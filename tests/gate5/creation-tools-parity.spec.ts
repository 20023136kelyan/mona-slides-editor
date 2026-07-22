import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { isDeepStrictEqual } from 'node:util'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import type { PPTElement } from '@mona/presentation-core/model'

interface PresentationBridgeState {
  presentation: {
    slideIndex: number
    slides: Array<{ elements: PPTElement[] }>
  }
}

declare global {
  interface Window {
    __MONA_TEST__?: {
      getState: () => PresentationBridgeState & {
        editor: { activeElementIdList: string[] }
        history: { snapshotCursor: number; snapshotLength: number }
      }
      isReady: () => boolean
    }
    __MONA_REACT_TEST__?: {
      getHistoryState: () => { cursor: number; length: number }
      getState: () => PresentationBridgeState & { session: { activeElementIds: string[]; creatingCustomShape: boolean } }
      isReady: () => boolean
    }
  }
}

const fixturePath = '/?rendererFixture=gate4-editor'

async function openEditors(context: BrowserContext) {
  await context.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US'))
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

async function openEditorsInSeparateContexts(browser: Browser) {
  const sourceContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const destinationContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await Promise.all([
    sourceContext.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US')),
    destinationContext.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US')),
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

async function openShapeMenu(vue: Page, react: Page) {
  // Open the React/Radix popover last: focusing the other Page can otherwise
  // produce a native window-blur dismissal that PPTist's Tippy popover lacks.
  await vue.locator('.canvas-tool .insert-handler-item.group-btn').nth(1).locator('.arrow').click()
  await react.getByLabel('Shape options').click()
}

async function openPathEditor(vue: Page, react: Page) {
  await openShapeMenu(vue, react)
  await vue.locator('.tippy-box:visible .popover-menu-item').filter({ hasText: /^Draw path$/ }).click()
  await react.locator('.mona-canvas-tool-menu-item').filter({ hasText: /^Draw path$/ }).click()
  await Promise.all([
    expect(vue.locator('.modal:visible .svg-path-editor')).toBeVisible(),
    expect(react.getByRole('dialog', { name: 'SVG path editor' })).toBeVisible(),
    vue.waitForTimeout(350),
    react.waitForTimeout(350),
  ])
}

async function activateCustomShape(vue: Page, react: Page) {
  await openShapeMenu(vue, react)
  await vue.locator('.tippy-box:visible .popover-menu-item').filter({ hasText: /^Freehand shape$/ }).click()
  await react.locator('.mona-canvas-tool-menu-item').filter({ hasText: /^Freehand shape$/ }).click()
  await Promise.all([
    expect(vue.locator('.shape-create-canvas')).toBeVisible(),
    expect(react.locator('.mona-shape-create-canvas')).toBeVisible(),
    vue.waitForTimeout(350),
    react.waitForTimeout(350),
  ])
}

const roundedRect = (rect: { height: number; width: number; x: number; y: number } | null) => rect && ({
  height: Math.round(rect.height * 100) / 100,
  width: Math.round(rect.width * 100) / 100,
  x: Math.round(rect.x * 100) / 100,
  y: Math.round(rect.y * 100) / 100,
})

async function compareRaster(source: Locator, destination: Locator, options: { exact?: boolean; maxRawChannelDelta?: number; maxVisiblePixelDelta?: number } = {}) {
  const [sourceBuffer, destinationBuffer] = await Promise.all([source.screenshot(), destination.screenshot()])
  const expected = PNG.sync.read(sourceBuffer)
  const actual = PNG.sync.read(destinationBuffer)
  expect({ height: actual.height, width: actual.width }).toEqual({ height: expected.height, width: expected.width })
  const diff = new PNG({ height: expected.height, width: expected.width })
  const visiblePixelDelta = pixelmatch(expected.data, actual.data, diff.data, expected.width, expected.height, { threshold: 0 })
  let rawChannelDelta = 0
  let changedChannels = 0
  for (let index = 0; index < expected.data.length; index += 1) {
    const delta = Math.abs(expected.data[index]! - actual.data[index]!)
    if (delta) changedChannels += 1
    rawChannelDelta = Math.max(rawChannelDelta, delta)
  }
  expect(visiblePixelDelta).toBeLessThanOrEqual(options.maxVisiblePixelDelta ?? 0)
  if (options.exact) expect(changedChannels).toBe(0)
  else expect(rawChannelDelta).toBeLessThanOrEqual(options.maxRawChannelDelta ?? 2)
}

async function history(page: Page, app: 'react' | 'vue') {
  if (app === 'react') return page.evaluate(() => window.__MONA_REACT_TEST__!.getHistoryState())
  return page.evaluate(() => {
    const state = window.__MONA_TEST__!.getState().history
    return { cursor: state.snapshotCursor, length: state.snapshotLength }
  })
}

async function lastElement(page: Page, app: 'react' | 'vue') {
  return page.evaluate(appName => {
    const state = appName === 'vue' ? window.__MONA_TEST__!.getState() : window.__MONA_REACT_TEST__!.getState()
    const slide = state.presentation.slides[state.presentation.slideIndex]!
    return structuredClone(slide.elements[slide.elements.length - 1]!)
  }, app)
}

const withoutGeneratedId = (element: PPTElement) => {
  const clone = structuredClone(element) as PPTElement & { id?: string }
  delete clone.id
  return clone
}

async function expectLastElementAndHistoryParity(vue: Page, react: Page) {
  await Promise.all([vue.waitForTimeout(450), react.waitForTimeout(450)])
  expect(withoutGeneratedId(await lastElement(react, 'react'))).toEqual(withoutGeneratedId(await lastElement(vue, 'vue')))
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))
}

async function clickBoth(vue: Page, react: Page, x: number, y: number) {
  await Promise.all([vue.mouse.move(x, y), react.mouse.move(x, y)])
  await Promise.all([vue.mouse.down(), react.mouse.down()])
  await Promise.all([vue.mouse.up(), react.mouse.up()])
}

async function dragBoth(vue: Page, react: Page, start: { x: number; y: number }, end: { x: number; y: number }) {
  await Promise.all([vue.mouse.move(start.x, start.y), react.mouse.move(start.x, start.y)])
  await Promise.all([vue.mouse.down(), react.mouse.down()])
  await Promise.all([vue.mouse.move(end.x, end.y), react.mouse.move(end.x, end.y)])
  await Promise.all([vue.mouse.up(), react.mouse.up()])
}

async function dragSingle(page: Page, start: { x: number; y: number }, end: { x: number; y: number }) {
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.waitForTimeout(16)
  await page.mouse.move(end.x, end.y)
  await page.waitForTimeout(16)
  await page.mouse.up()
}

async function expectLastElementParity(vue: Page, react: Page) {
  await expect.poll(async () => isDeepStrictEqual(
    withoutGeneratedId(await lastElement(react, 'react')),
    withoutGeneratedId(await lastElement(vue, 'vue')),
  )).toBe(true)
}

test('canvas toolbar, notes strip, preset pools, and initial SVG path editor are source-identical', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const { react, vue } = await openEditors(context)

  expect(roundedRect(await react.locator('.mona-canvas-tool').boundingBox())).toEqual(roundedRect(await vue.locator('.canvas-tool').boundingBox()))
  expect(roundedRect(await react.locator('.mona-editor-remark').boundingBox())).toEqual(roundedRect(await vue.locator('.remark').boundingBox()))
  expect(await react.locator('.mona-canvas-insert-item').count()).toBe(await vue.locator('.canvas-tool .insert-handler-item').count())

  const [sourceToolbarBuffer, destinationToolbarBuffer, sourceIconBoxes, destinationIconBoxes] = await Promise.all([
    vue.locator('.canvas-tool').screenshot(),
    react.locator('.mona-canvas-tool').screenshot(),
    vue.locator('.canvas-tool svg').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect()
      return { height: rect.height, width: rect.width, x: rect.x, y: rect.y }
    })),
    react.locator('.mona-canvas-tool svg').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect()
      return { height: rect.height, width: rect.width, x: rect.x, y: rect.y }
    })),
  ])
  expect(destinationIconBoxes.map(roundedRect)).toEqual(sourceIconBoxes.map(roundedRect))
  const sourceToolbar = PNG.sync.read(sourceToolbarBuffer)
  const destinationToolbar = PNG.sync.read(destinationToolbarBuffer)
  const toolbarDiff = new PNG({ height: sourceToolbar.height, width: sourceToolbar.width })
  const visibleToolbarDelta = pixelmatch(sourceToolbar.data, destinationToolbar.data, toolbarDiff.data, sourceToolbar.width, sourceToolbar.height, { threshold: 0 })
  let changedToolbarPixels = 0
  let maxToolbarChannelDelta = 0
  const changedToolbarPoints: Array<{ x: number; y: number }> = []
  for (let offset = 0; offset < sourceToolbar.data.length; offset += 4) {
    let changed = false
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(sourceToolbar.data[offset + channel]! - destinationToolbar.data[offset + channel]!)
      if (delta) changed = true
      maxToolbarChannelDelta = Math.max(maxToolbarChannelDelta, delta)
    }
    if (changed) {
      changedToolbarPixels += 1
      const pixel = offset / 4
      changedToolbarPoints.push({ x: pixel % sourceToolbar.width, y: Math.floor(pixel / sourceToolbar.width) })
    }
  }
  const toolbarBox = await vue.locator('.canvas-tool').boundingBox()
  const localIconBoxes = sourceIconBoxes.map(rect => ({
    left: rect.x - toolbarBox!.x - 1,
    right: rect.x - toolbarBox!.x + rect.width + 1,
    top: rect.y - toolbarBox!.y - 1,
    bottom: rect.y - toolbarBox!.y + rect.height + 1,
  }))
  expect(changedToolbarPoints.every(point => localIconBoxes.some(rect => (
    point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
  )))).toBe(true)
  // Same computed SVG geometry; only deterministic cross-tree Chromium icon
  // antialias quantization remains, tightly bounded to 64 icon pixels.
  expect({ changedToolbarPixels, maxToolbarChannelDelta, visibleToolbarDelta }).toEqual({
    changedToolbarPixels: 64,
    maxToolbarChannelDelta: 6,
    visibleToolbarDelta: 13,
  })

  await vue.locator('.canvas-tool .insert-handler-item.group-btn').nth(1).locator('.group-btn-main').click()
  await react.locator('.mona-canvas-insert-item.is-group').nth(1).locator('.mona-canvas-group-main').click()
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  expect(await react.locator('.mona-canvas-shape-item').count()).toBe(await vue.locator('.tippy-box:visible .shape-pool .shape-item').count())
  expect(roundedRect(await react.locator('.mona-canvas-shape-pool').boundingBox())).toEqual(roundedRect(await vue.locator('.tippy-box:visible .shape-pool').boundingBox()))
  await compareRaster(vue.locator('.tippy-box:visible .shape-pool'), react.locator('.mona-canvas-shape-pool'), { exact: true })
  await Promise.all([vue.keyboard.press('Escape'), react.keyboard.press('Escape')])

  await vue.locator('.canvas-tool .add-element-handler > .popover').nth(0).click()
  await react.locator('.mona-canvas-insert-item').filter({ hasText: /^Line$/ }).click()
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  expect(await react.locator('.mona-canvas-line-item').count()).toBe(await vue.locator('.tippy-box:visible .line-pool .line-item').count())
  expect(roundedRect(await react.locator('.mona-canvas-line-pool').boundingBox())).toEqual(roundedRect(await vue.locator('.tippy-box:visible .line-pool').boundingBox()))
  await compareRaster(vue.locator('.tippy-box:visible .line-pool'), react.locator('.mona-canvas-line-pool'), { exact: true })
  await Promise.all([vue.keyboard.press('Escape'), react.keyboard.press('Escape')])

  await openPathEditor(vue, react)
  expect(roundedRect(await react.locator('.mona-svg-path-modal-content').boundingBox())).toEqual(roundedRect(await vue.locator('.modal:visible .modal-content').boundingBox()))
  expect(roundedRect(await react.locator('.mona-svg-path-canvas').boundingBox())).toEqual(roundedRect(await vue.locator('.modal:visible .svg-canvas').boundingBox()))
  expect(roundedRect(await react.locator('.mona-svg-path-panel').boundingBox())).toEqual(roundedRect(await vue.locator('.modal:visible .svg-panel').boundingBox()))
  expect(roundedRect(await react.locator('.mona-svg-path-footer').boundingBox())).toEqual(roundedRect(await vue.locator('.modal:visible .footer').boundingBox()))
  await compareRaster(vue.locator('.modal:visible .modal-content'), react.locator('.mona-svg-path-modal-content'))

  await context.close()
})

