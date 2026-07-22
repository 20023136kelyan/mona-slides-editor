import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

import type { PPTElement } from '@mona/presentation-core/model'

interface VueState {
  editor: {
    activeElementIdList: string[]
    activeGroupElementId: string
    handleElementId: string
    richTextAttrs: Record<string, unknown>
  }
  history: { snapshotCursor: number; snapshotLength: number }
  presentation: { slideIndex: number; slides: Array<{ elements: PPTElement[] }> }
}

interface ReactState {
  presentation: { slideIndex: number; slides: Array<{ elements: PPTElement[] }> }
  session: {
    activeElementIds: string[]
    activeGroupElementId: string | null
    handleElementId: string | null
  }
}

declare global {
  interface Window {
    __MONA_TEST__?: { getState: () => VueState; isReady: () => boolean }
    __MONA_REACT_TEST__?: {
      getHistoryState: () => { cursor: number; length: number }
      getRichTextState: () => { attrs: Record<string, unknown> }
      getState: () => ReactState
      isReady: () => boolean
    }
  }
}

const fixturePath = '/?rendererFixture=gate5-multi'

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
    vue.waitForFunction(() => window.__MONA_TEST__?.isReady() && window.__MONA_TEST__.getState().presentation.slides.length === 6),
    react.waitForFunction(() => window.__MONA_REACT_TEST__?.isReady() && window.__MONA_REACT_TEST__.getState().presentation.slides.length === 6),
  ])
  return { destinationContext, react, sourceContext, vue }
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

async function settle(vue: Page, react: Page, milliseconds = 700) {
  await Promise.all([vue.waitForTimeout(milliseconds), react.waitForTimeout(milliseconds)])
}

async function selectSlide(vue: Page, react: Page, index: number) {
  await Promise.all([
    vue.locator('.thumbnail-slide').nth(index).click(),
    react.getByRole('button', { name: `Show slide ${index + 1}` }).click(),
  ])
  await expect.poll(async () => Promise.all([
    sourceState(vue).then(state => state.presentation.slideIndex),
    destinationState(react).then(state => state.presentation.slideIndex),
  ])).toEqual([index, index])
}

async function selectAll(vue: Page, react: Page, expected: number) {
  await Promise.all([
    vue.locator('.canvas').click({ position: { x: 12, y: 12 } }),
    react.getByRole('application', { name: 'Editable slide canvas' }).click({ position: { x: 12, y: 12 } }),
  ])
  await Promise.all([vue.keyboard.press('Control+a'), react.keyboard.press('Control+a')])
  await expect.poll(async () => Promise.all([
    sourceState(vue).then(state => state.editor.activeElementIdList.length),
    destinationState(react).then(state => state.session.activeElementIds.length),
  ])).toEqual([expected, expected])
}

async function openMultiPosition(vue: Page, react: Page) {
  await Promise.all([
    vue.locator('.toolbar > .tabs .tab').filter({ hasText: /^Position \(multiple selection\)$/ }).click(),
    react.getByRole('tab', { name: 'Position (multiple selection)', exact: true }).click(),
  ])
  const source = vue.locator('.multi-position-panel')
  const destination = react.locator('.mona-multi-position-panel')
  await Promise.all([expect(source).toBeVisible(), expect(destination).toBeVisible()])
  return { destination, source }
}

function normalizeGroups(elements: readonly PPTElement[]) {
  const groups = new Map<string, string>()
  return structuredClone(elements).map(element => {
    if (!element.groupId) return element
    if (!groups.has(element.groupId)) groups.set(element.groupId, `group-${groups.size + 1}`)
    element.groupId = groups.get(element.groupId)
    return element
  })
}

async function currentElements(page: Page, app: 'react' | 'vue') {
  const state = app === 'vue' ? await sourceState(page) : await destinationState(page)
  return structuredClone(state.presentation.slides[state.presentation.slideIndex]!.elements)
}

async function expectDocumentParity(vue: Page, react: Page, compareHistory = true) {
  await expect.poll(async () => normalizeGroups(await currentElements(react, 'react')))
    .toEqual(normalizeGroups(await currentElements(vue, 'vue')))
  if (compareHistory) await expect.poll(async () => history(react, 'react')).toEqual(await history(vue, 'vue'))
}

