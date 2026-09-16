import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { binaries, releaseChannel, publishRelease, verifiedAssets } from './publish-release.mjs'

const sha = 'a'.repeat(40), older = 'b'.repeat(40)
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'frameo-release-test-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  for (const name of binaries) {
    const body = Buffer.from(`Synthetic binary fixture: ${name}`)
    await fs.writeFile(path.join(directory, name), body)
    await fs.writeFile(path.join(directory, `${name}.sha256`), `${createHash('sha256').update(body).digest('hex')}  ${name}\n`)
  }
  return directory
}
function remote({ head = sha, tag = null, release = null, failUpload = false } = {}) {
  const calls = []
  return {
    calls,
    async request(method, endpoint, body) {
      calls.push({ method, endpoint, body })
      if (method === 'GET' && endpoint.endsWith('/git/ref/heads/master')) return { object: { type: 'commit', sha: head } }
      if (method === 'GET' && endpoint.includes('/git/ref/tags/')) return tag
      if (method === 'GET' && endpoint.includes('/git/tags/')) return { object: { type: 'commit', sha } }
      if (method === 'GET' && endpoint.includes('/releases?')) return release ? [release] : []
      if (method === 'POST' && endpoint.endsWith('/releases/generate-notes')) return { body: 'Generated release notes.' }
      if (method === 'POST' && endpoint.endsWith('/releases')) { release = { id: 1, assets: [], html_url: 'https://example.com/release', ...body }; return release }
      if (method === 'PATCH' && /\/releases\/\d+$/.test(endpoint)) { Object.assign(release, body); return release }
      if (method === 'GET' && /\/releases\/\d+$/.test(endpoint)) return release
      if (method === 'POST' && endpoint.endsWith('/git/refs')) return {}
      if (method === 'PATCH' && endpoint.endsWith('/git/refs/tags/development')) return {}
      throw new Error(`Unexpected request: ${method} ${endpoint}`)
    },
    async upload(tagName, files) {
      calls.push({ method: 'UPLOAD', tag: tagName })
      if (failUpload) throw new Error('Upload interrupted')
      release.assets = await Promise.all(files.map(async file => ({ name: path.basename(file), size: (await fs.stat(file)).size, state: 'uploaded' })))
    },
  }
}

test('classifies master, stable tags and prerelease tags', () => {
  assert.deepEqual(releaseChannel('refs/heads/master'), { tag: 'development', development: true, prerelease: true })
  assert.equal(releaseChannel('refs/tags/v0.2.2').prerelease, false)
  assert.equal(releaseChannel('refs/tags/v0.3.0-rc.1').prerelease, true)
  for (const ref of ['refs/heads/feature', 'refs/tags/development', 'refs/tags/version', 'refs/tags/v1.2']) assert.throws(() => releaseChannel(ref))
})
test('rejects corrupted or unexpected artifacts before publishing', async t => {
  const directory = await fixture(t)
  assert.equal((await verifiedAssets(directory)).length, 13)
  await fs.appendFile(path.join(directory, binaries[0]), 'corruption')
  await assert.rejects(verifiedAssets(directory), /Checksum mismatch/)
  await fs.writeFile(path.join(directory, 'unexpected.txt'), 'extra file')
  await assert.rejects(verifiedAssets(directory), /Unexpected release file/)
})
test('updates rolling tag and publishes all assets as a non-latest prerelease', async t => {
  const directory = await fixture(t)
  const client = remote({ tag: { object: { type: 'commit', sha: older } }, release: { id: 2, tag_name: 'development', draft: false, assets: [] } })
  const result = await publishRelease({ repo: 'example/project', ref: 'refs/heads/master', sha, directory }, client)
  assert.equal(result.assets, 13)
  assert.deepEqual(client.calls.find(c => c.endpoint?.endsWith('/git/refs/tags/development')).body, { sha, force: true })
  const publication = client.calls.at(-1)
  assert.deepEqual(publication.body, { draft: false, prerelease: true, make_latest: 'false' })
  assert(client.calls.findIndex(c => c.body?.draft === true) < client.calls.findIndex(c => c.method === 'UPLOAD'))
})
test('does not downgrade the rolling release when an older run is retried', async t => {
  const client = remote({ head: older }), directory = await fixture(t)
  const result = await publishRelease({ repo: 'example/project', ref: 'refs/heads/master', sha, directory }, client)
  assert.equal(result.status, 'skipped')
  assert(client.calls.every(c => c.method === 'GET'))
})
test('publishes annotated version tags without modifying their refs', async t => {
  const client = remote({ tag: { object: { type: 'tag', sha: older } } }), directory = await fixture(t)
  await publishRelease({ repo: 'example/project', ref: 'refs/tags/v0.2.2', sha, directory }, client)
  assert(!client.calls.some(c => c.method !== 'GET' && c.endpoint?.includes('/git/')))
  assert.deepEqual(client.calls.at(-1).body, { draft: false, prerelease: false, make_latest: 'legacy' })
})
test('never overwrites a published versioned release', async t => {
  const client = remote({ tag: { object: { type: 'commit', sha } }, release: { id: 1, tag_name: 'v0.2.2', draft: false, target_commitish: sha } }), directory = await fixture(t)
  const result = await publishRelease({ repo: 'example/project', ref: 'refs/tags/v0.2.2', sha, directory }, client)
  assert.equal(result.status, 'skipped')
  assert(client.calls.every(c => c.method === 'GET'))
})
test('a moved version tag cannot publish artifacts from a different commit', async t => {
  const client = remote({ tag: { object: { type: 'commit', sha: older } } }), directory = await fixture(t)
  await assert.rejects(publishRelease({ repo: 'example/project', ref: 'refs/tags/v0.2.2', sha, directory }, client), /tag no longer matches/)
  assert(client.calls.every(c => c.method === 'GET'))
})
test('tagged release candidates remain prereleases and use versioned release notes', async t => {
  const client = remote({ tag: { object: { type: 'commit', sha } }, release: { id: 2, tag_name: 'v0.2.2', prerelease: false, draft: false } }), directory = await fixture(t)
  await publishRelease({ repo: 'example/project', ref: 'refs/tags/v0.3.0-rc.1', sha, directory }, client)
  assert.equal(client.calls.find(c => c.endpoint?.endsWith('/releases/generate-notes')).body.previous_tag_name, 'v0.2.2')
  assert.deepEqual(client.calls.at(-1).body, { draft: false, prerelease: true, make_latest: 'false' })
})
test('a failed upload leaves the release unpublished', async t => {
  const client = remote({ failUpload: true }), directory = await fixture(t)
  await assert.rejects(publishRelease({ repo: 'example/project', ref: 'refs/heads/master', sha, directory }, client), /Upload interrupted/)
  assert(!client.calls.some(c => c.body?.draft === false))
})