test('toolbar undo, redo, zoom presets, zoom stepping, and fit-to-screen match source transactions', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const { react, vue } = await openEditors(context)
  const sourceUndo = vue.locator('.canvas-tool .left-handler > .handler-item').nth(0)
  const sourceRedo = vue.locator('.canvas-tool .left-handler > .handler-item').nth(1)
  const destinationUndo = react.getByLabel('Undo (Ctrl + Z)')
  const destinationRedo = react.getByLabel('Redo (Ctrl + Y)')
  expect(await sourceUndo.getAttribute('class')).toContain('disable')
  expect(await sourceRedo.getAttribute('class')).toContain('disable')
  await expect(destinationUndo).toHaveAttribute('aria-disabled', 'true')
  await expect(destinationRedo).toHaveAttribute('aria-disabled', 'true')

  await vue.locator('.canvas-tool .insert-handler-item.group-btn').nth(1).locator('.group-btn-main').click()
  await vue.locator('.tippy-box:visible .shape-pool .shape-item').nth(0).click()
  await react.locator('.mona-canvas-insert-item.is-group').nth(1).locator('.mona-canvas-group-main').click()
  await react.locator('.mona-canvas-shape-pool .mona-canvas-shape-item').nth(0).click()
  await dragSingle(vue, { x: 850, y: 300 }, { x: 970, y: 390 })
  await dragSingle(react, { x: 850, y: 300 }, { x: 970, y: 390 })
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  await expectLastElementParity(vue, react)
  await expect(destinationUndo).toHaveAttribute('aria-disabled', 'false')

  await Promise.all([sourceUndo.click(), destinationUndo.click()])
  const [sourceAfterUndo, destinationAfterUndo] = await Promise.all([
    vue.evaluate(() => structuredClone(window.__MONA_TEST__!.getState().presentation.slides[0])),
    react.evaluate(() => structuredClone(window.__MONA_REACT_TEST__!.getState().presentation.slides[0])),
  ])
  expect(destinationAfterUndo).toEqual(sourceAfterUndo)
  await expect(destinationRedo).toHaveAttribute('aria-disabled', 'false')

  await Promise.all([sourceRedo.click(), destinationRedo.click()])
  await expectLastElementParity(vue, react)
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))

  const sourceZoomText = vue.locator('.canvas-tool .right-handler .text')
  const destinationZoomText = react.locator('.mona-canvas-zoom-text')
  expect(await destinationZoomText.textContent()).toBe(await sourceZoomText.textContent())
  await Promise.all([
    vue.locator('.canvas-tool .right-handler .handler-item.viewport-size').nth(1).click(),
    react.getByLabel('Zoom in (Ctrl + =)').click(),
  ])
  expect(await destinationZoomText.textContent()).toBe(await sourceZoomText.textContent())
  await Promise.all([
    vue.locator('.canvas-tool .right-handler .handler-item.viewport-size').nth(0).click(),
    react.getByLabel('Zoom out (Ctrl + -)').click(),
  ])
  expect(await destinationZoomText.textContent()).toBe(await sourceZoomText.textContent())

  await vue.locator('.canvas-tool .right-handler .popover').click()
  await react.locator('.mona-canvas-zoom-text').click()
  expect(await react.locator('.mona-canvas-tool-menu.is-zoom-menu .mona-canvas-tool-menu-item').count()).toBe(
    await vue.locator('.tippy-box:visible .popover-menu-item').count(),
  )
  await vue.locator('.tippy-box:visible .popover-menu-item').filter({ hasText: /^125%$/ }).click()
  await react.locator('.mona-canvas-tool-menu.is-zoom-menu .mona-canvas-tool-menu-item').filter({ hasText: /^125%$/ }).click()
  expect(await destinationZoomText.textContent()).toBe('125%')
  expect(await destinationZoomText.textContent()).toBe(await sourceZoomText.textContent())
  expect(await react.locator('.mona-editor-slide-canvas').evaluate(element => (element as HTMLElement).style.transform)).toBe(
    await vue.locator('.viewport').evaluate(element => (element as HTMLElement).style.transform),
  )

  await Promise.all([
    vue.locator('.canvas-tool .right-handler .handler-item.viewport-size-adaptation').click(),
    react.getByLabel('Fit to screen').click(),
  ])
  expect(await destinationZoomText.textContent()).toBe(await sourceZoomText.textContent())
  expect(await react.locator('.mona-editor-slide-canvas').evaluate(element => (element as HTMLElement).style.transform)).toBe(
    await vue.locator('.viewport').evaluate(element => (element as HTMLElement).style.transform),
  )
  await context.close()
})

