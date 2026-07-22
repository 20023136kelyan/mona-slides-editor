import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

import type { PresentationState } from '@mona/presentation-core'

interface VueState {
  history: { snapshotCursor: number; snapshotLength: number }
  presentation: PresentationState
}

interface ReactState {
  presentation: PresentationState
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

async function presentation(page: Page, app: 'react' | 'vue') {
  return page.evaluate(appName => structuredClone(appName === 'vue' ? window.__MONA_TEST__!.getState().presentation : window.__MONA_REACT_TEST__!.getState().presentation), app)
}

async function history(page: Page, app: 'react' | 'vue') {
  if (app === 'react') return page.evaluate(() => window.__MONA_REACT_TEST__!.getHistoryState())
  return page.evaluate(() => {
    const value = window.__MONA_TEST__!.getState().history
    return { cursor: value.snapshotCursor, length: value.snapshotLength }
  })
}

async function expectPresentationParity(vue: Page, react: Page) {
  expect(await presentation(react, 'react')).toEqual(await presentation(vue, 'vue'))
}

async function settleHistoryParity(vue: Page, react: Page) {
  await Promise.all([vue.waitForTimeout(380), react.waitForTimeout(380)])
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))
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

async function chooseSelect(vue: Page, react: Page, sourceRoot: Locator, destinationRoot: Locator, index: number, label: string) {
  await Promise.all([
    sourceRoot.locator('.select').nth(index).click(),
    destinationRoot.locator('.mona-panel-select').nth(index).click(),
  ])
  await Promise.all([
    vue.locator('.options:visible .option').filter({ hasText: new RegExp(`^${label}$`) }).click(),
    react.locator('.mona-panel-select-popover:visible .mona-panel-select-option').filter({ hasText: new RegExp(`^${label}$`) }).click(),
  ])
}

async function dragHorizontal(page: Page, locator: Locator, deltaX: number) {
  const rect = await locator.boundingBox()
  if (!rect) throw new Error('Expected horizontal drag geometry')
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2)
  await page.mouse.down()
  await page.mouse.move(rect.x + rect.width / 2 + deltaX, rect.y + rect.height / 2, { steps: 6 })
  await page.mouse.up()
}

async function dragVerticalTo(page: Page, locator: Locator, target: Locator) {
  const [rect, targetRect] = await Promise.all([locator.boundingBox(), target.boundingBox()])
  if (!rect || !targetRect) throw new Error('Expected vertical drag geometry')
  const startX = rect.x + rect.width / 2
  const startY = rect.y + rect.height / 2
  const endX = targetRect.x + targetRect.width / 2
  const endY = targetRect.y + targetRect.height - 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  // Sortable animates each displaced row for 200 ms. A human drag crosses
  // those boundaries over time; pausing at each segment prevents the probe
  // from sampling only the first in-flight reorder.
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(startX + ((endX - startX) * step / 6), startY + ((endY - startY) * step / 6))
    await page.waitForTimeout(220)
  }
  await page.mouse.up()
}

async function editHexColor(vue: Page, react: Page, sourceButton: Locator, destinationButton: Locator, hex: string, closeWithEscape = false) {
  await Promise.all([sourceButton.click(), destinationButton.click()])
  await Promise.all([
    vue.locator('.color-picker:visible .input-content').fill(hex),
    react.locator('.mona-color-picker:visible .mona-color-picker-hex input').fill(hex),
  ])
  if (closeWithEscape) await Promise.all([vue.keyboard.press('Escape'), react.keyboard.press('Escape')])
  else {
    await Promise.all([
      sourceButton.locator('xpath=ancestor::*[contains(@class,"row")][1]').click({ position: { x: 4, y: 4 } }),
      destinationButton.locator('xpath=ancestor::*[contains(@class,"row")][1]').click({ position: { x: 4, y: 4 } }),
    ])
    // Tippy retains the source popover during its 200 ms scale-out.
    await Promise.all([vue.waitForTimeout(220), react.waitForTimeout(220)])
  }
}

test('slide design chassis, inventories, geometry, and initial rendering match source', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const source = vue.locator('.toolbar > .content')
  const destination = react.locator('.mona-inspector-content')
  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))
  expect((await destination.textContent())?.replace(/\s/g, '')).toBe((await source.textContent())?.replace(/\s/g, ''))
  expect(await destination.locator('.mona-preset-theme').count()).toBe(await source.locator('.theme-item').count())
  // Chromium rasterizes a few anti-aliased icon/text edge pixels differently
  // across the Vue and React trees; geometry and every fully opaque pixel match.
  await compareRaster(source, destination, 519, 64)
  await closeEditors(sourceContext, destinationContext)
})

