import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

import { FORMULA_LIST, SYMBOL_LIST as LATEX_SYMBOL_LIST } from '@mona/presentation-core/latex-presets'
import { SYMBOL_LIST as INSERT_SYMBOL_LIST } from '@mona/presentation-core/symbol-presets'
import type { PPTElement, PPTLatexElement } from '@mona/presentation-core/model'

interface BridgeState {
  editor: { activeElementIdList: string[]; handleElementId: string; showBubbleMenu: boolean }
  presentation: { slideIndex: number; slides: Array<{ elements: PPTElement[] }> }
  session: { activeElementIds: string[]; handleElementId: string | null; showBubbleMenu: boolean }
}

declare global {
  interface Window {
    __MONA_TEST__?: { getState: () => BridgeState & { history: { snapshotCursor: number; snapshotLength: number } }; isReady: () => boolean }
    __MONA_REACT_TEST__?: { getHistoryState: () => { cursor: number; length: number }; getState: () => BridgeState; isReady: () => boolean }
  }
}

const fixturePath = '/?rendererFixture=gate4-editor'

async function openEditors(browser: Browser) {
  const sourceContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const destinationContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await Promise.all([
    sourceContext.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US')),
    destinationContext.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US')),
  ])
  const vue = await sourceContext.newPage()
  const react = await destinationContext.newPage()
  await Promise.all([
    vue.goto('http://127.0.0.1:5173' + fixturePath),
    react.goto('http://127.0.0.1:5174' + fixturePath),
  ])
  await Promise.all([
    expect(vue.locator('.pptist-editor')).toBeVisible(),
    expect(react.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible(),
    vue.waitForFunction(() => window.__MONA_TEST__?.isReady()),
    react.waitForFunction(() => window.__MONA_REACT_TEST__?.isReady()),
  ])
  return { destinationContext, react, sourceContext, vue }
}

const normalizeIds = <T, >(value: T): T => {
  if (Array.isArray(value)) return value.map(normalizeIds) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'id').map(([key, nested]) => [key, normalizeIds(nested)])) as T
  }
  return value
}

const roundedRect = (rect: { height: number; width: number; x: number; y: number } | null) => rect && ({
  height: Math.round(rect.height * 100) / 100,
  width: Math.round(rect.width * 100) / 100,
  x: Math.round(rect.x * 100) / 100,
  y: Math.round(rect.y * 100) / 100,
})

function cropEdges(image: PNG, amount: number) {
  if (!amount) return image
  const cropped = new PNG({ width: image.width - amount * 2, height: image.height - amount * 2 })
  PNG.bitblt(image, cropped, amount, amount, cropped.width, cropped.height, 0, 0)
  return cropped
}

async function compareRaster(source: Locator, destination: Locator, maxVisiblePixelDelta = 0, maxRawChannelDelta = 0, crop = 0) {
  const [sourceBuffer, destinationBuffer] = await Promise.all([source.screenshot(), destination.screenshot()])
  const expected = cropEdges(PNG.sync.read(sourceBuffer), crop)
  const actual = cropEdges(PNG.sync.read(destinationBuffer), crop)
  expect({ height: actual.height, width: actual.width }).toEqual({ height: expected.height, width: expected.width })
  const diff = new PNG({ height: expected.height, width: expected.width })
  const visiblePixelDelta = pixelmatch(expected.data, actual.data, diff.data, expected.width, expected.height, { threshold: 0 })
  let rawChannelDelta = 0
  for (let index = 0; index < expected.data.length; index += 1) rawChannelDelta = Math.max(rawChannelDelta, Math.abs(expected.data[index]! - actual.data[index]!))
  expect(visiblePixelDelta).toBeLessThanOrEqual(maxVisiblePixelDelta)
  expect(rawChannelDelta).toBeLessThanOrEqual(maxRawChannelDelta)
}

async function history(page: Page, app: 'react' | 'vue') {
  if (app === 'react') return page.evaluate(() => window.__MONA_REACT_TEST__!.getHistoryState())
  return page.evaluate(() => {
    const state = window.__MONA_TEST__!.getState().history
    return { cursor: state.snapshotCursor, length: state.snapshotLength }
  })
}

async function slideElements(page: Page, app: 'react' | 'vue') {
  return page.evaluate(appName => {
    const state = appName === 'vue' ? window.__MONA_TEST__!.getState() : window.__MONA_REACT_TEST__!.getState()
    return structuredClone(state.presentation.slides[state.presentation.slideIndex]!.elements)
  }, app)
}

async function lastLatex(page: Page, app: 'react' | 'vue') {
  const elements = await slideElements(page, app)
  return [...elements].reverse().find((element): element is PPTLatexElement => element.type === 'latex')!
}

async function expectDocumentParity(vue: Page, react: Page) {
  expect(normalizeIds(await slideElements(react, 'react'))).toEqual(normalizeIds(await slideElements(vue, 'vue')))
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))
}

async function expectSettledHistoryParity(
  vue: Page,
  react: Page,
  expected: { cursor: number; length: number },
) {
  // PPTist's trailing debounce calls an async Dexie writer without awaiting it.
  // Modal leave animation normally gives that write enough time to finish, but a
  // full single-worker gate can expose the interval between React's in-memory
  // snapshot and Vue publishing snapshotCursor/snapshotLength. Poll the public
  // history state at this one async persistence boundary; document parity is
  // still asserted separately and every earlier synchronous boundary remains
  // an immediate equality assertion.
  await expect.poll(async () => {
    const [source, destination] = await Promise.all([history(vue, 'vue'), history(react, 'react')])
    return { destination, source }
  }).toEqual({ destination: expected, source: expected })
}

async function waitForDebouncedHistoryParity(vue: Page, react: Page) {
  // Both implementations use a 300 ms trailing history boundary for these
  // component-local mutations. Do not sample the baseline for the next action
  // while the preceding transaction is still pending in both applications.
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  await expect.poll(async () => {
    const [source, destination] = await Promise.all([history(vue, 'vue'), history(react, 'react')])
    return source.cursor === destination.cursor && source.length === destination.length
  }).toBe(true)
}