test('SVG path editor segment editing, controls, context menu, dragging, and closed insertion are transaction-identical', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const { react, vue } = await openEditors(context)
  await openPathEditor(vue, react)

  const sourceSvg = vue.locator('.modal:visible .svg-grid')
  const destinationSvg = react.locator('.mona-svg-path-grid')
  await Promise.all([
    sourceSvg.click({ button: 'right', position: { x: 250, y: 250 } }),
    destinationSvg.click({ button: 'right', position: { x: 250, y: 250 } }),
  ])
  await Promise.all([
    expect(vue.locator('.contextmenu')).toBeVisible(),
    expect(react.locator('.mona-editor-context-menu')).toBeVisible(),
  ])
  expect(await react.locator('.mona-context-menu-entry:not(.is-divider)').count()).toBe(await vue.locator('.contextmenu .menu-item:not(.divider)').count())
  expect(roundedRect(await react.locator('.mona-editor-context-menu').boundingBox())).toEqual(roundedRect(await vue.locator('.contextmenu').boundingBox()))
  // Chromium quantizes only the four 2px rounded shadow corners one to four
  // 8-bit values apart across the separately mounted Vue and React trees.
  // Geometry, computed CSS, all menu content, and every non-corner pixel match.
  await compareRaster(vue.locator('.contextmenu'), react.locator('.mona-editor-context-menu'), { maxRawChannelDelta: 4, maxVisiblePixelDelta: 4 })

  await Promise.all([
    vue.locator('.contextmenu .menu-item').filter({ hasText: /^Append quadratic curve$/ }).click(),
    react.locator('.mona-editor-context-menu [data-action="Q"]').click(),
  ])
  expect(await react.locator('.mona-svg-path-content').textContent()).toBe(await vue.locator('.modal:visible .path-content').textContent())
  expect(await react.locator('.mona-svg-anchor-point').count()).toBe(await vue.locator('.modal:visible .anchor-point').count())

  await Promise.all([
    vue.locator('.modal:visible .segment-type .button').nth(2).click(),
    react.locator('.mona-svg-segment-type button').nth(2).click(),
  ])
  expect(await react.locator('.mona-svg-anchor-point').count()).toBe(2)
  expect(await react.locator('.mona-svg-path-content').textContent()).toBe(await vue.locator('.modal:visible .path-content').textContent())

  await Promise.all([
    vue.locator('.modal:visible .segment-type .button').nth(3).click(),
    react.locator('.mona-svg-segment-type button').nth(3).click(),
  ])
  expect(await react.locator('.mona-svg-path-panel .mona-panel-number').count()).toBe(await vue.locator('.modal:visible .number-input').count())
  await Promise.all([
    vue.locator('.modal:visible .checkbox').filter({ hasText: /^Large arc$/ }).click(),
    react.locator('.mona-path-checkbox').filter({ hasText: /^Large arc$/ }).click(),
  ])

  const sourceInputs = vue.locator('.modal:visible .number-input input')
  const destinationInputs = react.locator('.mona-svg-path-panel .mona-panel-number input')
  await Promise.all([sourceInputs.nth(0).fill('140'), destinationInputs.nth(0).fill('140')])
  await Promise.all([sourceInputs.nth(0).press('Enter'), destinationInputs.nth(0).press('Enter')])
  await Promise.all([sourceInputs.nth(1).fill('180'), destinationInputs.nth(1).fill('180')])
  await Promise.all([sourceInputs.nth(1).press('Enter'), destinationInputs.nth(1).press('Enter')])
  expect(await react.locator('.mona-svg-path-content').textContent()).toBe(await vue.locator('.modal:visible .path-content').textContent())

  const sourcePoint = vue.locator('.modal:visible .path-point.active')
  const destinationPoint = react.locator('.mona-svg-path-point.is-active')
  const [sourcePointBox, destinationPointBox] = await Promise.all([sourcePoint.boundingBox(), destinationPoint.boundingBox()])
  expect(roundedRect(destinationPointBox)).toEqual(roundedRect(sourcePointBox))
  await Promise.all([
    vue.mouse.move(sourcePointBox!.x + sourcePointBox!.width / 2, sourcePointBox!.y + sourcePointBox!.height / 2),
    react.mouse.move(destinationPointBox!.x + destinationPointBox!.width / 2, destinationPointBox!.y + destinationPointBox!.height / 2),
  ])
  await Promise.all([vue.mouse.down(), react.mouse.down()])
  await Promise.all([
    vue.mouse.move(sourcePointBox!.x + sourcePointBox!.width / 2 + 40, sourcePointBox!.y + sourcePointBox!.height / 2 + 20),
    react.mouse.move(destinationPointBox!.x + destinationPointBox!.width / 2 + 40, destinationPointBox!.y + destinationPointBox!.height / 2 + 20),
  ])
  await Promise.all([vue.mouse.up(), react.mouse.up()])
  expect(await react.locator('.mona-svg-path-content').textContent()).toBe(await vue.locator('.modal:visible .path-content').textContent())

  await Promise.all([
    vue.locator('.modal:visible .checkbox').filter({ hasText: /^Close path$/ }).click(),
    react.locator('.mona-path-checkbox').filter({ hasText: /^Close path$/ }).click(),
  ])
  expect((await react.locator('.mona-svg-path-content').textContent())?.endsWith('Z')).toBe(true)
  expect(await react.locator('.mona-svg-path-content').textContent()).toBe(await vue.locator('.modal:visible .path-content').textContent())

  await Promise.all([
    vue.locator('.modal:visible .footer-actions .button').nth(1).click(),
    react.locator('.mona-path-button.is-primary').click(),
  ])
  await expectLastElementAndHistoryParity(vue, react)
  const inserted = withoutGeneratedId(await lastElement(react, 'react'))
  expect(inserted).toMatchObject({ fill: '#5b9bd5', height: 400, left: 300, top: 81.25, type: 'shape', width: 400 })
  expect(inserted).not.toHaveProperty('outline')

  await context.close()
})

