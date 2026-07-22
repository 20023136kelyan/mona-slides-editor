import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import type { PPTElement, PPTImageElement } from '@mona/presentation-core/model'

interface VueState {
  presentation: {
    slideIndex: number
    slides: Array<{ elements: PPTElement[] }>
  }
  editor: {
    activeElementIdList: string[]
    handleElementId: string
  }
  history: {
    snapshotCursor: number
    snapshotLength: number
  }
}

interface ReactState {
  presentation: VueState['presentation']
  session: {
    activeElementIds: string[]
    handleElementId: string | null
  }
}

interface SearchRequestRecord {
  body: Record<string, unknown>
  method: string
  url: string
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

const imageSearchItems = [
  {
    id: 101,
    width: 900,
    height: 600,
    src: 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22900%22 height=%22600%22%3E%3Crect width=%22900%22 height=%22600%22 fill=%22%23d5e8f5%22/%3E%3Ccircle cx=%22450%22 cy=%22300%22 r=%22180%22 fill=%22%23d14424%22/%3E%3C/svg%3E',
  },
  {
    id: 102,
    width: 600,
    height: 900,
    src: 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22600%22 height=%22900%22%3E%3Crect width=%22600%22 height=%22900%22 fill=%22%23f7e8c8%22/%3E%3Cpath d=%22M100 760L300 120L500 760Z%22 fill=%22%2368a490%22/%3E%3C/svg%3E',
  },
  {
    id: 103,
    width: 800,
    height: 800,
    src: 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22800%22 height=%22800%22%3E%3Crect width=%22800%22 height=%22800%22 fill=%22%23ece1f2%22/%3E%3Crect x=%22140%22 y=%22140%22 width=%22520%22 height=%22520%22 rx=%2290%22 fill=%22%237b62a3%22/%3E%3C/svg%3E',
  },
  {
    id: 104,
    width: 1000,
    height: 500,
    src: 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221000%22 height=%22500%22%3E%3Crect width=%221000%22 height=%22500%22 fill=%22%23dcead8%22/%3E%3Cpath d=%22M0 390Q250 180 500 390T1000 390V500H0Z%22 fill=%22%233d7c59%22/%3E%3C/svg%3E',
  },
] as const

const replacementFile = {
  name: 'portrait-replacement.svg',
  mimeType: 'image/svg+xml',
  buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="600" viewBox="0 0 300 600"><rect width="300" height="600" fill="#d5e8f5"/><circle cx="150" cy="230" r="95" fill="#d14424"/></svg>'),
}

const insertionFile = {
  name: 'wide-insertion.svg',
  mimeType: 'image/svg+xml',
  buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400"><rect width="800" height="400" fill="#dcead8"/><path d="M0 330Q200 130 400 330T800 330V400H0Z" fill="#3d7c59"/></svg>'),
}

async function installImageSearchRoute(context: BrowserContext, records?: SearchRequestRecord[]) {
  await context.route('**/api/tools/img_search', async route => {
    records?.push({
      body: route.request().postDataJSON() as Record<string, unknown>,
      method: route.request().method(),
      url: new URL(route.request().url()).pathname,
    })
    await route.fulfill({
      body: JSON.stringify({ data: imageSearchItems, total: 104 }),
      contentType: 'application/json',
      status: 200,
    })
  })
}

async function openEditors(context: BrowserContext) {
  await context.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US'))
  await installImageSearchRoute(context)
  const vue = await context.newPage()
  const react = await context.newPage()
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
  return { react, vue }
}

async function openEditorsInSeparateContexts(browser: Browser, requestRecords?: { destination: SearchRequestRecord[]; source: SearchRequestRecord[] }) {
  const sourceContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const destinationContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await Promise.all([
    sourceContext.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US')),
    destinationContext.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US')),
    installImageSearchRoute(sourceContext, requestRecords?.source),
    installImageSearchRoute(destinationContext, requestRecords?.destination),
  ])
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

const roundedRect = (rect: { height: number; width: number; x: number; y: number } | null) => rect && ({
  height: Math.round(rect.height * 100) / 100,
  width: Math.round(rect.width * 100) / 100,
  x: Math.round(rect.x * 100) / 100,
  y: Math.round(rect.y * 100) / 100,
})

function rasterDelta(sourceBuffer: Buffer, destinationBuffer: Buffer) {
  const source = PNG.sync.read(sourceBuffer)
  const destination = PNG.sync.read(destinationBuffer)
  expect({ height: destination.height, width: destination.width }).toEqual({ height: source.height, width: source.width })
  let changedPixels = 0
  let maxChannelDelta = 0
  for (let offset = 0; offset < source.data.length; offset += 4) {
    let changed = false
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(source.data[offset + channel]! - destination.data[offset + channel]!)
      if (delta) changed = true
      maxChannelDelta = Math.max(maxChannelDelta, delta)
    }
    if (changed) changedPixels += 1
  }
  return {
    changedPixels,
    maxChannelDelta,
    visiblePixelDelta: pixelmatch(source.data, destination.data, null, source.width, source.height, { threshold: 0 }),
  }
}

async function expectExactRaster(source: Locator, destination: Locator) {
  const [sourceBuffer, destinationBuffer] = await Promise.all([
    source.screenshot({ animations: 'disabled', caret: 'hide' }),
    destination.screenshot({ animations: 'disabled', caret: 'hide' }),
  ])
  expect(rasterDelta(sourceBuffer, destinationBuffer)).toEqual({ changedPixels: 0, maxChannelDelta: 0, visiblePixelDelta: 0 })
}

async function expectBoundedRasterDelta(
  source: Locator,
  destination: Locator,
  sourceBoundSelector: string,
  destinationBoundSelector: string,
  expectedDelta: { changedPixels: number; maxChannelDelta: number; visiblePixelDelta: number },
  rootEdgeWidth = 0,
) {
  const [sourceBuffer, destinationBuffer, sourceBox, sourceBounds, destinationBounds] = await Promise.all([
    source.screenshot({ animations: 'disabled', caret: 'hide' }),
    destination.screenshot({ animations: 'disabled', caret: 'hide' }),
    source.boundingBox(),
    source.locator(sourceBoundSelector).evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON())),
    destination.locator(destinationBoundSelector).evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON())),
  ])
  expect(destinationBounds.map(roundedRect)).toEqual(sourceBounds.map(roundedRect))
  const expected = PNG.sync.read(sourceBuffer)
  const actual = PNG.sync.read(destinationBuffer)
  const localBounds = sourceBounds.map(rect => ({
    bottom: rect.y - sourceBox!.y + rect.height + 1,
    left: rect.x - sourceBox!.x - 1,
    right: rect.x - sourceBox!.x + rect.width + 1,
    top: rect.y - sourceBox!.y - 1,
  }))
  const outsideBounds: Array<{ x: number; y: number }> = []
  for (let offset = 0; offset < expected.data.length; offset += 4) {
    if (![0, 1, 2, 3].some(channel => expected.data[offset + channel] !== actual.data[offset + channel])) continue
    const pixel = offset / 4
    const point = { x: pixel % expected.width, y: Math.floor(pixel / expected.width) }
    if (rootEdgeWidth && (
      point.x < rootEdgeWidth || point.y < rootEdgeWidth
      || point.x >= expected.width - rootEdgeWidth || point.y >= expected.height - rootEdgeWidth
    )) continue
    if (!localBounds.some(rect => point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom)) outsideBounds.push(point)
  }
  expect(outsideBounds).toEqual([])
  expect(rasterDelta(sourceBuffer, destinationBuffer)).toEqual(expectedDelta)
}

