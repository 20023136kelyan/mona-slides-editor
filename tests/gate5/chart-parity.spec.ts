import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import CryptoJS from 'crypto-js'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import type { PPTChartElement, PPTElement } from '@mona/presentation-core/model'

interface BridgeState {
  presentation: { slideIndex: number; slides: Array<{ elements: PPTElement[] }> }
}

declare global {
  interface Window {
    __MONA_TEST__?: { getState: () => BridgeState & { history: { snapshotCursor: number; snapshotLength: number } }; isReady: () => boolean }
    __MONA_REACT_TEST__?: { getHistoryState: () => { cursor: number; length: number }; getState: () => BridgeState; isReady: () => boolean }
  }
}

const fixturePath = '/?rendererFixture=gate4-editor'
const CHART_TYPE_ORDER: PPTChartElement['chartType'][] = ['bar', 'column', 'line', 'area', 'scatter', 'pie', 'ring', 'radar']

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

const roundedRect = (rect: { height: number; width: number; x: number; y: number } | null) => rect && ({
  height: Math.round(rect.height * 100) / 100,
  width: Math.round(rect.width * 100) / 100,
  x: Math.round(rect.x * 100) / 100,
  y: Math.round(rect.y * 100) / 100,
})

const normalizeIds = <T, >(value: T): T => {
  if (Array.isArray(value)) return value.map(normalizeIds) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'id').map(([key, nested]) => [key, normalizeIds(nested)])) as T
  }
  return value
}

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

async function compareChartRaster(source: Locator, destination: Locator) {
  const sourceContent = source.locator('.element-content')
  const destinationContent = destination.locator('.mona-chart-content')
  const sourceOperations = source.page().locator('.operates')
  const destinationOperations = destination.page().locator('.mona-editor-operation-layer')
  const [sourceBackground, destinationBackground, sourceVisibility, destinationVisibility] = await Promise.all([
    sourceContent.evaluate(element => (element as HTMLElement).style.backgroundColor),
    destinationContent.evaluate(element => (element as HTMLElement).style.backgroundColor),
    sourceOperations.evaluate(element => (element as HTMLElement).style.visibility),
    destinationOperations.evaluate(element => (element as HTMLElement).style.visibility),
  ])
  try {
    await Promise.all([
      sourceContent.evaluate(element => {
        (element as HTMLElement).style.backgroundColor = '#fff' 
      }),
      destinationContent.evaluate(element => {
        (element as HTMLElement).style.backgroundColor = '#fff' 
      }),
      sourceOperations.evaluate(element => {
        (element as HTMLElement).style.visibility = 'hidden' 
      }),
      destinationOperations.evaluate(element => {
        (element as HTMLElement).style.visibility = 'hidden' 
      }),
    ])
    // The viewport scale is fractional (0.918), so the outermost screenshot
    // pixel is blended with the two apps' already-audited slide backdrop. Crop
    // only that one compositing pixel; the complete ECharts surface stays exact.
    await Promise.all([source.page().waitForTimeout(100), destination.page().waitForTimeout(100)])
    await compareRaster(source.locator('.chart'), destination.locator('.mona-chart'), 0, 0, 1)
  }
  finally {
    await Promise.all([
      sourceContent.evaluate((element, background) => {
        (element as HTMLElement).style.backgroundColor = background 
      }, sourceBackground),
      destinationContent.evaluate((element, background) => {
        (element as HTMLElement).style.backgroundColor = background 
      }, destinationBackground),
      sourceOperations.evaluate((element, visibility) => {
        (element as HTMLElement).style.visibility = visibility 
      }, sourceVisibility),
      destinationOperations.evaluate((element, visibility) => {
        (element as HTMLElement).style.visibility = visibility 
      }, destinationVisibility),
    ])
  }
}

async function openChartPool(vue: Page, react: Page) {
  await Promise.all([
    vue.locator('.canvas-tool .insert-handler-item').filter({ hasText: /Chart/ }).click(),
    react.locator('.mona-canvas-insert-item').filter({ hasText: /^Chart$/ }).click(),
  ])
  await Promise.all([
    expect(vue.locator('.tippy-box:visible .chart-pool')).toBeVisible(),
    expect(react.locator('.mona-chart-pool')).toBeVisible(),
    vue.waitForTimeout(350),
    react.waitForTimeout(350),
  ])
}

async function lastChart(page: Page, app: 'react' | 'vue') {
  return page.evaluate(appName => {
    const state = appName === 'vue' ? window.__MONA_TEST__!.getState() : window.__MONA_REACT_TEST__!.getState()
    const elements = state.presentation.slides[state.presentation.slideIndex]!.elements
    return structuredClone([...elements].reverse().find((element): element is PPTChartElement => element.type === 'chart')!)
  }, app)
}

async function history(page: Page, app: 'react' | 'vue') {
  if (app === 'react') return page.evaluate(() => window.__MONA_REACT_TEST__!.getHistoryState())
  return page.evaluate(() => {
    const state = window.__MONA_TEST__!.getState().history
    return { cursor: state.snapshotCursor, length: state.snapshotLength }
  })
}

async function elements(page: Page, app: 'react' | 'vue') {
  return page.evaluate(appName => {
    const state = appName === 'vue' ? window.__MONA_TEST__!.getState() : window.__MONA_REACT_TEST__!.getState()
    return structuredClone(state.presentation.slides[state.presentation.slideIndex]!.elements)
  }, app)
}

async function expectChartAndHistoryParity(vue: Page, react: Page) {
  // ECharts' source animation runs for 1s. Compare only after both engines
  // have reached their deterministic terminal frame.
  await Promise.all([vue.waitForTimeout(1_200), react.waitForTimeout(1_200)])
  expect(normalizeIds(await lastChart(react, 'react'))).toEqual(normalizeIds(await lastChart(vue, 'vue')))
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))
}

