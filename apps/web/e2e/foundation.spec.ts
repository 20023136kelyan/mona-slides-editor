import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mona:ui-locale', 'en-US')
  })
})

test('loads Mona and changes locale without browser errors', async ({ page }) => {
  const browserProblems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      browserProblems.push(`${message.type()}: ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => browserProblems.push(`pageerror: ${error.message}`))

  await page.goto('/')

  await expect(page).toHaveTitle('Mona')
  await expect(page.getByLabel('Mona presentation editor')).toBeVisible()
  await expect(page.locator('.mona-editor-header-title-input')).toHaveValue('Untitled presentation')

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.locator('.mona-header-locale-select').click()
  await page.locator('.mona-panel-select-popover:visible .mona-panel-select-option').filter({ hasText: /^Simplified Chinese$/ }).click()

  await expect(page.locator('.mona-editor-header-item[aria-label="设置"]')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expect(page.locator('.mona-editor-header-title-input')).toHaveValue('Untitled presentation')
  expect(browserProblems).toEqual([])
})

test('renders the complete native fixture and selects a slide read-only', async ({ page }) => {
  const browserProblems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') browserProblems.push(`${message.type()}: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserProblems.push(`pageerror: ${error.message}`))

  await page.goto('/?developmentFixture=renderer')
  await expect(page.getByRole('button', { name: 'Show slide 4' })).toBeVisible()
  await expect(page.locator('.mona-thumbnail-rail [data-chart-ready] svg')).toBeVisible()

  await page.getByRole('button', { name: 'Show slide 3' }).click()
  await expect(page.getByRole('button', { name: 'Show slide 3' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.mona-render-stage [data-slide-id="fixture-slide-data"]')).toBeVisible()
  await expect(page.locator('.mona-render-stage [data-element-type="table"]')).toBeVisible()
  await expect(page.locator('.mona-render-stage [data-element-type="latex"]')).toBeVisible()
  await expect(page.locator('.mona-render-stage').getByRole('textbox')).toHaveCount(0)
  expect(browserProblems).toEqual([])
})

test('keeps the canvas, left task panel, and resizable AI dock structurally independent on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?developmentFixture=slides')

  const stage = page.locator('.mona-editor-stage')
  const initialStageWidth = (await stage.boundingBox())!.width

  await page.getByRole('button', { name: 'Generate presentation with AI' }).click()
  await expect(page.getByRole('complementary', { name: 'Mona AI' })).toBeVisible()
  await expect(page.getByRole('separator', { name: 'Resize AI panel' })).toBeVisible()
  await expect(page.locator('.mona-agent-dialog')).toHaveCount(0)
  expect((await stage.boundingBox())!.width).toBeLessThan(initialStageWidth)

  await page.getByRole('navigation', { name: 'Editor tools' }).getByRole('button', { name: 'Elements' }).click()
  await expect(page.getByRole('complementary', { name: 'Elements' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Mona AI' })).toBeVisible()

  const leftPanel = await page.locator('.mona-editor-drawer').boundingBox()
  const canvas = await stage.boundingBox()
  const agentDock = await page.locator('.mona-agent-dock').boundingBox()
  expect(leftPanel).not.toBeNull()
  expect(canvas).not.toBeNull()
  expect(agentDock).not.toBeNull()
  expect(leftPanel!.x + leftPanel!.width).toBeLessThanOrEqual(canvas!.x)
  expect(canvas!.x + canvas!.width).toBeLessThanOrEqual(agentDock!.x)

  const widthBeforeKeyboardResize = agentDock!.width
  const separator = page.getByRole('separator', { name: 'Resize AI panel' })
  await separator.focus()
  await separator.press('ArrowLeft')
  await expect.poll(async () => (await page.locator('.mona-agent-dock').boundingBox())!.width).not.toBe(widthBeforeKeyboardResize)
})
