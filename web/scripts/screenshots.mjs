// Capture documentation images without loading a user's frame data or photos.
// API requests use synthetic data. Photo URLs are replaced in the DOM before
// each capture, and all other network requests are blocked.
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = path.join(root, 'docs', 'screenshots')
const temporary = path.join(root, 'test-results', 'documentation')
const base = 'http://127.0.0.1:18767'
const peer = 'a'.repeat(64)
const demoToken = '0'.repeat(64)
const now = Date.UTC(2026, 0, 15, 12)
const frame = { peer_id: peer, name: 'Living room', placement: 'Home', host: '192.0.2.20', port: 40000, width: 1280, height: 800, protocol_version: 18, permissions: { view_photos: true, manage_photos: true } }
const media = Array.from({ length: 8 }, (_, i) => ({ id: String(101 + i), type: 'photo', visible: i < 6, received: Date.UTC(2025, 5, 18 - i), captured: Date.UTC(2025, 5, 18 - i) }))
const session = { id: 'documentation-example', active: true, peer, host: '192.0.2.10', url: `http://192.0.2.10:40000/phone#t=${demoToken}`, expires_at: now + 900000, connected: false, networks: [{ name: 'Example network', host: '192.0.2.10' }] }
const photos = [
  ['photo-1470770841072-f978cf4d019e', 'Mountain lake'],
  ['photo-1507525428034-b723cf961d3e', 'A quiet beach'],
  ['photo-1441974231531-c6227db76b6e', 'Sunlight in a forest'],
  ['photo-1464822759023-fed622ff2c3b', 'Mountain peaks'],
  ['photo-1500530855697-b586d89ba3ee', 'Desert road'],
  ['photo-1476514525535-07fb3b4ae5f1', 'Lakeside scenery'],
  ['photo-1518837695005-2083093ee35b', 'Ocean waves'],
  ['photo-1519681393784-d120267933ba', 'Mountains under the stars'],
].map(([id, description]) => ({ description, url: `https://images.unsplash.com/${id}?auto=format&fit=crop&w=720&h=540&q=85` }))