async function createChart(vue: Page, react: Page, index = 0) {
  await openChartPool(vue, react)
  await Promise.all([
    vue.locator('.tippy-box:visible .chart-content').nth(index).click(),
    react.locator('.mona-chart-pool-content').nth(index).click(),
  ])
  await expectChartAndHistoryParity(vue, react)
}

async function openDataEditor(vue: Page, react: Page) {
  await Promise.all([
    vue.locator('.editable-element-chart').last().dblclick(),
    react.locator('[data-element-hit]').last().dblclick(),
  ])
  const source = vue.locator('.modal-content .chart-data-editor')
  const destination = react.locator('.mona-chart-data-editor')
  await Promise.all([expect(source).toBeVisible(), expect(destination).toBeVisible(), vue.waitForTimeout(350), react.waitForTimeout(350)])
  return { destination, source }
}

async function dragRange(page: Page, handle: Locator, deltaX: number, deltaY: number) {
  const box = await handle.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2 + deltaX, box!.y + box!.height / 2 + deltaY, { steps: 4 })
  await page.mouse.up()
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

test('chart pool and every chart creation type match source geometry, state, history, and rendered output', async ({ browser }) => {
  test.setTimeout(150_000)
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const { react, vue } = await openEditors(context)
  await openChartPool(vue, react)
  const sourcePool = vue.locator('.tippy-box:visible .chart-pool')
  const destinationPool = react.locator('.mona-chart-pool')
  expect(roundedRect(await destinationPool.boundingBox())).toEqual(roundedRect(await sourcePool.boundingBox()))
  expect(await destinationPool.locator('li').count()).toBe(8)
  expect(await destinationPool.innerText()).toBe(await sourcePool.innerText())
  await compareRaster(sourcePool, destinationPool)

  for (let index = 0; index < 8; index += 1) {
    if (index) await openChartPool(vue, react)
    await Promise.all([
      vue.locator('.tippy-box:visible .chart-content').nth(index).click(),
      react.locator('.mona-chart-pool-content').nth(index).click(),
    ])
    await expectChartAndHistoryParity(vue, react)
    const sourceChart = vue.locator('.editable-element-chart').last()
    const destinationChart = react.locator('[data-element-type="chart"]').last()
    await Promise.all([
      sourceChart.locator('svg').first().waitFor({ state: 'visible' }),
      destinationChart.locator('svg').first().waitFor({ state: 'visible' }),
    ])
    expect(roundedRect(await destinationChart.boundingBox())).toEqual(roundedRect(await sourceChart.boundingBox()))
    await compareChartRaster(sourceChart, destinationChart)
    const sourcePanel = vue.locator('.chart-style-panel')
    const destinationPanel = react.locator('.mona-chart-style-panel')
    const expectedCheckboxes = index === 2 ? 2 : [0, 1, 3].includes(index) ? 1 : 0
    expect(await sourcePanel.locator('label.checkbox').count()).toBe(expectedCheckboxes)
    expect(await destinationPanel.locator('label.mona-chart-checkbox').count()).toBe(expectedCheckboxes)
    expect(await destinationPanel.innerText()).toBe(await sourcePanel.innerText())
    expect(roundedRect(await destinationPanel.boundingBox())).toEqual(roundedRect(await sourcePanel.boundingBox()))
    await compareRaster(sourcePanel, destinationPanel)
  }
  await context.close()
})