async function expectIconBoundRaster(source: Locator, destination: Locator) {
  const [sourceBuffer, destinationBuffer, sourceBox, sourceIcons, destinationIcons] = await Promise.all([
    source.screenshot({ animations: 'disabled', caret: 'hide' }),
    destination.screenshot({ animations: 'disabled', caret: 'hide' }),
    source.boundingBox(),
    source.locator('svg').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON())),
    destination.locator('svg').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON())),
  ])
  expect(destinationIcons.map(roundedRect)).toEqual(sourceIcons.map(roundedRect))
  const expected = PNG.sync.read(sourceBuffer)
  const actual = PNG.sync.read(destinationBuffer)
  const changedPoints: Array<{ x: number; y: number }> = []
  for (let offset = 0; offset < expected.data.length; offset += 4) {
    if ([0, 1, 2, 3].some(channel => expected.data[offset + channel] !== actual.data[offset + channel])) {
      const pixel = offset / 4
      changedPoints.push({ x: pixel % expected.width, y: Math.floor(pixel / expected.width) })
    }
  }
  const localIconBoxes = sourceIcons.map(rect => ({
    bottom: rect.y - sourceBox!.y + rect.height + 1,
    left: rect.x - sourceBox!.x - 1,
    right: rect.x - sourceBox!.x + rect.width + 1,
    top: rect.y - sourceBox!.y - 1,
  }))
  expect(changedPoints.every(point => localIconBoxes.some(rect => (
    point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
  )))).toBe(true)
  expect(rasterDelta(sourceBuffer, destinationBuffer)).toEqual({ changedPixels: 80, maxChannelDelta: 87, visiblePixelDelta: 28 })
}

async function expectBoundedRaster(source: Locator, destination: Locator, sourceBoundSelector: string) {
  const [sourceBuffer, destinationBuffer, sourceBox, textBoxes] = await Promise.all([
    source.screenshot({ animations: 'disabled', caret: 'hide' }),
    destination.screenshot({ animations: 'disabled', caret: 'hide' }),
    source.boundingBox(),
    source.locator(sourceBoundSelector).evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON())),
  ])
  const expected = PNG.sync.read(sourceBuffer)
  const actual = PNG.sync.read(destinationBuffer)
  const changedPoints: Array<{ x: number; y: number }> = []
  for (let offset = 0; offset < expected.data.length; offset += 4) {
    if ([0, 1, 2, 3].some(channel => expected.data[offset + channel] !== actual.data[offset + channel])) {
      const pixel = offset / 4
      changedPoints.push({ x: pixel % expected.width, y: Math.floor(pixel / expected.width) })
    }
  }
  const localBoundBoxes = textBoxes.map(rect => ({
    bottom: rect.y - sourceBox!.y + rect.height,
    left: rect.x - sourceBox!.x,
    right: rect.x - sourceBox!.x + rect.width,
    top: rect.y - sourceBox!.y,
  }))
  const outsideBounds = changedPoints.filter(point => !localBoundBoxes.some(rect => (
    point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
  )))
  expect(outsideBounds).toEqual([])
  expect(rasterDelta(sourceBuffer, destinationBuffer)).toEqual({ changedPixels: 48, maxChannelDelta: 12, visiblePixelDelta: 0 })
}

async function expectRotatedCropRaster(source: Locator, destination: Locator) {
  const [sourceBuffer, destinationBuffer] = await Promise.all([
    source.screenshot({ animations: 'disabled', caret: 'hide' }),
    destination.screenshot({ animations: 'disabled', caret: 'hide' }),
  ])
  const sourceImage = PNG.sync.read(sourceBuffer)
  const destinationImage = PNG.sync.read(destinationBuffer)
  expect({ height: destinationImage.height, width: destinationImage.width }).toEqual({ height: sourceImage.height, width: sourceImage.width })
  const compositorDelta = pixelmatch(
    sourceImage.data,
    destinationImage.data,
    null,
    sourceImage.width,
    sourceImage.height,
    { threshold: 0.2 },
  )
  // Geometry and computed styles are asserted independently. The residual is
  // Chromium's rotated-image compositor interpolation across separate trees.
  expect({ ...rasterDelta(sourceBuffer, destinationBuffer), compositorDelta }).toEqual({
    changedPixels: 22368,
    compositorDelta: 13,
    maxChannelDelta: 111,
    visiblePixelDelta: 19164,
  })
}

async function selectSlide(vue: Page, react: Page, slideIndex: number) {
  await Promise.all([
    vue.locator('.thumbnail-slide').nth(slideIndex).click(),
    react.getByRole('button', { name: `Show slide ${slideIndex + 1}` }).click(),
  ])
}

