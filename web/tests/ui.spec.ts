import { expect, test } from '@playwright/test'

const peer = 'a'.repeat(64)
const frame = { peer_id: peer, name: 'Living room', placement: 'Home', width: 1280, height: 800, permissions: { view_photos: true, manage_photos: true }, protocol_version: 18 }
const media = [{ id: '-9007199254740993', type: 'photo', visible: true, received: 1704153600000, captured: 1704153600000 }, { id: '9223372036854775806', type: 'photo', visible: false, received: 1704067200000, captured: 1704067200000 }]

test('gallery filters, exact 64-bit IDs and delete confirmation', async ({ page }) => {
  let action: unknown = null
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let data: unknown = []
    if (path.endsWith('/bootstrap')) data = { token: 'test', name: 'My computer', frames: [frame] }
    else if (path.endsWith('/info')) data = frame
    else if (path.endsWith('/media')) data = media
    else if (path.endsWith('/actions')) { action = route.request().postDataJSON(); data = { id: 'test-job', kind: 'action', state: 'running' } }
    else if (path.includes('/media/')) { await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#ccd6ee"/></svg>' }); return }
    await route.fulfill({ json: data })
  })
  await page.goto('/')
  await expect(page.locator('.photo-card')).toHaveCount(2)
  await page.getByRole('tab', { name: /Hidden/ }).click()
  await expect(page.locator('.photo-card')).toHaveCount(1)
  await page.getByRole('button', { name: `Select photo ${media[1].id}`, exact: true }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Delete 1 photo?' })).toBeVisible()
  expect(action).toBeNull()
  await page.getByRole('button', { name: 'Keep photos' }).click()
  expect(action).toBeNull()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('button', { name: 'Delete from frame' }).click()
  await expect.poll(() => action).toEqual({ action: 'delete', ids: [media[1].id] })
})

test('first-run discovery, pairing and accessible keyboard dialog', async ({ page }) => {
  let pairing: any = null
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let data: unknown = []
    if (path.endsWith('/bootstrap')) data = { token: 'test', name: 'My computer', frames: [] }
    if (path.endsWith('/discover')) data = [{ instance: peer.slice(0, 63), host: '192.168.1.20', port: 40000, hostname: 'Frame.local.' }]
    if (path.endsWith('/pair')) { pairing = route.request().postDataJSON(); data = { id: 'pair-job', kind: 'pair', state: 'running' } }
    await route.fulfill({ json: data })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Connect your first frame' }).click()
  await expect(page.getByRole('dialog', { name: 'Connect a frame' })).toBeVisible()
  await page.getByRole('button', { name: /Frame 192.168.1.20/ }).click()
  await page.getByRole('textbox', { name: 'Friend code' }).fill('12 34 56 78 90')
  await page.getByRole('button', { name: 'Connect frame', exact: true }).click()
  await expect.poll(() => pairing?.code).toBe('12 34 56 78 90')
  expect(pairing.service.port).toBe(40000)
})

test('permission gating and mobile layout', async ({ page }) => {
  let requested = false
  const locked = { ...frame, permissions: { view_photos: false, manage_photos: false } }
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let data: unknown = []
    if (path.endsWith('/bootstrap')) data = { token: 'test', name: 'My computer', frames: [locked] }
    if (path.endsWith('/info')) data = locked
    if (path.endsWith('/permissions')) { requested = true; data = { id: 'p-job', kind: 'permission', peer, state: 'running' } }
    await route.fulfill({ json: data })
  })
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/')
  await expect(page.getByRole('button', { name: 'Request photo access' })).toBeEnabled()
  await page.getByRole('button', { name: 'Request photo access' }).click()
  await expect(page.getByRole('dialog')).toContainText('Allow')
  await page.getByRole('button', { name: 'Send request' }).click()
  await expect.poll(() => requested).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await page.getByRole('button', { name: 'Close activity' }).click()
  await page.getByRole('button', { name: 'Add photos', exact: true }).click()
  await expect(page.locator('input[type=file]')).toBeHidden()
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0)
})
