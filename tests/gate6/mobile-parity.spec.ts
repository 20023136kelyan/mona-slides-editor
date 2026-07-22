import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

import type { PresentationState } from '@mona/presentation-core'

interface VueState {
  editor: { activeElementIdList: string[]; handleElementId: string; selectedSlidesIndex: number[] }
  history: { snapshotCursor: number; snapshotLength: number }
  presentation: PresentationState
}

interface ReactState {
  presentation: PresentationState
  session: { activeElementIds: string[]; handleElementId: string | null; selectedSlideIndexes: number[] }
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

const fixturePath = '/?rendererFixture=gate4-editor'
const mobileContext = {
  viewport: { width: 390, height: 844 },
  screen: { width: 390, height: 844 },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  deviceScaleFactor: 1,
  hasTouch: true,
  isMobile: true,
} as const

const mobileImageFile = {
  name: 'mobile-wide.svg',
  mimeType: 'image/svg+xml',
  buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400"><rect width="800" height="400" fill="#dcead8"/><path d="M0 330Q200 130 400 330T800 330V400H0Z" fill="#3d7c59"/></svg>'),
}

async function installDeterminism(context: BrowserContext) {
  await context.addInitScript(() => {
    localStorage.setItem('mona:ui-locale', 'en-US')
    Math.random = () => 0.45
  })
}

async function openMobileEditors(browser: Browser, path = fixturePath) {
  const sourceContext = await browser.newContext(mobileContext)
  const destinationContext = await browser.newContext(mobileContext)
  await Promise.all([installDeterminism(sourceContext), installDeterminism(destinationContext)])
  const vue = await sourceContext.newPage()
  const react = await destinationContext.newPage()
  await Promise.all([
    vue.goto(`http://127.0.0.1:5173${path}`),
    react.goto(`http://127.0.0.1:5174${path}`),
  ])
  await Promise.all([
    expect(vue.locator('.mobile-preview')).toBeVisible(),
    expect(react.locator('.mona-mobile-preview')).toBeVisible(),
    vue.waitForFunction(() => window.__MONA_TEST__?.isReady()),
    react.waitForFunction(() => window.__MONA_REACT_TEST__?.isReady()),
  ])
  return { destinationContext, react, sourceContext, vue }
}

const roundedRect = (rect: { height: number; width: number; x: number; y: number } | null) => rect && ({
  height: Math.round(rect.height * 100) / 100,
  width: Math.round(rect.width * 100) / 100,
  x: Math.round(rect.x * 100) / 100,
  y: Math.round(rect.y * 100) / 100,
})

const canonicalizeGeneratedIds = <T, >(source: T, destination: T): T => {
  const destinationToSource = new Map<string, string>()
  const collectCorrespondingIds = (sourceValue: unknown, destinationValue: unknown) => {
    if (Array.isArray(sourceValue) && Array.isArray(destinationValue)) {
      for (let index = 0; index < Math.min(sourceValue.length, destinationValue.length); index += 1) {
        collectCorrespondingIds(sourceValue[index], destinationValue[index])
      }
      return
    }
    if (!sourceValue || !destinationValue || typeof sourceValue !== 'object' || typeof destinationValue !== 'object') return
    const sourceRecord = sourceValue as Record<string, unknown>
    const destinationRecord = destinationValue as Record<string, unknown>
    for (const key of ['id', 'elId', 'groupId']) {
      const sourceId = sourceRecord[key]
      const destinationId = destinationRecord[key]
      if (typeof sourceId === 'string' && typeof destinationId === 'string' && sourceId !== destinationId) destinationToSource.set(destinationId, sourceId)
    }
    for (const key of Object.keys(sourceRecord)) collectCorrespondingIds(sourceRecord[key], destinationRecord[key])
  }
  const replaceIds = (value: unknown): unknown => {
    if (typeof value === 'string') return destinationToSource.get(value) ?? value
    if (Array.isArray(value)) return value.map(replaceIds)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, replaceIds(nested)]))
    return value
  }
  collectCorrespondingIds(source, destination)
  return replaceIds(destination) as T
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

async function settle(vue: Page, react: Page, milliseconds = 500) {
  await Promise.all([vue.waitForTimeout(milliseconds), react.waitForTimeout(milliseconds)])
}

async function expectMobileStateParity(vue: Page, react: Page, compareHistory = true) {
  const [source, destination] = await Promise.all([sourceState(vue), destinationState(react)])
  const sourceComparable = {
    activeElementIds: source.editor.activeElementIdList,
    handleElementId: source.editor.handleElementId || null,
    presentation: source.presentation,
    selectedSlideIndexes: source.editor.selectedSlidesIndex,
  }
  const destinationComparable = {
    activeElementIds: destination.session.activeElementIds,
    handleElementId: destination.session.handleElementId,
    presentation: destination.presentation,
    selectedSlideIndexes: destination.session.selectedSlideIndexes,
  }
  expect(canonicalizeGeneratedIds(sourceComparable, destinationComparable)).toEqual(sourceComparable)
  if (compareHistory) await expect.poll(async () => history(react, 'react')).toEqual(await history(vue, 'vue'))
}

async function enterMobileEdit(vue: Page, react: Page) {
  await Promise.all([
    vue.locator('.mobile-preview .menu-item').first().click(),
    react.locator('.mona-mobile-preview-menu-item').first().click(),
  ])
  await Promise.all([expect(vue.locator('.mobile-editor')).toBeVisible(), expect(react.locator('.mona-mobile-editor')).toBeVisible()])
  await settle(vue, react, 200)
}

async function tapMobileBlank(vue: Page, react: Page) {
  await Promise.all([vue.touchscreen.tap(20, 500), react.touchscreen.tap(20, 500)])
  await settle(vue, react, 100)
}

async function compareRaster(
  source: Locator,
  destination: Locator,
  maxVisiblePixelDelta = 0,
  maxRawChannelDelta = 0,
  threshold = 0,
) {
  await Promise.all([
    source.page().evaluate(() => document.fonts.ready),
    destination.page().evaluate(() => document.fonts.ready),
  ])
  let best = { raw: Number.POSITIVE_INFINITY, visible: Number.POSITIVE_INFINITY }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const [sourceBuffer, destinationBuffer] = await Promise.all([source.screenshot(), destination.screenshot()])
    const expected = PNG.sync.read(sourceBuffer)
    const actual = PNG.sync.read(destinationBuffer)
    expect({ height: actual.height, width: actual.width }).toEqual({ height: expected.height, width: expected.width })
    const visible = pixelmatch(expected.data, actual.data, null, expected.width, expected.height, { includeAA: false, threshold })
    let raw = 0
    for (let index = 0; index < expected.data.length; index += 1) raw = Math.max(raw, Math.abs(expected.data[index]! - actual.data[index]!))
    if (visible <= maxVisiblePixelDelta && raw <= maxRawChannelDelta) return
    if (visible < best.visible || (visible === best.visible && raw < best.raw)) best = { raw, visible }
    // Chromium can composite two independently transformed SVG trees one
    // frame apart. The bound remains exact; a later settled frame must meet it.
    await Promise.all([source.page().waitForTimeout(100), destination.page().waitForTimeout(100)])
  }
  expect(best.visible, 'visible raster pixels').toBeLessThanOrEqual(maxVisiblePixelDelta)
  expect(best.raw, 'maximum raw channel delta').toBeLessThanOrEqual(maxRawChannelDelta)
}