async function selectImage(vue: Page, react: Page, id = 'gate3-image-round') {
  await selectSlide(vue, react, 1)
  await Promise.all([
    vue.locator(`#editable-element-${id} .editable-element-image`).click(),
    react.getByRole('button', { name: `Select image ${id}` }).click(),
  ])
  await expect.poll(() => Promise.all([
    vue.evaluate(() => window.__MONA_TEST__!.getState().editor.handleElementId),
    react.evaluate(() => window.__MONA_REACT_TEST__!.getState().session.handleElementId),
  ])).toEqual([id, id])
}

async function enableFloatingToolbar(vue: Page, react: Page) {
  await Promise.all([
    vue.locator('.canvas').click({ button: 'right', position: { x: 40, y: 40 } }),
    react.getByRole('application', { name: 'Editable slide canvas' }).click({ button: 'right', position: { x: 40, y: 40 } }),
  ])
  await Promise.all([
    expect(vue.locator('.contextmenu')).toBeVisible(),
    expect(react.getByRole('menu', { name: 'Canvas menu' })).toBeVisible(),
  ])
  await Promise.all([
    vue.locator('.contextmenu > .menu-content > .menu-item').filter({ hasText: /^Floating toolbar/ }).click(),
    react.locator('.mona-editor-context-menu [data-action="bubble-menu"]').click(),
  ])
}

async function currentImage(page: Page, app: 'react' | 'vue', id: string) {
  return page.evaluate(({ appName, elementId }) => {
    const state = appName === 'vue' ? window.__MONA_TEST__!.getState() : window.__MONA_REACT_TEST__!.getState()
    return structuredClone(state.presentation.slides[state.presentation.slideIndex]!.elements.find(element => element.id === elementId)!)
  }, { appName: app, elementId: id }) as Promise<PPTImageElement>
}

async function history(page: Page, app: 'react' | 'vue') {
  if (app === 'react') return page.evaluate(() => window.__MONA_REACT_TEST__!.getHistoryState())
  return page.evaluate(() => {
    const state = window.__MONA_TEST__!.getState().history
    return { cursor: state.snapshotCursor, length: state.snapshotLength }
  })
}

async function expectImageAndHistoryParity(vue: Page, react: Page, id: string) {
  await Promise.all([vue.waitForTimeout(400), react.waitForTimeout(400)])
  expect(await currentImage(react, 'react', id)).toEqual(await currentImage(vue, 'vue', id))
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))
}

async function expectCurrentSlideAndHistoryParity(vue: Page, react: Page) {
  await Promise.all([vue.waitForTimeout(400), react.waitForTimeout(400)])
  const [sourceSlide, destinationSlide] = await Promise.all([
    vue.evaluate(() => structuredClone(window.__MONA_TEST__!.getState().presentation.slides[window.__MONA_TEST__!.getState().presentation.slideIndex]!)),
    react.evaluate(() => structuredClone(window.__MONA_REACT_TEST__!.getState().presentation.slides[window.__MONA_REACT_TEST__!.getState().presentation.slideIndex]!)),
  ])
  expect(destinationSlide).toEqual(sourceSlide)
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))
}

async function lastElement(page: Page, app: 'react' | 'vue') {
  return page.evaluate(appName => {
    const state = appName === 'vue' ? window.__MONA_TEST__!.getState() : window.__MONA_REACT_TEST__!.getState()
    return structuredClone(state.presentation.slides[state.presentation.slideIndex]!.elements.at(-1)!)
  }, app) as Promise<PPTElement>
}

function withoutId<T extends PPTElement>(element: T) {
  const clone = structuredClone(element) as T & { id?: string }
  delete clone.id
  return clone
}

async function clickSlider(source: Locator, destination: Locator, ratio: number) {
  const [sourceBox, destinationBox] = await Promise.all([source.boundingBox(), destination.boundingBox()])
  expect(sourceBox).not.toBeNull()
  expect(destinationBox).not.toBeNull()
  await Promise.all([
    source.click({ position: { x: Math.floor(sourceBox!.width * ratio), y: Math.floor(sourceBox!.height / 2) } }),
    destination.click({ position: { x: Math.floor(destinationBox!.width * ratio), y: Math.floor(destinationBox!.height / 2) } }),
  ])
}

async function dragBySlideDelta(
  page: Page,
  handle: Locator,
  slide: Locator,
  delta: { x: number; y: number },
  modifier?: 'Shift',
) {
  const [handleBox, scale] = await Promise.all([
    handle.boundingBox(),
    slide.evaluate(element => new DOMMatrixReadOnly((element as HTMLElement).style.transform || getComputedStyle(element).transform).a),
  ])
  expect(handleBox).not.toBeNull()
  const start = { x: handleBox!.x + handleBox!.width / 2, y: handleBox!.y + handleBox!.height / 2 }
  if (modifier) await page.keyboard.down(modifier)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + delta.x * scale, start.y + delta.y * scale)
  await page.mouse.up()
  if (modifier) await page.keyboard.up(modifier)
}

const sourceCropHandleClass: Readonly<Record<string, string>> = {
  'top-left': 'left-top',
  top: 'top',
  'top-right': 'right-top',
  right: 'right',
  'bottom-right': 'right-bottom',
  bottom: 'bottom',
  'bottom-left': 'left-bottom',
  left: 'left',
}

async function readCropGeometry(page: Page, app: 'react' | 'vue') {
  const root = page.locator(app === 'vue' ? '.image-clip-handler' : '.mona-image-crop-editor')
  return root.evaluate((element, appName) => {
    const selectors = appName === 'vue'
      ? { bottom: '.bottom-img', controls: '.operate', highlight: '.top-image-content', image: '.top-img' }
      : { bottom: '.mona-crop-bottom-image', controls: '.mona-crop-controls', highlight: '.mona-crop-highlight', image: '.mona-crop-highlight img' }
    const read = (selector: string) => {
      const target = element.querySelector<HTMLElement>(selector)!
      const rect = target.getBoundingClientRect()
      return {
        rect: { height: rect.height, width: rect.width, x: rect.x, y: rect.y },
        style: { clipPath: target.style.clipPath, height: target.style.height, left: target.style.left, top: target.style.top, width: target.style.width },
      }
    }
    return {
      bottom: read(selectors.bottom),
      controls: read(selectors.controls),
      highlight: read(selectors.highlight),
      image: read(selectors.image),
    }
  }, app)
}

