// Runs only against the local application. Mutations target the exact ID returned
// by this script's new upload. No existing photos are selected for mutation.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'

const base = process.env.FRAMEO_URL || 'http://127.0.0.1:8766'
const bootstrap = await (await fetch(base + '/api/bootstrap')).json()
const peer = bootstrap.frames[0].peer_id
async function api(path, body) {
  const form = body instanceof FormData
  const r = await fetch(base + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'X-Frameo-Token': bootstrap.token, ...(form ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : form ? body : JSON.stringify(body) })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}
async function wait(job) {
  const until = Date.now() + 180000
  while (Date.now() < until) {
    const status = (await api('/jobs')).find(j => j.id === job.id)
    if (status?.state === 'succeeded') return status
    if (status?.state === 'failed' || status?.state === 'cancelled') throw new Error(status.error || status.state)
    await new Promise(r => setTimeout(r, 300))
  }
  throw new Error('Job timed out')
}
const before = await api(`/frames/${peer}/media`)
const form = new FormData()
form.append('photo', new Blob([await fs.readFile(new URL('../internal/server/testdata/transfer.webp', import.meta.url))], { type: 'image/webp' }), 'integration-test.webp')
form.append('caption', 'Temporary Go integration test'); form.append('fit', 'true'); form.append('captured', String(Date.now()))
const upload = await wait(await api(`/frames/${peer}/upload`, form))
const id = upload.media_id
assert(id && !before.some(x => x.id === id))
let items = await api(`/frames/${peer}/media`)
assert(items.some(x => x.id === id))
assert(Math.abs(items.find(x => x.id === id).received - Date.now()) < 60000, 'timestamp encoding incorrect')
for (const [action, visible] of [['hide', false], ['show', true]]) {
  await wait(await api(`/frames/${peer}/actions`, { action, ids: [id] }))
  items = await api(`/frames/${peer}/media`); assert.equal(items.find(x => x.id === id).visible, visible)
}
const download = await fetch(`${base}/api/frames/${peer}/media/${id}?full=1`)
assert.equal(download.status, 200); assert.equal(download.headers.get('content-type'), 'image/webp')
assert((await download.arrayBuffer()).byteLength > 1000)
await wait(await api(`/frames/${peer}/actions`, { action: 'display', ids: [id] }))
await wait(await api(`/frames/${peer}/actions`, { action: 'delete', ids: [id] }))
const after = await api(`/frames/${peer}/media`)
assert(!after.some(x => x.id === id)); assert(before.every(x => after.some(y => x.id === y.id)))
const result = { upload: true, list: true, timestamps: true, download: true, hide: true, show: true, display_request: true, delete: true, before: before.length, after: after.length }
await fs.mkdir('test-results', { recursive: true }); await fs.writeFile('test-results/go-live.json', JSON.stringify(result, null, 2) + '\n')
console.log(result)