await fs.mkdir(output, { recursive: true })
await fs.mkdir(temporary, { recursive: true })
const stock = new Map(await Promise.all(photos.map(async photo => {
  const response = await fetch(photo.url, { signal: AbortSignal.timeout(45000) })
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error(`Stock image failed: ${photo.url}`)
  return [photo.url, { body: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') }]
})))

const server = spawn('go', ['run', './cmd/frameo', '--no-open', '--port', '18767', '--state', path.join(temporary, 'device.json')], { cwd: root, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
let serverLog = ''
server.stdout.on('data', b => { serverLog += b.toString() })
server.stderr.on('data', b => { serverLog += b.toString() })
let browser
try {
  const until = Date.now() + 90000
  while (true) {
    if (server.exitCode !== null) throw new Error(`Screenshot server stopped: ${serverLog}`)
    if (serverLog.includes(base)) break
    if (Date.now() > until) throw new Error('Screenshot server did not start')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', bypassCSP: true })
  const unexpected = []
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (stock.has(request.url())) return route.fulfill(stock.get(request.url()))
    if (url.origin !== base) { unexpected.push(request.url()); return route.abort() }
    const p = url.pathname
    if (request.method() === 'GET' && (p === '/' || p === '/phone' || p.startsWith('/assets/'))) return route.continue()
    if (p === '/favicon.ico') return route.fulfill({ status: 204 })
    if (p === '/api/bootstrap') return route.fulfill({ json: { token: 'documentation-session', name: 'Photo sender', frames: [frame] } })
    if (p === '/api/frames') return route.fulfill({ json: [frame] })
    if (p === '/api/jobs' || p === '/phone-api/jobs') return route.fulfill({ json: [] })
    if (p === `/api/frames/${peer}/info`) return route.fulfill({ json: frame })
    if (p === `/api/frames/${peer}/media`) return route.fulfill({ json: media })
    if (p.startsWith(`/api/frames/${peer}/media/`)) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="540"><rect width="720" height="540" fill="#edf0f5"/></svg>' })
    if (p === `/api/frames/${peer}/phone` || p === '/api/phone') return route.fulfill({ json: session })
    if (p === '/phone-api/session') return route.fulfill({ json: { name: frame.name, placement: frame.placement, width: 1280, height: 800, expires_at: session.expires_at } })
    unexpected.push(request.url()); return route.abort()
  })

  async function replacePhotoDOM(page, indices = photos.map((_, i) => i)) {
    await page.evaluate(({ photos, indices }) => {
      const images = [...document.querySelectorAll('.photo-card img, .phone-photo img, .lightbox-image img')]
      images.forEach((image, i) => {
        const stock = photos[indices[i % indices.length]]
        image.removeAttribute('srcset'); image.removeAttribute('sizes')
        image.loading = 'eager'; image.src = stock.url; image.alt = stock.description
      })
    }, { photos, indices })
    await page.locator('.photo-card img, .phone-photo img, .lightbox-image img').evaluateAll(images => Promise.all(images.map(image => image.decode())))
  }

  async function checkCapture(page, expectedImages) {
    if (unexpected.length) throw new Error(`Unexpected network request: ${unexpected.join(', ')}`)
    const details = await page.evaluate(() => ({
      images: [...document.querySelectorAll('img')].map(i => ({ src: i.currentSrc || i.src, width: i.naturalWidth })),
      title: document.querySelector('.frame-name, .phone-destination strong')?.textContent,
      values: [...document.querySelectorAll('input')].filter(i => i.type !== 'file').map(i => i.value),
      hasError: !!document.querySelector('[role="alert"]'),
    }))
    if (details.title !== frame.name || details.hasError || details.images.length !== expectedImages) throw new Error('Unexpected screenshot content')
    for (const image of details.images) if (!stock.has(image.src) || image.width === 0) throw new Error('A photo was not replaced with an approved stock image')
    for (const value of details.values) if (value.includes('http') && value !== session.url) throw new Error('Unexpected device link in screenshot')
  }

  const desktop = await context.newPage()
  await desktop.clock.setFixedTime(now)
  await desktop.goto(base)
  await desktop.waitForSelector('.photo-card')
  await desktop.getByRole('button', { name: 'Select photo 101', exact: true }).click({ force: true })
  await desktop.getByRole('button', { name: 'Select photo 102', exact: true }).click({ force: true })
  await replacePhotoDOM(desktop)
  await checkCapture(desktop, 8)
  await desktop.screenshot({ path: path.join(output, 'gallery.png'), animations: 'disabled' })

  await desktop.locator('.selection-bar').getByRole('button', { name: 'Clear selection', exact: true }).click()
  await desktop.getByRole('button', { name: 'Add from phone' }).click()
  await desktop.getByLabel('Phone upload link').waitFor()
  await replacePhotoDOM(desktop)
  await checkCapture(desktop, 8)
  const qr = await desktop.getByRole('dialog', { name: 'Add photos from your phone' }).screenshot({ animations: 'disabled' })

  const phone = await context.newPage()
  await phone.setViewportSize({ width: 390, height: 900 })
  await phone.clock.setFixedTime(now)
  await phone.goto(`${base}/phone#t=${demoToken}`)
  await phone.getByRole('button', { name: /Choose photos/ }).waitFor()
  const fixture = await fs.readFile(path.join(root, 'internal/server/testdata/transfer.png'))
  await phone.locator('input[type=file]').setInputFiles(['lake.png', 'forest.png', 'coast.png'].map(name => ({ name, mimeType: 'image/png', buffer: fixture })))
  await phone.locator('textarea').fill('A few favorites from our trip.')
  await phone.getByRole('heading', { level: 1 }).click()
  await replacePhotoDOM(phone, [0, 2, 1])
  await checkCapture(phone, 3)
  const mobile = await phone.screenshot({ fullPage: true, animations: 'disabled' })

  // Compose the two already-sanitized captures for a compact README figure.
  const figure = await context.newPage()
  await figure.setViewportSize({ width: 1060, height: 1060 })
  await figure.setContent(`<!doctype html><html lang="en"><style>
    *{box-sizing:border-box}body{margin:0;background:#f4f6fa;font-family:Arial,sans-serif;color:#64738c}
    main{display:flex;gap:48px;padding:34px;align-items:flex-start;justify-content:center}
    section{display:flex;flex-direction:column;align-items:center;gap:16px}
    h2{margin:0;font-size:14px;font-weight:500}img{display:block;max-width:100%;border-radius:14px;box-shadow:0 8px 28px #20304d10}
  </style><main><section style="width:480px"><h2>Scan the code on your computer</h2><img alt="Example QR dialog" src="data:image/png;base64,${qr.toString('base64')}"></section>
  <section style="width:390px"><h2>Choose photos on your phone</h2><img alt="Phone upload page with stock photos" src="data:image/png;base64,${mobile.toString('base64')}"></section></main></html>`)
  await figure.locator('img').evaluateAll(images => Promise.all(images.map(i => i.decode())))
  const height = await figure.locator('main').evaluate(el => Math.ceil(el.getBoundingClientRect().height))
  await figure.setViewportSize({ width: 1060, height })
  await figure.screenshot({ path: path.join(output, 'phone-transfer.png'), animations: 'disabled' })
  console.log('Created gallery.png and phone-transfer.png with stock imagery and synthetic device data.')
} finally {
  await browser?.close()
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' })
  } else {
    try { process.kill(-server.pid, 'SIGTERM') } catch { /* server already stopped */ }
  }
}
