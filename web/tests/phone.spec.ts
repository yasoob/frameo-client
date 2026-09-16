import { expect, test } from '@playwright/test'

const peer = 'a'.repeat(64), phoneToken = 'b'.repeat(64)
const frame = { peer_id: peer, name: 'Living room', placement: 'Home', width: 1280, height: 800, permissions: { view_photos: false, manage_photos: false }, protocol_version: 18 }
const target = { name: frame.name, placement: frame.placement, width: 1280, height: 800, expires_at: Date.now() + 900000 }
const file = { name: 'moment.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9ZkAAAAASUVORK5CYII=', 'base64') }

test('desktop QR is scoped to the selected frame and can be ended', async ({ page }) => {
  let ended = false, selectedPeer = ''
  const session = { active: true, peer, url: `http://192.168.1.10:54321/phone#t=${phoneToken}`, expires_at: Date.now() + 900000, connected: false, host: '192.168.1.10', networks: [{ host: '192.168.1.10', name: 'en0' }] }
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let data: unknown = []
    if (path.endsWith('/bootstrap')) data = { token: 'desktop', name: 'Test sender', frames: [frame] }
    if (path.endsWith('/info')) data = frame
    if (path.endsWith('/phone')) { data = session; if (route.request().method() === 'POST') selectedPeer = path.split('/')[3]; if (route.request().method() === 'DELETE') ended = true }
    await route.fulfill({ json: data })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Add from phone' }).click()
  await expect(page.locator('.qr-stage svg')).toHaveCount(1)
  await expect(page.getByLabel('Phone upload link')).toHaveValue(session.url)
  expect(selectedPeer).toBe(peer)
  await page.getByRole('button', { name: 'End phone session' }).click()
  await expect.poll(() => ended).toBe(true)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('mobile retry reuses upload ID and waits for frame acknowledgement', async ({ page }) => {
  const uploadIDs: string[] = []
  let polls = 0, desktopCalls = 0
  await page.route('**/api/**', route => { desktopCalls++; return route.fulfill({ status: 403 }) })
  await page.route('**/phone-api/**', async route => {
    expect(route.request().headers()['authorization']).toBe(`Bearer ${phoneToken}`)
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/session')) return route.fulfill({ json: target })
    if (path.endsWith('/upload')) {
      uploadIDs.push(route.request().headers()['x-upload-id'])
      if (uploadIDs.length === 1) return route.abort('failed')
      return route.fulfill({ json: { id: 'phone-job', state: 'running', progress: 0 } })
    }
    polls++
    return route.fulfill({ json: [{ id: 'phone-job', state: polls > 1 ? 'succeeded' : 'running', progress: .5 }] })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/phone#t=${phoneToken}`)
  await expect(page.getByRole('button', { name: /Choose photos/ })).toBeVisible()
  expect(page.url()).not.toContain(phoneToken)
  await page.locator('input[type=file]').setInputFiles(file)
  await page.getByRole('button', { name: 'Send 1 photo', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Retry remaining photos' })).toBeVisible()
  await page.getByRole('button', { name: 'Retry remaining photos' }).click()
  await expect(page.getByRole('heading', { name: 'They’re on the frame.' })).toBeVisible({ timeout: 15000 })
  expect(uploadIDs).toHaveLength(2); expect(uploadIDs[0]).toMatch(/^[0-9a-f]{32}$/); expect(uploadIDs[1]).toBe(uploadIDs[0])
  expect(desktopCalls).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
})

test('expired mobile link cannot select or send more photos', async ({ page }) => {
  await page.route('**/phone-api/**', route => route.fulfill({ status: 410, body: 'This phone link has expired.' }))
  await page.goto(`/phone#t=${phoneToken}`)
  await expect(page.getByRole('heading', { name: 'Let’s reconnect' })).toBeVisible()
  await expect(page.locator('input[type=file]')).toHaveCount(0)
})

test('iOS Safari canvas PNG fallback is sent to the app for conversion', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      return original.call(this, callback, type === 'image/webp' ? 'image/png' : type, quality)
    }
  })
  let pngUploaded = false
  await page.route('**/phone-api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/session')) return route.fulfill({ json: target })
    if (path.endsWith('/upload')) {
      const body = route.request().postDataBuffer()?.toString('latin1') || ''
      pngUploaded = body.includes('Content-Type: image/png') && body.includes('moment.png')
      return route.fulfill({ json: { id: 'safari-job', state: 'running', progress: 0 } })
    }
    return route.fulfill({ json: [{ id: 'safari-job', state: 'succeeded', progress: 1 }] })
  })
  await page.goto(`/phone#t=${phoneToken}`)
  await expect(page.getByRole('button', { name: /Choose photos/ })).toBeVisible()
  await page.locator('input[type=file]').setInputFiles(file)
  await page.getByRole('button', { name: 'Send 1 photo', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'They’re on the frame.' })).toBeVisible()
  expect(pngUploaded).toBe(true)
})