async function expectSelectionParity(vue: Page, react: Page) {
  const [source, destination] = await Promise.all([sourceState(vue), destinationState(react)])
  expect({
    activeElementIds: destination.session.activeElementIds,
    activeGroupElementId: destination.session.activeGroupElementId || '',
    handleElementId: destination.session.handleElementId || '',
  }).toEqual({
    activeElementIds: source.editor.activeElementIdList,
    activeGroupElementId: source.editor.activeGroupElementId,
    handleElementId: source.editor.handleElementId,
  })
}

const roundedRect = (rect: { height: number; width: number; x: number; y: number } | null) => rect && ({
  height: Math.round(rect.height * 100) / 100,
  width: Math.round(rect.width * 100) / 100,
  x: Math.round(rect.x * 100) / 100,
  y: Math.round(rect.y * 100) / 100,
})

async function compareRaster(source: Locator, destination: Locator, maxVisiblePixelDelta = 0, maxRawChannelDelta = 0) {
  const [sourceBuffer, destinationBuffer] = await Promise.all([source.screenshot(), destination.screenshot()])
  const expected = PNG.sync.read(sourceBuffer)
  const actual = PNG.sync.read(destinationBuffer)
  expect({ height: actual.height, width: actual.width }).toEqual({ height: expected.height, width: expected.width })
  const visiblePixelDelta = pixelmatch(expected.data, actual.data, null, expected.width, expected.height, { threshold: 0 })
  let rawChannelDelta = 0
  for (let index = 0; index < expected.data.length; index += 1) rawChannelDelta = Math.max(rawChannelDelta, Math.abs(expected.data[index]! - actual.data[index]!))
  expect(visiblePixelDelta).toBeLessThanOrEqual(maxVisiblePixelDelta)
  expect(rawChannelDelta).toBeLessThanOrEqual(maxRawChannelDelta)
}

async function resetEditors(vue: Page, react: Page) {
  await Promise.all([vue.reload(), react.reload()])
  await Promise.all([
    vue.waitForFunction(() => window.__MONA_TEST__?.isReady() && window.__MONA_TEST__.getState().presentation.slides.length === 6),
    react.waitForFunction(() => window.__MONA_REACT_TEST__?.isReady() && window.__MONA_REACT_TEST__.getState().presentation.slides.length === 6),
  ])
}

