import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  outputDir: '../../.artifacts/react-playwright',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'line',
  expect: { timeout: 15_000 },
  // CI runners are virtualised and have no GPU; the same journeys that take
  // seconds on a laptop were being closed mid-click at the 30s default.
  timeout: process.env.CI ? 90_000 : 30_000,
  use: {
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
  },
  // One project, and it is not a browser. The fixture launches the Electron
  // application; `devices` and `viewport` do not apply to a window the shell
  // sizes itself, and `baseURL` does not apply to a page that is not a tab.
  projects: [{ name: 'electron' }],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 6174',
    url: 'http://127.0.0.1:6174',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