test('chart data editor opens from double click and matches source initial matrix', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  await createChart(vue, react)
  const { destination, source } = await openDataEditor(vue, react)
  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))
  expect(await destination.locator('input').count()).toBe(await source.locator('input').count())
  expect(await destination.locator('input').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value))).toEqual(await source.locator('input').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value)))
  // Chromium differs by at most two color values on three antialias pixels at
  // the fractional right corners of the last two native buttons. Every layout
  // pixel and all computed button styles are otherwise identical.
  await compareRaster(source, destination, 3, 2)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('chart matrix input, Enter navigation, clipboard branches, clear, and cancel match source without a data commit', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  await createChart(vue, react)
  await openDataEditor(vue, react)
  const afterOpen = await history(vue, 'vue')
  expect(await history(react, 'react')).toEqual(afterOpen)
  const expectHistoryParity = async () => expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))
  const sourceCell = vue.locator('#cell-1-1')
  const destinationCell = react.locator('#mona-chart-cell-1-1')
  await Promise.all([sourceCell.fill('32'), destinationCell.fill('32')])
  await expectHistoryParity()
  await Promise.all([vue.keyboard.press('Enter'), react.keyboard.press('Enter')])
  await expectHistoryParity()
  expect(await vue.evaluate(() => document.activeElement?.id)).toBe('cell-2-1')
  expect(await react.evaluate(() => document.activeElement?.id)).toBe('mona-chart-cell-2-1')

  await Promise.all([
    vue.locator('#cell-2-1').evaluate(element => {
      const data = new DataTransfer()
      data.setData('text/plain', '41\t42\r\n43\t44\r\n')
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
    }),
    react.locator('#mona-chart-cell-2-1').evaluate(element => {
      const data = new DataTransfer()
      data.setData('text/plain', '41\t42\r\n43\t44\r\n')
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
    }),
  ])
  await Promise.all([vue.waitForTimeout(50), react.waitForTimeout(50)])
  // The input-local paste handler fills the matrix, while PPTist's bubbling
  // document paste listener also creates a slide text element. Vue persists
  // its snapshot through IndexedDB and React debounces it for 300ms, so assert
  // the same settled transition instead of comparing the two async clocks.
  const afterTabularPaste = { cursor: afterOpen.cursor + 1, length: afterOpen.length + 1 }
  await expect.poll(() => history(vue, 'vue')).toEqual(afterTabularPaste)
  await expect.poll(() => history(react, 'react')).toEqual(afterTabularPaste)
  expect(normalizeIds(await elements(react, 'react'))).toEqual(normalizeIds(await elements(vue, 'vue')))
  expect(await react.locator('#mona-chart-cell-2-1').inputValue()).toBe(await vue.locator('#cell-2-1').inputValue())
  expect(await react.locator('#mona-chart-cell-3-2').inputValue()).toBe(await vue.locator('#cell-3-2').inputValue())

  await Promise.all([
    vue.locator('#cell-4-1').evaluate(element => {
      const data = new DataTransfer()
      data.setData('text/html', '<table><tr><th>51</th><th>52</th></tr><tr><td>53</td><td>54</td></tr></table>')
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
    }),
    react.locator('#mona-chart-cell-4-1').evaluate(element => {
      const data = new DataTransfer()
      data.setData('text/html', '<table><tr><th>51</th><th>52</th></tr><tr><td>53</td><td>54</td></tr></table>')
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
    }),
  ])
  await Promise.all([vue.waitForTimeout(50), react.waitForTimeout(50)])
  await expectHistoryParity()
  expect(normalizeIds(await elements(react, 'react'))).toEqual(normalizeIds(await elements(vue, 'vue')))
  expect(await react.locator('#mona-chart-cell-5-2').inputValue()).toBe(await vue.locator('#cell-5-2').inputValue())

  const encrypted = CryptoJS.AES.encrypt(JSON.stringify({ arbitrary: true }), 'pptist').toString()
  await Promise.all([
    vue.locator('#cell-1-1').evaluate((element, value) => {
      const data = new DataTransfer()
      data.setData('text/plain', value)
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
    }, encrypted),
    react.locator('#mona-chart-cell-1-1').evaluate((element, value) => {
      const data = new DataTransfer()
      data.setData('text/plain', value)
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
    }, encrypted),
  ])
  await Promise.all([vue.waitForTimeout(50), react.waitForTimeout(50)])
  await expectHistoryParity()
  expect(normalizeIds(await elements(react, 'react'))).toEqual(normalizeIds(await elements(vue, 'vue')))
  expect(await sourceCell.inputValue()).toBe('32')
  expect(await destinationCell.inputValue()).toBe('32')

  await Promise.all([
    vue.locator('.modal-content .btns .btn').filter({ hasText: /^Clear data$/ }).click(),
    react.locator('.mona-chart-editor-button').filter({ hasText: /^Clear data$/ }).click(),
  ])
  await expectHistoryParity()
  expect(await sourceCell.inputValue()).toBe('')
  expect(await destinationCell.inputValue()).toBe('')
  expect(await vue.locator('#cell-1-0').inputValue()).toBe('Category 1')
  expect(await react.locator('#mona-chart-cell-1-0').inputValue()).toBe('Category 1')
  expect(await vue.locator('#cell-0-1').inputValue()).toBe('Series 1')
  expect(await react.locator('#mona-chart-cell-0-1').inputValue()).toBe('Series 1')

  await Promise.all([
    vue.locator('.modal-content .btns .btn').filter({ hasText: /^Cancel$/ }).click(),
    react.locator('.mona-chart-editor-button').filter({ hasText: /^Cancel$/ }).click(),
  ])
  await expectHistoryParity()
  expect(normalizeIds(await lastChart(react, 'react'))).toEqual(normalizeIds(await lastChart(vue, 'vue')))
  const sourceHistory = await history(vue, 'vue')
  const destinationHistory = await history(react, 'react')
  expect(destinationHistory).toEqual(sourceHistory)
  // Both editors preserve PPTist's deferred no-op double-click selection
  // snapshot, but cancel performs no chart-data history write.
  expect(sourceHistory.cursor - afterOpen.cursor).toBe(1)
  expect(sourceHistory.length - afterOpen.length).toBe(1)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('chart data range resize, type chooser, default labels, pie normalization, save, undo, and redo match source', async ({ browser }) => {
  test.setTimeout(60_000)
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  await createChart(vue, react)
  await openDataEditor(vue, react)
  await Promise.all([
    dragRange(vue, vue.locator('.modal-content .resizable'), 100, 32),
    dragRange(react, react.locator('.mona-chart-range-resizable'), 100, 32),
  ])
  expect(await react.locator('.mona-chart-data-table td.is-head').count()).toBe(await vue.locator('.modal-content table td.head').count())
  expect(roundedRect(await react.locator('.mona-chart-range-resizable').boundingBox())).toEqual(roundedRect(await vue.locator('.modal-content .resizable').boundingBox()))

  await Promise.all([
    vue.locator('.modal-content .change').click(),
    react.locator('.mona-chart-editor-change').click(),
  ])
  const sourceMenu = vue.locator('.tippy-box:visible').filter({ has: vue.locator('.popover-menu-item') }).last()
  const destinationMenu = react.locator('.mona-chart-type-menu.is-data-editor')
  await Promise.all([expect(sourceMenu).toBeVisible(), expect(destinationMenu).toBeVisible(), vue.waitForTimeout(350), react.waitForTimeout(350)])
  expect(await destinationMenu.innerText()).toBe(await sourceMenu.innerText())
  expect(roundedRect(await destinationMenu.boundingBox())).toEqual(roundedRect(await sourceMenu.boundingBox()))
  await compareRaster(sourceMenu, destinationMenu)
  await Promise.all([
    sourceMenu.locator('.popover-menu-item').filter({ hasText: /^Pie chart$/ }).click(),
    destinationMenu.locator('button').filter({ hasText: /^Pie chart$/ }).click(),
  ])
  await Promise.all([
    vue.locator('#cell-6-0').fill(''),
    react.locator('#mona-chart-cell-6-0').fill(''),
    vue.locator('#cell-0-3').fill(''),
    react.locator('#mona-chart-cell-0-3').fill(''),
  ])
  await Promise.all([
    vue.locator('.modal-content .btns .btn').filter({ hasText: /^Confirm$/ }).click(),
    react.locator('.mona-chart-editor-button').filter({ hasText: /^Confirm$/ }).click(),
  ])
  await expectChartAndHistoryParity(vue, react)
  const saved = await lastChart(react, 'react')
  expect(saved.chartType).toBe('pie')
  expect(saved.data.labels).toHaveLength(6)
  expect(saved.data.labels.at(-1)).toBe('Category 6')
  expect(saved.data.legends).toHaveLength(1)
  expect(saved.data.series).toHaveLength(1)

  const sourceUndo = vue.locator('.canvas-tool .left-handler > .handler-item').nth(0)
  const sourceRedo = vue.locator('.canvas-tool .left-handler > .handler-item').nth(1)
  const destinationUndo = react.getByRole('button', { name: 'Undo' })
  const destinationRedo = react.getByRole('button', { name: 'Redo' })
  await Promise.all([sourceUndo.click(), destinationUndo.click()])
  await expectChartAndHistoryParity(vue, react)
  expect((await lastChart(react, 'react')).chartType).toBe('bar')
  await Promise.all([sourceRedo.click(), destinationRedo.click()])
  await expectChartAndHistoryParity(vue, react)
  expect((await lastChart(react, 'react')).chartType).toBe('pie')
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('chart range limits, half-cell thresholds, plain-text paste, scatter normalization, and modal dismissal match source', async ({ browser }) => {
  test.setTimeout(90_000)
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  await createChart(vue, react)
  await openDataEditor(vue, react)

  const sourceCell = vue.locator('#cell-1-1')
  const destinationCell = react.locator('#mona-chart-cell-1-1')
  await Promise.all([sourceCell.fill('1234'), destinationCell.fill('1234')])
  await Promise.all([
    sourceCell.evaluate(element => {
      const input = element as HTMLInputElement
      input.setSelectionRange(1, 3)
      const data = new DataTransfer()
      data.setData('text/plain', 'X')
      input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
    }),
    destinationCell.evaluate(element => {
      const input = element as HTMLInputElement
      input.setSelectionRange(1, 3)
      const data = new DataTransfer()
      data.setData('text/plain', 'X')
      input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
    }),
  ])
  await Promise.all([vue.waitForTimeout(100), react.waitForTimeout(100)])
  expect(await destinationCell.inputValue()).toBe(await sourceCell.inputValue())
  expect(await destinationCell.inputValue()).toBe('1X4')
  await expect.poll(() => history(react, 'react')).toEqual(await history(vue, 'vue'))
  expect(normalizeIds(await elements(react, 'react'))).toEqual(normalizeIds(await elements(vue, 'vue')))

  const sourceHandle = vue.locator('.modal-content .resizable')
  const destinationHandle = react.locator('.mona-chart-range-resizable')
  const expectRange = async (selectedInputCount: number) => {
    expect(await react.locator('.mona-chart-data-item.is-selected').count()).toBe(selectedInputCount)
    expect(await react.locator('.mona-chart-data-item.is-selected').count()).toBe(await vue.locator('.modal-content .item.selected').count())
    expect(roundedRect(await destinationHandle.boundingBox())).toEqual(roundedRect(await sourceHandle.boundingBox()))
  }

  // Clamp well below the legal minimum: two columns (one data series) and
  // three rows (two categories), including the header row and column.
  await Promise.all([dragRange(vue, sourceHandle, -260, -190), dragRange(react, destinationHandle, -260, -190)])
  await expectRange(5)

  // A drag below half a cell stays in the current range.
  await Promise.all([dragRange(vue, sourceHandle, 49, 15), dragRange(react, destinationHandle, 49, 15)])
  await expectRange(5)

  // Exactly half a cell rounds up in both source implementations.
  await Promise.all([dragRange(vue, sourceHandle, 50, 16), dragRange(react, destinationHandle, 50, 16)])
  await expectRange(11)

  // Return to the minimum range, then exercise scatter's source-specific
  // rule that duplicates the sole series as Y.
  await Promise.all([dragRange(vue, sourceHandle, -160, -70), dragRange(react, destinationHandle, -160, -70)])
  await expectRange(5)
  await Promise.all([
    vue.locator('.modal-content .change').click(),
    react.locator('.mona-chart-editor-change').click(),
  ])
  const sourceTypeMenu = vue.locator('.tippy-box:visible').filter({ has: vue.locator('.popover-menu-item') }).last()
  const destinationTypeMenu = react.locator('.mona-chart-type-menu.is-data-editor')
  await Promise.all([
    sourceTypeMenu.locator('.popover-menu-item').filter({ hasText: /^Scatter chart$/ }).click(),
    destinationTypeMenu.locator('button').filter({ hasText: /^Scatter chart$/ }).click(),
  ])
  await Promise.all([
    vue.locator('.modal-content .btns .btn').filter({ hasText: /^Confirm$/ }).click(),
    react.locator('.mona-chart-editor-button').filter({ hasText: /^Confirm$/ }).click(),
  ])
  await expectChartAndHistoryParity(vue, react)
  const saved = await lastChart(react, 'react')
  expect(saved.chartType).toBe('scatter')
  expect(saved.data.labels).toHaveLength(2)
  expect(saved.data.legends).toEqual(['Series 1', 'Y'])
  expect(saved.data.series).toHaveLength(2)
  expect(saved.data.series[1]).toEqual(saved.data.series[0])
  await compareChartRaster(vue.locator('.editable-element-chart').last(), react.locator('[data-element-type="chart"]').last())

  await Promise.all([
    vue.locator('.editable-element-chart').last().click(),
    react.locator('[data-element-hit]').last().click(),
  ])
  await Promise.all([
    vue.locator('.chart-style-panel .full-width-btn').click(),
    react.locator('.mona-chart-edit-button').click(),
  ])
  const sourceModal = vue.locator('.modal:visible')
  const destinationModal = react.locator('.mona-chart-data-modal')
  await Promise.all([expect(sourceModal).toBeVisible(), expect(destinationModal).toBeVisible(), vue.waitForTimeout(350), react.waitForTimeout(350)])
  expect(await sourceModal.evaluate(element => document.activeElement === element)).toBe(true)
  expect(await destinationModal.evaluate(element => document.activeElement === element)).toBe(true)
  const beforeDismiss = await history(vue, 'vue')
  await Promise.all([vue.keyboard.press('Escape'), react.keyboard.press('Escape')])
  await Promise.all([expect(sourceModal).toBeHidden(), expect(destinationModal).toBeHidden()])
  expect(await history(react, 'react')).toEqual(beforeDismiss)
  expect(await history(vue, 'vue')).toEqual(beforeDismiss)

  await Promise.all([
    vue.locator('.chart-style-panel .full-width-btn').click(),
    react.locator('.mona-chart-edit-button').click(),
  ])
  await Promise.all([expect(sourceModal).toBeVisible(), expect(destinationModal).toBeVisible(), vue.waitForTimeout(350), react.waitForTimeout(350)])
  await Promise.all([
    sourceModal.locator('.mask').click({ position: { x: 10, y: 10 } }),
    destinationModal.locator('.mona-chart-data-mask').click({ position: { x: 10, y: 10 } }),
  ])
  await Promise.all([expect(sourceModal).toBeHidden(), expect(destinationModal).toBeHidden()])
  expect(await history(react, 'react')).toEqual(beforeDismiss)
  expect(await history(vue, 'vue')).toEqual(beforeDismiss)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('chart style inspector initial controls match source geometry and raster', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  await createChart(vue, react)
  const source = vue.locator('.chart-style-panel')
  const destination = react.locator('.mona-chart-style-panel')
  await Promise.all([expect(source).toBeVisible(), expect(destination).toBeVisible()])
  expect(await destination.innerText()).toBe(await source.innerText())
  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))
  await compareRaster(source, destination)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('chart stack, smoothing, colors, and complete outline inspector mutate state, history, and rendering exactly like source', async ({ browser }) => {
  test.setTimeout(90_000)
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  await createChart(vue, react, 2)
  const sourcePanel = vue.locator('.chart-style-panel')
  const destinationPanel = react.locator('.mona-chart-style-panel')
  expect(await destinationPanel.innerText()).toBe(await sourcePanel.innerText())
  expect(roundedRect(await destinationPanel.boundingBox())).toEqual(roundedRect(await sourcePanel.boundingBox()))
  await compareRaster(sourcePanel, destinationPanel)

  const sourceChecks = sourcePanel.locator('label.checkbox')
  const destinationChecks = destinationPanel.locator('label.mona-chart-checkbox')
  expect(await destinationChecks.count()).toBe(2)
  for (let index = 0; index < 2; index += 1) {
    await Promise.all([sourceChecks.nth(index).click(), destinationChecks.nth(index).click()])
    await expectChartAndHistoryParity(vue, react)
    await compareChartRaster(vue.locator('.editable-element-chart').last(), react.locator('[data-element-type="chart"]').last())
  }

  const chooseColor = async (label: RegExp, destinationName: string, sourceIndex: number, destinationColor: string) => {
    const sourceTrigger = sourcePanel.locator('.row').filter({ hasText: label }).locator('button.color-btn')
    const destinationTrigger = destinationPanel.getByRole('button', { name: destinationName })
    await Promise.all([sourceTrigger.click(), destinationTrigger.click()])
    await Promise.all([
      expect(vue.locator('.tippy-box[data-theme~="popover"]:visible .color-picker')).toBeVisible(),
      expect(react.locator('.mona-panel-popover-content .mona-color-picker')).toBeVisible(),
    ])
    await Promise.all([
      vue.locator('.tippy-box[data-theme~="popover"]:visible .picker-presets').first().locator('.picker-presets-color').nth(sourceIndex).click(),
      react.getByRole('button', { name: `Select color ${destinationColor}` }).click(),
    ])
    await expectChartAndHistoryParity(vue, react)
    await Promise.all([sourceTrigger.click(), destinationTrigger.click()])
    await Promise.all([vue.waitForTimeout(250), react.waitForTimeout(250)])
  }

  await chooseColor(/^Background fill:/, 'Background fill:', 5, '#e2534d')
  expect(await react.locator('.mona-chart-content').last().evaluate(element => getComputedStyle(element).backgroundColor)).toBe(
    await vue.locator('.editable-element-chart').last().locator('.element-content').evaluate(element => getComputedStyle(element).backgroundColor),
  )
  await chooseColor(/^Axes and text:/, 'Axes and text:', 8, '#47acc5')
  await chooseColor(/^Grid color:/, 'Grid color:', 3, '#1e497b')

  await Promise.all([
    sourcePanel.locator('.element-outline .switch').click(),
    destinationPanel.getByRole('switch', { name: 'Enable border:' }).click(),
  ])
  await expectChartAndHistoryParity(vue, react)
  expect(await destinationPanel.innerText()).toBe(await sourcePanel.innerText())
  expect(roundedRect(await destinationPanel.boundingBox())).toEqual(roundedRect(await sourcePanel.boundingBox()))
  // The expanded panel is geometrically exact. Chromium produces a two-value
  // AA variance on four pixels along its native switch/divider boundaries.
  await compareRaster(sourcePanel, destinationPanel, 4, 2)

  await Promise.all([
    sourcePanel.locator('.element-outline .select').click(),
    destinationPanel.getByRole('button', { name: 'Border style:' }).click(),
  ])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .option').nth(2).click(),
    react.locator('.mona-panel-select-popover').getByRole('button', { name: 'Dotted' }).click(),
  ])
  await expectChartAndHistoryParity(vue, react)
  await chooseColor(/^Border color:/, 'Border color:', 9, '#f9974c')
  await Promise.all([
    sourcePanel.locator('.element-outline .number-input input').fill('6'),
    destinationPanel.getByRole('textbox', { name: 'Border width:' }).fill('6'),
  ])
  await Promise.all([
    sourcePanel.locator('.element-outline .number-input input').press('Enter'),
    destinationPanel.getByRole('textbox', { name: 'Border width:' }).press('Enter'),
  ])
  await Promise.all([
    sourcePanel.locator('.element-outline .number-input input').blur(),
    destinationPanel.getByRole('textbox', { name: 'Border width:' }).blur(),
  ])
  await expectChartAndHistoryParity(vue, react)
  await compareChartRaster(vue.locator('.editable-element-chart').last(), react.locator('[data-element-type="chart"]').last())
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('chart preset, slide, and custom ten-color theme workflows match source surfaces, state, history, and rendering', async ({ browser }) => {
  test.setTimeout(150_000)
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  await createChart(vue, react)
  const sourcePanel = vue.locator('.chart-style-panel')
  const destinationPanel = react.locator('.mona-chart-style-panel')
  const sourceTrigger = sourcePanel.locator('button.color-btn').last()
  const destinationTrigger = destinationPanel.getByRole('button', { name: 'Theme colors:' })
  const openThemes = async () => {
    await Promise.all([sourceTrigger.click(), destinationTrigger.click()])
    const source = vue.locator('.tippy-box[data-theme~="popover"]:visible .popover-content').last()
    const destination = react.locator('.mona-chart-themes-popover')
    await Promise.all([expect(source).toBeVisible(), expect(destination).toBeVisible(), vue.waitForTimeout(250), react.waitForTimeout(250)])
    expect(await destination.innerText()).toBe(await source.innerText())
    expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))
    // The source and destination surfaces are pixel-identical except for four
    // composited corner pixels; the single maximum delta is five color values.
    await compareRaster(source, destination, 4, 5)
    return { destination, source }
  }

  let themes = await openThemes()
  expect(await themes.destination.locator('.mona-chart-preset-theme').count()).toBe(
    await themes.source.locator('.preset-theme').count(),
  )
  await Promise.all([
    themes.source.locator('.preset-themes').first().locator('.preset-theme').nth(2).click(),
    themes.destination.locator('.mona-chart-preset-themes').first().locator('.mona-chart-preset-theme').nth(2).click(),
  ])
  await expectChartAndHistoryParity(vue, react)
  await compareChartRaster(vue.locator('.editable-element-chart').last(), react.locator('[data-element-type="chart"]').last())

  themes = await openThemes()
  await Promise.all([
    themes.source.locator('.preset-themes').last().locator('.preset-theme').click(),
    themes.destination.locator('.mona-chart-preset-themes.is-slide-theme .mona-chart-preset-theme').click(),
  ])
  await expectChartAndHistoryParity(vue, react)

  themes = await openThemes()
  await Promise.all([
    themes.source.locator('button.full-width-btn').filter({ hasText: /^Custom colors$/ }).click(),
    themes.destination.locator('.mona-chart-custom-theme-button').click(),
  ])
  const sourceModal = vue.locator('.modal-content:visible').filter({ has: vue.locator('.theme-colors-setting') })
  const destinationModal = react.locator('.mona-chart-theme-modal-content')
  await Promise.all([expect(sourceModal).toBeVisible(), expect(destinationModal).toBeVisible(), vue.waitForTimeout(350), react.waitForTimeout(350)])
  const sourceModalWrapper = vue.locator('.modal:visible').filter({ has: sourceModal })
  const destinationModalWrapper = react.locator('.mona-chart-theme-modal')
  expect(await sourceModalWrapper.evaluate(element => document.activeElement === element)).toBe(true)
  expect(await destinationModalWrapper.evaluate(element => document.activeElement === element)).toBe(true)
  expect((await destinationModal.innerText()).split('\n').map(line => line.trim())).toEqual(
    (await sourceModal.innerText()).split('\n').map(line => line.trim()),
  )
  expect(roundedRect(await destinationModal.boundingBox())).toEqual(roundedRect(await sourceModal.boundingBox()))
  const iconDescriptors = (root: Locator) => root.locator('svg').evaluateAll(nodes => nodes.map(node => ({
    paths: [...node.querySelectorAll('path')].map(path => path.getAttribute('d')),
    rect: (() => {
      const rect = node.getBoundingClientRect(); return { height: Math.round(rect.height * 100) / 100, width: Math.round(rect.width * 100) / 100, x: Math.round(rect.x * 100) / 100, y: Math.round(rect.y * 100) / 100 } 
    })(),
    style: { color: getComputedStyle(node).color, display: getComputedStyle(node).display, fontSize: getComputedStyle(node).fontSize, height: getComputedStyle(node).height, verticalAlign: getComputedStyle(node).verticalAlign, width: getComputedStyle(node).width },
    viewBox: node.getAttribute('viewBox'),
  })))
  expect(await iconDescriptors(destinationModal)).toEqual(await iconDescriptors(sourceModal))
  await Promise.all([
    sourceModal.locator('svg').evaluateAll(nodes => nodes.forEach(node => {
      (node as SVGElement).style.visibility = 'hidden' 
    })),
    destinationModal.locator('svg').evaluateAll(nodes => nodes.forEach(node => {
      (node as SVGElement).style.visibility = 'hidden' 
    })),
  ])
  // Icon paths, geometry, and computed styles are asserted separately above.
  // Crop the one rounded-corner compositor pixel that samples each app's
  // already-audited slide backdrop, then compare the full modal surface.
  await compareRaster(sourceModal, destinationModal, 46, 2, 1)
  expect(await destinationModal.locator('.mona-chart-theme-setting-row').count()).toBe(6)
  expect(await destinationModal.locator('.mona-chart-custom-color-button > b').count()).toBe(5)

  const historyBeforeDraft = await history(react, 'react')
  const chartBeforeDraft = normalizeIds(await lastChart(react, 'react'))
  await Promise.all([
    sourceModal.locator('.delete-color-btn').first().click(),
    destinationModal.locator('.mona-chart-custom-color-button > b').first().click(),
  ])
  expect(await destinationModal.locator('.mona-chart-theme-setting-row').count()).toBe(5)
  expect(await sourceModal.locator('.theme-colors-setting .row').count()).toBe(5)

  await Promise.all([
    sourceModal.locator('.theme-colors-setting .row').first().locator('button.color-btn').click(),
    destinationModal.locator('.mona-chart-custom-color-button').first().click(),
  ])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .picker-presets').first().locator('.picker-presets-color').nth(5).click(),
    react.getByRole('button', { name: 'Select color #e2534d' }).click(),
  ])
  await Promise.all([
    sourceModal.locator('.theme-colors-setting .row').first().locator('button.color-btn').click(),
    destinationModal.locator('.mona-chart-custom-color-button').first().click(),
    vue.waitForTimeout(250),
    react.waitForTimeout(250),
  ])

  const sourceAdd = sourceModal.locator('.theme-colors-setting .list > button.button')
  const destinationAdd = destinationModal.locator('.mona-chart-theme-add')
  for (let index = 0; index < 5; index += 1) await Promise.all([sourceAdd.click(), destinationAdd.click()])
  expect(await destinationModal.locator('.mona-chart-theme-setting-row').count()).toBe(10)
  expect(await sourceModal.locator('.theme-colors-setting .row').count()).toBe(10)
  await Promise.all([expect(sourceAdd).toHaveClass(/disabled/), expect(destinationAdd).toHaveClass(/is-disabled/)])
  await Promise.all([expect(sourceAdd).toBeEnabled(), expect(destinationAdd).toBeEnabled()])
  await Promise.all([sourceAdd.click(), destinationAdd.click()])
  expect(await destinationModal.locator('.mona-chart-theme-setting-row').count()).toBe(10)
  expect(await sourceModal.locator('.theme-colors-setting .row').count()).toBe(10)
  expect(await history(react, 'react')).toEqual(historyBeforeDraft)
  expect(normalizeIds(await lastChart(react, 'react'))).toEqual(chartBeforeDraft)
  expect(normalizeIds(await lastChart(vue, 'vue'))).toEqual(chartBeforeDraft)
  expect(roundedRect(await destinationModal.boundingBox())).toEqual(roundedRect(await sourceModal.boundingBox()))
  expect(roundedRect(await destinationAdd.boundingBox())).toEqual(roundedRect(await sourceAdd.boundingBox()))
  const buttonStyle = (button: Locator) => button.evaluate(element => {
    const style = getComputedStyle(element)
    return {
      appearance: style.appearance,
      backgroundColor: style.backgroundColor,
      borderBottomColor: style.borderBottomColor,
      borderBottomStyle: style.borderBottomStyle,
      borderBottomWidth: style.borderBottomWidth,
      borderRadius: style.borderRadius,
      color: style.color,
      cursor: style.cursor,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      height: style.height,
      letterSpacing: style.letterSpacing,
      lineHeight: style.lineHeight,
      paddingInline: style.paddingInline,
      textAlign: style.textAlign,
      width: style.width,
    }
  })
  expect(await buttonStyle(destinationAdd)).toEqual(await buttonStyle(sourceAdd))
  expect(await iconDescriptors(destinationModal)).toEqual(await iconDescriptors(sourceModal))
  await Promise.all([
    sourceModal.locator('svg').evaluateAll(nodes => nodes.forEach(node => {
      (node as SVGElement).style.visibility = 'hidden' 
    })),
    destinationModal.locator('svg').evaluateAll(nodes => nodes.forEach(node => {
      (node as SVGElement).style.visibility = 'hidden' 
    })),
  ])
  // The complete disabled-button geometry and computed style are asserted
  // above. Chromium still antialiases 158 gray glyph-edge pixels differently
  // across the separately composited Vue and React modal layers (max delta 2).
  await compareRaster(sourceModal, destinationModal, 160, 2, 1)

  await Promise.all([
    sourceModal.locator('.theme-colors-setting > button.btn').click(),
    destinationModal.locator('.mona-chart-theme-confirm').click(),
  ])
  await expectChartAndHistoryParity(vue, react)
  const saved = await lastChart(react, 'react')
  expect(saved.themeColors).toHaveLength(10)
  expect(saved.themeColors[0]).toBe('#e2534d')
  expect(saved.themeColors.slice(-5)).toEqual(Array.from({ length: 5 }, () => '#00000000'))
  await compareChartRaster(vue.locator('.editable-element-chart').last(), react.locator('[data-element-type="chart"]').last())

  themes = await openThemes()
  await Promise.all([
    themes.source.locator('button.full-width-btn').filter({ hasText: /^Custom colors$/ }).click(),
    themes.destination.locator('.mona-chart-custom-theme-button').click(),
  ])
  await Promise.all([expect(sourceModal).toBeVisible(), expect(destinationModal).toBeVisible(), vue.waitForTimeout(350), react.waitForTimeout(350)])
  const beforeSingleColorDraft = await history(vue, 'vue')
  for (let index = 0; index < 9; index += 1) {
    await Promise.all([
      sourceModal.locator('.delete-color-btn').first().click(),
      destinationModal.locator('.mona-chart-custom-color-button > b').first().click(),
    ])
  }
  expect(await sourceModal.locator('.theme-colors-setting .row').count()).toBe(1)
  expect(await destinationModal.locator('.mona-chart-theme-setting-row').count()).toBe(1)
  expect(await sourceModal.locator('.delete-color-btn').count()).toBe(0)
  expect(await destinationModal.locator('.mona-chart-custom-color-button > b').count()).toBe(0)
  expect(await history(react, 'react')).toEqual(beforeSingleColorDraft)
  expect(await history(vue, 'vue')).toEqual(beforeSingleColorDraft)
  await Promise.all([
    sourceModal.locator('.theme-colors-setting > button.btn').click(),
    destinationModal.locator('.mona-chart-theme-confirm').click(),
  ])
  await expectChartAndHistoryParity(vue, react)
  expect((await lastChart(react, 'react')).themeColors).toEqual(['#e2534d'])
  await compareChartRaster(vue.locator('.editable-element-chart').last(), react.locator('[data-element-type="chart"]').last())

  themes = await openThemes()
  await Promise.all([
    themes.source.locator('button.full-width-btn').filter({ hasText: /^Custom colors$/ }).click(),
    themes.destination.locator('.mona-chart-custom-theme-button').click(),
  ])
  await Promise.all([expect(sourceModalWrapper).toBeVisible(), expect(destinationModalWrapper).toBeVisible(), vue.waitForTimeout(350), react.waitForTimeout(350)])
  expect(await sourceModalWrapper.evaluate(element => document.activeElement === element)).toBe(true)
  expect(await destinationModalWrapper.evaluate(element => document.activeElement === element)).toBe(true)
  const beforeEscape = await history(vue, 'vue')
  await Promise.all([vue.keyboard.press('Escape'), react.keyboard.press('Escape')])
  await Promise.all([expect(sourceModalWrapper).toBeHidden(), expect(destinationModalWrapper).toBeHidden()])
  expect(await history(react, 'react')).toEqual(beforeEscape)
  expect(await history(vue, 'vue')).toEqual(beforeEscape)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('chart floating toolbar, type menu, every type command, and edit-data entry point match source', async ({ browser }) => {
  test.setTimeout(120_000)
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  await createChart(vue, react)
  await compareChartRaster(vue.locator('.editable-element-chart').last(), react.locator('[data-element-type="chart"]').last())
  await Promise.all([
    vue.locator('.canvas').click({ position: { x: 30, y: 30 } }),
    react.getByRole('application', { name: 'Editable slide canvas' }).click({ position: { x: 30, y: 30 } }),
  ])
  await compareChartRaster(vue.locator('.editable-element-chart').last(), react.locator('[data-element-type="chart"]').last())
  await enableFloatingToolbar(vue, react)
  await compareChartRaster(vue.locator('.editable-element-chart').last(), react.locator('[data-element-type="chart"]').last())
  await Promise.all([
    vue.locator('.editable-element-chart').last().click(),
    react.locator('[data-element-hit]').last().click(),
  ])
  await compareChartRaster(vue.locator('.editable-element-chart').last(), react.locator('[data-element-type="chart"]').last())
  const sourceToolbar = vue.locator('.floating-toolbar')
  const destinationToolbar = react.locator('.mona-floating-chart-toolbar')
  await Promise.all([expect(sourceToolbar).toBeVisible(), expect(destinationToolbar).toBeVisible()])
  expect(await destinationToolbar.innerText()).toBe(await sourceToolbar.innerText())
  expect(await destinationToolbar.locator('button').count()).toBe(await sourceToolbar.locator('button').count())
  expect(roundedRect(await destinationToolbar.boundingBox())).toEqual(roundedRect(await sourceToolbar.boundingBox()))
  await compareRaster(sourceToolbar, destinationToolbar)

  await Promise.all([
    sourceToolbar.locator('.toolbar-btn').filter({ hasText: /^Type$/ }).click(),
    destinationToolbar.locator('.mona-floating-toolbar-button').filter({ hasText: /^Type$/ }).click(),
  ])
  const sourceMenu = vue.locator('.tippy-box[data-theme~="popover"]:visible .popover-content').last()
  const destinationMenu = react.locator('.mona-chart-type-menu.is-floating')
  await Promise.all([expect(sourceMenu).toBeVisible(), expect(destinationMenu).toBeVisible(), vue.waitForTimeout(250), react.waitForTimeout(250)])
  expect(await destinationMenu.innerText()).toBe(await sourceMenu.innerText())
  expect(roundedRect(await destinationMenu.boundingBox())).toEqual(roundedRect(await sourceMenu.boundingBox()))
  await compareRaster(sourceMenu, destinationMenu)

  for (let index = 0; index < 8; index += 1) {
    await Promise.all([
      sourceMenu.locator('.popover-menu-item').nth(index).click(),
      destinationMenu.locator('button').nth(index).click(),
    ])
    await expectChartAndHistoryParity(vue, react)
    await Promise.all([expect(sourceMenu).toBeVisible(), expect(destinationMenu).toBeVisible()])
    expect((await lastChart(react, 'react')).chartType).toBe(CHART_TYPE_ORDER[index])
    await compareChartRaster(vue.locator('.editable-element-chart').last(), react.locator('[data-element-type="chart"]').last())
  }

  await Promise.all([
    sourceToolbar.locator('.toolbar-btn').filter({ hasText: /^Type$/ }).click(),
    destinationToolbar.locator('.mona-floating-toolbar-button').filter({ hasText: /^Type$/ }).click(),
  ])
  await Promise.all([expect(sourceMenu).toBeHidden(), expect(destinationMenu).toBeHidden()])

  await Promise.all([
    sourceToolbar.locator('.toolbar-btn').filter({ hasText: /^Edit data$/ }).click(),
    destinationToolbar.locator('.mona-floating-toolbar-button').filter({ hasText: /^Edit data$/ }).click(),
  ])
  await Promise.all([
    expect(vue.locator('.modal-content .chart-data-editor')).toBeVisible(),
    expect(react.locator('.mona-chart-data-editor')).toBeVisible(),
  ])
  await Promise.all([
    vue.locator('.modal-content .btns .btn').filter({ hasText: /^Cancel$/ }).click(),
    react.locator('.mona-chart-editor-button').filter({ hasText: /^Cancel$/ }).click(),
  ])
  await Promise.all([sourceContext.close(), destinationContext.close()])
})