test('slide transition inventory, selection, apply-all semantics, notice, state, history, and rendering match source', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await Promise.all([
    vue.locator('.toolbar .tabs.card .tab').nth(1).click(),
    react.locator('.mona-inspector-tabs button').nth(1).click(),
  ])
  const source = vue.locator('.slide-animation-panel')
  const destination = react.locator('.mona-slide-transition-panel')
  await Promise.all([expect(source).toBeVisible(), expect(destination).toBeVisible()])
  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))
  expect((await destination.textContent())?.replace(/\s/g, '')).toBe((await source.textContent())?.replace(/\s/g, ''))
  expect(await destination.locator('.mona-slide-transition-item').count()).toBe(await source.locator('.animation-item').count())
  await compareRaster(source, destination, 0, 0)

  const initialHistory = await history(vue, 'vue')
  expect(await history(react, 'react')).toEqual(initialHistory)
  await Promise.all([
    source.getByRole('button', { name: 'Apply to all slides' }).click(),
    destination.getByRole('button', { name: 'Apply to all slides' }).click(),
  ])
  await Promise.all([vue.waitForTimeout(380), react.waitForTimeout(380)])
  await expectPresentationParity(vue, react)
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))
  await Promise.all([
    expect(vue.getByText('Applied to all slides')).toBeVisible(),
    expect(react.getByText('Applied to all slides')).toBeVisible(),
  ])

  const sourceItems = source.locator('.animation-item')
  const destinationItems = destination.locator('.mona-slide-transition-item')
  for (let index = 0; index < 12; index += 1) {
    await Promise.all([sourceItems.nth(index).click(), destinationItems.nth(index).click()])
    await expectPresentationParity(vue, react)
    expect(await destinationItems.nth(index).getAttribute('aria-pressed')).toBe('true')
  }
  await Promise.all([vue.waitForTimeout(380), react.waitForTimeout(380)])
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))

  await Promise.all([
    source.getByRole('button', { name: 'Apply to all slides' }).click(),
    destination.getByRole('button', { name: 'Apply to all slides' }).click(),
  ])
  await Promise.all([vue.waitForTimeout(380), react.waitForTimeout(380)])
  await expectPresentationParity(vue, react)
  expect((await presentation(react, 'react')).slides.every(slide => slide.turningMode === 'scaleReverse')).toBe(true)
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))
  await closeEditors(sourceContext, destinationContext)
})

