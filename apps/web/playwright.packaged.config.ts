import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e-packaged',
  globalSetup: './e2e-packaged/global-setup.ts',
  outputDir: '../../.artifacts/packaged-playwright',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: 'line',
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  workers: 1,
  use: {
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
  },
  projects: [{ name: `packaged-${process.platform}-${process.arch}` }],
})