test('mobile preview and bottom menu preserve exact source geometry and raster', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openMobileEditors(browser)
  const source = vue.locator('.mobile-preview')
  const destination = react.locator('.mona-mobile-preview')
  // ECharts' SVG entrance animation is 1s. Capture only the settled chart;
  // otherwise the foreground/background page scheduling can leave the two
  // identical renderers one animation frame apart.
  await Promise.all([vue.waitForTimeout(1400), react.waitForTimeout(1400)])
  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))
  const sourceChart = source.locator('.base-element-chart').first()
  const destinationChart = destination.locator('.mona-chart-element').first()
  expect(roundedRect(await destinationChart.boundingBox())).toEqual(roundedRect(await sourceChart.boundingBox()))
  expect(await destinationChart.locator('.mona-rotate-wrapper').evaluate(element => getComputedStyle(element).transform))
    .toBe(await sourceChart.locator('.rotate-wrapper').evaluate(element => getComputedStyle(element).transform))
  const sourceOutline = await sourceChart.locator('.element-outline path').evaluate(element => Object.fromEntries(
    [...element.attributes].filter(attribute => !attribute.name.startsWith('data-v-')).map(attribute => [attribute.name, attribute.value]),
  ))
  const destinationOutline = await destinationChart.locator('.mona-element-outline path').evaluate(element => Object.fromEntries(
    [...element.attributes].map(attribute => [attribute.name, attribute.value]),
  ))
  expect(destinationOutline).toEqual(sourceOutline)
  // Independent Chromium contexts nondeterministically quantize this one
  // rotated SVG outline by one or two 8-bit channel levels. Its vector,
  // transform and geometry are asserted exactly above; no visible pixel or
  // product-level colour difference is permitted here.
  await compareRaster(source, destination, 0, 2, 0.01)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('mobile preview stages large decks in the same 50/+20/600ms batches', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openMobileEditors(browser, '/?rendererFixture=gate6-slideshow')
  expect(await vue.locator('.mobile-preview .placeholder').count()).toBe(13)
  expect(await react.locator('.mona-mobile-preview .mona-scaled-slide-placeholder').count()).toBe(13)
  await Promise.all([vue.waitForTimeout(700), react.waitForTimeout(700)])
  expect(await vue.locator('.mobile-preview .placeholder').count()).toBe(0)
  expect(await react.locator('.mona-mobile-preview .mona-scaled-slide-placeholder').count()).toBe(0)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('rotated mobile player, tool overlay, thumbnail navigation, swipes, and exit match the source', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openMobileEditors(browser)
  await Promise.all([
    vue.locator('.mobile-preview .menu-item').nth(1).click(),
    react.locator('.mona-mobile-preview-menu-item').nth(1).click(),
  ])
  const source = vue.locator('.mobile-player')
  const destination = react.locator('.mona-mobile-player')
  await Promise.all([expect(source).toBeVisible(), expect(destination).toBeVisible(), vue.waitForTimeout(800), react.waitForTimeout(800)])
  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))
  await compareRaster(source, destination)

  await Promise.all([
    vue.locator('.screen-slide-list').click({ position: { x: 150, y: 150 } }),
    react.locator('.mona-mobile-player-slides').click({ position: { x: 150, y: 150 } }),
  ])
  const sourceHeader = vue.locator('.mobile-player .header')
  const destinationHeader = react.locator('.mona-mobile-player-header')
  const sourceThumbs = vue.locator('.mobile-player .mobile-thumbnails')
  const destinationThumbs = react.locator('.mona-mobile-player-thumbnails')
  await Promise.all([expect(sourceHeader).toBeVisible(), expect(destinationHeader).toBeVisible()])
  await Promise.all([vue.waitForTimeout(200), react.waitForTimeout(200)])
  expect(roundedRect(await destinationHeader.boundingBox())).toEqual(roundedRect(await sourceHeader.boundingBox()))
  expect(roundedRect(await destinationThumbs.boundingBox())).toEqual(roundedRect(await sourceThumbs.boundingBox()))
  await compareRaster(sourceHeader, destinationHeader)
  await compareRaster(sourceThumbs, destinationThumbs)

  await Promise.all([
    sourceThumbs.locator('.thumbnail-item').nth(2).click(),
    destinationThumbs.locator('.mona-mobile-thumbnail-item').nth(2).click(),
  ])
  await Promise.all([
    vue.waitForFunction(() => window.__MONA_TEST__?.getState().presentation.slideIndex === 2),
    react.waitForFunction(() => window.__MONA_REACT_TEST__?.getState().presentation.slideIndex === 2),
  ])
  const dispatchSwipe = async (page: Page, start: { x: number; y: number }, end: { x: number; y: number }) => {
    const session = await page.context().newCDPSession(page)
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...end, id: 1 }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await session.detach()
  }
  await Promise.all([
    dispatchSwipe(vue, { x: 200, y: 200 }, { x: 120, y: 200 }),
    dispatchSwipe(react, { x: 200, y: 200 }, { x: 120, y: 200 }),
  ])
  await Promise.all([
    vue.waitForFunction(() => window.__MONA_TEST__?.getState().presentation.slideIndex === 1),
    react.waitForFunction(() => window.__MONA_REACT_TEST__?.getState().presentation.slideIndex === 1),
  ])
  await Promise.all([sourceHeader.locator('.back').click(), destinationHeader.locator('.mona-mobile-player-back').click()])
  await Promise.all([expect(vue.locator('.mobile-preview')).toBeVisible(), expect(react.locator('.mona-mobile-preview')).toBeVisible()])
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('mobile editor shell, fitted canvas, header, notes, slide toolbar, and thumbnails are exact', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openMobileEditors(browser)
  await Promise.all([
    vue.locator('.mobile-preview .menu-item').first().click(),
    react.locator('.mona-mobile-preview-menu-item').first().click(),
  ])
  const source = vue.locator('.mobile-editor')
  const destination = react.locator('.mona-mobile-editor')
  await Promise.all([expect(source).toBeVisible(), expect(destination).toBeVisible(), vue.waitForTimeout(800), react.waitForTimeout(800)])
  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))

  const surfacePairs: Array<[Locator, Locator]> = [
    [vue.locator('.mobile-editor-header'), react.locator('.mona-mobile-editor-header')],
    [vue.locator('.viewport-wrapper'), react.locator('.mona-editor-viewport-frame')],
    [vue.locator('.slide-toolbar .remark'), react.locator('.mona-mobile-remark')],
    [vue.locator('.slide-toolbar .toolbar'), react.locator('.mona-mobile-slide-actions')],
    [vue.locator('.slide-toolbar .mobile-thumbnails'), react.locator('.mona-mobile-thumbnails')],
  ]
  for (const [sourceSurface, destinationSurface] of surfacePairs) {
    expect(roundedRect(await destinationSurface.boundingBox())).toEqual(roundedRect(await sourceSurface.boundingBox()))
  }
  await compareRaster(surfacePairs[0]![0], surfacePairs[0]![1])
  await compareRaster(surfacePairs[2]![0], surfacePairs[2]![1])
  await compareRaster(surfacePairs[3]![0], surfacePairs[3]![1], 6, 60, 0.1)
  await compareRaster(surfacePairs[4]![0], surfacePairs[4]![1])

  const sourceViewport = vue.locator('.viewport')
  const destinationElements = react.locator('.mona-editor-viewport-frame .mona-rendered-element')
  await Promise.all([
    sourceViewport.evaluate(element => {
      element.style.visibility = 'hidden' 
    }),
    destinationElements.evaluateAll(elements => {
      for (const element of elements) (element as HTMLElement).style.visibility = 'hidden' 
    }),
  ])
  await compareRaster(surfacePairs[1]![0], surfacePairs[1]![1], 0, 4, 0.1)
  await Promise.all([
    sourceViewport.evaluate(element => {
      element.style.visibility = '' 
    }),
    destinationElements.evaluateAll(elements => {
      for (const element of elements) (element as HTMLElement).style.visibility = '' 
    }),
  ])

  const sourceElements = vue.locator('.viewport > .mobile-editable-element > *')
  const destinationEditableElements = react.locator('.mona-editor-viewport-frame .mona-rendered-element > .mona-element')
  await Promise.all([expect(sourceElements).toHaveCount(5), expect(destinationEditableElements).toHaveCount(5)])
  for (let index = 0; index < 5; index += 1) {
    expect(roundedRect(await destinationEditableElements.nth(index).boundingBox())).toEqual(roundedRect(await sourceElements.nth(index).boundingBox()))
  }
  await compareRaster(sourceElements.nth(0), destinationEditableElements.nth(0), 0, 2, 0.1)
  await compareRaster(sourceElements.nth(1), destinationEditableElements.nth(1), 0, 2, 0.1)
  await compareRaster(sourceElements.nth(2).locator('svg'), destinationEditableElements.nth(2).locator('svg'), 30, 100, 0.1)
  await compareRaster(sourceElements.nth(3), destinationEditableElements.nth(3))
  await compareRaster(sourceElements.nth(4), destinationEditableElements.nth(4))
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('mobile notes, thumbnail focus, exit, and re-entry preserve source state and lifecycle semantics', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openMobileEditors(browser)
  await enterMobileEdit(vue, react)
  const initialHistory = await history(vue, 'vue')
  expect(await history(react, 'react')).toEqual(initialHistory)

  const sourceNotes = vue.locator('.slide-toolbar .remark textarea')
  const destinationNotes = react.locator('.mona-mobile-remark textarea')
  await Promise.all([sourceNotes.fill('Mobile speaker notes'), destinationNotes.fill('Mobile speaker notes')])
  await settle(vue, react, 150)
  await expectMobileStateParity(vue, react, false)
  expect(await history(vue, 'vue')).toEqual(initialHistory)
  expect(await history(react, 'react')).toEqual(initialHistory)

  await Promise.all([
    vue.locator('.viewport > .mobile-editable-element > *').first().tap(),
    react.locator('.mona-editor-viewport-frame [data-element-id="gate3-gradient-shape"]').tap(),
  ])
  await expectMobileStateParity(vue, react, false)
  await tapMobileBlank(vue, react)
  await expectMobileStateParity(vue, react, false)
  await Promise.all([
    vue.locator('.mobile-thumbnails .thumbnail-item').nth(2).click(),
    react.locator('.mona-mobile-thumbnails .mona-mobile-thumbnail-item').nth(2).click(),
  ])
  await settle(vue, react, 150)
  await expectMobileStateParity(vue, react, false)

  await Promise.all([
    vue.locator('.mobile-editor-header .back').click(),
    react.locator('.mona-mobile-editor-back').click(),
  ])
  await Promise.all([expect(vue.locator('.mobile-preview')).toBeVisible(), expect(react.locator('.mona-mobile-preview')).toBeVisible()])
  await enterMobileEdit(vue, react)
  await expectMobileStateParity(vue, react, false)
  const [source, destination] = await Promise.all([sourceState(vue), destinationState(react)])
  expect(source.presentation.slideIndex).toBe(0)
  expect(destination.presentation.slideIndex).toBe(0)
  expect(source.editor.activeElementIdList).toEqual([])
  expect(destination.session.activeElementIds).toEqual([])
  await Promise.all([expect(sourceNotes).toHaveValue('Mobile speaker notes'), expect(destinationNotes).toHaveValue('Mobile speaker notes')])
  expect(await history(vue, 'vue')).toEqual(initialHistory)
  expect(await history(react, 'react')).toEqual(initialHistory)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('mobile slide and element creation, deletion, image upload, undo, and redo match source documents and history', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openMobileEditors(browser)
  await enterMobileEdit(vue, react)
  const sourceRows = vue.locator('.slide-toolbar .toolbar .row')
  const destinationRows = react.locator('.mona-mobile-slide-actions .mona-mobile-row')
  const clickPair = async (row: number, column: number) => {
    await Promise.all([
      sourceRows.nth(row).locator('button').nth(column).click(),
      destinationRows.nth(row).locator('button').nth(column).click(),
    ])
    await settle(vue, react)
    await expectMobileStateParity(vue, react)
  }

  await clickPair(0, 0)
  await clickPair(0, 1)
  await clickPair(0, 2)
  await clickPair(1, 0)
  await tapMobileBlank(vue, react)
  await clickPair(1, 2)
  await tapMobileBlank(vue, react)
  await clickPair(1, 3)
  await tapMobileBlank(vue, react)

  await Promise.all([
    vue.locator('.slide-toolbar input[type="file"]').setInputFiles(mobileImageFile),
    react.locator('.mona-mobile-file-button input[type="file"]').setInputFiles(mobileImageFile),
  ])
  await Promise.all([
    vue.waitForFunction(() => window.__MONA_TEST__!.getState().presentation.slides[window.__MONA_TEST__!.getState().presentation.slideIndex]!.elements.at(-1)?.type === 'image'),
    react.waitForFunction(() => window.__MONA_REACT_TEST__!.getState().presentation.slides[window.__MONA_REACT_TEST__!.getState().presentation.slideIndex]!.elements.at(-1)?.type === 'image'),
  ])
  await settle(vue, react)
  await expectMobileStateParity(vue, react)

  await Promise.all([
    vue.locator('.mobile-editor-header .history-item').nth(0).click(),
    react.locator('.mona-mobile-editor-history-item').nth(0).click(),
  ])
  await settle(vue, react)
  await expectMobileStateParity(vue, react)
  await Promise.all([
    vue.locator('.mobile-editor-header .history-item').nth(1).click(),
    react.locator('.mona-mobile-editor-history-item').nth(1).click(),
  ])
  await settle(vue, react)
  await expectMobileStateParity(vue, react)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('mobile single selection, operation handles, common toolbar, copy/delete, order, and all canvas alignments match source', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openMobileEditors(browser)
  await enterMobileEdit(vue, react)
  await Promise.all([
    vue.locator('.viewport > .mobile-editable-element > *').first().tap(),
    react.locator('.mona-editor-viewport-frame [data-element-id="gate3-gradient-shape"]').tap(),
  ])
  await settle(vue, react, 200)
  await expectMobileStateParity(vue, react, false)

  const sourceOperate = vue.locator('.mobile-operate').first()
  const destinationOperate = react.locator('.mona-editor-operation-layer .mona-selection-frame')
  await Promise.all([
    expect(sourceOperate.locator('.operate-border-line')).toHaveCount(4),
    expect(destinationOperate.locator('.mona-selection-border-line')).toHaveCount(4),
    expect(sourceOperate.locator('.operate-resize-handler')).toHaveCount(8),
    expect(destinationOperate.locator('.mona-transform-handle')).toHaveCount(8),
    expect(sourceOperate.locator('.operate-rotate-handler')).toHaveCount(1),
    expect(destinationOperate.locator('.mona-rotate-handle')).toHaveCount(1),
  ])
  const [sourceOperateStyle, destinationOperateStyle] = await Promise.all([
    sourceOperate.evaluate(element => ({
      left: (element as HTMLElement).style.left,
      top: (element as HTMLElement).style.top,
      transform: (element as HTMLElement).style.transform,
      transformOrigin: (element as HTMLElement).style.transformOrigin,
      width: ((element.querySelector('.operate-border-line.top') as HTMLElement).style.width),
      height: ((element.querySelector('.operate-border-line.left') as HTMLElement).style.height),
    })),
    destinationOperate.evaluate(element => ({
      left: (element as HTMLElement).style.left,
      top: (element as HTMLElement).style.top,
      transform: (element as HTMLElement).style.transform,
      transformOrigin: `${Number.parseFloat((element as HTMLElement).style.width) / 2}px ${Number.parseFloat((element as HTMLElement).style.height) / 2}px`,
      width: (element as HTMLElement).style.width,
      height: (element as HTMLElement).style.height,
    })),
  ])
  expect(destinationOperateStyle).toEqual(sourceOperateStyle)

  const sourceToolbar = vue.locator('.element-toolbar')
  const destinationToolbar = react.locator('.mona-mobile-element-toolbar')
  await Promise.all([vue.waitForTimeout(200), react.waitForTimeout(200)])
  expect(roundedRect(await destinationToolbar.boundingBox())).toEqual(roundedRect(await sourceToolbar.boundingBox()))
  await compareRaster(sourceToolbar, destinationToolbar, 20, 60, 0.1)

  const sourceRows = sourceToolbar.locator('.common .row')
  const destinationRows = destinationToolbar.locator('.mona-mobile-element-common .mona-mobile-row')
  const clickCommon = async (row: number, column: number) => {
    await Promise.all([
      sourceRows.nth(row).locator('button').nth(column).click(),
      destinationRows.nth(row).locator('button').nth(column).click(),
    ])
    await settle(vue, react)
    await expectMobileStateParity(vue, react)
  }
  await clickCommon(0, 0)
  await clickCommon(0, 1)

  await Promise.all([
    vue.locator('.viewport > .mobile-editable-element > *').nth(3).tap(),
    react.locator('.mona-editor-viewport-frame [data-element-id="gate3-radial-shape"]').tap(),
  ])
  await settle(vue, react, 150)
  await expectMobileStateParity(vue, react, false)
  for (let column = 0; column < 4; column += 1) await clickCommon(1, column)
  for (let column = 0; column < 3; column += 1) await clickCommon(2, column)
  for (let column = 0; column < 3; column += 1) await clickCommon(3, column)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('mobile trusted-touch drag, live alignment guides, resize, and rotation match source geometry and history', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openMobileEditors(browser)
  await enterMobileEdit(vue, react)
  const sourceElement = vue.locator('.viewport > .mobile-editable-element > *').nth(3)
  const destinationElement = react.locator('.mona-editor-viewport-frame [data-element-id="gate3-radial-shape"]')
  await Promise.all([sourceElement.tap(), destinationElement.tap()])
  await settle(vue, react, 150)
  await expectMobileStateParity(vue, react, false)

  const beginTouch = async (page: Page, point: { x: number; y: number }) => {
    const session = await page.context().newCDPSession(page)
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] })
    return session
  }
  const moveTouch = async (session: Awaited<ReturnType<typeof beginTouch>>, point: { x: number; y: number }) => {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, id: 1 }] })
  }
  const endTouch = async (session: Awaited<ReturnType<typeof beginTouch>>) => {
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await session.detach()
  }
  const center = (box: { height: number; width: number; x: number; y: number }) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })

  const [sourceBox, destinationBox] = await Promise.all([sourceElement.boundingBox(), destinationElement.boundingBox()])
  expect(sourceBox).not.toBeNull()
  expect(roundedRect(destinationBox)).toEqual(roundedRect(sourceBox))
  const sourceDrag = await beginTouch(vue, center(sourceBox!))
  const destinationDrag = await beginTouch(react, center(destinationBox!))
  await Promise.all([
    moveTouch(sourceDrag, { x: 195, y: 332 }),
    moveTouch(destinationDrag, { x: 195, y: 332 }),
  ])
  await settle(vue, react, 100)
  const sourceGuides = vue.locator('.viewport-wrapper > .alignment-line')
  const destinationGuides = react.locator('.mona-editor-viewport-frame > .mona-alignment-guide')
  expect(await sourceGuides.count()).toBeGreaterThan(0)
  expect(await destinationGuides.count()).toBe(await sourceGuides.count())
  for (let index = 0; index < await sourceGuides.count(); index += 1) {
    expect(roundedRect(await destinationGuides.nth(index).boundingBox())).toEqual(roundedRect(await sourceGuides.nth(index).locator('.line').boundingBox()))
  }
  await Promise.all([endTouch(sourceDrag), endTouch(destinationDrag)])
  await settle(vue, react)
  await expectMobileStateParity(vue, react)
  await Promise.all([expect(sourceGuides).toHaveCount(0), expect(destinationGuides).toHaveCount(0)])

  const sourceOperate = vue.locator('.mobile-operate').filter({ has: vue.locator('.operate-resize-handler') }).first()
  const destinationOperate = react.locator('.mona-editor-operation-layer .mona-selection-frame')
  const sourceResize = sourceOperate.locator('.operate-resize-handler.right-bottom')
  const destinationResize = destinationOperate.locator('[data-handle="bottom-right"]')
  const [sourceResizeBox, destinationResizeBox] = await Promise.all([sourceResize.boundingBox(), destinationResize.boundingBox()])
  expect(sourceResizeBox).not.toBeNull()
  expect(destinationResizeBox).not.toBeNull()
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(destinationResizeBox![key]).toBeCloseTo(sourceResizeBox![key], 1)
  const sourceResizeTouch = await beginTouch(vue, center(sourceResizeBox!))
  const destinationResizeTouch = await beginTouch(react, center(destinationResizeBox!))
  await Promise.all([
    moveTouch(sourceResizeTouch, { x: center(sourceResizeBox!).x + 20, y: center(sourceResizeBox!).y + 15 }),
    moveTouch(destinationResizeTouch, { x: center(destinationResizeBox!).x + 20, y: center(destinationResizeBox!).y + 15 }),
  ])
  await Promise.all([endTouch(sourceResizeTouch), endTouch(destinationResizeTouch)])
  await settle(vue, react)
  await expectMobileStateParity(vue, react)

  const sourceRotate = sourceOperate.locator('.operate-rotate-handler')
  const destinationRotate = destinationOperate.locator('.mona-rotate-handle')
  const [sourceRotateBox, destinationRotateBox] = await Promise.all([sourceRotate.boundingBox(), destinationRotate.boundingBox()])
  expect(sourceRotateBox).not.toBeNull()
  expect(destinationRotateBox).not.toBeNull()
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(destinationRotateBox![key]).toBeCloseTo(sourceRotateBox![key], 1)
  const sourceRotateTouch = await beginTouch(vue, center(sourceRotateBox!))
  const destinationRotateTouch = await beginTouch(react, center(destinationRotateBox!))
  const rotateEnd = { x: center(sourceRotateBox!).x + 45, y: center(sourceRotateBox!).y + 35 }
  await Promise.all([
    moveTouch(sourceRotateTouch, rotateEnd),
    moveTouch(destinationRotateTouch, rotateEnd),
  ])
  await Promise.all([endTouch(sourceRotateTouch), endTouch(destinationRotateTouch)])
  await settle(vue, react)
  await expectMobileStateParity(vue, react)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('mobile text style toolbar visuals, rich-text commands, colors, and history match source', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openMobileEditors(browser)
  await enterMobileEdit(vue, react)

  const sourceSlideRows = vue.locator('.slide-toolbar .toolbar .row')
  const destinationSlideRows = react.locator('.mona-mobile-slide-actions .mona-mobile-row')
  await Promise.all([
    sourceSlideRows.nth(0).locator('button').nth(0).click(),
    destinationSlideRows.nth(0).locator('button').nth(0).click(),
  ])
  await settle(vue, react)
  await expectMobileStateParity(vue, react)
  await Promise.all([
    sourceSlideRows.nth(1).locator('button').nth(0).click(),
    destinationSlideRows.nth(1).locator('button').nth(0).click(),
  ])
  await settle(vue, react)
  await expectMobileStateParity(vue, react)

  const sourceToolbar = vue.locator('.element-toolbar')
  const destinationToolbar = react.locator('.mona-mobile-element-toolbar')
  await Promise.all([
    sourceToolbar.locator('.tabs .tab').nth(0).click(),
    destinationToolbar.locator('.mona-mobile-tabs button').nth(0).click(),
  ])
  await settle(vue, react, 200)
  expect(roundedRect(await destinationToolbar.boundingBox())).toEqual(roundedRect(await sourceToolbar.boundingBox()))
  await compareRaster(sourceToolbar, destinationToolbar, 25, 90, 0.1)

  const sourceStyleRows = sourceToolbar.locator('.style > .row')
  const destinationStyleRows = destinationToolbar.locator('.mona-mobile-element-style > .mona-mobile-row')
  const clickStyle = async (row: number, column: number) => {
    await Promise.all([
      sourceStyleRows.nth(row).locator('button').nth(column).click(),
      destinationStyleRows.nth(row).locator('button').nth(column).click(),
    ])
    await settle(vue, react)
    await expectMobileStateParity(vue, react)
  }

  for (let column = 0; column < 4; column += 1) {
    await clickStyle(0, column)
    await Promise.all([
      expect(sourceStyleRows.nth(0).locator('button').nth(column)).toHaveClass(/checked/),
      expect(destinationStyleRows.nth(0).locator('button').nth(column)).toHaveClass(/is-checked/),
    ])
  }
  await clickStyle(1, 0)
  await clickStyle(1, 1)
  for (let column = 0; column < 3; column += 1) {
    await clickStyle(2, column)
    await Promise.all([
      expect(sourceStyleRows.nth(2).locator('button').nth(column)).toHaveClass(/checked/),
      expect(destinationStyleRows.nth(2).locator('button').nth(column)).toHaveClass(/is-checked/),
    ])
  }

  const sourceColorRows = sourceToolbar.locator('.style > .row-block')
  const destinationColorRows = destinationToolbar.locator('.mona-mobile-element-style > .mona-mobile-row-block')
  await Promise.all([
    sourceColorRows.nth(0).locator('.color').nth(8).click(),
    destinationColorRows.nth(0).locator('.mona-mobile-color').nth(8).click(),
  ])
  await settle(vue, react)
  await expectMobileStateParity(vue, react)
  await Promise.all([
    sourceColorRows.nth(1).locator('.color').nth(9).click(),
    destinationColorRows.nth(1).locator('.mona-mobile-color').nth(9).click(),
  ])
  await settle(vue, react)
  await expectMobileStateParity(vue, react)

  await Promise.all([
    sourceColorRows.nth(0).locator('.color.custom').click(),
    destinationColorRows.nth(0).locator('.mona-mobile-color.is-custom').click(),
  ])
  const sourcePickerSurface = vue.locator('.tippy-box[data-theme~="popover"] .popover-content')
  const destinationPickerSurface = react.locator('.mona-mobile-color-popover')
  const sourcePicker = sourcePickerSurface.locator('.color-picker')
  const destinationPicker = destinationPickerSurface.locator('.mona-color-picker')
  await Promise.all([
    expect(sourcePickerSurface).toBeVisible(),
    expect(destinationPickerSurface).toBeVisible(),
    vue.waitForTimeout(250),
    react.waitForTimeout(250),
  ])
  expect(roundedRect(await destinationPickerSurface.boundingBox())).toEqual(roundedRect(await sourcePickerSurface.boundingBox()))
  expect(roundedRect(await destinationPicker.boundingBox())).toEqual(roundedRect(await sourcePicker.boundingBox()))
  await compareRaster(sourcePickerSurface, destinationPickerSurface, 1, 6)
  await Promise.all([
    sourcePicker.locator('.picker-presets').nth(0).locator('.picker-presets-color').nth(4).click(),
    destinationPicker.locator('.mona-color-picker-presets').nth(0).locator('.mona-color-picker-swatch').nth(4).click(),
  ])
  await settle(vue, react)
  await expectMobileStateParity(vue, react)

  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('mobile style enablement and mutations match source for line, image, chart, table, equation, video, and audio', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openMobileEditors(browser)
  await enterMobileEdit(vue, react)
  const sourceToolbar = vue.locator('.element-toolbar')
  const destinationToolbar = react.locator('.mona-mobile-element-toolbar')

  const selectElement = async ({
    elementId,
    elementIndex,
    resizeHandles,
    rotateHandle,
    rowBlocks,
    slideIndex,
    textRows,
    tip,
  }: {
    elementId: string
    elementIndex: number
    resizeHandles: number
    rotateHandle: boolean
    rowBlocks: number
    slideIndex: number
    textRows: number
    tip: boolean
  }) => {
    if (await sourceToolbar.isVisible()) await tapMobileBlank(vue, react)
    await Promise.all([
      vue.locator('.mobile-thumbnails .thumbnail-item').nth(slideIndex).click(),
      react.locator('.mona-mobile-thumbnails .mona-mobile-thumbnail-item').nth(slideIndex).click(),
    ])
    await settle(vue, react, 150)
    await expectMobileStateParity(vue, react, false)
    await Promise.all([
      vue.locator('.viewport > .mobile-editable-element > *').nth(elementIndex).tap({ force: true }),
      react.locator(`.mona-editor-viewport-frame [data-element-id="${elementId}"]`).tap({ force: true }),
    ])
    await settle(vue, react, 150)
    await expectMobileStateParity(vue, react, false)
    await Promise.all([
      expect(vue.locator('.mobile-operate .operate-resize-handler')).toHaveCount(resizeHandles),
      expect(vue.locator('.mobile-operate .operate-rotate-handler')).toHaveCount(rotateHandle ? 1 : 0),
      expect(react.locator('.mona-editor-operation-layer .mona-selection-frame')).toHaveCount(resizeHandles || rotateHandle ? 1 : 0),
      expect(react.locator('.mona-editor-operation-layer .mona-transform-handle')).toHaveCount(resizeHandles),
      expect(react.locator('.mona-editor-operation-layer .mona-rotate-handle')).toHaveCount(rotateHandle ? 1 : 0),
    ])
    await Promise.all([
      sourceToolbar.locator('.tabs .tab').nth(0).click(),
      destinationToolbar.locator('.mona-mobile-tabs button').nth(0).click(),
    ])
    await settle(vue, react, 150)
    const sourceTextRows = sourceToolbar.locator('.style > .row')
    const destinationTextRows = destinationToolbar.locator('.mona-mobile-element-style > .mona-mobile-row')
    const sourceColorRows = sourceToolbar.locator('.style > .row-block')
    const destinationColorRows = destinationToolbar.locator('.mona-mobile-element-style > .mona-mobile-row-block')
    await Promise.all([
      expect(sourceTextRows).toHaveCount(textRows),
      expect(destinationTextRows).toHaveCount(textRows),
      expect(sourceColorRows).toHaveCount(rowBlocks),
      expect(destinationColorRows).toHaveCount(rowBlocks),
      expect(sourceToolbar.locator('.style > .tip')).toHaveCount(tip ? 1 : 0),
      expect(destinationToolbar.locator('.mona-mobile-no-properties')).toHaveCount(tip ? 1 : 0),
    ])
    expect(roundedRect(await destinationToolbar.boundingBox())).toEqual(roundedRect(await sourceToolbar.boundingBox()))
    expect(roundedRect(await destinationToolbar.locator('.mona-mobile-tabs').boundingBox())).toEqual(roundedRect(await sourceToolbar.locator('.tabs').boundingBox()))
    await compareRaster(sourceToolbar.locator('.tabs'), destinationToolbar.locator('.mona-mobile-tabs'))
    for (let index = 0; index < rowBlocks; index += 1) {
      expect(roundedRect(await destinationColorRows.nth(index).boundingBox())).toEqual(roundedRect(await sourceColorRows.nth(index).boundingBox()))
      await compareRaster(sourceColorRows.nth(index), destinationColorRows.nth(index))
    }
    if (tip) {
      expect(roundedRect(await destinationToolbar.locator('.mona-mobile-no-properties').boundingBox())).toEqual(roundedRect(await sourceToolbar.locator('.style > .tip').boundingBox()))
      await compareRaster(sourceToolbar.locator('.style > .tip'), destinationToolbar.locator('.mona-mobile-no-properties'))
    }
    return { destinationColorRows, sourceColorRows }
  }

  let rows = await selectElement({ elementId: 'gate3-line', elementIndex: 2, resizeHandles: 0, rotateHandle: false, rowBlocks: 1, slideIndex: 0, textRows: 0, tip: false })
  await Promise.all([
    rows.sourceColorRows.nth(0).locator('.color').nth(5).click(),
    rows.destinationColorRows.nth(0).locator('.mona-mobile-color').nth(5).click(),
  ])
  await settle(vue, react)
  await expectMobileStateParity(vue, react)

  await selectElement({ elementId: 'gate3-image-round', elementIndex: 1, resizeHandles: 8, rotateHandle: true, rowBlocks: 0, slideIndex: 1, textRows: 0, tip: true })

  rows = await selectElement({ elementId: 'gate3-chart', elementIndex: 0, resizeHandles: 8, rotateHandle: false, rowBlocks: 1, slideIndex: 2, textRows: 0, tip: false })
  await Promise.all([
    rows.sourceColorRows.nth(0).locator('.color').nth(6).click(),
    rows.destinationColorRows.nth(0).locator('.mona-mobile-color').nth(6).click(),
  ])
  await settle(vue, react)
  await expectMobileStateParity(vue, react)

  rows = await selectElement({ elementId: 'gate3-table', elementIndex: 1, resizeHandles: 2, rotateHandle: true, rowBlocks: 2, slideIndex: 2, textRows: 0, tip: false })
  await Promise.all([
    rows.sourceColorRows.nth(0).locator('.color').nth(7).click(),
    rows.destinationColorRows.nth(0).locator('.mona-mobile-color').nth(7).click(),
  ])
  await settle(vue, react)
  await expectMobileStateParity(vue, react)
  await Promise.all([
    rows.sourceColorRows.nth(1).locator('.color').nth(8).click(),
    rows.destinationColorRows.nth(1).locator('.mona-mobile-color').nth(8).click(),
  ])
  await settle(vue, react)
  await expectMobileStateParity(vue, react)

  rows = await selectElement({ elementId: 'gate3-latex', elementIndex: 2, resizeHandles: 8, rotateHandle: true, rowBlocks: 1, slideIndex: 2, textRows: 0, tip: false })
  await Promise.all([
    rows.sourceColorRows.nth(0).locator('.color').nth(9).click(),
    rows.destinationColorRows.nth(0).locator('.mona-mobile-color').nth(9).click(),
  ])
  await settle(vue, react)
  await expectMobileStateParity(vue, react)

  await selectElement({ elementId: 'gate3-video', elementIndex: 1, resizeHandles: 8, rotateHandle: false, rowBlocks: 0, slideIndex: 3, textRows: 0, tip: true })

  rows = await selectElement({ elementId: 'gate3-audio', elementIndex: 2, resizeHandles: 8, rotateHandle: false, rowBlocks: 1, slideIndex: 3, textRows: 0, tip: false })
  await Promise.all([
    rows.sourceColorRows.nth(0).locator('.color').nth(10).click(),
    rows.destinationColorRows.nth(0).locator('.mona-mobile-color').nth(10).click(),
  ])
  await settle(vue, react)
  await expectMobileStateParity(vue, react)

  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('mobile trusted-touch thumbnail reorder matches source order, focus, history, and rendering', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openMobileEditors(browser)
  await enterMobileEdit(vue, react)
  const initialSource = await sourceState(vue)
  const initialOrder = initialSource.presentation.slides.map(slide => slide.id)
  const initialHistory = await history(vue, 'vue')
  expect(await history(react, 'react')).toEqual(initialHistory)

  const sourceItems = vue.locator('.mobile-thumbnails .thumbnail-item')
  const destinationItems = react.locator('.mona-mobile-thumbnails .mona-mobile-thumbnail-item')
  const [sourceStartBox, sourceTargetBox, destinationStartBox, destinationTargetBox] = await Promise.all([
    sourceItems.nth(0).boundingBox(),
    sourceItems.nth(2).boundingBox(),
    destinationItems.nth(0).boundingBox(),
    destinationItems.nth(2).boundingBox(),
  ])
  expect(sourceStartBox).not.toBeNull()
  expect(sourceTargetBox).not.toBeNull()
  expect(roundedRect(destinationStartBox)).toEqual(roundedRect(sourceStartBox))
  expect(roundedRect(destinationTargetBox)).toEqual(roundedRect(sourceTargetBox))
  const center = (box: { height: number; width: number; x: number; y: number }) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })
  const sourceSession = await sourceContext.newCDPSession(vue)
  const destinationSession = await destinationContext.newCDPSession(react)
  await Promise.all([
    sourceSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...center(sourceStartBox!), id: 1 }] }),
    destinationSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...center(destinationStartBox!), id: 1 }] }),
  ])
  await settle(vue, react, 850)
  const sourceTarget = center(sourceTargetBox!)
  const destinationTarget = center(destinationTargetBox!)
  for (const progress of [0.35, 0.7, 1]) {
    await Promise.all([
      sourceSession.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{
          id: 1,
          x: center(sourceStartBox!).x + ((sourceTarget.x - center(sourceStartBox!).x) * progress),
          y: sourceTarget.y,
        }],
      }),
      destinationSession.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{
          id: 1,
          x: center(destinationStartBox!).x + ((destinationTarget.x - center(destinationStartBox!).x) * progress),
          y: destinationTarget.y,
        }],
      }),
    ])
    await settle(vue, react, 50)
  }
  await Promise.all([
    sourceSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
    destinationSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
  ])
  await Promise.all([sourceSession.detach(), destinationSession.detach()])
  await settle(vue, react, 500)
  await expectMobileStateParity(vue, react)

  const expectedOrder = [initialOrder[1]!, initialOrder[2]!, initialOrder[0]!, ...initialOrder.slice(3)]
  const [source, destination] = await Promise.all([sourceState(vue), destinationState(react)])
  expect(source.presentation.slides.map(slide => slide.id)).toEqual(expectedOrder)
  expect(destination.presentation.slides.map(slide => slide.id)).toEqual(expectedOrder)
  expect(source.presentation.slideIndex).toBe(2)
  expect(destination.presentation.slideIndex).toBe(2)
  expect(await history(vue, 'vue')).toEqual(initialHistory)
  expect(await history(react, 'react')).toEqual(initialHistory)
  const labels = initialOrder.map((_, index) => `${index + 1}`)
  await Promise.all([
    expect(sourceItems.locator('.label')).toHaveText(labels),
    expect(destinationItems.locator('.mona-mobile-thumbnail-label')).toHaveText(labels),
  ])
  expect(roundedRect(await destinationItems.nth(2).boundingBox())).toEqual(roundedRect(await sourceItems.nth(2).boundingBox()))
  await compareRaster(sourceItems.nth(2), destinationItems.nth(2))

  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('mobile routing follows the source user-agent contract independently of viewport width', async ({ browser }) => {
  const narrowDesktopSourceContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const narrowDesktopDestinationContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await Promise.all([installDeterminism(narrowDesktopSourceContext), installDeterminism(narrowDesktopDestinationContext)])
  const narrowDesktopVue = await narrowDesktopSourceContext.newPage()
  const narrowDesktopReact = await narrowDesktopDestinationContext.newPage()
  await Promise.all([
    narrowDesktopVue.goto(`http://127.0.0.1:5173${fixturePath}`),
    narrowDesktopReact.goto(`http://127.0.0.1:5174${fixturePath}`),
  ])
  await Promise.all([
    expect(narrowDesktopVue.locator('.pptist-editor')).toBeVisible(),
    expect(narrowDesktopReact.locator('.mona-editor-deck')).toBeVisible(),
    expect(narrowDesktopVue.locator('.mobile-preview')).toHaveCount(0),
    expect(narrowDesktopReact.locator('.mona-mobile-preview')).toHaveCount(0),
  ])
  await Promise.all([narrowDesktopSourceContext.close(), narrowDesktopDestinationContext.close()])

  const wideMobileOptions = {
    ...mobileContext,
    viewport: { width: 1200, height: 844 },
    screen: { width: 1200, height: 844 },
  }
  const wideMobileSourceContext = await browser.newContext(wideMobileOptions)
  const wideMobileDestinationContext = await browser.newContext(wideMobileOptions)
  await Promise.all([installDeterminism(wideMobileSourceContext), installDeterminism(wideMobileDestinationContext)])
  const wideMobileVue = await wideMobileSourceContext.newPage()
  const wideMobileReact = await wideMobileDestinationContext.newPage()
  await Promise.all([
    wideMobileVue.goto(`http://127.0.0.1:5173${fixturePath}`),
    wideMobileReact.goto(`http://127.0.0.1:5174${fixturePath}`),
  ])
  await Promise.all([
    expect(wideMobileVue.locator('.mobile-preview')).toBeVisible(),
    expect(wideMobileReact.locator('.mona-mobile-preview')).toBeVisible(),
    expect(wideMobileVue.locator('.pptist-editor')).toHaveCount(0),
    expect(wideMobileReact.locator('.mona-editor-deck')).toHaveCount(0),
  ])
  await Promise.all([wideMobileSourceContext.close(), wideMobileDestinationContext.close()])
})

