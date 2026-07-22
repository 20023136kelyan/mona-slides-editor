import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

import type { PresentationState } from '@mona/presentation-core'

interface VueState {
  editor: { showMarkupPanel: boolean }
  history: { snapshotCursor: number; snapshotLength: number }
  presentation: PresentationState
}

interface ReactState {
  presentation: PresentationState
  session: { openPanels: string[] }
}

declare global {
  interface Window {
    __MONA_TEST__?: { getState: () => VueState; isReady: () => boolean }
    __MONA_REACT_TEST__?: {
      getHistoryState: () => { cursor: number; length: number }
      getState: () => ReactState
      isReady: () => boolean
    }
  }
}

const fixturePath = '/?rendererFixture=gate6-workflows'

async function openEditors(browser: Browser) {
  const sourceContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const destinationContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await Promise.all([sourceContext, destinationContext].map(context => context.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US'))))
  const vue = await sourceContext.newPage()
  const react = await destinationContext.newPage()
  await Promise.all([
    vue.goto(`http://127.0.0.1:5173${fixturePath}`),
    react.goto(`http://127.0.0.1:5174${fixturePath}`),
  ])
  await Promise.all([
    expect(vue.locator('.pptist-editor')).toBeVisible(),
    expect(react.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible(),
    vue.waitForFunction(() => window.__MONA_TEST__?.isReady()),
    react.waitForFunction(() => window.__MONA_REACT_TEST__?.isReady()),
  ])
  return { destinationContext, react, sourceContext, vue }
}

async function closeEditors(sourceContext: BrowserContext, destinationContext: BrowserContext) {
  await Promise.all([sourceContext.close(), destinationContext.close()])
}

async function sourceState(page: Page) {
  return page.evaluate(() => structuredClone(window.__MONA_TEST__!.getState()))
}

async function destinationState(page: Page) {
  return page.evaluate(() => structuredClone(window.__MONA_REACT_TEST__!.getState()))
}

async function history(page: Page, app: 'react' | 'vue') {
  if (app === 'react') return page.evaluate(() => window.__MONA_REACT_TEST__!.getHistoryState())
  return page.evaluate(() => {
    const value = window.__MONA_TEST__!.getState().history
    return { cursor: value.snapshotCursor, length: value.snapshotLength }
  })
}

const roundedRect = (rect: { height: number; width: number; x: number; y: number } | null) => rect && ({
  height: Math.round(rect.height * 100) / 100,
  width: Math.round(rect.width * 100) / 100,
  x: Math.round(rect.x * 100) / 100,
  y: Math.round(rect.y * 100) / 100,
})

async function compareRaster(source: Locator, destination: Locator, maxVisiblePixelDelta: number, maxRawChannelDelta: number) {
  const [sourceBuffer, destinationBuffer] = await Promise.all([source.screenshot(), destination.screenshot()])
  const expected = PNG.sync.read(sourceBuffer)
  const actual = PNG.sync.read(destinationBuffer)
  expect({ height: actual.height, width: actual.width }).toEqual({ height: expected.height, width: expected.width })
  const visible = pixelmatch(expected.data, actual.data, null, expected.width, expected.height, { threshold: 0 })
  let raw = 0
  for (let index = 0; index < expected.data.length; index += 1) raw = Math.max(raw, Math.abs(expected.data[index]! - actual.data[index]!))
  expect.soft(visible, 'visible raster pixels').toBeLessThanOrEqual(maxVisiblePixelDelta)
  expect(raw, 'maximum raw channel delta').toBeLessThanOrEqual(maxRawChannelDelta)
}

async function openMainMenu(vue: Page, react: Page) {
  await Promise.all([
    vue.locator('.editor-header .left .menu-item').first().click(),
    react.getByRole('button', { name: 'Menu' }).click(),
  ])
  await Promise.all([
    expect(vue.locator('.tippy-content:visible .main-menu')).toBeVisible(),
    expect(react.locator('.mona-editor-main-menu')).toBeVisible(),
  ])
  await Promise.all([vue.waitForTimeout(250), react.waitForTimeout(250)])
}

test('header chassis, title, menu, screening, and settings popovers match source geometry and rendering', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const sourceHeader = vue.locator('.editor-header')
  const destinationHeader = react.locator('.mona-editor-header')
  expect(roundedRect(await destinationHeader.boundingBox())).toEqual(roundedRect(await sourceHeader.boundingBox()))
  expect((await destinationHeader.textContent())?.replace(/\s/g, '')).toBe((await sourceHeader.textContent())?.replace(/\s/g, ''))
  await compareRaster(sourceHeader, destinationHeader, 0, 0)

  await openMainMenu(vue, react)
  const sourceMain = vue.locator('.tippy-content:visible').filter({ has: vue.locator('.main-menu') })
  const destinationMain = react.locator('.mona-editor-main-menu')
  expect(roundedRect(await destinationMain.boundingBox())).toEqual(roundedRect(await sourceMain.boundingBox()))
  expect((await destinationMain.textContent())?.replace(/\s/g, '')).toBe((await sourceMain.textContent())?.replace(/\s/g, ''))
  await compareRaster(sourceMain, destinationMain, 5800, 9)

  await Promise.all([vue.keyboard.press('Escape'), react.keyboard.press('Escape')])
  await Promise.all([expect(sourceMain).toBeVisible(), expect(destinationMain).toBeVisible()])
  await Promise.all([vue.mouse.click(700, 500), react.mouse.click(700, 500)])
  await Promise.all([expect(sourceMain).toBeHidden(), expect(destinationMain).toHaveCount(0)])
  await Promise.all([vue.waitForTimeout(220), react.waitForTimeout(220)])

  await Promise.all([
    vue.locator('.group-menu-item .arrow-btn').click(),
    react.locator('.mona-header-screen-arrow').click(),
  ])
  await Promise.all([vue.waitForTimeout(250), react.waitForTimeout(250)])
  const sourceScreen = vue.locator('.tippy-content:visible .popover-content')
  const destinationScreen = react.locator('.mona-header-screen-menu')
  expect(roundedRect(await destinationScreen.boundingBox())).toEqual(roundedRect(await sourceScreen.boundingBox()))
  expect((await destinationScreen.textContent())?.replace(/\s/g, '')).toBe((await sourceScreen.textContent())?.replace(/\s/g, ''))
  await compareRaster(sourceScreen, destinationScreen, 100, 9)
  await Promise.all([vue.keyboard.press('Escape'), react.keyboard.press('Escape')])
  await Promise.all([expect(sourceScreen).toBeVisible(), expect(destinationScreen).toBeVisible()])
  await Promise.all([vue.mouse.click(700, 500), react.mouse.click(700, 500)])
  await Promise.all([vue.waitForTimeout(220), react.waitForTimeout(220)])

  await Promise.all([
    vue.getByRole('button', { name: 'Settings' }).click(),
    react.getByRole('button', { name: 'Settings' }).click(),
  ])
  await Promise.all([vue.waitForTimeout(250), react.waitForTimeout(250)])
  const sourceSettings = vue.locator('.tippy-content:visible .popover-content')
  const destinationSettings = react.locator('.mona-header-settings-menu')
  expect(roundedRect(await destinationSettings.boundingBox())).toEqual(roundedRect(await sourceSettings.boundingBox()))
  expect((await destinationSettings.textContent())?.replace(/\s/g, '')).toBe((await sourceSettings.textContent())?.replace(/\s/g, ''))
  await compareRaster(sourceSettings, destinationSettings, 10, 9)

  await Promise.all([vue.mouse.click(700, 500), react.mouse.click(700, 500)])
  await Promise.all([expect(sourceSettings).toBeHidden(), expect(destinationSettings).toHaveCount(0)])
  await closeEditors(sourceContext, destinationContext)
})

test('title editing, empty fallback, and history semantics match source', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const initialHistory = await history(vue, 'vue')
  expect(await history(react, 'react')).toEqual(initialHistory)

  await Promise.all([
    vue.locator('.editor-header .title-text').click(),
    react.locator('.mona-editor-header-title-text').click(),
  ])
  const sourceInput = vue.locator('.editor-header .title-input input')
  const destinationInput = react.locator('.mona-editor-header-title-input')
  await Promise.all([expect(sourceInput).toBeFocused(), expect(destinationInput).toBeFocused()])
  expect(roundedRect(await destinationInput.boundingBox())).toEqual(roundedRect(await vue.locator('.editor-header .title-input').boundingBox()))
  await Promise.all([sourceInput.fill('Chrome parity title'), destinationInput.fill('Chrome parity title')])
  await Promise.all([sourceInput.blur(), destinationInput.blur()])
  await Promise.all([vue.waitForTimeout(380), react.waitForTimeout(380)])
  expect((await destinationState(react)).presentation.title).toBe((await sourceState(vue)).presentation.title)
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))

  await Promise.all([
    vue.locator('.editor-header .title-text').click(),
    react.locator('.mona-editor-header-title-text').click(),
  ])
  await Promise.all([
    vue.locator('.editor-header .title-input input').fill(''),
    react.locator('.mona-editor-header-title-input').fill(''),
  ])
  await Promise.all([
    vue.locator('.editor-header .title-input input').blur(),
    react.locator('.mona-editor-header-title-input').blur(),
  ])
  await Promise.all([vue.waitForTimeout(380), react.waitForTimeout(380)])
  expect((await destinationState(react)).presentation.title).toBe('Untitled presentation')
  expect((await destinationState(react)).presentation.title).toBe((await sourceState(vue)).presentation.title)
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))
  await closeEditors(sourceContext, destinationContext)
})

