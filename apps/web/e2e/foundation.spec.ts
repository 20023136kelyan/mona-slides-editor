import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mona:ui-locale', 'en-US')
  })
})

test('loads Mona Slides and changes locale without browser errors', async ({ page }) => {
  const browserProblems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      browserProblems.push(`${message.type()}: ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => browserProblems.push(`pageerror: ${error.message}`))

  await page.goto('/')

  await expect(page).toHaveTitle('Mona Slides')
  await expect(page.getByLabel('Mona Slides editor')).toBeVisible()
  await expect(page.getByText('Untitled presentation', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.locator('.mona-header-locale-select').click()
  await page.locator('.mona-panel-select-popover:visible .mona-panel-select-option').filter({ hasText: /^Simplified Chinese$/ }).click()

  await expect(page.locator('.mona-editor-header-item[aria-label="设置"]')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expect(page.getByText('Untitled presentation', { exact: true })).toBeVisible()
  expect(browserProblems).toEqual([])
})

test('renders the complete native fixture and selects a slide read-only', async ({ page }) => {
  const browserProblems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') browserProblems.push(`${message.type()}: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserProblems.push(`pageerror: ${error.message}`))

  await page.goto('/?rendererFixture=gate3-renderer')
  await expect(page.getByRole('button', { name: 'Show slide 4' })).toBeVisible()
  await expect(page.locator('.mona-thumbnail-rail [data-chart-ready] svg')).toBeVisible()

  await page.getByRole('button', { name: 'Show slide 3' }).click()
  await expect(page.getByRole('button', { name: 'Show slide 3' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.mona-render-stage [data-slide-id="gate3-slide-data"]')).toBeVisible()
  await expect(page.locator('.mona-render-stage [data-element-type="table"]')).toBeVisible()
  await expect(page.locator('.mona-render-stage [data-element-type="latex"]')).toBeVisible()
  await expect(page.getByRole('textbox')).toHaveCount(0)
  expect(browserProblems).toEqual([])
})