async function openCreateEditor(vue: Page, react: Page) {
  await Promise.all([
    vue.locator('.canvas-tool .insert-handler-item').nth(6).click(),
    react.locator('.mona-canvas-insert-item').filter({ hasText: /^Equation$/ }).click(),
  ])
  const source = vue.locator('.modal-content:visible .latex-editor')
  const destination = react.locator('.mona-latex-editor')
  await Promise.all([expect(source).toBeVisible(), expect(destination).toBeVisible(), vue.waitForTimeout(350), react.waitForTimeout(350)])
  return { destination, source }
}

async function createEquation(vue: Page, react: Page, formulaIndex = 0) {
  const { destination, source } = await openCreateEditor(vue, react)
  await Promise.all([
    source.locator('.right > .tabs.card .tab').filter({ hasText: /^Preset equations$/ }).click(),
    destination.locator('.mona-latex-tabs.is-card > button').filter({ hasText: /^Preset equations$/ }).click(),
  ])
  await Promise.all([
    source.locator('.formula-item').nth(formulaIndex).locator('.formula-item-content').click(),
    destination.locator('.mona-latex-formula-item').nth(formulaIndex).locator('.mona-latex-formula-item-content').click(),
  ])
  const latex = await source.locator('textarea').inputValue()
  expect(await destination.locator('textarea').inputValue()).toBe(latex)
  const historyBeforeCreate = await history(react, 'react')
  await Promise.all([
    source.locator('.footer .button').filter({ hasText: /^Confirm$/ }).click(),
    destination.locator('.mona-latex-editor-button').filter({ hasText: /^Confirm$/ }).click(),
  ])
  await Promise.all([expect(source).toBeHidden(), expect(destination).toBeHidden()])
  expect(normalizeIds(await slideElements(react, 'react'))).toEqual(normalizeIds(await slideElements(vue, 'vue')))
  await expectSettledHistoryParity(vue, react, {
    cursor: historyBeforeCreate.cursor + 1,
    length: historyBeforeCreate.length + 1,
  })
  return {
    destination: await lastLatex(react, 'react'),
    latex,
    source: await lastLatex(vue, 'vue'),
  }
}

async function enableFloatingToolbar(vue: Page, react: Page) {
  await Promise.all([
    vue.locator('.canvas').click({ button: 'right', position: { x: 40, y: 40 } }),
    react.getByRole('application', { name: 'Editable slide canvas' }).click({ button: 'right', position: { x: 40, y: 40 } }),
  ])
  await Promise.all([
    vue.locator('.contextmenu > .menu-content > .menu-item').filter({ hasText: /^Floating toolbar/ }).click(),
    react.locator('.mona-editor-context-menu [data-action="bubble-menu"]').click(),
  ])
}

async function currentLatex(page: Page, app: 'react' | 'vue', id: string) {
  const elements = await slideElements(page, app)
  return elements.find((element): element is PPTLatexElement => element.id === id && element.type === 'latex')!
}

async function openSymbolPanel(vue: Page, react: Page) {
  await Promise.all([
    vue.locator('.canvas-tool .insert-handler-item').nth(8).click(),
    react.locator('.mona-canvas-insert-item').filter({ hasText: /^Symbol$/ }).click(),
  ])
  const source = vue.locator('.moveable-panel.symbol-panel')
  const destination = react.locator('.mona-symbol-panel')
  await Promise.all([expect(source).toBeVisible(), expect(destination).toBeVisible()])
  return { destination, source }
}

async function selectSlide(vue: Page, react: Page, slideIndex: number) {
  await Promise.all([
    vue.locator('.thumbnail-slide').nth(slideIndex).click(),
    react.getByRole('button', { name: `Show slide ${slideIndex + 1}` }).click(),
  ])
  await expect.poll(async () => Promise.all([
    vue.evaluate(() => window.__MONA_TEST__!.getState().presentation.slideIndex),
    react.evaluate(() => window.__MONA_REACT_TEST__!.getState().presentation.slideIndex),
  ])).toEqual([slideIndex, slideIndex])
}

async function placeCaretAtEnd(locator: Locator) {
  await locator.evaluate(element => {
    const selection = window.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
    ;(element as HTMLElement).focus()
  })
}

async function currentElement(page: Page, app: 'react' | 'vue', id: string) {
  return (await slideElements(page, app)).find(element => element.id === id)!
}