test('solid, gradient, and image backgrounds preserve source editing, stop gestures, upload, apply-all, and history', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const source = vue.locator('.slide-design-panel')
  const destination = react.locator('.mona-slide-design-panel')
  const initialHistory = await history(vue, 'vue')

  await chooseSelect(vue, react, source, destination, 0, 'Gradient fill')
  await expectPresentationParity(vue, react)
  await settleHistoryParity(vue, react)
  expect(await source.locator('.gradient-bar .point').count()).toBe(2)
  expect(await destination.locator('.mona-design-gradient-bar-point').count()).toBe(2)

  await chooseSelect(vue, react, source, destination, 1, 'Radial gradient')
  await expectPresentationParity(vue, react)
  await settleHistoryParity(vue, react)
  await chooseSelect(vue, react, source, destination, 1, 'Linear gradient')
  await expectPresentationParity(vue, react)
  await settleHistoryParity(vue, react)
  expect({
    bar: roundedRect(await destination.locator('.mona-design-gradient-bar-track').boundingBox()),
    wrapper: roundedRect(await destination.locator('.mona-design-gradient-bar').boundingBox()),
  }).toEqual({
    bar: roundedRect(await source.locator('.gradient-bar .bar').boundingBox()),
    wrapper: roundedRect(await source.locator('.gradient-bar').boundingBox()),
  })

  await Promise.all([
    source.locator('.gradient-bar .bar').click({ position: { x: 90, y: 8 } }),
    destination.locator('.mona-design-gradient-bar-track').click({ position: { x: 90, y: 8 } }),
  ])
  await expectPresentationParity(vue, react)
  await settleHistoryParity(vue, react)
  expect(await destination.locator('.mona-design-gradient-bar-point').count()).toBe(3)
  expect(roundedRect(await destination.locator('.mona-design-gradient-bar-point').nth(1).boundingBox())).toEqual(roundedRect(await source.locator('.gradient-bar .point').nth(1).boundingBox()))
  await Promise.all([
    dragHorizontal(vue, source.locator('.gradient-bar .point').nth(1), 25),
    dragHorizontal(react, destination.locator('.mona-design-gradient-bar-point').nth(1), 25),
  ])
  await expectPresentationParity(vue, react)
  await settleHistoryParity(vue, react)
  await Promise.all([
    source.locator('.gradient-bar .point').nth(1).click({ button: 'right' }),
    destination.locator('.mona-design-gradient-bar-point').nth(1).click({ button: 'right' }),
  ])
  await expectPresentationParity(vue, react)
  await settleHistoryParity(vue, react)
  expect(await destination.locator('.mona-design-gradient-bar-point').count()).toBe(2)

  const sourceSlider = source.locator('.background-gradient-wrapper .slider')
  const destinationSlider = destination.locator('.mona-background-gradient .mona-panel-slider')
  await Promise.all([dragHorizontal(vue, sourceSlider, 45), dragHorizontal(react, destinationSlider, 45)])
  await expectPresentationParity(vue, react)
  await settleHistoryParity(vue, react)

  await Promise.all([
    source.locator('.background-gradient-wrapper .color-btn').click(),
    destination.locator('.mona-background-gradient .mona-panel-color-button').click(),
  ])
  await Promise.all([
    vue.locator('.color-picker:visible .input-content').fill('336699'),
    react.locator('.mona-color-picker:visible .mona-color-picker-hex input').fill('336699'),
  ])
  await expectPresentationParity(vue, react)
  await Promise.all([vue.keyboard.press('Escape'), react.keyboard.press('Escape')])
  await settleHistoryParity(vue, react)

  await chooseSelect(vue, react, source, destination, 0, 'Image fill')
  await expectPresentationParity(vue, react)
  await settleHistoryParity(vue, react)
  await chooseSelect(vue, react, source, destination, 1, 'Tile')
  await expectPresentationParity(vue, react)
  await settleHistoryParity(vue, react)
  const image = {
    name: 'background.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#336699"/></svg>'),
  }
  await Promise.all([
    source.locator('.background-image-wrapper input[type="file"]').setInputFiles(image),
    destination.locator('.mona-background-image-upload input[type="file"]').setInputFiles(image),
  ])
  await expect.poll(async () => JSON.stringify(await presentation(react, 'react')) === JSON.stringify(await presentation(vue, 'vue'))).toBe(true)
  await settleHistoryParity(vue, react)

  await chooseSelect(vue, react, source, destination, 0, 'Solid fill')
  await expectPresentationParity(vue, react)
  await settleHistoryParity(vue, react)
  await Promise.all([
    source.locator(':scope > .row .color-btn').first().click(),
    destination.locator('.mona-design-split-row .mona-panel-color-button').click(),
  ])
  await Promise.all([
    vue.locator('.color-picker:visible .input-content').fill('EEDDBB'),
    react.locator('.mona-color-picker:visible .mona-color-picker-hex input').fill('EEDDBB'),
  ])
  await expectPresentationParity(vue, react)
  await Promise.all([vue.keyboard.press('Escape'), react.keyboard.press('Escape')])
  await settleHistoryParity(vue, react)

  await Promise.all([
    source.getByRole('button', { name: 'Apply background to all slides' }).click(),
    destination.getByRole('button', { name: 'Apply background to all slides' }).click(),
  ])
  await settleHistoryParity(vue, react)
  await expectPresentationParity(vue, react)
  const state = await presentation(react, 'react')
  expect(state.slides.every(slide => JSON.stringify(slide.background) === JSON.stringify(state.slides[0]!.background))).toBe(true)
  expect(await history(react, 'react')).toEqual({ cursor: initialHistory.cursor + 14, length: initialHistory.length + 14 })
  await closeEditors(sourceContext, destinationContext)
})