test('SVG path editor double-click insertion preserves the exact open-path element contract', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const { react, vue } = await openEditors(context)
  await openPathEditor(vue, react)
  await Promise.all([
    vue.locator('.modal:visible .svg-grid').dblclick({ position: { x: 220, y: 180 } }),
    react.locator('.mona-svg-path-grid').dblclick({ position: { x: 220, y: 180 } }),
  ])
  expect(await react.locator('.mona-svg-path-content').textContent()).toBe(await vue.locator('.modal:visible .path-content').textContent())
  await Promise.all([
    vue.locator('.modal:visible .footer-actions .button').nth(1).click(),
    react.locator('.mona-path-button.is-primary').click(),
  ])
  await expectLastElementAndHistoryParity(vue, react)
  expect(withoutGeneratedId(await lastElement(react, 'react'))).toMatchObject({
    fill: 'rgba(0, 0, 0, 0)',
    outline: { color: '#5b9bd5', style: 'solid', width: 2 },
  })
  await context.close()
})

test('freehand custom-shape notice, closed polygon, open freehand path, modifiers, and cancellation are source-identical', async ({ browser }) => {
  test.slow()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const { react, vue } = await openEditors(context)
  await activateCustomShape(vue, react)

  expect(roundedRect(await react.locator('.mona-shape-create-canvas').boundingBox())).toEqual(roundedRect(await vue.locator('.shape-create-canvas').boundingBox()))
  expect(roundedRect(await react.locator('.mona-message-container').boundingBox())).toEqual(roundedRect(await vue.locator('.message-container').boundingBox()))
  await compareRaster(vue.locator('.message-container'), react.locator('.mona-message-container'), { exact: true })

  await clickBoth(vue, react, 500, 300)
  await clickBoth(vue, react, 620, 300)
  await clickBoth(vue, react, 620, 400)
  await Promise.all([vue.mouse.move(502, 302), react.mouse.move(502, 302)])
  // The overlay itself is transparent; isolate its path raster from the
  // separately verified slide renderer beneath it.
  await Promise.all([
    vue.locator('.shape-create-canvas').evaluate(element => {
      element.style.background = '#fff' 
    }),
    react.locator('.mona-shape-create-canvas').evaluate(element => {
      element.style.background = '#fff' 
    }),
  ])
  await compareRaster(vue.locator('.shape-create-canvas'), react.locator('.mona-shape-create-canvas'), { exact: true })
  await clickBoth(vue, react, 502, 302)
  await expectLastElementAndHistoryParity(vue, react)
  expect(await react.locator('.mona-message-container').count()).toBe(0)
  expect(withoutGeneratedId(await lastElement(react, 'react'))).not.toHaveProperty('outline')

  await activateCustomShape(vue, react)
  await Promise.all([vue.mouse.move(480, 280), react.mouse.move(480, 280)])
  await Promise.all([vue.mouse.down(), react.mouse.down()])
  for (const [x, y] of [[500, 290], [525, 310], [550, 345], [590, 370]] as const) {
    await Promise.all([vue.mouse.move(x, y), react.mouse.move(x, y)])
  }
  await Promise.all([vue.mouse.up(), react.mouse.up()])
  await Promise.all([vue.keyboard.press('Enter'), react.keyboard.press('Enter')])
  await expectLastElementAndHistoryParity(vue, react)
  const openPath = withoutGeneratedId(await lastElement(react, 'react'))
  expect(openPath).toMatchObject({ fill: 'rgba(0, 0, 0, 0)', outline: { color: '#5b9bd5', style: 'solid', width: 2 } })
  expect((openPath as Extract<PPTElement, { type: 'shape' }>).path.endsWith(' ')).toBe(true)

  await activateCustomShape(vue, react)
  await clickBoth(vue, react, 460, 260)
  await Promise.all([vue.keyboard.down('Shift'), react.keyboard.down('Shift')])
  await clickBoth(vue, react, 560, 310)
  await Promise.all([vue.keyboard.up('Shift'), react.keyboard.up('Shift')])
  await Promise.all([vue.keyboard.press('Enter'), react.keyboard.press('Enter')])
  await expectLastElementAndHistoryParity(vue, react)

  const [sourceCount, destinationCount] = await Promise.all([
    vue.evaluate(() => window.__MONA_TEST__!.getState().presentation.slides[0]!.elements.length),
    react.evaluate(() => window.__MONA_REACT_TEST__!.getState().presentation.slides[0]!.elements.length),
  ])
  expect(destinationCount).toBe(sourceCount)
  await activateCustomShape(vue, react)
  await Promise.all([vue.keyboard.press('Escape'), react.keyboard.press('Escape')])
  await Promise.all([
    expect(vue.locator('.shape-create-canvas')).toHaveCount(0),
    expect(react.locator('.mona-shape-create-canvas')).toHaveCount(0),
    expect(vue.locator('.message-container')).toHaveCount(0),
    expect(react.locator('.mona-message-container')).toHaveCount(0),
  ])
  expect(await react.evaluate(() => window.__MONA_REACT_TEST__!.getState().presentation.slides[0]!.elements.length)).toBe(destinationCount)

  await activateCustomShape(vue, react)
  await Promise.all([
    vue.locator('.shape-create-canvas').click({ button: 'right', position: { x: 100, y: 100 } }),
    react.locator('.mona-shape-create-canvas').click({ button: 'right', position: { x: 100, y: 100 } }),
  ])
  await Promise.all([
    expect(vue.locator('.shape-create-canvas')).toHaveCount(0),
    expect(react.locator('.mona-shape-create-canvas')).toHaveCount(0),
  ])
  expect(await react.evaluate(() => window.__MONA_REACT_TEST__!.getState().presentation.slides[0]!.elements.length)).toBe(destinationCount)

  await context.close()
})

