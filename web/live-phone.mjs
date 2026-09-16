// Simulate a phone browser over the real LAN interface, then verify its upload on
// the frame. Cleanup targets only the exact media ID created by this test.
import { chromium, webkit, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const base = process.env.FRAMEO_URL || 'http://127.0.0.1:8766'
const browser = process.env.BROWSER === 'webkit' ? await webkit.launch({ headless: true }) : await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
const context = await browser.newContext()
const desktop = await context.newPage(); await desktop.setViewportSize({ width: 1440, height: 1000 })
let createdID = '', peer = '', adminToken = '', phoneURL = ''
async function admin(path, body, method) {
  const r = await fetch(base + '/api' + path, { method: method || (body === undefined ? 'GET' : 'POST'), headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Frameo-Token': adminToken }, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!r.ok) throw new Error(await r.text()); return r.json()
}
async function wait(job) {
  await expect.poll(async () => (await admin('/jobs')).find(j => j.id === job.id)?.state, { timeout: 90000, intervals: [500, 1000] }).toBe('succeeded')
  return (await admin('/jobs')).find(j => j.id === job.id)
}
try {
  const boot = await admin('/bootstrap'); adminToken = boot.token; peer = boot.frames[0].peer_id
  const before = await admin(`/frames/${peer}/media`)
  await desktop.goto(base); await expect(desktop.getByRole('button', { name: 'Add from phone' })).toBeEnabled({ timeout: 45000 })
  await desktop.getByRole('button', { name: 'Add from phone' }).click()
  await expect(desktop.getByLabel('Phone upload link')).toBeVisible(); phoneURL = await desktop.getByLabel('Phone upload link').inputValue()
  await fs.mkdir('../test-results', { recursive: true }); await desktop.screenshot({ path: '../test-results/phone-qr.png' })
  const phone = await context.newPage(); await phone.setViewportSize({ width: 390, height: 844 })
  if (process.env.SAFARI_CANVAS === '1') await phone.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      return original.call(this, callback, type === 'image/webp' ? 'image/png' : type, quality)
    }
  })
  const errors = []; phone.on('pageerror', e => errors.push(String(e)))
  await phone.goto(phoneURL)
  await expect(phone.getByRole('button', { name: /Choose photos/ })).toBeVisible()
  console.log('LAN phone page is secure context:', await phone.evaluate(() => isSecureContext))
  console.log('Canvas WebP request produces:', await phone.evaluate(() => new Promise(resolve => { const c=document.createElement('canvas');c.width=c.height=1;c.toBlob(b=>resolve(b?.type),'image/webp') })))
  await phone.screenshot({ path: '../test-results/phone-welcome.png' })
  await phone.locator('input[type=file]').setInputFiles(fileURLToPath(new URL('../internal/server/testdata/transfer.png', import.meta.url)))
  await phone.locator('textarea').fill('Temporary phone handoff test')
  await phone.screenshot({ path: '../test-results/phone-selected.png' })
  const posted = phone.waitForResponse(r => r.url().endsWith('/phone-api/upload') && r.request().method() === 'POST')
  await phone.getByRole('button', { name: 'Send 1 photo', exact: true }).click()
  const accepted = await (await posted).json(); const finished = await wait(accepted); createdID = finished.media_id
  await expect(phone.getByRole('heading', { name: 'They’re on the frame.' })).toBeVisible({ timeout: 30000 })
  await phone.screenshot({ path: '../test-results/phone-received.png' })
  if (errors.length) throw new Error(errors.join('\n'))
  const after = await admin(`/frames/${peer}/media`)
  if (!createdID || !after.some(x => x.id === createdID) || before.some(x => x.id === createdID)) throw new Error('Uploaded photo could not be verified safely')
  const thumb = await fetch(`${base}/api/frames/${peer}/media/${createdID}`)
  if (!thumb.ok || !(thumb.headers.get('content-type') || '').startsWith('image/') || (await thumb.arrayBuffer()).byteLength < 100) throw new Error('Frame could not render a thumbnail of the converted image')
  const receiverOrigin = new URL(phoneURL).origin
  const privateAPI = await fetch(receiverOrigin + '/api/bootstrap')
  if (privateAPI.status !== 404) throw new Error('Phone port exposes the management API')
  console.log('Phone → Go app → frame succeeded. Admin API isolation passed. Library:', before.length, '→', after.length)
  await wait(await admin(`/frames/${peer}/actions`, { action: 'delete', ids: [createdID] })); createdID = ''
  const final = await admin(`/frames/${peer}/media`)
  if (!before.every(x => final.some(y => y.id === x.id))) throw new Error('A pre-existing photo disappeared')
  console.log('Dedicated phone test photo cleaned up. Library:', final.length)
} finally {
  if (createdID && adminToken) { try { await wait(await admin(`/frames/${peer}/actions`, { action: 'delete', ids: [createdID] })) } catch (e) { console.error('Test-photo cleanup failed:', String(e)) } }
  if (adminToken && process.env.KEEP_PHONE_SESSION !== '1') await admin('/phone', {}, 'DELETE').catch(() => {})
  await browser.close()
}
