import { defineConfig, devices } from '@playwright/test'

const referenceURL = process.env.MONA_REFERENCE_URL || 'http://127.0.0.1:5173'

export default defineConfig({
  testDir: './tests/reference',
  outputDir: '.artifacts/playwright',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['line'], ['html', { outputFolder: 'playwright-report', open: 'never' }]] : 'line',
  expect: {
    timeout: 7_500,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.001,
      stylePath: './tests/reference/visual-stability.css',
    },
  },
  use: {
    baseURL: referenceURL,
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'UTC',
    contextOptions: {
      reducedMotion: 'reduce',
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'reference-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5173',
    url: referenceURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