test('mobile preview, editor canvas, and rotated player preserve source mount-time sizing through viewport changes', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openMobileEditors(browser)
  const sourcePreviewSlide = vue.locator('.mobile-preview .thumbnail-slide').first()
  const destinationPreviewSlide = react.locator('.mona-mobile-preview .mona-scaled-slide').first()
  const [sourceInitialPreview, destinationInitialPreview] = await Promise.all([sourcePreviewSlide.boundingBox(), destinationPreviewSlide.boundingBox()])
  expect(roundedRect(destinationInitialPreview)).toEqual(roundedRect(sourceInitialPreview))

  await Promise.all([
    vue.setViewportSize({ width: 430, height: 844 }),
    react.setViewportSize({ width: 430, height: 844 }),
  ])
  await settle(vue, react, 250)
  const [sourceResizedPreview, destinationResizedPreview] = await Promise.all([sourcePreviewSlide.boundingBox(), destinationPreviewSlide.boundingBox()])
  expect(roundedRect(destinationResizedPreview)).toEqual(roundedRect(sourceResizedPreview))
  expect(sourceResizedPreview?.width).toBe(sourceInitialPreview?.width)
  expect(sourceResizedPreview?.height).toBe(sourceInitialPreview?.height)
  expect(sourceResizedPreview?.x).toBeGreaterThan(sourceInitialPreview!.x)

  await enterMobileEdit(vue, react)
  const sourceFrame = vue.locator('.viewport-wrapper')
  const destinationFrame = react.locator('.mona-editor-viewport-frame')
  const [sourceInitialFrame, destinationInitialFrame] = await Promise.all([sourceFrame.boundingBox(), destinationFrame.boundingBox()])
  expect(roundedRect(destinationInitialFrame)).toEqual(roundedRect(sourceInitialFrame))
  await Promise.all([
    vue.setViewportSize({ width: 480, height: 844 }),
    react.setViewportSize({ width: 480, height: 844 }),
  ])
  await settle(vue, react, 250)
  const [sourceResizedFrame, destinationResizedFrame] = await Promise.all([sourceFrame.boundingBox(), destinationFrame.boundingBox()])
  expect(roundedRect(destinationResizedFrame)).toEqual(roundedRect(sourceResizedFrame))
  expect(sourceResizedFrame?.width).toBe(sourceInitialFrame?.width)
  expect(sourceResizedFrame?.height).toBe(sourceInitialFrame?.height)
  expect(sourceResizedFrame?.x).toBeGreaterThan(sourceInitialFrame!.x)

  await Promise.all([
    vue.locator('.mobile-editor-header .back').click(),
    react.locator('.mona-mobile-editor-back').click(),
  ])
  await Promise.all([
    vue.locator('.mobile-preview .menu-item').nth(1).click(),
    react.locator('.mona-mobile-preview-menu-item').nth(1).click(),
  ])
  const sourcePlayer = vue.locator('.mobile-player')
  const destinationPlayer = react.locator('.mona-mobile-player')
  await Promise.all([expect(sourcePlayer).toBeVisible(), expect(destinationPlayer).toBeVisible()])
  const playerStyle = (locator: Locator) => locator.evaluate(element => ({
    height: (element as HTMLElement).style.height,
    transform: (element as HTMLElement).style.transform,
    width: (element as HTMLElement).style.width,
  }))
  const [sourceInitialPlayer, destinationInitialPlayer] = await Promise.all([playerStyle(sourcePlayer), playerStyle(destinationPlayer)])
  expect(destinationInitialPlayer).toEqual(sourceInitialPlayer)
  await Promise.all([
    vue.setViewportSize({ width: 500, height: 800 }),
    react.setViewportSize({ width: 500, height: 800 }),
  ])
  await settle(vue, react, 250)
  expect(await playerStyle(sourcePlayer)).toEqual(sourceInitialPlayer)
  expect(await playerStyle(destinationPlayer)).toEqual(sourceInitialPlayer)

  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('mobile suppresses desktop-only keyboard, paste, wheel, blank-double-click, and context-menu routes while retaining text input', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openMobileEditors(browser)
  await enterMobileEdit(vue, react)
  await Promise.all([
    vue.locator('.viewport > .mobile-editable-element > *').nth(3).tap(),
    react.locator('.mona-editor-viewport-frame [data-element-id="gate3-radial-shape"]').tap(),
  ])
  await settle(vue, react, 150)
  await expectMobileStateParity(vue, react, false)
  const initialHistory = await history(vue, 'vue')
  expect(await history(react, 'react')).toEqual(initialHistory)

  await Promise.all([
    vue.locator('.viewport > .mobile-editable-element > *').nth(3).click({ button: 'right', force: true }),
    react.locator('.mona-editor-viewport-frame [data-element-id="gate3-radial-shape"]').click({ button: 'right', force: true }),
  ])
  await settle(vue, react, 100)
  await expectMobileStateParity(vue, react, false)
  await expect(react.locator('.mona-editor-context-menu')).toHaveCount(0)

  await Promise.all([vue.keyboard.press('Delete'), react.keyboard.press('Delete')])
  await settle(vue, react, 100)
  await expectMobileStateParity(vue, react)
  expect(await history(vue, 'vue')).toEqual(initialHistory)
  expect(await history(react, 'react')).toEqual(initialHistory)

  await Promise.all([vue.mouse.move(200, 320), react.mouse.move(200, 320)])
  await Promise.all([vue.mouse.wheel(0, 120), react.mouse.wheel(0, 120)])
  await settle(vue, react, 100)
  await expectMobileStateParity(vue, react)

  await Promise.all([vue.mouse.dblclick(20, 500), react.mouse.dblclick(20, 500)])
  await settle(vue, react, 100)
  await expectMobileStateParity(vue, react)

  const dispatchPlainTextPaste = (page: Page) => page.evaluate(() => {
    const clipboard = new DataTransfer()
    clipboard.setData('text/plain', 'desktop-only paste must not create a mobile element')
    document.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }))
  })
  await Promise.all([dispatchPlainTextPaste(vue), dispatchPlainTextPaste(react)])
  await settle(vue, react, 350)
  await expectMobileStateParity(vue, react)

  const sourceText = vue.locator('.viewport > .mobile-editable-element > .editable-element-text').first().locator('.ProseMirror')
  const destinationText = react.locator('.mona-editor-viewport-frame [data-element-id="gate3-title"] .ProseMirror')
  await Promise.all([
    sourceText.click({ position: { x: 30, y: 20 } }),
    destinationText.click({ position: { x: 30, y: 20 } }),
  ])
  await Promise.all([vue.keyboard.press('End'), react.keyboard.press('End')])
  await Promise.all([vue.keyboard.type('!'), react.keyboard.type('!')])
  await settle(vue, react, 500)
  await expectMobileStateParity(vue, react)

  await Promise.all([sourceContext.close(), destinationContext.close()])
})