async function enterCrop(vue: Page, react: Page, id = 'gate3-image-round') {
  await selectImage(vue, react, id)
  await Promise.all([
    vue.getByRole('button', { name: 'Crop image' }).click(),
    react.getByRole('button', { name: 'Crop image' }).click(),
  ])
  await Promise.all([
    expect(vue.locator('.image-clip-handler')).toBeVisible(),
    expect(react.locator('.mona-image-crop-editor')).toBeVisible(),
  ])
}

async function openImageLibrary(vue: Page, react: Page) {
  await vue.locator('.canvas-tool .insert-handler-item.group-btn').nth(2).locator('.arrow').click()
  await vue.locator('.tippy-box:visible .popover-menu-item').nth(1).click()
  await react.getByLabel('Image options').click()
  await react.locator('.mona-canvas-tool-menu-item').filter({ hasText: /^Online images$/ }).click()
  await Promise.all([
    expect(vue.locator('.moveable-panel.image-lib-panel')).toBeVisible(),
    expect(react.locator('.mona-image-library-panel')).toBeVisible(),
    expect(vue.locator('.directive-loading-overlay')).toHaveCount(0),
    expect(react.locator('.mona-image-library-loading')).toHaveCount(0),
    expect(vue.locator('.image-lib-panel .waterfall-item')).toHaveCount(imageSearchItems.length),
    expect(react.locator('.mona-image-library-item')).toHaveCount(imageSearchItems.length),
  ])
  await Promise.all([vue.waitForTimeout(1100), react.waitForTimeout(1100)])
}

test('image inspector initial composition is source-identical and exposes the complete source inventory', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const { react, vue } = await openEditors(context)
  await selectImage(vue, react)
  const source = vue.locator('.image-style-panel')
  const destination = react.locator('.mona-image-style-panel')
  await Promise.all([expect(source).toBeVisible(), expect(destination).toBeVisible()])
  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))
  expect(await destination.locator('.mona-image-filter-preset').count()).toBe(await source.locator('.preset-item').count())
  expect(await destination.locator('.mona-image-filter-row').count()).toBe(await source.locator('.filter-item').count())
  expect(await destination.locator('.mona-panel-divider').count()).toBe(await source.locator('.divider').count())
  await expectExactRaster(source, destination)
  await context.close()
})

test('image flip, radius, mask, all filter presets and sliders, outline, shadow, reset, and background transactions match source', async ({ browser }) => {
  test.slow()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const { react, vue } = await openEditors(context)
  const id = 'gate3-image-round'
  await selectImage(vue, react, id)

  const sourceFlipButtons = vue.locator('.image-style-panel .element-flip .button')
  for (const [index, label] of [[0, 'Flip vertically'], [1, 'Flip horizontally']] as const) {
    await Promise.all([sourceFlipButtons.nth(index).click(), react.getByRole('button', { name: label }).click()])
    await expectImageAndHistoryParity(vue, react, id)
  }

  await Promise.all([
    vue.locator('.image-style-panel > .row .number-input .handler').first().click(),
    react.getByRole('button', { name: 'Corner radius: increase' }).click(),
  ])
  await expectImageAndHistoryParity(vue, react, id)

  const sourceMaskSwitch = vue.locator('.image-style-panel .element-color-mask .switch')
  const destinationMaskSwitch = react.getByRole('switch', { name: 'Color overlay:' })
  await Promise.all([sourceMaskSwitch.click(), destinationMaskSwitch.click()])
  await expectImageAndHistoryParity(vue, react, id)
  await Promise.all([sourceMaskSwitch.click(), destinationMaskSwitch.click()])
  await expectImageAndHistoryParity(vue, react, id)

  const sourceFilterSwitch = vue.locator('.image-style-panel .element-filter .switch')
  const destinationFilterSwitch = react.getByRole('switch', { name: 'Enable filter:' })
  await Promise.all([sourceFilterSwitch.click(), destinationFilterSwitch.click()])
  await expectImageAndHistoryParity(vue, react, id)
  await Promise.all([sourceFilterSwitch.click(), destinationFilterSwitch.click()])
  await expectImageAndHistoryParity(vue, react, id)

  const presetLabels = ['Black and white', 'Vintage', 'Sharpen', 'Soft', 'Warm', 'Bright', 'Vivid', 'Blur', 'Invert']
  for (let index = 0; index < presetLabels.length; index += 1) {
    await Promise.all([
      vue.locator('.image-style-panel .preset-item').nth(index).click(),
      react.locator('.mona-image-filter-preset').filter({ has: react.getByText(presetLabels[index]!, { exact: true }) }).click(),
    ])
    await expectImageAndHistoryParity(vue, react, id)
  }

  const sourceFilterSliders = vue.locator('.image-style-panel .element-filter .filter-item .slider')
  const destinationFilterSliders = react.locator('.mona-image-filter-row .mona-panel-slider')
  expect(await destinationFilterSliders.count()).toBe(await sourceFilterSliders.count())
  for (let index = 0; index < 9; index += 1) {
    await clickSlider(sourceFilterSliders.nth(index), destinationFilterSliders.nth(index), 0.2 + index * 0.07)
    await expectImageAndHistoryParity(vue, react, id)
  }

  const sourceOutlineSwitch = vue.locator('.image-style-panel .element-outline .switch')
  const destinationOutlineSwitch = react.getByRole('switch', { name: 'Enable border:' })
  await Promise.all([sourceOutlineSwitch.click(), destinationOutlineSwitch.click()])
  await expectImageAndHistoryParity(vue, react, id)
  await Promise.all([sourceOutlineSwitch.click(), destinationOutlineSwitch.click()])
  await expectImageAndHistoryParity(vue, react, id)
  await Promise.all([
    vue.locator('.image-style-panel .element-outline .number-input .handler').first().click(),
    react.getByRole('button', { name: 'Border width: increase' }).click(),
  ])
  await expectImageAndHistoryParity(vue, react, id)

  const sourceShadowSwitch = vue.locator('.image-style-panel .element-shadow .switch')
  const destinationShadowSwitch = react.getByRole('switch', { name: 'Enable shadow:' })
  await Promise.all([sourceShadowSwitch.click(), destinationShadowSwitch.click()])
  await expectImageAndHistoryParity(vue, react, id)
  await Promise.all([sourceShadowSwitch.click(), destinationShadowSwitch.click()])
  await expectImageAndHistoryParity(vue, react, id)
  const sourceShadowSliders = vue.locator('.image-style-panel .element-shadow .slider')
  const destinationShadowSliders = react.locator('.mona-element-shadow-controls .mona-panel-slider')
  for (let index = 0; index < 3; index += 1) {
    await clickSlider(sourceShadowSliders.nth(index), destinationShadowSliders.nth(index), 0.25 + index * 0.2)
    await expectImageAndHistoryParity(vue, react, id)
  }

  await Promise.all([
    vue.locator('.image-style-panel .full-width-btn').nth(1).click(),
    react.getByRole('button', { name: 'Reset style' }).click(),
  ])
  await expectImageAndHistoryParity(vue, react, id)
  expect((await currentImage(react, 'react', id)).flipH).toBe(true)
  expect((await currentImage(react, 'react', id)).flipV).toBe(true)

  await Promise.all([
    vue.locator('.image-style-panel .full-width-btn').nth(2).click(),
    react.getByRole('button', { name: 'Set as background' }).click(),
  ])
  await expectCurrentSlideAndHistoryParity(vue, react)
  await context.close()
})

