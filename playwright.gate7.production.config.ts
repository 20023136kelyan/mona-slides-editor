import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/gate7',
  testMatch: 'stabilization-production.spec.ts',
  outputDir: '.artifacts/gate7-production-playwright',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'line',
  expect: { timeout: 15_000 },
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'UTC',
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    // Real builds prune the fixture base JSON (exclude-development-fixtures);
    // the stability harness seeds it back so the production preview can load
    // the gate6-workflows fixture deck.
    command: 'cp public/mocks/gate3-renderer.json apps/web/dist/mocks/gate3-renderer.json && npm run preview -w @mona/web -- --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