test('every preset shape creates the exact source element through the real toolbar and drawing surface', async ({ browser }) => {
  test.setTimeout(240_000)
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  const sourceTrigger = vue.locator('.canvas-tool .insert-handler-item.group-btn').nth(1).locator('.group-btn-main')
  const destinationTrigger = react.locator('.mona-canvas-insert-item.is-group').nth(1).locator('.mona-canvas-group-main')

  await sourceTrigger.click()
  await destinationTrigger.click()
  const sourcePool = vue.locator('.tippy-box:visible .shape-pool')
  const destinationPool = react.locator('.mona-canvas-shape-pool')
  await Promise.all([expect(sourcePool).toBeVisible(), expect(destinationPool).toBeVisible()])
  const presetCount = await sourcePool.locator('.shape-item').count()
  expect(await destinationPool.locator('.mona-canvas-shape-item').count()).toBe(presetCount)
  expect(presetCount).toBe(150)
  await Promise.all([vue.keyboard.press('Escape'), react.keyboard.press('Escape')])
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])

  for (let index = 0; index < presetCount; index += 1) {
    await sourceTrigger.click()
    await expect(vue.locator('.tippy-box:visible .shape-pool')).toBeVisible()
    await vue.locator('.tippy-box:visible .shape-pool .shape-item').nth(index).evaluate(element => (element as HTMLElement).click())
    await destinationTrigger.click()
    await expect(react.locator('.mona-canvas-shape-pool')).toBeVisible()
    await react.locator('.mona-canvas-shape-pool .mona-canvas-shape-item').nth(index).evaluate(element => (element as HTMLElement).click())
    await Promise.all([
      expect(vue.locator('.element-create-selection')).toBeVisible(),
      expect(react.locator('.mona-element-create-selection')).toBeVisible(),
    ])
    // Draw outside the closing 340px-wide pool so its source/Radix exit
    // animation cannot become the pointer target for the creation gesture.
    await dragSingle(vue, { x: 850, y: 300 }, { x: 970, y: 390 })
    await dragSingle(react, { x: 850, y: 300 }, { x: 970, y: 390 })
    await expectLastElementParity(vue, react)
    await Promise.all([vue.waitForTimeout(325), react.waitForTimeout(325)])
  }

  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('every preset line creates the exact source element through the real toolbar and drawing surface', async ({ browser }) => {
  test.setTimeout(90_000)
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  const sourceTrigger = vue.locator('.canvas-tool .add-element-handler > .popover').nth(0)
  const destinationTrigger = react.locator('.mona-canvas-tool-add-elements > .mona-canvas-insert-item:not(.is-group)').first()

  await sourceTrigger.click()
  await destinationTrigger.click()
  const sourcePool = vue.locator('.tippy-box:visible .line-pool')
  const destinationPool = react.locator('.mona-canvas-line-pool')
  await Promise.all([expect(sourcePool).toBeVisible(), expect(destinationPool).toBeVisible()])
  const presetCount = await sourcePool.locator('.line-item').count()
  expect(await destinationPool.locator('.mona-canvas-line-item').count()).toBe(presetCount)
  expect(presetCount).toBe(9)
  await Promise.all([vue.keyboard.press('Escape'), react.keyboard.press('Escape')])
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])

  for (let index = 0; index < presetCount; index += 1) {
    await sourceTrigger.click()
    await expect(vue.locator('.tippy-box:visible .line-pool')).toBeVisible()
    await vue.locator('.tippy-box:visible .line-pool .line-content').nth(index).evaluate(element => (element as HTMLElement).click())
    await destinationTrigger.click()
    await expect(react.locator('.mona-canvas-line-pool')).toBeVisible()
    await react.locator('.mona-canvas-line-pool .mona-canvas-line-item').nth(index).evaluate(element => (element as HTMLElement).click())
    await Promise.all([
      expect(vue.locator('.element-create-selection')).toBeVisible(),
      expect(react.locator('.mona-element-create-selection')).toBeVisible(),
    ])
    await dragSingle(vue, { x: 850, y: 300 }, { x: 970, y: 380 })
    await dragSingle(react, { x: 850, y: 300 }, { x: 970, y: 380 })
    await expectLastElementParity(vue, react)
    await Promise.all([vue.waitForTimeout(325), react.waitForTimeout(325)])
  }

  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('toolbar horizontal and vertical text tools create exact editable source text elements', async ({ browser }) => {
  for (const [label, vertical] of [['Horizontal text box', false], ['Vertical text box', true]] as const) {
    const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
    const sourceArrow = vue.locator('.canvas-tool .insert-handler-item.group-btn').nth(0).locator('.arrow')
    const destinationArrow = react.locator('.mona-canvas-insert-item.is-group').nth(0).locator('.mona-canvas-group-arrow')

    await sourceArrow.click()
    await vue.locator('.tippy-box:visible .popover-menu-item').filter({ hasText: label }).click()
    await expect(vue.locator('.element-create-selection')).toBeVisible()
    await dragSingle(vue, { x: 450, y: 280 }, { x: 620, y: 360 })
    await vue.waitForTimeout(100)
    const sourceElement = withoutGeneratedId(await lastElement(vue, 'vue'))
    await vue.waitForTimeout(350)
    const sourceHistory = await history(vue, 'vue')

    await destinationArrow.click()
    await react.locator('.mona-canvas-tool-menu-item').filter({ hasText: label }).click()
    await expect(react.locator('.mona-element-create-selection')).toBeVisible()
    await dragSingle(react, { x: 450, y: 280 }, { x: 620, y: 360 })
    await react.waitForTimeout(350)
    const element = withoutGeneratedId(await lastElement(react, 'react'))
    expect(element).toEqual(sourceElement)
    expect(element).toMatchObject({ type: 'text', vertical })
    expect(await history(react, 'react')).toEqual(sourceHistory)

    await Promise.all([sourceContext.close(), destinationContext.close()])
  }
})