test('reset and markup routes preserve complete source state and history behavior', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await openMainMenu(vue, react)
  await Promise.all([
    vue.getByText('Label slide types', { exact: true }).click(),
    react.getByText('Label slide types', { exact: true }).click(),
  ])
  await Promise.all([
    expect(vue.locator('.notes-panel')).toBeVisible(),
    expect(react.locator('.mona-markup-panel')).toBeVisible(),
  ])
  expect((await sourceState(vue)).editor.showMarkupPanel).toBe(true)
  expect((await destinationState(react)).session.openPanels).toContain('markup')

  await openMainMenu(vue, react)
  await Promise.all([
    vue.getByText('Reset presentation', { exact: true }).click(),
    react.getByText('Reset presentation', { exact: true }).click(),
  ])
  await Promise.all([vue.waitForTimeout(380), react.waitForTimeout(380)])
  const source = await sourceState(vue)
  const destination = await destinationState(react)
  expect(destination.presentation.slides).toHaveLength(1)
  expect(destination.presentation.slides[0]).toMatchObject({ elements: [], background: source.presentation.slides[0]!.background })
  expect(destination.presentation.slideIndex).toBe(source.presentation.slideIndex)
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))
  await closeEditors(sourceContext, destinationContext)
})

test('keyboard shortcut drawer content, geometry, rendering, and close animation match source', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await openMainMenu(vue, react)
  await Promise.all([
    vue.locator('.tippy-content:visible .popover-menu-item').nth(3).click(),
    react.locator('.mona-editor-main-menu .mona-header-popover-menu-item').nth(3).click(),
  ])
  const source = vue.locator('.drawer.right')
  const destination = react.locator('.mona-hotkey-drawer')
  await Promise.all([expect(source).toBeVisible(), expect(destination).toBeVisible()])
  await Promise.all([vue.waitForTimeout(280), react.waitForTimeout(280)])
  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))
  expect((await destination.textContent())?.replace(/\s/g, '')).toBe((await source.textContent())?.replace(/\s/g, ''))
  await compareRaster(source, destination, 450, 9)

  await Promise.all([
    source.locator('.close-btn').click(),
    destination.getByRole('button', { name: 'Close' }).click(),
  ])
  await Promise.all([vue.waitForTimeout(120), react.waitForTimeout(120)])
  expect((await source.boundingBox())?.x).toBeGreaterThan(1120)
  expect((await destination.boundingBox())?.x).toBeGreaterThan(1120)
  await Promise.all([expect(source).toBeHidden({ timeout: 500 }), expect(destination).toHaveCount(0, { timeout: 500 })])
  await closeEditors(sourceContext, destinationContext)
})

