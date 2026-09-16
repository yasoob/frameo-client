// Publish only the six verified binary artifacts produced by this workflow run.
// The development channel is mutable; published versioned releases are preserved.
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

export const binaries = [
  'frameo-local-darwin-amd64',
  'frameo-local-darwin-arm64',
  'frameo-local-linux-amd64',
  'frameo-local-linux-arm64',
  'frameo-local-windows-amd64.exe',
  'frameo-local-windows-arm64.exe',
]
const versionTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/

export function releaseChannel(ref) {
  if (ref === 'refs/heads/master') return { tag: 'development', development: true, prerelease: true }
  const tag = ref.replace(/^refs\/tags\//, '')
  const match = ref.startsWith('refs/tags/') && tag.match(versionTag)
  if (!match) throw new Error('Publish from master or a version tag such as v0.2.2 or v0.3.0-rc.1.')
  return { tag, development: false, prerelease: Boolean(match[4]) }
}

export async function verifiedAssets(directory) {
  const allowed = new Set(binaries.flatMap(name => [name, `${name}.sha256`]).concat('SHA256SUMS'))
  for (const name of await fs.readdir(directory)) {
    if (!allowed.has(name)) throw new Error(`Unexpected release file: ${name}`)
  }
  const files = [], checksums = []
  for (const name of binaries) {
    const binary = path.join(directory, name), checksum = `${binary}.sha256`
    for (const file of [binary, checksum]) {
      const stat = await fs.lstat(file)
      if (!stat.isFile() || stat.size === 0) throw new Error(`Missing or invalid release file: ${file}`)
    }
    const hash = createHash('sha256').update(await fs.readFile(binary)).digest('hex')
    const expected = (await fs.readFile(checksum, 'utf8')).trim().split(/\s+\*?/)
    if (expected.length !== 2 || expected[0] !== hash || expected[1] !== name) throw new Error(`Checksum mismatch: ${name}`)
    checksums.push(`${hash}  ${name}`)
    files.push(binary, checksum)
  }
  const combined = path.join(directory, 'SHA256SUMS')
  await fs.writeFile(combined, checksums.join('\n') + '\n')
  return [...files, combined]
}

function gh(args, input, allowMissing = false) {
  const result = spawnSync('gh', args, { encoding: 'utf8', input: input === undefined ? undefined : JSON.stringify(input), maxBuffer: 16 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) {
    if (allowMissing && /HTTP 404/.test(result.stderr)) return null
    throw new Error(result.stderr.trim() || `gh exited with status ${result.status}`)
  }
  return result.stdout
}

export function githubClient(repo) {
  return {
    async request(method, endpoint, body, allowMissing = false) {
      const args = ['api', endpoint, '--method', method]
      if (body !== undefined) args.push('--input', '-')
      const output = gh(args, body, allowMissing)
      return output === null ? null : output.trim() ? JSON.parse(output) : null
    },
    async upload(tag, files) {
      gh(['release', 'upload', tag, ...files, '--repo', repo, '--clobber'])
    },
  }
}

async function listReleases(client, base) {
  const result = []
  for (let page = 1; ; page++) {
    const entries = await client.request('GET', `${base}/releases?per_page=100&page=${page}`)
    result.push(...entries)
    if (entries.length < 100) return result
  }
}

async function tagCommit(client, base, object) {
  for (let depth = 0; depth < 8; depth++) {
    if (object.type === 'commit') return object.sha
    if (object.type !== 'tag') throw new Error('Release tag does not point to a commit.')
    object = (await client.request('GET', `${base}/git/tags/${object.sha}`)).object
  }
  throw new Error('Too many nested annotated tags.')
}

export async function publishRelease({ repo, ref, sha, directory, runID }, client = githubClient(repo)) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[a-f0-9]{40}$/i.test(sha)) throw new Error('Invalid repository or commit SHA.')
  const channel = releaseChannel(ref), base = `repos/${repo}`
  const files = await verifiedAssets(directory)
  if (channel.development) {
    const head = await client.request('GET', `${base}/git/ref/heads/master`)
    if (head.object.sha !== sha) return { status: 'skipped', reason: 'A newer commit is already on master.', tag: channel.tag }
  }
  const tagPath = `${base}/git/ref/tags/${encodeURIComponent(channel.tag)}`
  const tag = await client.request('GET', tagPath, undefined, true)
  if (!channel.development && (!tag || await tagCommit(client, base, tag.object) !== sha)) {
    throw new Error('Version tag no longer matches the tested commit.')
  }
  const releases = await listReleases(client, base)
  let release = releases.find(item => item.tag_name === channel.tag)
  if (release && !release.draft && !channel.development) {
    if (release.target_commitish !== sha) throw new Error('Published version belongs to another commit; create a new version tag.')
    return { status: 'skipped', reason: 'This version is already published.', tag: channel.tag, url: release.html_url }
  }
  if (release?.immutable) throw new Error('The development release is immutable and cannot be updated.')

  const source = `Source commit: [\`${sha.slice(0, 12)}\`](https://github.com/${repo}/commit/${sha}).`
  const build = runID ? `\nBuild: https://github.com/${repo}/actions/runs/${runID}.` : ''
  let notes
  if (channel.development) {
    notes = `Latest successful development build from \`master\`.\n\nThese files change when a new development build is published.\n\n${source}${build}\n\nDownload the executable for your operating system and processor. Each executable has a SHA-256 checksum.`
  } else if (release?.body) {
    notes = release.body // Preserve notes when resuming a draft.
  } else {
    const previous = releases.find(item => !item.draft && item.tag_name !== channel.tag && versionTag.test(item.tag_name) && (channel.prerelease || !item.prerelease))
    const generated = previous ? await client.request('POST', `${base}/releases/generate-notes`, { tag_name: channel.tag, target_commitish: sha, previous_tag_name: previous.tag_name }) : { body: 'First versioned release of Frameo Local.' }
    notes = `${generated.body}\n\n${source}${build}`
  }

  // Keep incomplete or mixed asset sets out of the public release page.
  if (release && !release.draft) release = await client.request('PATCH', `${base}/releases/${release.id}`, { draft: true })
  if (channel.development) {
    if (tag) await client.request('PATCH', `${base}/git/refs/tags/development`, { sha, force: true })
    else await client.request('POST', `${base}/git/refs`, { ref: 'refs/tags/development', sha })
  }
  const metadata = { tag_name: channel.tag, target_commitish: sha, name: channel.development ? 'Latest development build' : channel.tag, body: notes, draft: true, prerelease: channel.prerelease }
  release = release
    ? await client.request('PATCH', `${base}/releases/${release.id}`, metadata)
    : await client.request('POST', `${base}/releases`, metadata)
  await client.upload(channel.tag, files)
  const uploaded = await client.request('GET', `${base}/releases/${release.id}`)
  for (const file of files) {
    const size = (await fs.stat(file)).size
    if (!uploaded.assets.some(asset => asset.name === path.basename(file) && asset.size === size && asset.state === 'uploaded')) {
      throw new Error(`Release asset upload is incomplete: ${path.basename(file)}`)
    }
  }
  release = await client.request('PATCH', `${base}/releases/${release.id}`, {
    draft: false, prerelease: channel.prerelease, make_latest: channel.prerelease ? 'false' : 'legacy',
  })
  return { status: 'published', tag: channel.tag, url: release.html_url, assets: files.length }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await publishRelease({ repo: process.env.GITHUB_REPOSITORY || '', ref: process.env.GITHUB_REF || '', sha: process.env.GITHUB_SHA || '', runID: process.env.GITHUB_RUN_ID, directory: path.resolve(process.argv[2] || 'release-assets') })
    console.log(JSON.stringify(result, null, 2))
    if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `## Release ${result.status}\n\n${result.url ? `[${result.tag}](${result.url})` : result.tag}\n\n${result.reason || `${result.assets} assets published.`}\n`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