test('preset and custom viewport sizes match source state, modal geometry, Enter lifecycle, and non-history behavior', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const source = vue.locator('.slide-design-panel')
  const destination = react.locator('.mona-slide-design-panel')
  const initialHistory = await history(vue, 'vue')
  await chooseSelect(vue, react, source, destination, 1, 'Standard 4:3')
  await expectPresentationParity(vue, react)
  expect((await presentation(react, 'react')).viewportRatio).toBe(.75)
  expect(await history(react, 'react')).toEqual(initialHistory)

  await chooseSelect(vue, react, source, destination, 1, 'Custom')
  const sourceModal = vue.locator('.modal-content:visible')
  const destinationModal = react.locator('.mona-source-modal-content')
  await Promise.all([expect(sourceModal).toBeVisible(), expect(destinationModal).toBeVisible()])
  // Both products use the source 250 ms fade/zoom entrance. Compare the
  // settled dialog rather than sampling two different animation frames.
  await Promise.all([vue.waitForTimeout(300), react.waitForTimeout(300)])
  expect(roundedRect(await destinationModal.boundingBox())).toEqual(roundedRect(await sourceModal.boundingBox()))
  expect((await destinationModal.textContent())?.replace(/\s/g, '')).toBe((await sourceModal.textContent())?.replace(/\s/g, ''))
  // One anti-aliased edge pixel differs by two channel values in Chromium.
  await compareRaster(sourceModal, destinationModal, 1, 2)
  const sourceInputs = sourceModal.locator('input')
  const destinationInputs = destinationModal.locator('input')
  await Promise.all([sourceInputs.nth(0).fill('1200'), destinationInputs.nth(0).fill('1200')])
  await Promise.all([sourceInputs.nth(1).fill('800'), destinationInputs.nth(1).fill('800')])
  await Promise.all([sourceInputs.nth(1).press('Enter'), destinationInputs.nth(1).press('Enter')])
  await Promise.all([expect(sourceModal).toBeHidden(), expect(destinationModal).toBeHidden()])
  await expectPresentationParity(vue, react)
  const state = await presentation(react, 'react')
  expect({ ratio: state.viewportRatio, size: state.viewportSize }).toEqual({ ratio: 2 / 3, size: 1200 })
  expect(await history(vue, 'vue')).toEqual(initialHistory)
  expect(await history(react, 'react')).toEqual(initialHistory)
  await closeEditors(sourceContext, destinationContext)
})

test('global theme controls, expanded outline/shadow controls, state, non-history behavior, and rendering match source', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const source = vue.locator('.slide-design-panel')
  const destination = react.locator('.mona-slide-design-panel')
  const initialHistory = await history(vue, 'vue')

  await chooseSelect(vue, react, source, destination, 2, 'Inter')
  await expectPresentationParity(vue, react)

  const sourceFontColor = source.getByText('Font color:', { exact: true }).locator('..').locator('.color-btn')
  const destinationFontColor = destination.getByText('Font color:', { exact: true }).locator('..').locator('.mona-panel-color-button')
  await editHexColor(vue, react, sourceFontColor, destinationFontColor, '225588')
  await expectPresentationParity(vue, react)

  const sourceBackgroundColor = source.getByText('Background color:', { exact: true }).locator('..').locator('.color-btn')
  const destinationBackgroundColor = destination.getByText('Background color:', { exact: true }).locator('..').locator('.mona-panel-color-button')
  await editHexColor(vue, react, sourceBackgroundColor, destinationBackgroundColor, 'F1E8D7')
  await expectPresentationParity(vue, react)

  await Promise.all([source.locator('.more').click(), destination.locator('.mona-design-more').click()])
  expect((await destination.textContent())?.replace(/\s/g, '')).toBe((await source.textContent())?.replace(/\s/g, ''))
  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))

  await Promise.all([source.locator('.select').nth(3).click(), destination.locator('.mona-panel-select').nth(3).click()])
  await Promise.all([
    vue.locator('.options:visible .option').nth(1).click(),
    react.locator('.mona-panel-select-popover:visible .mona-panel-select-option').nth(1).click(),
  ])
  await expectPresentationParity(vue, react)

  const sourceBorderColor = source.getByText('Border color:', { exact: true }).locator('..').locator('.color-btn')
  const destinationBorderColor = destination.getByText('Border color:', { exact: true }).locator('..').locator('.mona-panel-color-button')
  await editHexColor(vue, react, sourceBorderColor, destinationBorderColor, 'AABBCC')
  await expectPresentationParity(vue, react)

  const sourceBorderWidth = source.getByText('Border width:', { exact: true }).locator('..').locator('input')
  const destinationBorderWidth = destination.getByText('Border width:', { exact: true }).locator('..').locator('input')
  await Promise.all([sourceBorderWidth.fill('5'), destinationBorderWidth.fill('5')])
  await Promise.all([sourceBorderWidth.press('Enter'), destinationBorderWidth.press('Enter')])
  await expectPresentationParity(vue, react)

  const sliderLabels = ['Horizontal shadow:', 'Vertical shadow:', 'Blur radius:']
  const sliderDeltas = [32, -21, 48]
  for (let index = 0; index < sliderLabels.length; index += 1) {
    const sourceSlider = source.getByText(sliderLabels[index]!, { exact: true }).locator('..').locator('.slider')
    const destinationSlider = destination.getByText(sliderLabels[index]!, { exact: true }).locator('..').locator('.mona-panel-slider')
    await Promise.all([dragHorizontal(vue, sourceSlider, sliderDeltas[index]!), dragHorizontal(react, destinationSlider, sliderDeltas[index]!)])
    await expectPresentationParity(vue, react)
  }

  const sourceShadowColor = source.getByText('Shadow color:', { exact: true }).locator('..').locator('.color-btn')
  const destinationShadowColor = destination.getByText('Shadow color:', { exact: true }).locator('..').locator('.mona-panel-color-button')
  await editHexColor(vue, react, sourceShadowColor, destinationShadowColor, '334455')
  await expectPresentationParity(vue, react)
  await Promise.all([vue.waitForTimeout(380), react.waitForTimeout(380)])
  expect(await history(vue, 'vue')).toEqual(initialHistory)
  expect(await history(react, 'react')).toEqual(initialHistory)
  await closeEditors(sourceContext, destinationContext)
})