test('locale settings switch the complete chrome and persist the same product locale', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await Promise.all([
    vue.getByRole('button', { name: 'Settings' }).click(),
    react.getByRole('button', { name: 'Settings' }).click(),
  ])
  await Promise.all([
    vue.locator('.settings-menu .select').click(),
    react.locator('.mona-header-locale-select').click(),
  ])
  await Promise.all([
    vue.locator('.options:visible .option').filter({ hasText: /^Simplified Chinese$/ }).click(),
    react.locator('.mona-panel-select-popover:visible .mona-panel-select-option').filter({ hasText: /^Simplified Chinese$/ }).click(),
  ])
  await Promise.all([
    expect(vue.locator('.editor-header .title-text')).toBeVisible(),
    expect(react.locator('.mona-editor-header-title-text')).toBeVisible(),
  ])
  await Promise.all([
    expect(vue.locator('html')).toHaveAttribute('lang', 'zh-CN'),
    expect(react.locator('html')).toHaveAttribute('lang', 'zh-CN'),
  ])
  expect(await vue.evaluate(() => localStorage.getItem('mona:ui-locale'))).toBe('zh-CN')
  expect(await react.evaluate(() => localStorage.getItem('mona:ui-locale'))).toBe('zh-CN')
  expect((await react.locator('.mona-editor-header').textContent())?.replace(/\s/g, '')).toBe((await vue.locator('.editor-header').textContent())?.replace(/\s/g, ''))
  await closeEditors(sourceContext, destinationContext)
})