test('multi-position panel matches the complete source surface and both conditional states', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await selectSlide(vue, react, 4)
  await selectAll(vue, react, 5)
  let panels = await openMultiPosition(vue, react)
  expect(roundedRect(await panels.destination.boundingBox())).toEqual(roundedRect(await panels.source.boundingBox()))
  expect(await panels.destination.innerText()).toBe(await panels.source.innerText())
  expect(await panels.destination.locator('button').count()).toBe(await panels.source.locator('button').count())
  expect(await panels.destination.locator('button').count()).toBe(10)
  expect(await panels.destination.locator('button').evaluateAll(buttons => buttons.map(button => ({
    disabled: (button as HTMLButtonElement).disabled,
    title: button.getAttribute('title'),
  })))).toEqual([
    { disabled: false, title: 'Align left' },
    { disabled: false, title: 'Center horizontally' },
    { disabled: false, title: 'Align right' },
    { disabled: false, title: 'Align top' },
    { disabled: false, title: 'Center vertically' },
    { disabled: false, title: 'Align bottom' },
    { disabled: false, title: 'Distribute horizontally' },
    { disabled: false, title: 'Distribute vertically' },
    { disabled: false, title: 'Group' },
    { disabled: true, title: 'Ungroup' },
  ])
  // The DOM geometry, text, state, and ten-button inventory are exact above;
  // Chromium rounds two anti-aliased SVG edge pixels by two channel values.
  await compareRaster(panels.source, panels.destination, 2, 2)

  await resetEditors(vue, react)
  await selectSlide(vue, react, 4)
  await Promise.all([
    vue.locator('#editable-element-gate5-geometry-group-shape .editable-element-shape').click(),
    react.getByRole('button', { name: 'Select shape gate5-geometry-group-shape' }).click(),
  ])
  panels = await openMultiPosition(vue, react)
  expect(await panels.destination.innerText()).toBe(await panels.source.innerText())
  expect(await panels.destination.locator('button').count()).toBe(8)
  expect(await panels.destination.locator('button').nth(6).isDisabled()).toBe(true)
  expect(await panels.destination.locator('button').nth(7).isEnabled()).toBe(true)
  expect(roundedRect(await panels.destination.boundingBox())).toEqual(roundedRect(await panels.source.boundingBox()))
  await compareRaster(panels.source, panels.destination)
  await expectSelectionParity(vue, react)

  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('all six mutual alignments and both distributions match rotated, line, and grouped source geometry', async ({ browser }) => {
  test.setTimeout(240_000)
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  for (const buttonIndex of [0, 1, 2, 3, 4, 5, 6, 7]) {
    if (buttonIndex) await resetEditors(vue, react)
    await selectSlide(vue, react, 4)
    await selectAll(vue, react, 5)
    const { destination, source } = await openMultiPosition(vue, react)
    await expectDocumentParity(vue, react)
    await Promise.all([source.locator('button').nth(buttonIndex).click(), destination.locator('button').nth(buttonIndex).click()])
    await settle(vue, react)
    await expectDocumentParity(vue, react)
    await expectSelectionParity(vue, react)

    await Promise.all([vue.keyboard.press('Control+z'), react.keyboard.press('Control+z')])
    await expectDocumentParity(vue, react)
    await Promise.all([vue.keyboard.press('Control+y'), react.keyboard.press('Control+y')])
    await expectDocumentParity(vue, react)
  }
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('multi-position grouping, exact-group canvas alignment, and ungroup selection reset match source', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await selectSlide(vue, react, 4)
  await selectAll(vue, react, 5)
  let panels = await openMultiPosition(vue, react)
  await Promise.all([panels.source.locator('button').nth(8).click(), panels.destination.locator('button').nth(8).click()])
  await settle(vue, react)
  await expectDocumentParity(vue, react)
  await expectSelectionParity(vue, react)
  expect(await panels.destination.locator('button').count()).toBe(8)
  expect(await panels.destination.locator('button').nth(6).isDisabled()).toBe(true)
  expect(await panels.destination.locator('button').nth(7).isEnabled()).toBe(true)

  await Promise.all([panels.source.locator('button').nth(0).click(), panels.destination.locator('button').nth(0).click()])
  await settle(vue, react)
  await expectDocumentParity(vue, react)

  await Promise.all([panels.source.locator('button').nth(7).click(), panels.destination.locator('button').nth(7).click()])
  await settle(vue, react)
  await expectDocumentParity(vue, react)
  await expectSelectionParity(vue, react)

  await resetEditors(vue, react)
  await selectSlide(vue, react, 4)
  await Promise.all([
    vue.locator('#editable-element-gate5-geometry-group-shape .editable-element-shape').click(),
    react.getByRole('button', { name: 'Select shape gate5-geometry-group-shape' }).click(),
  ])
  panels = await openMultiPosition(vue, react)
  await Promise.all([panels.source.locator('button').nth(7).click(), panels.destination.locator('button').nth(7).click()])
  await settle(vue, react)
  await expectDocumentParity(vue, react)
  await expectSelectionParity(vue, react)
  expect((await destinationState(react)).session.activeElementIds).toEqual(['gate5-geometry-group-shape'])

  await Promise.all([sourceContext.close(), destinationContext.close()])
})

async function chooseColor(vue: Page, react: Page, sourceTrigger: Locator, destinationTrigger: Locator, sourceIndex: number, destinationColor: string) {
  await Promise.all([sourceTrigger.click(), destinationTrigger.click()])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .picker-presets').first().locator('.picker-presets-color').nth(sourceIndex).click(),
    react.getByRole('button', { name: `Select color ${destinationColor}` }).click(),
  ])
  await Promise.all([sourceTrigger.click(), destinationTrigger.click()])
}