test('theme-color modal preserves source geometry, local color editing, drag reorder, close lifecycle, state, and non-history behavior', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const source = vue.locator('.slide-design-panel')
  const destination = react.locator('.mona-slide-design-panel')
  const initialHistory = await history(vue, 'vue')
  await Promise.all([
    source.getByText('Theme color:', { exact: true }).locator('..').locator('.color-btn').click(),
    destination.getByText('Theme color:', { exact: true }).locator('..').locator('.mona-theme-color-list').click(),
  ])
  const sourceModal = vue.locator('.modal-content:visible')
  const destinationModal = react.locator('.mona-source-modal-content')
  await Promise.all([expect(sourceModal).toBeVisible(), expect(destinationModal).toBeVisible()])
  await Promise.all([vue.waitForTimeout(300), react.waitForTimeout(300)])
  expect(roundedRect(await destinationModal.boundingBox())).toEqual(roundedRect(await sourceModal.boundingBox()))
  expect((await destinationModal.textContent())?.replace(/\s/g, '')).toBe((await sourceModal.textContent())?.replace(/\s/g, ''))
  // The DOM, bounds, fills, and text are exact; the remaining delta is the
  // same framework-level anti-aliasing seen on the complete design panel.
  await compareRaster(sourceModal, destinationModal, 466, 62)

  const sourceRows = sourceModal.locator('.theme-colors-setting .row')
  const destinationRows = destinationModal.locator('.mona-theme-colors-row')
  expect(await destinationRows.count()).toBe(await sourceRows.count())
  const sourceFirstColor = sourceRows.first().locator('.color-btn')
  const destinationFirstColor = destinationRows.first().locator('.mona-panel-color-button')
  await editHexColor(vue, react, sourceFirstColor, destinationFirstColor, 'E2534D', false)
  await Promise.all([
    dragVerticalTo(vue, sourceRows.first().locator('.label'), sourceRows.last().locator('.label')),
    dragVerticalTo(react, destinationRows.first().locator('.mona-theme-colors-label'), destinationRows.last().locator('.mona-theme-colors-label')),
  ])
  const [sourceColors, destinationColors] = await Promise.all([
    sourceRows.locator('.color-block .content').evaluateAll(items => items.map(item => getComputedStyle(item).backgroundColor)),
    destinationRows.locator('.mona-panel-color-swatch > span').evaluateAll(items => items.map(item => getComputedStyle(item).backgroundColor)),
  ])
  expect(destinationColors).toEqual(sourceColors)

  await Promise.all([
    sourceModal.getByRole('button', { name: 'Confirm' }).click(),
    destinationModal.getByRole('button', { name: 'Confirm' }).click(),
  ])
  await Promise.all([vue.waitForTimeout(100), react.waitForTimeout(100)])
  await Promise.all([expect(sourceModal).toBeVisible(), expect(destinationModal).toBeVisible()])
  await Promise.all([vue.waitForTimeout(200), react.waitForTimeout(200)])
  await Promise.all([expect(sourceModal).toBeHidden(), expect(destinationModal).toBeHidden()])
  await expectPresentationParity(vue, react)
  expect((await presentation(react, 'react')).theme.themeColors.at(-1)).toBe('rgba(226,83,77,1)')
  expect(await history(vue, 'vue')).toEqual(initialHistory)
  expect(await history(react, 'react')).toEqual(initialHistory)
  await closeEditors(sourceContext, destinationContext)
})