test('image crop popover and every shape and ratio preset match source state, crop entry, commit, and history', async ({ browser }) => {
  test.slow()
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  const id = 'gate3-image-round'
  await selectImage(vue, react, id)

  const openSourceCropOptions = async () => {
    await vue.locator('.image-style-panel .popover-btn').click()
    await expect(vue.locator('.tippy-box:visible .clip')).toBeVisible()
    await vue.waitForTimeout(350)
  }
  const openDestinationCropOptions = async () => {
    await react.getByRole('button', { name: 'Image crop options' }).click()
    await expect(react.locator('.mona-panel-popover-content .mona-image-clip-panel')).toBeVisible()
  }

  await openSourceCropOptions()
  await openDestinationCropOptions()
  const sourcePool = vue.locator('.tippy-box:visible .clip')
  const destinationPool = react.locator('.mona-panel-popover-content .mona-image-clip-panel')
  expect(roundedRect(await destinationPool.boundingBox())).toEqual(roundedRect(await sourcePool.boundingBox()))
  expect(await destinationPool.locator('.mona-image-clip-shape-item').count()).toBe(await sourcePool.locator('.shape-clip-item').count())
  expect(await destinationPool.locator('.mona-image-ratio-buttons .mona-panel-button').count()).toBe(await sourcePool.locator('.button').count())
  await expectBoundedRaster(sourcePool, destinationPool, '.shape')

  const shapeNames = [
    'rect', 'snip1Rect', 'snip2DiagRect', 'roundRect', 'ellipse', 'triangle', 'rtTriangle', 'triangleReverse', 'diamond', 'pentagon',
    'hexagon', 'heptagon', 'octagon', 'chevron', 'homePlate', 'rightArrow', 'parallelogram', 'parallelogramReverse', 'trapezoid', 'trapezoidReverse',
  ]
  for (let index = 0; index < shapeNames.length; index += 1) {
    if (index > 0) await openSourceCropOptions()
    await vue.locator('.tippy-box:visible .shape-clip-item').nth(index).click()
    if (index > 0) await openDestinationCropOptions()
    await react.getByRole('button', { name: shapeNames[index]!, exact: true }).click()
    await Promise.all([
      expect(vue.locator('.image-clip-handler')).toBeVisible(),
      expect(react.locator('.mona-image-crop-editor')).toBeVisible(),
    ])
    expect(await currentImage(react, 'react', id)).toEqual(await currentImage(vue, 'vue', id))
    await vue.locator('.image-style-panel .origin-image').click()
    await react.locator('.mona-image-origin-preview').click()
    await Promise.all([
      expect(vue.locator('.image-clip-handler')).toHaveCount(0),
      expect(react.locator('.mona-image-crop-editor')).toHaveCount(0),
    ])
    await expectImageAndHistoryParity(vue, react, id)
  }

  const ratios = ['1:1', '2:3', '3:4', '3:5', '4:5', '3:2', '4:3', '5:3', '5:4', '16:9', '16:10']
  for (let index = 0; index < ratios.length; index += 1) {
    await openSourceCropOptions()
    await vue.locator('.tippy-box:visible .clip .button').nth(index).click()
    await openDestinationCropOptions()
    await react.getByRole('button', { name: ratios[index]!, exact: true }).click()
    await Promise.all([
      expect(vue.locator('.image-clip-handler')).toBeVisible(),
      expect(react.locator('.mona-image-crop-editor')).toBeVisible(),
    ])
    expect(await currentImage(react, 'react', id)).toEqual(await currentImage(vue, 'vue', id))
    await vue.locator('.image-style-panel .origin-image').click()
    await react.locator('.mona-image-origin-preview').click()
    await Promise.all([
      expect(vue.locator('.image-clip-handler')).toHaveCount(0),
      expect(react.locator('.mona-image-crop-editor')).toHaveCount(0),
    ])
    await expectImageAndHistoryParity(vue, react, id)
  }
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('image crop move, every resize handle, modifier locking, transient geometry, commit, and undo match source', async ({ browser }) => {
  test.slow()
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  const id = 'gate3-image-round'
  const sourceSlide = vue.locator('.viewport')
  const destinationSlide = react.locator('.mona-editor-slide-canvas')
  const cases = [
    { handle: 'move', delta: { x: 10, y: 0 } },
    { handle: 'top-left', delta: { x: 18, y: 14 } },
    { handle: 'top', delta: { x: 0, y: 18 } },
    { handle: 'top-right', delta: { x: -18, y: 14 } },
    { handle: 'right', delta: { x: -28, y: 0 } },
    { handle: 'bottom-right', delta: { x: -24, y: -18 } },
    { handle: 'bottom', delta: { x: 0, y: -18 } },
    { handle: 'bottom-left', delta: { x: 18, y: -14 } },
    { handle: 'left', delta: { x: 24, y: 0 } },
    { handle: 'bottom-right', delta: { x: -28, y: -7 }, modifier: 'Shift' as const },
  ]

  for (const current of cases) {
    await enterCrop(vue, react, id)
    const before = await currentImage(vue, 'vue', id)
    expect(await currentImage(react, 'react', id)).toEqual(before)
    const beforeHistory = await history(vue, 'vue')
    expect(await history(react, 'react')).toEqual(beforeHistory)

    const sourceHandle = current.handle === 'move'
      ? vue.locator('.image-clip-handler .operate')
      : vue.locator(`.image-clip-handler .clip-point.${sourceCropHandleClass[current.handle]}`)
    const destinationHandle = current.handle === 'move'
      ? react.getByRole('button', { name: 'Move crop area' })
      : react.locator(`.mona-crop-handle[data-handle="${current.handle}"]`)
    await Promise.all([
      dragBySlideDelta(vue, sourceHandle, sourceSlide, current.delta, current.modifier),
      dragBySlideDelta(react, destinationHandle, destinationSlide, current.delta, current.modifier),
    ])

    // Crop gestures are drafts until the user confirms or clicks outside.
    expect(await currentImage(vue, 'vue', id)).toEqual(before)
    expect(await currentImage(react, 'react', id)).toEqual(before)
    expect(await history(vue, 'vue')).toEqual(beforeHistory)
    expect(await history(react, 'react')).toEqual(beforeHistory)
    expect(await readCropGeometry(react, 'react')).toEqual(await readCropGeometry(vue, 'vue'))

    await vue.locator('.canvas').press('Enter')
    await react.getByRole('application', { name: 'Editable slide canvas' }).press('Enter')
    await Promise.all([
      expect(vue.locator('.image-clip-handler')).toHaveCount(0),
      expect(react.locator('.mona-image-crop-editor')).toHaveCount(0),
    ])
    await expectImageAndHistoryParity(vue, react, id)
    expect(await currentImage(react, 'react', id)).not.toEqual(before)

    await Promise.all([
      vue.locator('.canvas-tool .left-handler > .handler-item').first().click(),
      react.getByRole('application', { name: 'Editable slide canvas' }).press('Control+z'),
    ])
    await expect.poll(() => currentImage(vue, 'vue', id)).toEqual(before)
    await expect.poll(() => currentImage(react, 'react', id)).toEqual(before)
  }
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('rotated crop raster, no-op Enter, Escape semantics, and dirty outside-click commit match source', async ({ browser }) => {
  test.slow()
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  const id = 'gate3-image-round'
  await enterCrop(vue, react, id)
  const before = await currentImage(vue, 'vue', id)
  const beforeHistory = await history(vue, 'vue')
  expect(await currentImage(react, 'react', id)).toEqual(before)
  expect(await history(react, 'react')).toEqual(beforeHistory)
  expect(await readCropGeometry(react, 'react')).toEqual(await readCropGeometry(vue, 'vue'))
  await expectRotatedCropRaster(vue.locator('.image-clip-handler'), react.locator('.mona-image-crop-editor'))

  await Promise.all([
    vue.locator('.canvas').press('Escape'),
    react.getByRole('application', { name: 'Editable slide canvas' }).press('Escape'),
  ])
  await Promise.all([
    expect(vue.locator('.image-clip-handler')).toBeVisible(),
    expect(react.locator('.mona-image-crop-editor')).toBeVisible(),
  ])
  expect(await currentImage(vue, 'vue', id)).toEqual(before)
  expect(await currentImage(react, 'react', id)).toEqual(before)
  expect(await history(vue, 'vue')).toEqual(beforeHistory)
  expect(await history(react, 'react')).toEqual(beforeHistory)

  await vue.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })))
  await react.getByRole('application', { name: 'Editable slide canvas' }).press('Enter')
  await Promise.all([
    expect(vue.locator('.image-clip-handler')).toHaveCount(0),
    expect(react.locator('.mona-image-crop-editor')).toHaveCount(0),
  ])
  expect(await currentImage(vue, 'vue', id)).toEqual(before)
  expect(await currentImage(react, 'react', id)).toEqual(before)
  expect(await history(vue, 'vue')).toEqual(beforeHistory)
  expect(await history(react, 'react')).toEqual(beforeHistory)

  await enterCrop(vue, react, id)
  await Promise.all([
    dragBySlideDelta(vue, vue.locator('.image-clip-handler .operate'), vue.locator('.viewport'), { x: 16, y: 0 }),
    dragBySlideDelta(react, react.getByRole('button', { name: 'Move crop area' }), react.locator('.mona-editor-slide-canvas'), { x: 16, y: 0 }),
  ])
  expect(await readCropGeometry(react, 'react')).toEqual(await readCropGeometry(vue, 'vue'))
  await Promise.all([
    vue.locator('.image-style-panel .origin-image').click(),
    react.locator('.mona-image-origin-preview').click(),
  ])
  await Promise.all([
    expect(vue.locator('.image-clip-handler')).toHaveCount(0),
    expect(react.locator('.mona-image-crop-editor')).toHaveCount(0),
  ])
  await expectImageAndHistoryParity(vue, react, id)
  expect(await currentImage(react, 'react', id)).not.toEqual(before)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('inspector replacement preserves non-rect clips, removes rect clips, and matches source geometry and history', async ({ browser }) => {
  test.slow()
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  const id = 'gate3-image-round'
  await selectImage(vue, react, id)
  await Promise.all([
    vue.locator('.image-style-panel .file-input input[type="file"]').setInputFiles(replacementFile),
    react.locator('input[aria-label="Replace image"]').setInputFiles(replacementFile),
  ])
  await expectImageAndHistoryParity(vue, react, id)
  expect((await currentImage(react, 'react', id)).clip).toEqual({ range: [[0, 0], [100, 100]], shape: 'roundRect' })

  await vue.locator('.image-style-panel .popover-btn').click()
  await vue.waitForTimeout(350)
  await vue.locator('.tippy-box:visible .shape-clip-item').first().click()
  await react.getByRole('button', { name: 'Image crop options' }).click()
  await react.getByRole('button', { name: 'rect', exact: true }).click()
  await Promise.all([
    vue.locator('.image-style-panel .origin-image').click(),
    react.locator('.mona-image-origin-preview').click(),
  ])
  await expectImageAndHistoryParity(vue, react, id)
  await Promise.all([
    vue.locator('.image-style-panel .file-input input[type="file"]').setInputFiles(insertionFile),
    react.locator('input[aria-label="Replace image"]').setInputFiles(insertionFile),
  ])
  await expectImageAndHistoryParity(vue, react, id)
  expect((await currentImage(react, 'react', id)).clip).toBeUndefined()
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('main image upload creates the same editable element, selection, placement, and history as source', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const { react, vue } = await openEditors(context)
  const [sourceBefore, destinationBefore] = await Promise.all([history(vue, 'vue'), history(react, 'react')])
  expect(destinationBefore).toEqual(sourceBefore)
  await Promise.all([
    vue.locator('.canvas-tool .insert-handler-item.group-btn').nth(2).locator('input[type="file"]').first().setInputFiles(insertionFile),
    react.getByLabel('Upload image').setInputFiles(insertionFile),
  ])
  await expect.poll(async () => (await lastElement(vue, 'vue')).type).toBe('image')
  await expect.poll(async () => (await lastElement(react, 'react')).type).toBe('image')
  await Promise.all([vue.waitForTimeout(400), react.waitForTimeout(400)])
  const [sourceImage, destinationImage] = await Promise.all([lastElement(vue, 'vue'), lastElement(react, 'react')])
  expect(withoutId(destinationImage)).toEqual(withoutId(sourceImage))
  expect(withoutId(destinationImage)).toMatchObject({
    fixedRatio: true,
    height: 400,
    left: 100,
    rotate: 0,
    top: 81.25,
    type: 'image',
    width: 800,
  })
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))
  const [sourceSelection, destinationSelection] = await Promise.all([
    vue.evaluate(() => window.__MONA_TEST__!.getState().editor.activeElementIdList.length),
    react.evaluate(() => window.__MONA_REACT_TEST__!.getState().session.activeElementIds.length),
  ])
  expect(destinationSelection).toBe(sourceSelection)
  expect(destinationSelection).toBe(1)
  await context.close()
})

test('main Image menu matches source geometry, inventory, and raster', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  await vue.locator('.canvas-tool .insert-handler-item.group-btn').nth(2).locator('.arrow').click()
  await react.getByLabel('Image options').click()
  await vue.waitForTimeout(350)
  const source = vue.locator('.tippy-box[data-theme~="popover"]:visible .popover-content')
  const destination = react.locator('.mona-canvas-tool-popover:visible')
  await Promise.all([expect(source).toBeVisible(), expect(destination).toBeVisible()])
  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))
  const sourceItems = source.locator('.popover-menu-item')
  const destinationItems = destination.locator('.mona-canvas-tool-menu-item')
  expect(await destinationItems.count()).toBe(await sourceItems.count())
  expect((await destinationItems.allTextContents()).map(text => text.trim())).toEqual((await sourceItems.allTextContents()).map(text => text.trim()))
  await expectBoundedRasterDelta(source, destination, 'svg', 'svg', { changedPixels: 12, maxChannelDelta: 5, visiblePixelDelta: 4 }, 2)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('floating image toolbar matches source geometry, inventory, raster, crop lifecycle, and replacement transaction', async ({ browser }) => {
  test.slow()
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  await enableFloatingToolbar(vue, react)
  await selectImage(vue, react)
  const source = vue.locator('.floating-toolbar')
  const destination = react.locator('.mona-floating-image-toolbar')
  await Promise.all([expect(source).toBeVisible(), expect(destination).toBeVisible()])
  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))
  const sourceButtons = source.locator('.toolbar-btn')
  const destinationButtons = destination.locator('.mona-floating-toolbar-button')
  expect(await destinationButtons.count()).toBe(await sourceButtons.count())
  expect(await destinationButtons.allTextContents()).toEqual(await sourceButtons.allTextContents())
  await expectBoundedRasterDelta(source, destination, '.toolbar-btn > span', '.mona-floating-toolbar-button > span', { changedPixels: 125, maxChannelDelta: 2, visiblePixelDelta: 123 }, 2)

  await Promise.all([sourceButtons.filter({ hasText: /^Crop$/ }).click(), destinationButtons.filter({ hasText: /^Crop$/ }).click()])
  await Promise.all([
    expect(vue.locator('.image-clip-handler')).toBeVisible(),
    expect(react.locator('.mona-image-crop-editor')).toBeVisible(),
  ])
  await Promise.all([
    vue.locator('.canvas').click({ position: { x: 30, y: 30 } }),
    react.getByRole('application', { name: 'Editable slide canvas' }).click({ position: { x: 30, y: 30 } }),
  ])
  await Promise.all([
    expect(vue.locator('.image-clip-handler')).toHaveCount(0),
    expect(react.locator('.mona-image-crop-editor')).toHaveCount(0),
  ])
  const [sourceAfterCrop, destinationAfterCrop] = await Promise.all([
    vue.evaluate(() => ({ active: window.__MONA_TEST__!.getState().editor.activeElementIdList, handle: window.__MONA_TEST__!.getState().editor.handleElementId })),
    react.evaluate(() => ({ active: window.__MONA_REACT_TEST__!.getState().session.activeElementIds, handle: window.__MONA_REACT_TEST__!.getState().session.handleElementId })),
  ])
  expect(destinationAfterCrop.active).toEqual(sourceAfterCrop.active)
  expect(Boolean(destinationAfterCrop.handle)).toBe(Boolean(sourceAfterCrop.handle))
  await Promise.all([expect(source).toHaveCount(0), expect(destination).toHaveCount(0)])
  await selectImage(vue, react)
  await Promise.all([expect(source).toBeVisible(), expect(destination).toBeVisible()])
  await Promise.all([
    source.locator('input[type="file"]').setInputFiles(replacementFile),
    destination.locator('input[type="file"]').setInputFiles(replacementFile),
  ])
  await expectImageAndHistoryParity(vue, react, 'gate3-image-round')
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('online image library matches source panel geometry, inventory, raster, drag bounds, request protocol, and insertion', async ({ browser }) => {
  test.slow()
  const requests = { destination: [] as SearchRequestRecord[], source: [] as SearchRequestRecord[] }
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser, requests)
  await openImageLibrary(vue, react)
  const source = vue.locator('.moveable-panel.image-lib-panel')
  const destination = react.locator('.mona-image-library-panel')
  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))
  expect(await destination.locator('.mona-image-library-item').count()).toBe(await source.locator('.waterfall-item').count())
  const [sourceItems, destinationItems] = await Promise.all([
    source.locator('.waterfall-item').evaluateAll(items => items.map(item => ({
      rect: item.getBoundingClientRect().toJSON(),
      style: { left: (item as HTMLElement).style.left, top: (item as HTMLElement).style.top, width: (item as HTMLElement).style.width },
    }))),
    destination.locator('.mona-image-library-item').evaluateAll(items => items.map(item => ({
      rect: item.getBoundingClientRect().toJSON(),
      style: { left: (item as HTMLElement).style.left, top: (item as HTMLElement).style.top, width: (item as HTMLElement).style.width },
    }))),
  ])
  expect(destinationItems.map(item => ({ ...item, rect: roundedRect(item.rect) }))).toEqual(sourceItems.map(item => ({ ...item, rect: roundedRect(item.rect) })))
  await expectIconBoundRaster(source, destination)

  const initialRequest = { body: { orientation: 'all', page: 1, per_page: 50, query: 'landscape' }, method: 'POST', url: '/api/tools/img_search' }
  expect(requests.source).toEqual([initialRequest])
  expect(requests.destination).toEqual([initialRequest])

  await Promise.all([
    source.locator('.input input').fill('architecture'),
    destination.locator('.mona-image-library-input > input').fill('architecture'),
  ])
  await Promise.all([
    source.locator('.search-btn').click(),
    destination.locator('.mona-image-library-search').click(),
  ])
  await expect.poll(() => [requests.source.length, requests.destination.length]).toEqual([2, 2])
  const typedRequest = { body: { orientation: 'all', page: 1, per_page: 50, query: 'architecture' }, method: 'POST', url: '/api/tools/img_search' }
  expect(requests.source.at(-1)).toEqual(typedRequest)
  expect(requests.destination.at(-1)).toEqual(typedRequest)

  await source.locator('.search-orientation').click()
  await vue.waitForTimeout(350)
  await vue.locator('.tippy-box:visible .popover-menu-item').nth(1).click()
  await destination.locator('.mona-image-library-orientation').click()
  await react.locator('.mona-image-library-orientation-menu > button').filter({ hasText: /^Landscape$/ }).click()
  await expect.poll(() => [requests.source.length, requests.destination.length]).toEqual([3, 3])
  const orientedRequest = { body: { orientation: 'landscape', page: 1, per_page: 50, query: 'architecture' }, method: 'POST', url: '/api/tools/img_search' }
  expect(requests.source.at(-1)).toEqual(orientedRequest)
  expect(requests.destination.at(-1)).toEqual(orientedRequest)
  await Promise.all([
    expect(source.locator('.directive-loading-overlay')).toHaveCount(0),
    expect(destination.locator('.mona-image-library-loading')).toHaveCount(0),
  ])

  await Promise.all([
    source.locator('.image-waterfall-viewer').evaluate(element => {
      element.scrollTop = element.scrollHeight
      element.dispatchEvent(new Event('scroll'))
    }),
    destination.locator('.mona-image-library-waterfall').evaluate(element => {
      element.scrollTop = element.scrollHeight
      element.dispatchEvent(new Event('scroll'))
    }),
  ])
  await expect.poll(() => [requests.source.length, requests.destination.length], { timeout: 3_000 }).toEqual([4, 4])
  const pageTwoRequest = { body: { orientation: 'landscape', page: 2, per_page: 50, query: 'architecture' }, method: 'POST', url: '/api/tools/img_search' }
  expect(requests.source.at(-1)).toEqual(pageTwoRequest)
  expect(requests.destination.at(-1)).toEqual(pageTwoRequest)

  const [sourceHeader, destinationHeader] = await Promise.all([
    source.locator('.header').boundingBox(),
    destination.locator('.mona-moveable-panel-header').boundingBox(),
  ])
  await Promise.all([
    vue.mouse.move(sourceHeader!.x + 100, sourceHeader!.y + 20),
    react.mouse.move(destinationHeader!.x + 100, destinationHeader!.y + 20),
  ])
  await Promise.all([vue.mouse.down(), react.mouse.down()])
  await Promise.all([vue.mouse.move(-200, -200), react.mouse.move(-200, -200)])
  await Promise.all([vue.mouse.up(), react.mouse.up()])
  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))
  expect(roundedRect(await destination.boundingBox())).toEqual({ x: 0, y: 0, width: 360, height: 580 })

  await Promise.all([
    vue.locator('.image-lib-panel .img-item').first().hover(),
    react.locator('.mona-image-library-item').first().hover(),
  ])
  await Promise.all([
    vue.locator('.image-lib-panel .img-item').first().getByRole('button', { name: 'Insert' }).click(),
    react.locator('.mona-image-library-item').first().getByRole('button', { name: 'Insert' }).click(),
  ])
  await Promise.all([vue.waitForTimeout(400), react.waitForTimeout(400)])
  const [sourceLast, destinationLast] = await Promise.all([
    vue.evaluate(() => structuredClone(window.__MONA_TEST__!.getState().presentation.slides[0]!.elements.at(-1)!)),
    react.evaluate(() => structuredClone(window.__MONA_REACT_TEST__!.getState().presentation.slides[0]!.elements.at(-1)!)),
  ])
  const sourceWithoutId = { ...sourceLast, id: '' }
  const destinationWithoutId = { ...destinationLast, id: '' }
  expect(destinationWithoutId).toEqual(sourceWithoutId)
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))

  await Promise.all([sourceContext.close(), destinationContext.close()])
})