test('multi-style panel and every compatible fill, outline, font, table, equation, and audio branch match source', async ({ browser }) => {
  test.setTimeout(120_000)
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await selectSlide(vue, react, 5)
  await selectAll(vue, react, 8)
  const source = vue.locator('.multi-style-panel')
  const destination = react.locator('.mona-multi-style-panel')
  await Promise.all([expect(source).toBeVisible(), expect(destination).toBeVisible()])
  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))
  expect(await destination.innerText()).toBe(await source.innerText())
  expect(await destination.locator('.mona-panel-select').count()).toBe(3)
  expect(await source.locator('.select-custom .select, .select-wrap .select').count()).toBe(3)
  expect(await destination.locator('.mona-panel-button').count()).toBe(await source.locator('button.button').count())
  // Every label, control, selector, and bounding box is asserted above; one
  // anti-aliased line-preview pixel differs by two channel values.
  await compareRaster(source, destination, 1, 2)

  await chooseColor(vue, react, source.locator('.color-btn').nth(0), destination.getByRole('button', { name: 'Fill color:' }), 5, '#e2534d')
  await settle(vue, react)
  await expectDocumentParity(vue, react)

  await Promise.all([
    source.locator('.select-wrap .select').nth(0).click(),
    destination.getByRole('button', { name: 'Border style:' }).click(),
  ])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .option').nth(2).click(),
    react.locator('.mona-panel-select-popover:visible').getByRole('button', { name: 'Dotted' }).click(),
  ])
  await settle(vue, react)
  await expectDocumentParity(vue, react)

  await chooseColor(vue, react, source.locator('.color-btn').nth(1), destination.getByRole('button', { name: 'Border color:' }), 3, '#1e497b')
  await settle(vue, react)
  await expectDocumentParity(vue, react)

  await Promise.all([
    source.locator('.number-input .handler').nth(0).click(),
    destination.getByRole('textbox', { name: 'Border width:' }).locator('..').locator('.mona-panel-number-handlers button').nth(0).click(),
  ])
  await settle(vue, react)
  await expectDocumentParity(vue, react)

  await Promise.all([
    source.locator('.select-wrap .select').nth(1).click(),
    destination.locator('.mona-panel-select').nth(1).click(),
  ])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .option').filter({ hasText: /^Inter$/ }).click(),
    react.locator('.mona-panel-select-popover:visible').getByRole('button', { name: 'Inter', exact: true }).click(),
  ])
  await settle(vue, react)
  await expectDocumentParity(vue, react, false)

  await Promise.all([
    source.locator('.select-wrap .select').nth(2).click(),
    destination.locator('.mona-panel-select').nth(2).click(),
  ])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .option').filter({ hasText: /^28px$/ }).click(),
    react.locator('.mona-panel-select-popover:visible').getByRole('button', { name: '28px', exact: true }).click(),
  ])
  await settle(vue, react)
  await expectDocumentParity(vue, react, false)

  await chooseColor(vue, react, source.locator('.text-color-btn').nth(0), destination.getByRole('button', { name: 'Text color' }), 8, '#47acc5')
  await settle(vue, react)
  await expectDocumentParity(vue, react, false)

  await chooseColor(vue, react, source.locator('.text-color-btn').nth(1), destination.getByRole('button', { name: 'Text highlight' }), 7, '#8165a0')
  await settle(vue, react)
  await expectDocumentParity(vue, react, false)

  const sourceButtons = source.locator('button.button')
  const destinationButtons = destination.locator('.mona-panel-button')
  for (const index of [4, 5, 6, 7, 8, 9]) {
    await Promise.all([sourceButtons.nth(index).click(), destinationButtons.nth(index).click()])
    await settle(vue, react)
    await expectDocumentParity(vue, react, false)
  }
  expect(await react.evaluate(() => window.__MONA_REACT_TEST__!.getRichTextState().attrs))
    .toEqual(await vue.evaluate(() => window.__MONA_TEST__!.getState().editor.richTextAttrs))

  await Promise.all([sourceContext.close(), destinationContext.close()])
})
