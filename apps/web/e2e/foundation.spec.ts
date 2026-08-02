import { join } from 'node:path'

import { configureLocalSaveFolder, expect, openApp, resizeWindow, test } from './electron-fixture'

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

  await openApp(page)

  await expect(page).toHaveTitle('Presentations - Mona')
  await expect(page.getByRole('heading', { name: 'Presentations' })).toBeVisible()
  const homeSidebar = page.getByRole('navigation', { name: 'Mona navigation' })
  await expect(page.getByRole('button', { name: 'New presentation' }).first()).toBeVisible()
  await expect(page.locator('header')).toHaveCount(0)

  await homeSidebar.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('combobox', { name: 'Language', exact: true }).click()
  await page.getByRole('option', { name: 'Simplified Chinese', exact: true }).click()

  await expect(page.getByRole('heading', { name: '演示文稿' })).toBeVisible()
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  expect(browserProblems).toEqual([])
})

test('keeps one sidebar shell, collapse state, and geometry across Home and Editor', async ({ app, page }, testInfo) => {
  const viewport = await resizeWindow(app, 1440, 900)
  test.skip(!viewport.fits, `needs a 1440x900 window; this display is ${viewport.display}`)
  await openApp(page)
  await configureLocalSaveFolder(app, page, join(testInfo.outputDir, 'presentations'))

  const homeSidebar = page.getByRole('navigation', { name: 'Mona navigation' })
  const homeHeader = homeSidebar.locator('[data-sidebar="header"]')
  await expect(homeSidebar).toBeVisible()
  const expandedHomeBox = await homeSidebar.boundingBox()
  const homeHeaderBox = await homeHeader.boundingBox()
  expect(expandedHomeBox?.width).toBe(224)
  expect(homeHeaderBox?.height).toBe(44)

  await homeSidebar.getByRole('button', { name: 'Collapse sidebar' }).click()
  // Wait for the shared sidebar transition to finish. Sampling only the
  // "under 100px" threshold could capture an in-between fractional width and
  // compare that animation frame with the settled editor shell.
  await expect.poll(async () => (await homeSidebar.boundingBox())?.width).toBe(97)
  const collapsedHomeWidth = (await homeSidebar.boundingBox())!.width

  // Route-specific content changes, while the shared sidebar state remains.
  await page.getByRole('button', { name: 'New presentation' }).first().click()
  await page.waitForURL(/\/documents\/[^/?]+/)
  const editorSidebar = page.getByRole('navigation', { name: 'Editor tools' })
  await expect(editorSidebar).toBeVisible()
  expect((await editorSidebar.boundingBox())?.width).toBe(collapsedHomeWidth)
  expect((await editorSidebar.locator('[data-sidebar="header"]').boundingBox())?.height).toBe(44)

  await page.getByRole('menubar', { name: 'Menu bar' }).getByRole('button', { name: 'Expand sidebar' }).click()
  await expect.poll(async () => (await editorSidebar.boundingBox())?.width).toBe(224)
  await editorSidebar.getByRole('button', { name: 'All presentations' }).click()
  await expect(page.getByRole('navigation', { name: 'Mona navigation' })).toBeVisible()
  expect((await page.getByRole('navigation', { name: 'Mona navigation' }).boundingBox())?.width).toBe(224)
})

test('renders the complete native fixture and selects a slide read-only', async ({ page }) => {
  const browserProblems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') browserProblems.push(`${message.type()}: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserProblems.push(`pageerror: ${error.message}`))

  await openApp(page, '?developmentFixture=renderer')
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

test('keeps the canvas, left task panel, and AI dock structurally independent on desktop', async ({ app, page }) => {
  const viewport = await resizeWindow(app, 1440, 900)
  test.skip(!viewport.fits, `needs a 1440x900 window; this display is ${viewport.display}`)
  await openApp(page, '?developmentFixture=slides')

  const stage = page.locator('.mona-editor-stage')
  const initialStageWidth = (await stage.boundingBox())!.width

  await page.getByRole('button', { name: 'Generate presentation with AI' }).click()
  await expect(page.getByRole('complementary', { name: 'Mona AI' })).toBeVisible()
  await expect(page.locator('.mona-agent-dialog')).toHaveCount(0)
  // The dock floats over the canvas but reserves its width, so the fitted
  // stage shrinks to sit beside it.
  expect((await stage.boundingBox())!.width).toBeLessThan(initialStageWidth)

  await page.getByRole('navigation', { name: 'Editor tools' }).getByRole('button', { name: 'Shape' }).click()
  await expect(page.getByRole('complementary', { name: 'Elements' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Mona AI' })).toBeVisible()

  const leftPanel = await page.locator('.mona-editor-drawer').boundingBox()
  const canvas = await stage.boundingBox()
  const agentDock = await page.locator('.mona-agent-dock').boundingBox()
  expect(leftPanel).not.toBeNull()
  expect(canvas).not.toBeNull()
  expect(agentDock).not.toBeNull()
  // Both panels float over the canvas, yet the fitted stage sits cleanly
  // between them — drawer on the left, dock on the right.
  expect(leftPanel!.x + leftPanel!.width).toBeLessThanOrEqual(canvas!.x)
  expect(canvas!.x + canvas!.width).toBeLessThanOrEqual(agentDock!.x)
})
