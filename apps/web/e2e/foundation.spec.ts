import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mona:ui-locale', 'en-US')
  })
})

test('loads the React foundation and changes locale without browser errors', async ({ page }) => {
  const browserProblems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      browserProblems.push(`${message.type()}: ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => browserProblems.push(`pageerror: ${error.message}`))

  await page.goto('/')

  await expect(page).toHaveTitle('Mona Slides — React foundation')
  await expect(page.getByLabel('React migration foundation')).toBeVisible()
  await expect(page.getByText('Untitled presentation', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('combobox', { name: 'Language' }).click()
  await page.getByRole('option', { name: 'Simplified Chinese' }).click()

  await expect(page.getByRole('button', { name: '设置' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expect(page.getByText('Untitled presentation', { exact: true })).toBeVisible()
  expect(browserProblems).toEqual([])
})