test('preset Set and Set-and-apply, theme application modes, and font application preserve the complete source graph and history', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const source = vue.locator('.slide-design-panel')
  const destination = react.locator('.mona-slide-design-panel')
  const initialHistory = await history(vue, 'vue')
  const initialSlides = (await presentation(vue, 'vue')).slides
  const sourceThemes = source.locator('.theme-item')
  const destinationThemes = destination.locator('.mona-preset-theme')

  await Promise.all([
    sourceThemes.nth(6).locator('.btns .button').first().click(),
    destinationThemes.nth(6).locator('.mona-preset-theme-actions button').first().click(),
  ])
  await expectPresentationParity(vue, react)
  expect((await presentation(react, 'react')).slides).toEqual(initialSlides)
  await Promise.all([vue.waitForTimeout(380), react.waitForTimeout(380)])
  expect(await history(react, 'react')).toEqual(initialHistory)

  await Promise.all([
    sourceThemes.nth(7).locator('.btns .button').nth(1).click(),
    destinationThemes.nth(7).locator('.mona-preset-theme-actions button').nth(1).click(),
  ])
  await settleHistoryParity(vue, react)
  await expectPresentationParity(vue, react)

  await chooseSelect(vue, react, source, destination, 2, 'Inter')
  await Promise.all([
    source.getByRole('button', { name: 'Apply theme to all slides' }).click(),
    destination.getByRole('button', { name: 'Apply theme to all slides' }).click(),
  ])
  await settleHistoryParity(vue, react)
  await expectPresentationParity(vue, react)

  await chooseSelect(vue, react, source, destination, 2, 'Roboto')
  await Promise.all([
    source.getByRole('button', { name: 'Use font throughout' }).click(),
    destination.getByRole('button', { name: 'Use font throughout' }).click(),
  ])
  await settleHistoryParity(vue, react)
  await expectPresentationParity(vue, react)

  await Promise.all([source.locator('.more').click(), destination.locator('.mona-design-more').click()])
  const sourceShadow = source.getByText('Horizontal shadow:', { exact: true }).locator('..').locator('.slider')
  const destinationShadow = destination.getByText('Horizontal shadow:', { exact: true }).locator('..').locator('.mona-panel-slider')
  await Promise.all([dragHorizontal(vue, sourceShadow, 45), dragHorizontal(react, destinationShadow, 45)])
  await expectPresentationParity(vue, react)
  await Promise.all([
    source.getByRole('button', { name: 'Apply theme to all slides' }).click(),
    destination.getByRole('button', { name: 'Apply theme to all slides' }).click(),
  ])
  await settleHistoryParity(vue, react)
  await expectPresentationParity(vue, react)
  expect(await history(react, 'react')).toEqual({ cursor: initialHistory.cursor + 4, length: initialHistory.length + 4 })
  await closeEditors(sourceContext, destinationContext)
})

