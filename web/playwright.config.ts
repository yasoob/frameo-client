import { defineConfig } from '@playwright/test'

const baseURL = process.env.FRAMEO_URL || 'http://127.0.0.1:18766'

export default defineConfig({
  testDir: './tests', timeout: 30000,
  use: { baseURL, headless: true,
    launchOptions: { executablePath: process.env.CHROME_PATH } },
  webServer: process.env.FRAMEO_URL ? undefined : {
    command: 'go run ../cmd/frameo --no-open --port 18766 --state ../test-results/browser-state/device.json',
    url: baseURL,
    timeout: 120000,
    reuseExistingServer: false,
  },
  reporter: 'list', outputDir: '../test-results/browser',
})
