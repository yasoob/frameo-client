// Real-frame end-to-end UI check. Only the exact ID from this upload is mutated.
import { chromium, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const base = process.env.FRAMEO_URL || 'http://127.0.0.1:8766'
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []; page.on('pageerror', e => errors.push(String(e)))
async function wait(job) {
  await expect.poll(async () => (await (await page.request.get(base + '/api/jobs')).json()).find(x => x.id === job.id)?.state, { timeout: 90000, intervals: [500, 1000] }).toBe('succeeded')
  return (await (await page.request.get(base + '/api/jobs')).json()).find(x => x.id === job.id)
}
async function clickJob(button) { const response = page.waitForResponse(r => r.url().endsWith('/actions') && r.request().method() === 'POST'); await button.click(); return wait(await (await response).json()) }
try {
  await page.goto(base); await expect(page.locator('.photo-card').first()).toBeVisible({ timeout: 60000 })
  const before = await page.locator('.photo-card').count()
  await page.getByRole('button', { name: 'Add photos', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles(fileURLToPath(new URL('../internal/server/testdata/transfer.png', import.meta.url)))
  await page.locator('textarea').fill('Temporary browser end-to-end test')
  const posted = page.waitForResponse(r => r.url().endsWith('/upload') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Send photos', exact: true }).click()
  const job = await wait(await (await posted).json()); const id = job.media_id
  if (!id) throw new Error('Server did not return the uploaded image ID')
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10000 })
  await expect(page.getByRole('button', { name: `Select photo ${id}`, exact: true })).toBeAttached({ timeout: 30000 })
  const select = () => page.getByRole('button', { name: `Select photo ${id}`, exact: true }).click({ force: true })
  await select(); await clickJob(page.getByRole('button', { name: 'Hide', exact: true }))
  await expect(page.locator('.hidden-badge')).toHaveCount(1, { timeout: 30000 })
  await select(); await clickJob(page.getByRole('button', { name: 'Show', exact: true }))
  await expect(page.locator('.hidden-badge')).toHaveCount(0, { timeout: 30000 })
  await select(); await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await clickJob(page.getByRole('button', { name: 'Delete from frame' }))
  await expect(page.getByRole('button', { name: `Select photo ${id}`, exact: true })).toHaveCount(0, { timeout: 30000 })
  await expect(page.locator('.photo-card')).toHaveCount(before)
  await fs.mkdir('../test-results', { recursive: true })
  await page.getByRole('button', { name: 'Close activity' }).click()
  await page.screenshot({ path: '../test-results/gallery-final.png' })
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: '../test-results/gallery-mobile-final.png' })
  if (errors.length) throw new Error(errors.join('\n'))
  console.log('Real UI: upload, acknowledgement, hide, show, confirmed delete passed. Library count:', before)
} finally { await browser.close() }