test('equation modal, complete preset inventories, generated preview, validation, and creation match source', async ({ browser }) => {
  test.setTimeout(90_000)
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const beforeElements = await slideElements(vue, 'vue')
  const beforeHistory = await history(vue, 'vue')
  const { destination, source } = await openCreateEditor(vue, react)

  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))
  expect(await destination.innerText()).toBe(await source.innerText())
  expect(await destination.locator('textarea').count()).toBe(1)
  expect(await destination.locator('.mona-latex-tabs.is-card > button').count()).toBe(await source.locator('.right > .tabs.card .tab').count())
  expect(await destination.locator('.mona-latex-symbol-tabs button').count()).toBe(await source.locator('.symbol > .tabs .tab').count())
  expect(await destination.locator('.mona-latex-symbol-item').count()).toBe(await source.locator('.symbol-pool .symbol-item').count())
  expect(await source.locator('textarea').evaluate(element => document.activeElement === element)).toBe(true)
  expect(await destination.locator('textarea').evaluate(element => document.activeElement === element)).toBe(true)
  await compareRaster(source, destination)

  const sourceSymbolTabs = source.locator('.symbol > .tabs .tab')
  const destinationSymbolTabs = destination.locator('.mona-latex-symbol-tabs button')
  expect(await sourceSymbolTabs.count()).toBe(LATEX_SYMBOL_LIST.length)
  for (let index = 0; index < LATEX_SYMBOL_LIST.length; index += 1) {
    await Promise.all([sourceSymbolTabs.nth(index).click(), destinationSymbolTabs.nth(index).click()])
    const sourceItems = source.locator('.symbol-pool .symbol-item')
    const destinationItems = destination.locator('.mona-latex-symbol-item')
    expect(await sourceItems.count()).toBe(LATEX_SYMBOL_LIST[index]!.children.length)
    expect(await destinationItems.count()).toBe(await sourceItems.count())
    expect(await destinationItems.locator('path').evaluateAll(paths => paths.map(path => path.getAttribute('d'))))
      .toEqual(await sourceItems.locator('path').evaluateAll(paths => paths.map(path => path.getAttribute('d'))))
    // Every SVG path is asserted exactly above. Chromium can round one
    // anti-aliased channel by one value in the Functions/Greek pools.
    await compareRaster(source.locator('.symbol'), destination.locator('.mona-latex-symbol-pane'), 1, 1)
  }
  await Promise.all([sourceSymbolTabs.first().click(), destinationSymbolTabs.first().click()])

  await Promise.all([
    source.locator('.footer .button').filter({ hasText: /^Confirm$/ }).click(),
    destination.locator('.mona-latex-editor-button').filter({ hasText: /^Confirm$/ }).click(),
  ])
  const sourceNotice = vue.locator('.message-wrap .message')
  const destinationNotice = react.locator('.mona-message')
  await Promise.all([expect(sourceNotice).toBeVisible(), expect(destinationNotice).toBeVisible()])
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  expect(await destinationNotice.innerText()).toBe(await sourceNotice.innerText())
  expect(roundedRect(await destinationNotice.boundingBox())).toEqual(roundedRect(await sourceNotice.boundingBox()))
  const sourceNoticeSurface = sourceNotice.locator('.message-container')
  const destinationNoticeSurface = destinationNotice.locator('.mona-message-container')
  expect(await destinationNoticeSurface.evaluate(element => [getComputedStyle(element).boxShadow, getComputedStyle(element).borderRadius]))
    .toEqual(await sourceNoticeSurface.evaluate(element => [getComputedStyle(element).boxShadow, getComputedStyle(element).borderRadius]))
  // Rounded shadow-edge pixels blend with two independently rendered editor
  // backdrops. Verify those styles above, then isolate the opaque content raster.
  await Promise.all([
    sourceNoticeSurface.evaluate(element => {
      element.style.borderRadius = '0'; element.style.boxShadow = 'none' 
    }),
    destinationNoticeSurface.evaluate(element => {
      element.style.borderRadius = '0'; element.style.boxShadow = 'none' 
    }),
  ])
  await compareRaster(sourceNoticeSurface, destinationNoticeSurface)
  expect(normalizeIds(await slideElements(react, 'react'))).toEqual(normalizeIds(beforeElements))
  expect(normalizeIds(await slideElements(vue, 'vue'))).toEqual(normalizeIds(beforeElements))
  expect(await history(react, 'react')).toEqual(beforeHistory)
  expect(await history(vue, 'vue')).toEqual(beforeHistory)

  const sourceTextarea = source.locator('textarea')
  const destinationTextarea = destination.locator('textarea')
  await Promise.all([sourceTextarea.fill('ab'), destinationTextarea.fill('ab')])
  await Promise.all([
    sourceTextarea.evaluate(element => (element as HTMLTextAreaElement).setSelectionRange(1, 1)),
    destinationTextarea.evaluate(element => (element as HTMLTextAreaElement).setSelectionRange(1, 1)),
  ])
  await Promise.all([
    source.locator('.symbol-pool .symbol-item').nth(1).click(),
    destination.locator('.mona-latex-symbol-item').nth(1).click(),
  ])
  expect(await destinationTextarea.inputValue()).toBe(await sourceTextarea.inputValue())
  await Promise.all([
    source.locator('.right > .tabs.card .tab').filter({ hasText: /^Preset equations$/ }).click(),
    destination.locator('.mona-latex-tabs.is-card > button').filter({ hasText: /^Preset equations$/ }).click(),
  ])
  expect(await destination.locator('.mona-latex-formula-item').count()).toBe(FORMULA_LIST.length)
  expect(await destination.locator('.mona-latex-formula-item').count()).toBe(await source.locator('.formula-item').count())
  expect(await destination.locator('.mona-latex-formula-title').allInnerTexts()).toEqual(await source.locator('.formula-title').allInnerTexts())
  for (let index = 0; index < FORMULA_LIST.length; index += 1) {
    await Promise.all([
      source.locator('.formula-item').nth(index).locator('.formula-item-content').click(),
      destination.locator('.mona-latex-formula-item').nth(index).locator('.mona-latex-formula-item-content').click(),
    ])
    expect(await destinationTextarea.inputValue()).toBe(await sourceTextarea.inputValue())
    expect(await destination.locator('.mona-latex-preview-content path').getAttribute('d'))
      .toBe(await source.locator('.preview-content path').getAttribute('d'))
  }
  const selectedLatex = await sourceTextarea.inputValue()
  const sourcePreview = source.locator('.preview-content .formula-content')
  const destinationPreview = destination.locator('.mona-latex-preview-content .mona-latex-formula-content')
  expect(await destinationPreview.locator('path').getAttribute('d')).toBe(await sourcePreview.locator('path').getAttribute('d'))
  expect(roundedRect(await destinationPreview.boundingBox())).toEqual(roundedRect(await sourcePreview.boundingBox()))
  await compareRaster(sourcePreview, destinationPreview)

  await Promise.all([
    source.locator('.footer .button').filter({ hasText: /^Confirm$/ }).click(),
    destination.locator('.mona-latex-editor-button').filter({ hasText: /^Confirm$/ }).click(),
  ])
  await Promise.all([expect(source).toBeHidden(), expect(destination).toBeHidden()])
  await expectDocumentParity(vue, react)
  const created = await lastLatex(react, 'react')
  expect(created.latex).toBe(selectedLatex)
  expect(created.fixedRatio).toBe(true)
  expect(created.strokeWidth).toBe(2)
  expect(created.viewBox).toEqual([created.width, created.height])
  const sourceElement = vue.locator('.editable-element-latex').last()
  const destinationElement = react.locator('[data-element-type="latex"]').last()
  expect(roundedRect(await destinationElement.boundingBox())).toEqual(roundedRect(await sourceElement.boundingBox()))
  const sourceSvg = sourceElement.locator('svg')
  const destinationSvg = destinationElement.locator('svg')
  expect(await destinationSvg.locator('path').getAttribute('d')).toBe(await sourceSvg.locator('path').getAttribute('d'))
  expect(await destinationSvg.evaluate(element => {
    const style = getComputedStyle(element)
    return [style.display, style.overflow, style.transformOrigin, style.verticalAlign, style.stroke, style.strokeWidth, style.fill]
  })).toEqual(await sourceSvg.evaluate(element => {
    const style = getComputedStyle(element)
    return [style.display, style.overflow, style.transformOrigin, style.verticalAlign, style.stroke, style.strokeWidth, style.fill]
  }))
  // The equation SVG is transparent. Its path raster is isolated from the
  // independently rendered slide background, which is verified elsewhere.
  await Promise.all([
    sourceSvg.evaluate(element => {
      element.style.background = '#fff' 
    }),
    destinationSvg.evaluate(element => {
      element.style.background = '#fff' 
    }),
  ])
  // Pixelmatch reports zero visible pixels; Chromium's independently created
  // SVG layer differs by at most one channel value at an anti-aliased edge.
  await compareRaster(sourceSvg, destinationSvg, 0, 1)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('equation cancel, Escape, and mask dismissal preserve source leave lifecycle and document state', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const beforeElements = await slideElements(vue, 'vue')
  const beforeHistory = await history(vue, 'vue')
  for (const method of ['cancel', 'escape', 'mask'] as const) {
    const { destination, source } = await openCreateEditor(vue, react)
    if (method === 'cancel') {
      await Promise.all([
        source.locator('.footer .button').filter({ hasText: /^Cancel$/ }).click(),
        destination.locator('.mona-latex-editor-button').filter({ hasText: /^Cancel$/ }).click(),
      ])
    }
    else if (method === 'escape') {
      await Promise.all([source.locator('textarea').press('Escape'), destination.locator('textarea').press('Escape')])
    }
    else {
      await Promise.all([vue.locator('.modal:visible .mask').click({ position: { x: 10, y: 10 } }), react.locator('.mona-latex-modal-mask').click({ position: { x: 10, y: 10 } })])
    }
    // PPTist retains both layers for the 250 ms leave transition.
    await Promise.all([expect(source).toBeVisible(), expect(destination).toBeVisible()])
    expect(await destination.evaluate(element => getComputedStyle(element.closest('.mona-latex-modal')!).animationDuration))
      .toBe(await source.evaluate(element => getComputedStyle(element.closest('.modal')!).animationDuration))
    expect(await destination.evaluate(element => getComputedStyle(element.closest('.mona-latex-modal-content')!).animationDuration))
      .toBe(await source.evaluate(element => getComputedStyle(element.closest('.modal-content')!).animationDuration))
    await Promise.all([expect(source).toBeHidden(), expect(destination).toBeHidden()])
    expect(normalizeIds(await slideElements(react, 'react'))).toEqual(normalizeIds(beforeElements))
    expect(normalizeIds(await slideElements(vue, 'vue'))).toEqual(normalizeIds(beforeElements))
    expect(await history(react, 'react')).toEqual(beforeHistory)
    expect(await history(vue, 'vue')).toEqual(beforeHistory)
  }
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('equation inspector, number bounds, color, floating toolbar, every edit entry point, save, undo, and redo match source', async ({ browser }) => {
  test.setTimeout(90_000)
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const created = await createEquation(vue, react, 2)
  const sourcePanel = vue.locator('.latex-style-panel')
  const destinationPanel = react.locator('.mona-latex-style-panel')
  await Promise.all([expect(sourcePanel).toBeVisible(), expect(destinationPanel).toBeVisible()])
  expect(await destinationPanel.innerText()).toBe(await sourcePanel.innerText())
  expect(roundedRect(await destinationPanel.boundingBox())).toEqual(roundedRect(await sourcePanel.boundingBox()))
  expect(await destinationPanel.locator('svg path').evaluateAll(paths => paths.map(path => path.getAttribute('d'))))
    .toEqual(await sourcePanel.locator('svg path').evaluateAll(paths => paths.map(path => path.getAttribute('d'))))
  // Pixelmatch finds no visible pixel delta; independently instantiated icon
  // masks can differ only in Chromium's classified anti-alias channels.
  await compareRaster(sourcePanel, destinationPanel, 0, 64)

  const sourceWeight = sourcePanel.locator('.number-input input')
  const destinationWeight = destinationPanel.locator('.mona-panel-number input')
  expect(await destinationWeight.inputValue()).toBe(await sourceWeight.inputValue())
  await Promise.all([
    sourcePanel.locator('.number-input .handler').first().click(),
    destinationPanel.locator('.mona-panel-number-handlers button').first().click(),
  ])
  await expectDocumentParity(vue, react)
  expect(await destinationWeight.inputValue()).toBe(await sourceWeight.inputValue())
  await Promise.all([
    sourcePanel.locator('.number-input .handler').first().click(),
    destinationPanel.locator('.mona-panel-number-handlers button').first().click(),
  ])
  // The source displays the out-of-range draft (4) without committing it.
  expect(await destinationWeight.inputValue()).toBe(await sourceWeight.inputValue())
  await expectDocumentParity(vue, react)
  await Promise.all([sourceWeight.blur(), destinationWeight.blur()])
  expect(await destinationWeight.inputValue()).toBe(await sourceWeight.inputValue())
  await expectDocumentParity(vue, react)

  await Promise.all([
    sourcePanel.locator('.color-btn').click(),
    destinationPanel.locator('.mona-panel-color-button').click(),
  ])
  const sourcePicker = vue.locator('.tippy-box[data-theme~="popover"]:visible .color-picker')
  const destinationPicker = react.locator('.mona-panel-popover-content .mona-color-picker')
  await Promise.all([expect(sourcePicker).toBeVisible(), expect(destinationPicker).toBeVisible()])
  await Promise.all([vue.waitForTimeout(250), react.waitForTimeout(250)])
  expect(roundedRect(await destinationPicker.boundingBox())).toEqual(roundedRect(await sourcePicker.boundingBox()))
  expect(await destinationPicker.locator('.mona-color-picker-swatch').count()).toBe(await sourcePicker.locator('.picker-presets-color, .picker-gradient-color').count())
  // Opaque field and palette regions are byte-identical. Chromium composites
  // the CSS gradient/control layers one to two channel values apart despite
  // identical computed gradients, boxes, and pointer positions.
  await compareRaster(sourcePicker.locator('.picker-field'), destinationPicker.locator('.mona-color-picker-field'))
  await compareRaster(sourcePicker.locator('.picker-gradient-presets'), destinationPicker.locator('.mona-color-picker-gradients'))
  const sourcePresets = sourcePicker.locator('.picker-presets')
  const destinationPresets = destinationPicker.locator('.mona-color-picker-presets')
  expect(await destinationPresets.count()).toBe(await sourcePresets.count())
  for (let index = 0; index < await sourcePresets.count(); index += 1) {
    const sourceBox = await sourcePresets.nth(index).boundingBox()
    const destinationBox = await destinationPresets.nth(index).boundingBox()
    expect(roundedRect(destinationBox)).toEqual(roundedRect(sourceBox))
    if (sourceBox?.height) await compareRaster(sourcePresets.nth(index), destinationPresets.nth(index))
  }
  await compareRaster(sourcePicker.locator('.saturation'), destinationPicker.locator('.mona-color-picker-saturation'), 9_000, 1)
  await compareRaster(sourcePicker.locator('.picker-controls'), destinationPicker.locator('.mona-color-picker-controls'), 900, 2)
  await Promise.all([
    sourcePicker.locator('.picker-presets').first().locator('.picker-presets-color').nth(5).click(),
    destinationPicker.locator('.mona-color-picker-presets').first().locator('.mona-color-picker-swatch').nth(5).click(),
  ])
  await expectDocumentParity(vue, react)
  await Promise.all([sourcePanel.locator('.color-btn').click(), destinationPanel.locator('.mona-panel-color-button').click()])

  const [sourceSelectionBeforeFloating, destinationSelectionBeforeFloating] = await Promise.all([
    vue.evaluate(() => window.__MONA_TEST__!.getState().editor),
    react.evaluate(() => window.__MONA_REACT_TEST__!.getState().session),
  ])
  expect(destinationSelectionBeforeFloating.activeElementIds).toEqual([created.destination.id])
  expect(destinationSelectionBeforeFloating.handleElementId).toBe(created.destination.id)
  expect(sourceSelectionBeforeFloating.activeElementIdList).toEqual([created.source.id])
  expect(sourceSelectionBeforeFloating.handleElementId).toBe(created.source.id)

  await enableFloatingToolbar(vue, react)
  const [sourceSession, destinationSession] = await Promise.all([
    vue.evaluate(() => window.__MONA_TEST__!.getState().editor),
    react.evaluate(() => window.__MONA_REACT_TEST__!.getState().session),
  ])
  // Opening the canvas menu is itself a blank-canvas pointer-down in PPTist,
  // so both implementations must clear the active selection before enabling.
  expect(sourceSession.activeElementIdList).toEqual([])
  expect(destinationSession.activeElementIds).toEqual([])
  expect(destinationSession.showBubbleMenu).toBe(sourceSession.showBubbleMenu)
  expect(destinationSession.showBubbleMenu).toBe(true)
  await Promise.all([
    vue.locator(`#editable-element-${created.source.id} .editable-element-latex`).click(),
    react.locator(`[data-element-hit="${created.destination.id}"]`).click(),
  ])
  const [sourceReselected, destinationReselected] = await Promise.all([
    vue.evaluate(() => window.__MONA_TEST__!.getState().editor),
    react.evaluate(() => window.__MONA_REACT_TEST__!.getState().session),
  ])
  expect(sourceReselected.activeElementIdList).toEqual([created.source.id])
  expect(sourceReselected.handleElementId).toBe(created.source.id)
  expect(destinationReselected.activeElementIds).toEqual([created.destination.id])
  expect(destinationReselected.handleElementId).toBe(created.destination.id)
  const sourceFloating = vue.locator('.floating-toolbar')
  const destinationFloating = react.locator('.mona-floating-latex-toolbar')
  await Promise.all([expect(sourceFloating).toBeVisible(), expect(destinationFloating).toBeVisible()])
  expect(await destinationFloating.innerText()).toBe(await sourceFloating.innerText())
  expect(await destinationFloating.locator('.mona-floating-toolbar-button').count()).toBe(await sourceFloating.locator('.toolbar-btn').count())
  expect(roundedRect(await destinationFloating.boundingBox())).toEqual(roundedRect(await sourceFloating.boundingBox()))
  await compareRaster(sourceFloating, destinationFloating)

  await Promise.all([
    sourceFloating.locator('.toolbar-btn').filter({ hasText: /^Color$/ }).click(),
    destinationFloating.locator('.mona-floating-toolbar-button').filter({ hasText: /^Color$/ }).click(),
  ])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .picker-presets').first().locator('.picker-presets-color').nth(3).click(),
    react.locator('.mona-panel-popover-content .mona-color-picker-presets').first().locator('.mona-color-picker-swatch').nth(3).click(),
  ])
  await expectDocumentParity(vue, react)
  await Promise.all([
    sourceFloating.locator('.toolbar-btn').filter({ hasText: /^Color$/ }).click(),
    destinationFloating.locator('.mona-floating-toolbar-button').filter({ hasText: /^Color$/ }).click(),
  ])

  const [sourceAfterFloatingColor, destinationAfterFloatingColor] = await Promise.all([
    vue.evaluate(() => window.__MONA_TEST__!.getState().editor),
    react.evaluate(() => window.__MONA_REACT_TEST__!.getState().session),
  ])
  expect(sourceAfterFloatingColor.activeElementIdList).toEqual([created.source.id])
  expect(destinationAfterFloatingColor.activeElementIds).toEqual([created.destination.id])
  await Promise.all([expect(sourceFloating).toBeVisible(), expect(destinationFloating).toBeVisible()])

  await waitForDebouncedHistoryParity(vue, react)
  const historyBeforeEquationEdit = await history(react, 'react')
  for (const entry of ['floating', 'inspector', 'double-click'] as const) {
    if (entry === 'floating') {
      await Promise.all([
        sourceFloating.locator('.toolbar-btn').filter({ hasText: /^Edit LaTeX$/ }).click(),
        destinationFloating.locator('.mona-floating-toolbar-button').filter({ hasText: /^Edit LaTeX$/ }).click(),
      ])
    }
    else if (entry === 'inspector') {
      await Promise.all([sourcePanel.locator('.button').first().click(), destinationPanel.locator('.mona-latex-edit-button').click()])
    }
    else {
      await Promise.all([
        vue.locator(`#editable-element-${created.source.id} .editable-element-latex`).dblclick(),
        react.locator(`[data-element-hit="${created.destination.id}"]`).dblclick(),
      ])
    }
    const sourceEditor = vue.locator('.modal-content:visible .latex-editor')
    const destinationEditor = react.locator('.mona-latex-editor')
    await Promise.all([expect(sourceEditor).toBeVisible(), expect(destinationEditor).toBeVisible()])
    expect(await destinationEditor.locator('textarea').inputValue()).toBe(await sourceEditor.locator('textarea').inputValue())
    if (entry !== 'double-click') {
      await Promise.all([
        sourceEditor.locator('.footer .button').filter({ hasText: /^Cancel$/ }).click(),
        destinationEditor.locator('.mona-latex-editor-button').filter({ hasText: /^Cancel$/ }).click(),
      ])
      await Promise.all([expect(sourceEditor).toBeHidden(), expect(destinationEditor).toBeHidden()])
    }
    else {
      await Promise.all([sourceEditor.locator('textarea').fill('\\frac{a}{b}'), destinationEditor.locator('textarea').fill('\\frac{a}{b}')])
      const sourcePath = await sourceEditor.locator('.preview-content path').getAttribute('d')
      expect(await destinationEditor.locator('.mona-latex-preview-content path').getAttribute('d')).toBe(sourcePath)
      await Promise.all([
        sourceEditor.locator('.footer .button').filter({ hasText: /^Confirm$/ }).click(),
        destinationEditor.locator('.mona-latex-editor-button').filter({ hasText: /^Confirm$/ }).click(),
      ])
      await Promise.all([expect(sourceEditor).toBeHidden(), expect(destinationEditor).toBeHidden()])
    }
  }

  expect(normalizeIds(await slideElements(react, 'react'))).toEqual(normalizeIds(await slideElements(vue, 'vue')))
  await expectSettledHistoryParity(vue, react, {
    cursor: historyBeforeEquationEdit.cursor + 1,
    length: historyBeforeEquationEdit.length + 1,
  })
  const editedSource = await currentLatex(vue, 'vue', created.source.id)
  const editedDestination = await currentLatex(react, 'react', created.destination.id)
  expect(normalizeIds(editedDestination)).toEqual(normalizeIds(editedSource))
  expect(editedDestination.latex).toBe('\\frac{a}{b}')
  const sourceUndo = vue.locator('.canvas-tool .left-handler > .handler-item').nth(0)
  const sourceRedo = vue.locator('.canvas-tool .left-handler > .handler-item').nth(1)
  const destinationUndo = react.getByRole('button', { name: 'Undo' })
  const destinationRedo = react.getByRole('button', { name: 'Redo' })
  await Promise.all([sourceUndo.click(), destinationUndo.click()])
  await expect.poll(async () => Promise.all([
    currentLatex(vue, 'vue', created.source.id).then(element => element.latex),
    currentLatex(react, 'react', created.destination.id).then(element => element.latex),
  ])).toEqual([created.latex, created.latex])
  await expectDocumentParity(vue, react)
  expect((await currentLatex(react, 'react', created.destination.id)).latex).toBe(created.latex)
  await Promise.all([sourceRedo.click(), destinationRedo.click()])
  await expect.poll(async () => Promise.all([
    currentLatex(vue, 'vue', created.source.id).then(element => element.latex),
    currentLatex(react, 'react', created.destination.id).then(element => element.latex),
  ])).toEqual(['\\frac{a}{b}', '\\frac{a}{b}'])
  await expectDocumentParity(vue, react)
  expect((await currentLatex(react, 'react', created.destination.id)).latex).toBe('\\frac{a}{b}')
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('symbol panel complete inventories, tabs, emoji categories, scrolling, geometry, and raster match source', async ({ browser }) => {
  test.setTimeout(120_000)
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const { destination, source } = await openSymbolPanel(vue, react)
  const sourceTabs = source.locator('.tabs > .tab')
  const destinationTabs = destination.locator('.mona-symbol-tabs > button')
  const sourcePool = source.locator('.pool')
  const destinationPool = destination.locator('.mona-symbol-pool')

  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))
  expect(await destination.evaluate(element => getComputedStyle(element).zIndex)).toBe(await source.evaluate(element => getComputedStyle(element).zIndex))
  expect(await destinationTabs.count()).toBe(INSERT_SYMBOL_LIST.length)
  expect(await destinationTabs.allTextContents()).toEqual(await sourceTabs.allTextContents())
  expect(await destination.innerText()).toBe(await source.innerText())

  for (let tabIndex = 0; tabIndex < INSERT_SYMBOL_LIST.length; tabIndex += 1) {
    if (tabIndex > 0) {
      await Promise.all([
        sourcePool.evaluate(element => {
          element.scrollTop = 120 
        }),
        destinationPool.evaluate(element => {
          element.scrollTop = 120 
        }),
      ])
      await Promise.all([
        sourceTabs.nth(tabIndex).click({ position: { x: 20, y: 10 } }),
        destinationTabs.nth(tabIndex).click({ position: { x: 20, y: 10 } }),
      ])
      expect(await sourcePool.evaluate(element => element.scrollTop)).toBe(0)
      expect(await destinationPool.evaluate(element => element.scrollTop)).toBe(0)
    }
    const preset = INSERT_SYMBOL_LIST[tabIndex]!
    const sourceGroups = source.locator('.symbol-group')
    const destinationGroups = destination.locator('.mona-symbol-group')
    const expectedGroups = preset.key === 'emoji' ? [preset.children[0]!] : preset.children
    expect(await sourceGroups.count()).toBe(expectedGroups.length)
    expect(await destinationGroups.count()).toBe(expectedGroups.length)
    for (let groupIndex = 0; groupIndex < expectedGroups.length; groupIndex += 1) {
      const expected = [...expectedGroups[groupIndex]!]
      expect(await sourceGroups.nth(groupIndex).locator('.symbol-item').allTextContents()).toEqual(expected)
      expect(await destinationGroups.nth(groupIndex).locator('.mona-symbol-item').allTextContents()).toEqual(expected)
    }
    expect(await destination.innerText()).toBe(await source.innerText())
    await compareRaster(source, destination)
  }

  const emojiPreset = INSERT_SYMBOL_LIST.find(item => item.key === 'emoji')!
  const sourceCategories = source.locator('.emoji-types > .emoji-type')
  const destinationCategories = destination.locator('.mona-symbol-emoji-types > button')
  expect(await destinationCategories.count()).toBe(emojiPreset.children.length)
  expect(await destinationCategories.allTextContents()).toEqual(await sourceCategories.allTextContents())
  for (let categoryIndex = 0; categoryIndex < emojiPreset.children.length; categoryIndex += 1) {
    if (categoryIndex > 0) {
      await Promise.all([
        sourcePool.evaluate(element => {
          element.scrollTop = 180 
        }),
        destinationPool.evaluate(element => {
          element.scrollTop = 180 
        }),
      ])
      // The source category row deliberately overflows a hidden ancestor.
      // Locator.click() would programmatically horizontal-scroll that hidden
      // container to reveal later categories, which a real pointer cannot do.
      await Promise.all([
        sourceCategories.nth(categoryIndex).evaluate(element => (element as HTMLElement).click()),
        destinationCategories.nth(categoryIndex).evaluate(element => (element as HTMLElement).click()),
      ])
      expect(await sourcePool.evaluate(element => element.scrollTop)).toBe(0)
      expect(await destinationPool.evaluate(element => element.scrollTop)).toBe(0)
    }
    const expected = [...emojiPreset.children[categoryIndex]!]
    expect(await source.locator('.symbol-group .symbol-item').allTextContents()).toEqual(expected)
    expect(await destination.locator('.mona-symbol-group .mona-symbol-item').allTextContents()).toEqual(expected)
    expect(await destination.innerText()).toBe(await source.innerText())
    await compareRaster(source, destination)
  }
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('symbol panel dragging, viewport clamps, active toolbar state, and close lifecycle match source', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const { destination, source } = await openSymbolPanel(vue, react)
  const sourceTool = vue.locator('.canvas-tool .insert-handler-item').nth(8)
  const destinationTool = react.locator('.mona-canvas-insert-item').filter({ hasText: /^Symbol$/ })
  expect(await sourceTool.getAttribute('class')).toContain('active')
  expect(await destinationTool.getAttribute('class')).toContain('is-active')

  const drag = async (page: Page, panel: Locator, deltaX: number, deltaY: number) => {
    const box = await panel.boundingBox()
    expect(box).not.toBeNull()
    const x = box!.x + 300
    const y = box!.y + 46
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + deltaX, y + deltaY, { steps: 5 })
    await page.mouse.up()
  }

  await Promise.all([drag(vue, source, -180, 110), drag(react, destination, -180, 110)])
  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))
  await Promise.all([drag(vue, source, -2_000, -2_000), drag(react, destination, -2_000, -2_000)])
  expect(roundedRect(await source.boundingBox())).toEqual({ height: 560, width: 350, x: 0, y: 0 })
  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))
  await Promise.all([drag(vue, source, 2_000, 2_000), drag(react, destination, 2_000, 2_000)])
  expect(roundedRect(await source.boundingBox())).toEqual({ height: 560, width: 350, x: 1090, y: 340 })
  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))

  await Promise.all([
    source.locator('.close-btn').click(),
    destination.locator('.mona-symbol-panel-close').click(),
  ])
  await Promise.all([expect(source).toBeHidden(), expect(destination).toBeHidden()])
  expect(await sourceTool.getAttribute('class')).not.toContain('active')
  expect(await destinationTool.getAttribute('class')).not.toContain('is-active')
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('symbol insertion without an editable target creates the exact source text element, selection, and history', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const beforeCount = (await slideElements(vue, 'vue')).length
  const beforeHistory = await history(vue, 'vue')
  const { destination, source } = await openSymbolPanel(vue, react)
  await Promise.all([
    source.locator('.symbol-item').first().click(),
    destination.locator('.mona-symbol-item').first().click(),
  ])
  await Promise.all([vue.waitForTimeout(650), react.waitForTimeout(650)])
  await expectDocumentParity(vue, react)
  const [sourceElements, destinationElements] = await Promise.all([slideElements(vue, 'vue'), slideElements(react, 'react')])
  expect(sourceElements).toHaveLength(beforeCount + 1)
  expect(destinationElements).toHaveLength(beforeCount + 1)
  const sourceCreated = sourceElements.at(-1)!
  const destinationCreated = destinationElements.at(-1)!
  expect(normalizeIds(destinationCreated)).toEqual(normalizeIds(sourceCreated))
  expect(normalizeIds(destinationCreated)).toEqual({
    content: 'α',
    defaultColor: '#333',
    defaultFontName: '',
    height: 44,
    left: 0,
    rotate: 0,
    top: 0,
    type: 'text',
    vertical: false,
    width: 200,
  })
  const [sourceState, destinationState] = await Promise.all([
    vue.evaluate(() => window.__MONA_TEST__!.getState().editor),
    react.evaluate(() => window.__MONA_REACT_TEST__!.getState().session),
  ])
  expect(sourceState.activeElementIdList).toEqual([sourceCreated.id])
  expect(destinationState.activeElementIds).toEqual([destinationCreated.id])
  expect(await history(vue, 'vue')).toEqual({ cursor: beforeHistory.cursor + 1, length: beforeHistory.length + 1 })
  await Promise.all([expect(source).toBeVisible(), expect(destination).toBeVisible()])
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('symbol insertion into text, shape text, shape fallback, and table cell matches every source branch', async ({ browser }) => {
  test.setTimeout(120_000)
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)

  await selectSlide(vue, react, 1)
  const sourceText = vue.locator('#editable-element-gate3-image-title .ProseMirror')
  const destinationText = react.locator('[data-element-id="gate3-image-title"] .ProseMirror')
  await Promise.all([sourceText.click(), destinationText.click()])
  await Promise.all([placeCaretAtEnd(sourceText), placeCaretAtEnd(destinationText)])
  const { destination: destinationPanel, source: sourcePanel } = await openSymbolPanel(vue, react)
  await Promise.all([
    sourcePanel.locator('.symbol-item').nth(1).click(),
    destinationPanel.locator('.mona-symbol-item').nth(1).click(),
  ])
  await Promise.all([vue.waitForTimeout(650), react.waitForTimeout(650)])
  expect(await destinationText.innerHTML()).toBe(await sourceText.innerHTML())
  expect(await destinationText.innerHTML()).toContain('β')
  expect(await currentElement(react, 'react', 'gate3-image-title')).toEqual(await currentElement(vue, 'vue', 'gate3-image-title'))
  await expectDocumentParity(vue, react)

  await selectSlide(vue, react, 0)
  const sourceShapeHit = vue.locator('#editable-element-gate3-gradient-shape .editable-element-shape')
  const destinationShapeHit = react.getByRole('button', { name: 'Select shape gate3-gradient-shape' })
  await Promise.all([sourceShapeHit.click({ position: { x: 45, y: 40 } }), destinationShapeHit.click()])
  await Promise.all([sourceShapeHit.click({ position: { x: 45, y: 40 } }), destinationShapeHit.click()])
  await Promise.all([
    sourceShapeHit.locator('.element-content').dblclick({ position: { x: 85, y: 70 } }),
    destinationShapeHit.dblclick({ position: { x: 85, y: 70 } }),
  ])
  const sourceShapeText = vue.locator('#editable-element-gate3-gradient-shape .ProseMirror')
  const destinationShapeText = react.locator('[data-element-id="gate3-gradient-shape"] .ProseMirror')
  await Promise.all([expect(sourceShapeText).toBeVisible(), expect(destinationShapeText).toBeVisible()])
  await Promise.all([placeCaretAtEnd(sourceShapeText), placeCaretAtEnd(destinationShapeText)])
  await Promise.all([
    sourcePanel.locator('.symbol-item').nth(2).click(),
    destinationPanel.locator('.mona-symbol-item').nth(2).click(),
  ])
  await Promise.all([vue.waitForTimeout(650), react.waitForTimeout(650)])
  expect(await destinationShapeText.innerHTML()).toBe(await sourceShapeText.innerHTML())
  expect(await destinationShapeText.innerHTML()).toContain('γ')
  expect(await currentElement(react, 'react', 'gate3-gradient-shape')).toEqual(await currentElement(vue, 'vue', 'gate3-gradient-shape'))
  await expectDocumentParity(vue, react)

  const sourceRadial = vue.locator('#editable-element-gate3-radial-shape .editable-element-shape')
  const destinationRadial = react.getByRole('button', { name: 'Select shape gate3-radial-shape' })
  await Promise.all([sourceRadial.click(), destinationRadial.click()])
  const beforeFallbackCount = (await slideElements(vue, 'vue')).length
  await Promise.all([
    sourcePanel.locator('.symbol-item').nth(3).click(),
    destinationPanel.locator('.mona-symbol-item').nth(3).click(),
  ])
  await Promise.all([vue.waitForTimeout(650), react.waitForTimeout(650)])
  await expectDocumentParity(vue, react)
  const [sourceAfterFallback, destinationAfterFallback] = await Promise.all([slideElements(vue, 'vue'), slideElements(react, 'react')])
  expect(sourceAfterFallback).toHaveLength(beforeFallbackCount + 1)
  expect(normalizeIds(destinationAfterFallback.at(-1)!)).toEqual(normalizeIds(sourceAfterFallback.at(-1)!))
  expect(destinationAfterFallback.at(-1)).toMatchObject({ content: 'δ', height: 44, left: 0, top: 0, type: 'text', width: 200 })

  await selectSlide(vue, react, 2)
  const sourceTable = vue.locator('#editable-element-gate3-table .editable-element-table')
  const destinationTable = react.locator('.mona-editor-slide-canvas [data-element-id="gate3-table"]')
  await Promise.all([
    sourceTable.locator('.table-mask').dblclick({ position: { x: 20, y: 20 } }),
    destinationTable.locator('.mona-table-mask').dblclick({ position: { x: 20, y: 20 } }),
  ])
  const sourceCell = sourceTable.locator('[data-cell-index="1_0"]')
  const destinationCell = destinationTable.locator('[data-cell-index="1_0"]')
  await Promise.all([sourceCell.click({ position: { x: 15, y: 15 } }), destinationCell.click({ position: { x: 15, y: 15 } })])
  const sourceCellText = sourceCell.locator('.cell-text')
  const destinationCellText = destinationCell.locator('.mona-table-cell-text.is-active')
  await Promise.all([placeCaretAtEnd(sourceCellText), placeCaretAtEnd(destinationCellText)])
  await Promise.all([
    sourcePanel.locator('.symbol-item').nth(4).click(),
    destinationPanel.locator('.mona-symbol-item').nth(4).click(),
  ])
  await Promise.all([vue.waitForTimeout(650), react.waitForTimeout(650)])
  expect(await destinationCellText.innerHTML()).toBe(await sourceCellText.innerHTML())
  expect(await destinationCellText.innerHTML()).toContain('ϵ')
  expect(await currentElement(react, 'react', 'gate3-table')).toEqual(await currentElement(vue, 'vue', 'gate3-table'))
  await expectDocumentParity(vue, react)
  await Promise.all([expect(sourcePanel).toBeVisible(), expect(destinationPanel).toBeVisible()])
  await Promise.all([sourceContext.close(), destinationContext.close()])
})