test('theme extraction inventories, tabs, selection, direct application, exclusions, six-color warning, save, and non-history behavior match source', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const initialHistory = await history(vue, 'vue')
  await Promise.all([
    vue.getByRole('button', { name: 'Extract theme from slides' }).click(),
    react.getByRole('button', { name: 'Extract theme from slides' }).click(),
  ])
  const sourceModal = vue.locator('.modal-content:visible')
  const destinationModal = react.locator('.mona-source-modal-content')
  const sourceExtract = sourceModal.locator('.theme-styles-extract')
  const destinationExtract = destinationModal.locator('.mona-theme-extract')
  await Promise.all([expect(sourceExtract).toBeVisible(), expect(destinationExtract).toBeVisible()])
  await Promise.all([vue.waitForTimeout(300), react.waitForTimeout(300)])
  expect(roundedRect(await destinationModal.boundingBox())).toEqual(roundedRect(await sourceModal.boundingBox()))
  expect((await destinationExtract.textContent())?.replace(/\s/g, '')).toBe((await sourceExtract.textContent())?.replace(/\s/g, ''))
  // Exact bounds and computed typography leave ten glyph-edge pixels (plus
  // one SVG edge) that Chromium anti-aliases differently across framework
  // text nodes; no layout, fill, border, or fully painted pixel diverges.
  await compareRaster(sourceModal, destinationModal, 10, 33)
  expect(await destinationExtract.locator('.mona-extract-config').count()).toBe(await sourceExtract.locator('.config-item').count())
  expect(await destinationExtract.locator('.mona-extract-value-wrap').count()).toBe(await sourceExtract.locator('.values:not(.inline) .value-wrap').count())
  expect(await destinationExtract.locator('.mona-extract-colors button').count()).toBe(await sourceExtract.locator('.values.inline .value-wrap').count())

  await Promise.all([
    sourceExtract.getByText('Extract from all slides', { exact: true }).click(),
    destinationExtract.getByText('Extract from all slides', { exact: true }).click(),
  ])
  expect((await destinationExtract.textContent())?.replace(/\s/g, '')).toBe((await sourceExtract.textContent())?.replace(/\s/g, ''))
  expect(await destinationExtract.locator('.mona-extract-value-wrap').count()).toBe(await sourceExtract.locator('.values:not(.inline) .value-wrap').count())
  expect(await destinationExtract.locator('.mona-extract-colors button').count()).toBe(await sourceExtract.locator('.values.inline .value-wrap').count())

  const sourceConfigs = sourceExtract.locator('.config-item')
  const destinationConfigs = destinationExtract.locator('.mona-extract-config')
  await Promise.all([
    sourceConfigs.nth(0).locator('.config-btn').nth(1).click(),
    destinationConfigs.nth(0).locator('.mona-extract-handler button').nth(1).click(),
  ])
  await expectPresentationParity(vue, react)
  await Promise.all([
    sourceConfigs.nth(1).locator('.value-wrap').nth(1).locator('.config-btn').nth(0).click(),
    destinationConfigs.nth(1).locator('.mona-extract-value-wrap').nth(1).locator('button').nth(0).click(),
  ])
  await Promise.all([
    sourceConfigs.nth(2).locator('.value-wrap').nth(1).locator('.config-btn').nth(1).click(),
    destinationConfigs.nth(2).locator('.mona-extract-value-wrap').nth(1).locator('button').nth(1).click(),
  ])
  await expectPresentationParity(vue, react)

  const sourceSwatches = sourceExtract.locator('.values.inline .value-wrap')
  const destinationSwatches = destinationExtract.locator('.mona-extract-colors button')
  await Promise.all([sourceSwatches.first().click(), destinationSwatches.first().click()])
  await Promise.all([sourceSwatches.last().click(), destinationSwatches.last().click()])
  expect(await sourceSwatches.first().locator('.value').getAttribute('class')).toContain('disabled')
  expect(await destinationSwatches.first().getAttribute('aria-pressed')).toBe('false')

  await Promise.all([
    sourceExtract.getByRole('button', { name: 'Save selected settings as theme' }).click(),
    destinationExtract.getByRole('button', { name: 'Save selected settings as theme' }).click(),
  ])
  await Promise.all([vue.waitForTimeout(300), react.waitForTimeout(300)])
  await Promise.all([expect(sourceModal).toBeHidden(), expect(destinationModal).toBeHidden()])
  await expectPresentationParity(vue, react)
  expect((await presentation(react, 'react')).theme.themeColors).toHaveLength(6)
  await Promise.all([
    expect(vue.getByText('Too many theme colors; the first six were selected automatically.')).toBeVisible(),
    expect(react.getByText('Too many theme colors; the first six were selected automatically.')).toBeVisible(),
  ])
  expect(await history(vue, 'vue')).toEqual(initialHistory)
  expect(await history(react, 'react')).toEqual(initialHistory)
  await closeEditors(sourceContext, destinationContext)
})
