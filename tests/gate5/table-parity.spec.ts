import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import CryptoJS from 'crypto-js'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import type { PPTElement, PPTTableElement } from '@mona/presentation-core/model'

interface BridgeState {
  presentation: { slideIndex: number; slides: Array<{ elements: PPTElement[] }> }
}

declare global {
  interface Window {
    __MONA_TEST__?: { getState: () => BridgeState & { editor: { activeElementIdList: string[]; disableHotkeys: boolean; selectedTableCells: string[] }; history: { snapshotCursor: number; snapshotLength: number } }; isReady: () => boolean }
    __MONA_REACT_TEST__?: { getHistoryState: () => { cursor: number; length: number }; getState: () => BridgeState & { session: { activeElementIds: string[]; disableHotkeys: boolean; selectedTableCells: string[] } }; isReady: () => boolean }
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
  const diff = new PNG({ height: expected.height, width: expected.width })
  const visiblePixelDelta = pixelmatch(expected.data, actual.data, diff.data, expected.width, expected.height, { threshold: 0 })
  let rawChannelDelta = 0
  for (let index = 0; index < expected.data.length; index += 1) rawChannelDelta = Math.max(rawChannelDelta, Math.abs(expected.data[index]! - actual.data[index]!))
  expect(visiblePixelDelta).toBeLessThanOrEqual(maxVisiblePixelDelta)
  expect(rawChannelDelta).toBeLessThanOrEqual(maxRawChannelDelta)
}

async function openTableGenerator(vue: Page, react: Page) {
  await vue.locator('.canvas-tool .insert-handler-item').filter({ hasText: /Table/ }).click()
  await react.locator('.mona-canvas-insert-item').filter({ hasText: /Table/ }).click()
  await Promise.all([
    expect(vue.locator('.tippy-box:visible .table-generator')).toBeVisible(),
    expect(react.locator('.mona-table-generator')).toBeVisible(),
    vue.waitForTimeout(350),
    react.waitForTimeout(350),
  ])
}

const normalizeIds = <T, >(value: T): T => {
  if (Array.isArray(value)) return value.map(normalizeIds) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'id').map(([key, nested]) => [key, normalizeIds(nested)])) as T
  }
  return value
}

async function lastTable(page: Page, app: 'react' | 'vue') {
  return page.evaluate(appName => {
    const state = appName === 'vue' ? window.__MONA_TEST__!.getState() : window.__MONA_REACT_TEST__!.getState()
    const elements = state.presentation.slides[state.presentation.slideIndex]!.elements
    return structuredClone([...elements].reverse().find((element): element is PPTTableElement => element.type === 'table')!)
  }, app)
}

async function history(page: Page, app: 'react' | 'vue') {
  if (app === 'react') return page.evaluate(() => window.__MONA_REACT_TEST__!.getHistoryState())
  return page.evaluate(() => {
    const state = window.__MONA_TEST__!.getState().history
    return { cursor: state.snapshotCursor, length: state.snapshotLength }
  })
}

async function expectTableAndHistoryParity(vue: Page, react: Page) {
  await Promise.all([vue.waitForTimeout(450), react.waitForTimeout(450)])
  expect(normalizeIds(await lastTable(react, 'react'))).toEqual(normalizeIds(await lastTable(vue, 'vue')))
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))
}

async function tableSelection(page: Page, app: 'react' | 'vue') {
  return page.evaluate(appName => {
    return appName === 'vue' ? window.__MONA_TEST__!.getState().editor.selectedTableCells : window.__MONA_REACT_TEST__!.getState().session.selectedTableCells
  }, app)
}

async function createAndEditTable(vue: Page, react: Page, gridCell = 22) {
  await openTableGenerator(vue, react)
  await Promise.all([
    vue.locator('.tippy-box:visible .table-generator td').nth(gridCell).click(),
    react.locator('.mona-table-generator td').nth(gridCell).click(),
  ])
  const sourceTable = vue.locator('.editable-element-table').last()
  const destinationTable = react.locator('[data-element-type="table"]').last()
  await Promise.all([sourceTable.locator('.table-mask').dblclick(), destinationTable.locator('.mona-table-mask').dblclick()])
  return { destinationTable, sourceTable }
}

async function dragCellSelection(page: Page, start: Locator, end: Locator) {
  const [startBox, endBox] = await Promise.all([start.boundingBox(), end.boundingBox()])
  expect(startBox).not.toBeNull()
  expect(endBox).not.toBeNull()
  await page.mouse.move(startBox!.x + startBox!.width / 2, startBox!.y + startBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(endBox!.x + endBox!.width / 2, endBox!.y + endBox!.height / 2, { steps: 4 })
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

async function placeCaret(locator: Locator, offset: number) {
  await locator.evaluate((element, caretOffset) => {
    const target = element as HTMLDivElement
    target.focus()
    const selection = window.getSelection()!
    const range = document.createRange()
    const node = target.firstChild ?? target
    range.setStart(node, Math.min(caretOffset, node.textContent?.length ?? 0))
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  }, offset)
}

test('table generator matches source geometry, hover matrix, custom mode, creation state, and history', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const { react, vue } = await openEditors(context)
  await openTableGenerator(vue, react)
  const source = vue.locator('.tippy-box:visible .table-generator')
  const destination = react.locator('.mona-table-generator')
  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))
  expect(await destination.locator('td').count()).toBe(100)
  expect(await destination.locator('td').count()).toBe(await source.locator('td').count())
  await Promise.all([source.locator('td').nth(23).hover(), destination.locator('td').nth(23).hover()])
  expect(await destination.locator('.mona-table-generator-title').textContent()).toBe(await source.locator('.title').textContent())
  expect(await destination.locator('td > .is-active').count()).toBe(await source.locator('td > .cell.active').count())
  await compareRaster(source, destination)
  await Promise.all([source.locator('td').nth(23).click(), destination.locator('td').nth(23).click()])
  await Promise.all([vue.waitForTimeout(450), react.waitForTimeout(450)])
  expect(normalizeIds(await lastTable(react, 'react'))).toEqual(normalizeIds(await lastTable(vue, 'vue')))
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))
  const sourceCreated = vue.locator('.editable-element-table').last()
  const destinationCreated = react.locator('[data-element-type="table"]').last()
  expect(roundedRect(await destinationCreated.boundingBox())).toEqual(roundedRect(await sourceCreated.boundingBox()))
  await compareRaster(sourceCreated, destinationCreated)

  await openTableGenerator(vue, react)
  await Promise.all([
    vue.locator('.tippy-box:visible .table-generator .title .right').click(),
    react.locator('.mona-table-generator-title button').click(),
  ])
  expect(roundedRect(await react.locator('.mona-table-generator-custom').boundingBox())).toEqual(roundedRect(await vue.locator('.tippy-box:visible .table-generator .custom').boundingBox()))
  expect(await react.locator('.mona-table-generator-custom input').count()).toBe(await vue.locator('.tippy-box:visible .table-generator .custom input').count())
  const sourceInputs = vue.locator('.tippy-box:visible .table-generator .custom input')
  const destinationInputs = react.locator('.mona-table-generator-custom input')
  await Promise.all([sourceInputs.nth(0).fill('2'), destinationInputs.nth(0).fill('2')])
  await Promise.all([sourceInputs.nth(1).fill('4'), destinationInputs.nth(1).fill('4')])
  await Promise.all([
    vue.locator('.tippy-box:visible .table-generator .btns .btn').filter({ hasText: /Confirm/ }).click(),
    react.locator('.mona-table-generator-actions button').filter({ hasText: /Confirm/ }).click(),
  ])
  await Promise.all([vue.waitForTimeout(450), react.waitForTimeout(450)])
  expect(normalizeIds(await lastTable(react, 'react'))).toEqual(normalizeIds(await lastTable(vue, 'vue')))
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))
  await context.close()
})

test('table edit entry, cell selection, text input, keyboard structure commands, and exit match source state', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  const { destinationTable, sourceTable } = await createAndEditTable(vue, react)
  await Promise.all([
    expect(sourceTable.locator('.editable-table')).toBeVisible(),
    expect(destinationTable.locator('.mona-static-table.is-editable')).toBeVisible(),
  ])
  expect(await vue.evaluate(() => window.__MONA_TEST__!.getState().editor.disableHotkeys)).toBe(true)
  expect(await react.evaluate(() => window.__MONA_REACT_TEST__!.getState().session.disableHotkeys)).toBe(true)

  await Promise.all([
    sourceTable.locator('td.cell').first().click(),
    destinationTable.locator('td.mona-table-cell').first().click(),
  ])
  await Promise.all([
    sourceTable.locator('.cell-text.active').fill('Revenue'),
    destinationTable.locator('.mona-table-cell-text.is-active').fill('Revenue'),
  ])
  await Promise.all([vue.waitForTimeout(450), react.waitForTimeout(450)])
  expect(normalizeIds(await lastTable(react, 'react'))).toEqual(normalizeIds(await lastTable(vue, 'vue')))
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))

  await Promise.all([vue.keyboard.press('Control+ArrowDown'), react.keyboard.press('Control+ArrowDown')])
  await Promise.all([vue.waitForTimeout(450), react.waitForTimeout(450)])
  expect(normalizeIds(await lastTable(react, 'react'))).toEqual(normalizeIds(await lastTable(vue, 'vue')))

  await Promise.all([
    vue.locator('.canvas').click({ position: { x: 30, y: 30 } }),
    react.getByRole('application', { name: 'Editable slide canvas' }).click({ position: { x: 30, y: 30 } }),
  ])
  expect(await vue.evaluate(() => window.__MONA_TEST__!.getState().editor.disableHotkeys)).toBe(false)
  expect(await react.evaluate(() => window.__MONA_REACT_TEST__!.getState().session.disableHotkeys)).toBe(false)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('table paste expansion, rectangular selection, delete, context inventory, merge, split, and row selection match source', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  const { destinationTable, sourceTable } = await createAndEditTable(vue, react)
  const sourceCells = sourceTable.locator('td.cell')
  const destinationCells = destinationTable.locator('td.mona-table-cell')
  await Promise.all([sourceCells.nth(8).click(), destinationCells.nth(8).click()])
  await Promise.all([
    sourceTable.locator('.cell-text.active').evaluate(element => {
      const clipboardData = new DataTransfer()
      clipboardData.setData('text/plain', 'A\tB\r\nC\tD\r\n')
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }))
    }),
    destinationTable.locator('.mona-table-cell-text.is-active').evaluate(element => {
      const clipboardData = new DataTransfer()
      clipboardData.setData('text/plain', 'A\tB\r\nC\tD\r\n')
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }))
    }),
  ])
  await Promise.all([vue.waitForTimeout(450), react.waitForTimeout(450)])
  expect(normalizeIds(await lastTable(react, 'react'))).toEqual(normalizeIds(await lastTable(vue, 'vue')))
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))

  await Promise.all([
    dragCellSelection(vue, sourceCells.nth(0), sourceCells.nth(5)),
    dragCellSelection(react, destinationCells.nth(0), destinationCells.nth(5)),
  ])
  expect(await tableSelection(react, 'react')).toEqual(await tableSelection(vue, 'vue'))
  expect(await tableSelection(react, 'react')).toEqual(['0_0', '0_1', '1_0', '1_1'])
  await Promise.all([vue.keyboard.press('Delete'), react.keyboard.press('Delete')])
  await Promise.all([vue.waitForTimeout(450), react.waitForTimeout(450)])
  expect(normalizeIds(await lastTable(react, 'react'))).toEqual(normalizeIds(await lastTable(vue, 'vue')))
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))

  await Promise.all([sourceCells.nth(0).click({ button: 'right' }), destinationCells.nth(0).click({ button: 'right' })])
  const sourceMenu = vue.locator('.contextmenu')
  const destinationMenu = react.locator('.mona-editor-context-menu')
  await Promise.all([expect(sourceMenu).toBeVisible(), expect(destinationMenu).toBeVisible()])
  const sourceLabels = await sourceMenu.locator(':scope > .menu-content > .menu-item > .menu-item-content > .text').allTextContents()
  const destinationLabels = await destinationMenu.locator(':scope > .mona-context-menu-content > .mona-context-menu-entry > .mona-context-menu-item-content > .mona-context-menu-label').allTextContents()
  expect(destinationLabels).toEqual(sourceLabels)
  expect(roundedRect(await destinationMenu.boundingBox())).toEqual(roundedRect(await sourceMenu.boundingBox()))
  await compareRaster(sourceMenu, destinationMenu)
  await Promise.all([
    sourceMenu.locator(':scope > .menu-content > .menu-item').filter({ hasText: /^Merge cells$/ }).click(),
    destinationMenu.locator('[data-action="table-merge"]').click(),
  ])
  await Promise.all([vue.waitForTimeout(450), react.waitForTimeout(450)])
  expect(normalizeIds(await lastTable(react, 'react'))).toEqual(normalizeIds(await lastTable(vue, 'vue')))
  expect(await tableSelection(react, 'react')).toEqual(await tableSelection(vue, 'vue'))

  await Promise.all([
    sourceCells.first().click({ button: 'right', position: { x: 10, y: 10 } }),
    destinationCells.first().click({ button: 'right', position: { x: 10, y: 10 } }),
  ])
  await Promise.all([
    vue.locator('.contextmenu > .menu-content > .menu-item').filter({ hasText: /^Unmerge cells$/ }).click(),
    react.locator('.mona-editor-context-menu [data-action="table-split"]').click(),
  ])
  await Promise.all([vue.waitForTimeout(450), react.waitForTimeout(450)])
  expect(normalizeIds(await lastTable(react, 'react'))).toEqual(normalizeIds(await lastTable(vue, 'vue')))

  await Promise.all([
    sourceCells.first().click({ button: 'right', position: { x: 10, y: 10 } }),
    destinationCells.first().click({ button: 'right', position: { x: 10, y: 10 } }),
  ])
  await Promise.all([
    vue.locator('.contextmenu > .menu-content > .menu-item').filter({ hasText: /^Select current row$/ }).click(),
    react.locator('.mona-editor-context-menu [data-action="table-select-row"]').click(),
  ])
  expect(await tableSelection(react, 'react')).toEqual(await tableSelection(vue, 'vue'))
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('table inspector matches source inventory, geometry, raster, style transactions, structural commands, and theme state', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  await openTableGenerator(vue, react)
  await Promise.all([
    vue.locator('.tippy-box:visible .table-generator td').nth(22).click(),
    react.locator('.mona-table-generator td').nth(22).click(),
  ])
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  const sourcePanel = vue.locator('.table-style-panel')
  const destinationPanel = react.locator('.mona-table-style-panel')
  await Promise.all([expect(sourcePanel).toBeVisible(), expect(destinationPanel).toBeVisible()])
  expect(roundedRect(await destinationPanel.boundingBox())).toEqual(roundedRect(await sourcePanel.boundingBox()))
  // React's accessible switch is a button and its number input exposes two
  // native handler buttons; PPTist implements those three controls as spans.
  expect(await destinationPanel.locator('button').count()).toBe((await sourcePanel.locator('button').count()) + 3)
  // The panel itself is exact; 27 subpixel antialias samples (maximum channel
  // delta 2) remain only on the separately rendered inspector clipping edge.
  await compareRaster(sourcePanel, destinationPanel, 27, 2)

  await Promise.all([
    sourcePanel.locator('button.checkbox').nth(0).click(),
    destinationPanel.getByRole('button', { name: 'Bold' }).click(),
  ])
  await Promise.all([vue.waitForTimeout(450), react.waitForTimeout(450)])
  expect(normalizeIds(await lastTable(react, 'react'))).toEqual(normalizeIds(await lastTable(vue, 'vue')))
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))

  await Promise.all([
    sourcePanel.locator('.row').filter({ hasText: /^Rows:/ }).locator('button').first().click(),
    destinationPanel.getByRole('button', { name: 'Add row', exact: true }).click(),
  ])
  await Promise.all([vue.waitForTimeout(450), react.waitForTimeout(450)])
  expect(normalizeIds(await lastTable(react, 'react'))).toEqual(normalizeIds(await lastTable(vue, 'vue')))

  await Promise.all([
    sourcePanel.locator('.theme-switch .switch').click(),
    destinationPanel.getByRole('switch', { name: 'Use table theme:' }).click(),
  ])
  await Promise.all([vue.waitForTimeout(450), react.waitForTimeout(450)])
  expect(normalizeIds(await lastTable(react, 'react'))).toEqual(normalizeIds(await lastTable(vue, 'vue')))
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('every table inspector text, alignment, outline, and theme control produces source-identical cell state and history', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  vue.setDefaultTimeout(5_000)
  react.setDefaultTimeout(5_000)
  const { destinationTable, sourceTable } = await createAndEditTable(vue, react)
  await Promise.all([
    sourceTable.locator('td.cell').nth(4).click(),
    destinationTable.locator('td.mona-table-cell').nth(4).click(),
  ])
  const sourcePanel = vue.locator('.table-style-panel')
  const destinationPanel = react.locator('.mona-table-style-panel')

  for (const [index, label] of [[0, 'Inter'], [1, '20px']] as const) {
    await Promise.all([
      sourcePanel.locator('.select').nth(index).click(),
      destinationPanel.locator('.mona-panel-select').nth(index).click(),
    ])
    await Promise.all([
      vue.locator('.tippy-box[data-theme~="popover"]:visible .option').filter({ hasText: new RegExp(`^${label}$`) }).last().click(),
      react.locator('.mona-panel-select-popover').getByRole('button', { name: label, exact: true }).click(),
    ])
    await expectTableAndHistoryParity(vue, react)
  }

  const sourceButtons = sourcePanel.locator('button.button')
  for (const [sourceIndex, destinationName] of [
    [2, 'Bold'],
    [3, 'Italic'],
    [4, 'Underline'],
    [5, 'Strikethrough'],
    [6, 'Align left'],
    [7, 'Center'],
    [8, 'Align right'],
    [9, 'Justify'],
    [10, 'Align top'],
    [11, 'Center vertically'],
    [12, 'Align bottom'],
  ] as const) {
    await Promise.all([
      sourceButtons.nth(sourceIndex).click(),
      destinationPanel.getByRole('button', { name: destinationName, exact: true }).click(),
    ])
    await expectTableAndHistoryParity(vue, react)
  }

  for (const [sourceIndex, destinationName, sourceColorIndex, destinationColor] of [
    [0, 'Text color', 5, '#e2534d'],
    [1, 'Cell fill', 3, '#1e497b'],
  ] as const) {
    await Promise.all([
      sourceButtons.nth(sourceIndex).click(),
      destinationPanel.getByRole('button', { name: destinationName, exact: true }).click(),
    ])
    await Promise.all([
      vue.locator('.tippy-box[data-theme~="popover"]:visible .picker-presets').first().locator('.picker-presets-color').nth(sourceColorIndex).click(),
      react.getByRole('button', { name: `Select color ${destinationColor}` }).click(),
    ])
    await expectTableAndHistoryParity(vue, react)
    await Promise.all([sourceButtons.nth(sourceIndex).click(), destinationPanel.getByRole('button', { name: destinationName, exact: true }).click()])
  }

  await Promise.all([
    sourcePanel.locator('.element-outline .select').click(),
    destinationPanel.getByRole('button', { name: 'Border style' }).click(),
  ])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .option').nth(2).click(),
    react.locator('.mona-panel-select-popover').getByRole('button', { name: 'Dotted' }).click(),
  ])
  await expectTableAndHistoryParity(vue, react)
  await Promise.all([
    sourcePanel.locator('.element-outline .row').nth(1).locator('.color-btn').click(),
    destinationPanel.getByRole('button', { name: 'Border color' }).click(),
  ])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .picker-presets').first().locator('.picker-presets-color').nth(3).click(),
    react.getByRole('button', { name: 'Select color #1e497b' }).click(),
  ])
  await expectTableAndHistoryParity(vue, react)
  await Promise.all([
    sourcePanel.locator('.element-outline .row').nth(1).locator('.color-btn').click(),
    destinationPanel.getByRole('button', { name: 'Border color' }).click(),
  ])
  await Promise.all([
    sourcePanel.locator('.element-outline .number-input input').fill('6'),
    destinationPanel.getByRole('textbox', { name: 'Border width' }).fill('6'),
  ])
  await Promise.all([
    sourcePanel.locator('.element-outline .number-input input').press('Enter'),
    destinationPanel.getByRole('textbox', { name: 'Border width' }).press('Enter'),
  ])
  await Promise.all([
    sourcePanel.locator('.element-outline .number-input input').blur(),
    destinationPanel.getByRole('textbox', { name: 'Border width' }).blur(),
  ])
  await expectTableAndHistoryParity(vue, react)

  const sourceThemeChecks = sourcePanel.locator('label.checkbox')
  const destinationThemeChecks = destinationPanel.locator('label.mona-panel-checkbox')
  for (let index = 0; index < 4; index += 1) {
    await Promise.all([sourceThemeChecks.nth(index).click(), destinationThemeChecks.nth(index).click()])
    await expectTableAndHistoryParity(vue, react)
  }
  await Promise.all([
    sourcePanel.locator('button.color-btn').last().click(),
    destinationPanel.getByRole('button', { name: 'Theme color:' }).click(),
  ])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .picker-presets').first().locator('.picker-presets-color').nth(5).click(),
    react.getByRole('button', { name: 'Select color #e2534d' }).click(),
  ])
  await expectTableAndHistoryParity(vue, react)
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('every table cell context structural command and merged-axis deletion branch matches source state, selection, and history', async ({ browser }) => {
  test.slow()
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  vue.setDefaultTimeout(5_000)
  react.setDefaultTimeout(5_000)
  const { destinationTable, sourceTable } = await createAndEditTable(vue, react)
  const openMenu = async (cell: string) => {
    await Promise.all([
      sourceTable.locator(`td.cell[data-cell-index="${cell}"]`).click({ button: 'right', position: { x: 10, y: 10 } }),
      destinationTable.locator(`td.mona-table-cell[data-cell-index="${cell}"]`).click({ button: 'right', position: { x: 10, y: 10 } }),
    ])
    await Promise.all([expect(vue.locator('.contextmenu')).toBeVisible(), expect(react.locator('.mona-editor-context-menu')).toBeVisible()])
  }
  const clickSubcommand = async (rootIndex: number, childIndex: number) => {
    const sourceRoot = vue.locator('.contextmenu > .menu-content > .menu-item').nth(rootIndex)
    const destinationRoot = react.locator('.mona-editor-context-menu > .mona-context-menu-content > .mona-context-menu-entry').nth(rootIndex)
    await Promise.all([sourceRoot.hover(), destinationRoot.hover()])
    await Promise.all([
      sourceRoot.locator('.sub-menu > .menu-item').nth(childIndex).click(),
      destinationRoot.locator('.mona-editor-context-submenu > .mona-context-menu-entry').nth(childIndex).click(),
    ])
    await expectTableAndHistoryParity(vue, react)
  }

  await openMenu('1_1')
  await clickSubcommand(0, 0)
  await openMenu('1_1')
  await clickSubcommand(0, 1)
  await openMenu('1_1')
  await clickSubcommand(1, 0)
  await openMenu('1_1')
  await clickSubcommand(1, 1)
  await openMenu('1_1')
  await Promise.all([
    vue.locator('.contextmenu > .menu-content > .menu-item').filter({ hasText: /^Delete column$/ }).click(),
    react.locator('.mona-editor-context-menu [data-action="table-delete-column"]').click(),
  ])
  await expectTableAndHistoryParity(vue, react)
  await openMenu('1_1')
  await Promise.all([
    vue.locator('.contextmenu > .menu-content > .menu-item').filter({ hasText: /^Delete row$/ }).click(),
    react.locator('.mona-editor-context-menu [data-action="table-delete-row"]').click(),
  ])
  await expectTableAndHistoryParity(vue, react)

  // Merge a vertical 2×1 range, then delete its second row through a visible
  // neighboring cell. This executes PPTist's hidden-cell rowspan repair path.
  await Promise.all([
    dragCellSelection(vue, sourceTable.locator('[data-cell-index="0_0"]'), sourceTable.locator('[data-cell-index="1_0"]')),
    dragCellSelection(react, destinationTable.locator('[data-cell-index="0_0"]'), destinationTable.locator('[data-cell-index="1_0"]')),
  ])
  await openMenu('0_0')
  await Promise.all([
    vue.locator('.contextmenu > .menu-content > .menu-item').filter({ hasText: /^Merge cells$/ }).click(),
    react.locator('.mona-editor-context-menu [data-action="table-merge"]').click(),
  ])
  await expectTableAndHistoryParity(vue, react)
  await openMenu('1_1')
  await Promise.all([
    vue.locator('.contextmenu > .menu-content > .menu-item').filter({ hasText: /^Delete row$/ }).click(),
    react.locator('.mona-editor-context-menu [data-action="table-delete-row"]').click(),
  ])
  await expectTableAndHistoryParity(vue, react)

  // Repeat horizontally so deleting the covered column exercises colspan
  // owner repair rather than only the ordinary splice branch.
  await Promise.all([
    dragCellSelection(vue, sourceTable.locator('[data-cell-index="0_0"]'), sourceTable.locator('[data-cell-index="0_1"]')),
    dragCellSelection(react, destinationTable.locator('[data-cell-index="0_0"]'), destinationTable.locator('[data-cell-index="0_1"]')),
  ])
  await openMenu('0_0')
  await Promise.all([
    vue.locator('.contextmenu > .menu-content > .menu-item').filter({ hasText: /^Merge cells$/ }).click(),
    react.locator('.mona-editor-context-menu [data-action="table-merge"]').click(),
  ])
  await expectTableAndHistoryParity(vue, react)
  await openMenu('1_1')
  await Promise.all([
    vue.locator('.contextmenu > .menu-content > .menu-item').filter({ hasText: /^Delete column$/ }).click(),
    react.locator('.mona-editor-context-menu [data-action="table-delete-column"]').click(),
  ])
  await expectTableAndHistoryParity(vue, react)
  expect(await tableSelection(react, 'react')).toEqual(await tableSelection(vue, 'vue'))
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('every table inspector row and column split-menu command matches source targeting and history', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  vue.setDefaultTimeout(5_000)
  react.setDefaultTimeout(5_000)
  await openTableGenerator(vue, react)
  await Promise.all([
    vue.locator('.tippy-box:visible .table-generator td').nth(22).click(),
    react.locator('.mona-table-generator td').nth(22).click(),
  ])
  const sourcePanel = vue.locator('.table-style-panel')
  const destinationPanel = react.locator('.mona-table-style-panel')
  let openAxis: 'column' | 'row' | null = null
  const run = async (axis: 'column' | 'row', option: string) => {
    if (openAxis && openAxis !== axis) {
      const currentSourceRow = sourcePanel.locator('.row').filter({ hasText: openAxis === 'row' ? /^Rows:/ : /^Columns:/ })
      await Promise.all([currentSourceRow.locator('.popover').click({ force: true }), react.keyboard.press('Escape')])
      await Promise.all([vue.waitForTimeout(250), react.waitForTimeout(250)])
    }
    const sourceRow = sourcePanel.locator('.row').filter({ hasText: axis === 'row' ? /^Rows:/ : /^Columns:/ })
    const sourceOption = vue.locator('.tippy-box[data-theme~="popover"]:visible .popover-menu-item').filter({ hasText: new RegExp(`^${option}$`) })
    const destinationOption = react.locator('.mona-panel-popover-content .mona-table-command-menu').getByRole('button', { name: option, exact: true })
    if (!await sourceOption.isVisible()) await sourceRow.locator('.popover').click()
    if (!await destinationOption.isVisible()) await destinationPanel.getByRole('button', { name: axis === 'row' ? 'Rows:' : 'Columns:' }).click()
    openAxis = axis
    await Promise.all([vue.waitForTimeout(250), react.waitForTimeout(250)])
    await Promise.all([
      sourceOption.click(),
      destinationOption.click(),
    ])
    await expectTableAndHistoryParity(vue, react)
  }
  await run('row', 'Add above')
  await run('row', 'Add below')
  await run('row', 'Delete row')
  await run('column', 'Add left')
  await run('column', 'Add right')
  await run('column', 'Delete column')
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('table column resize live geometry and committed model, Tab append, and floating toolbar inventory and commands match source', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  const { destinationTable, sourceTable } = await createAndEditTable(vue, react)
  const sourceDrag = sourceTable.locator('.drag-line').first()
  const destinationDrag = destinationTable.locator('.mona-table-column-drag-line').first()
  const [sourceBox, destinationBox] = await Promise.all([sourceDrag.boundingBox(), destinationDrag.boundingBox()])
  expect(roundedRect(destinationBox)).toEqual(roundedRect(sourceBox))
  await Promise.all([
    (async () => {
      await vue.mouse.move(sourceBox!.x + 1, sourceBox!.y + 10); await vue.mouse.down(); await vue.mouse.move(sourceBox!.x + 38, sourceBox!.y + 10) 
    })(),
    (async () => {
      await react.mouse.move(destinationBox!.x + 1, destinationBox!.y + 10); await react.mouse.down(); await react.mouse.move(destinationBox!.x + 38, destinationBox!.y + 10) 
    })(),
  ])
  expect(roundedRect(await destinationTable.locator('.mona-static-table').boundingBox())).toEqual(roundedRect(await sourceTable.locator('.editable-table').boundingBox()))
  await Promise.all([vue.mouse.up(), react.mouse.up()])
  await Promise.all([vue.waitForTimeout(450), react.waitForTimeout(450)])
  expect(normalizeIds(await lastTable(react, 'react'))).toEqual(normalizeIds(await lastTable(vue, 'vue')))
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))

  const sourceCells = sourceTable.locator('td.cell')
  const destinationCells = destinationTable.locator('td.mona-table-cell')
  await Promise.all([sourceCells.last().click(), destinationCells.last().click()])
  await Promise.all([vue.keyboard.press('Tab'), react.keyboard.press('Tab')])
  await Promise.all([vue.waitForTimeout(450), react.waitForTimeout(450)])
  expect(normalizeIds(await lastTable(react, 'react'))).toEqual(normalizeIds(await lastTable(vue, 'vue')))
  expect(await tableSelection(react, 'react')).toEqual(await tableSelection(vue, 'vue'))

  await Promise.all([
    vue.locator('.canvas').click({ position: { x: 30, y: 30 } }),
    react.getByRole('application', { name: 'Editable slide canvas' }).click({ position: { x: 30, y: 30 } }),
  ])
  await enableFloatingToolbar(vue, react)
  await Promise.all([sourceTable.locator('.table-mask').click(), destinationTable.locator('.mona-table-mask').click()])
  const sourceToolbar = vue.locator('.floating-toolbar')
  const destinationToolbar = react.locator('.mona-floating-table-toolbar')
  await Promise.all([expect(sourceToolbar).toBeVisible(), expect(destinationToolbar).toBeVisible()])
  expect(roundedRect(await destinationToolbar.boundingBox())).toEqual(roundedRect(await sourceToolbar.boundingBox()))
  expect(await destinationToolbar.locator('button').count()).toBe(await sourceToolbar.locator('button').count())
  await compareRaster(sourceToolbar, destinationToolbar)
  await Promise.all([
    sourceToolbar.locator('.toolbar-btn').filter({ hasText: /^Add$/ }).click(),
    destinationToolbar.getByRole('button', { name: 'Add' }).click(),
  ])
  await Promise.all([
    vue.locator('.tippy-box:visible .table-command-menu').locator('text=Insert row below').click(),
    react.locator('[data-radix-popper-content-wrapper] .mona-table-command-menu').locator('text=Insert row below').click(),
  ])
  await Promise.all([vue.waitForTimeout(450), react.waitForTimeout(450)])
  expect(normalizeIds(await lastTable(react, 'react'))).toEqual(normalizeIds(await lastTable(vue, 'vue')))
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('table plain text, HTML table, and encrypted PPTist clipboard branches match source state and history', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  const { destinationTable, sourceTable } = await createAndEditTable(vue, react)
  const paste = async (sourceCell: Locator, destinationCell: Locator, type: 'text/html' | 'text/plain', value: string) => {
    await Promise.all([sourceCell.click(), destinationCell.click()])
    await Promise.all([
      sourceTable.locator('.cell-text.active').evaluate((element, payload) => {
        const clipboardData = new DataTransfer()
        clipboardData.setData(payload.type, payload.value)
        element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }))
      }, { type, value }),
      destinationTable.locator('.mona-table-cell-text.is-active').evaluate((element, payload) => {
        const clipboardData = new DataTransfer()
        clipboardData.setData(payload.type, payload.value)
        element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }))
      }, { type, value }),
    ])
    await expectTableAndHistoryParity(vue, react)
  }

  await paste(
    sourceTable.locator('[data-cell-index="0_0"]'),
    destinationTable.locator('[data-cell-index="0_0"]'),
    'text/html',
    '<table><tr><th colspan="2">Header</th></tr><tr><td>A</td><td>B</td></tr></table>',
  )
  await paste(
    sourceTable.locator('[data-cell-index="2_2"]'),
    destinationTable.locator('[data-cell-index="2_2"]'),
    'text/plain',
    'Plain cell text',
  )

  // The source ignores any decrypted object here, not only known element and
  // slide payloads, so exercise the broader contract explicitly.
  const encryptedPayload = CryptoJS.AES.encrypt(JSON.stringify({ source: 'custom-clipboard-object' }), 'pptist').toString()
  const beforeSource = normalizeIds(await lastTable(vue, 'vue'))
  const beforeDestination = normalizeIds(await lastTable(react, 'react'))
  await paste(
    sourceTable.locator('[data-cell-index="1_1"]'),
    destinationTable.locator('[data-cell-index="1_1"]'),
    'text/plain',
    encryptedPayload,
  )
  expect(normalizeIds(await lastTable(vue, 'vue'))).toEqual(beforeSource)
  expect(normalizeIds(await lastTable(react, 'react'))).toEqual(beforeDestination)
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('all table Ctrl+arrow insertion and caret-boundary navigation branches match source', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  const { destinationTable, sourceTable } = await createAndEditTable(vue, react)
  const sourceCell = (key: string) => sourceTable.locator(`[data-cell-index="${key}"]`)
  const destinationCell = (key: string) => destinationTable.locator(`[data-cell-index="${key}"]`)

  await Promise.all([sourceCell('1_1').click(), destinationCell('1_1').click()])
  for (const key of ['Control+ArrowUp', 'Control+ArrowLeft', 'Control+ArrowRight', 'Control+ArrowDown']) {
    await Promise.all([vue.keyboard.press(key), react.keyboard.press(key)])
    await expectTableAndHistoryParity(vue, react)
  }

  await Promise.all([sourceCell('2_2').click(), destinationCell('2_2').click()])
  await Promise.all([
    sourceCell('2_2').locator('.cell-text').fill('XYZ'),
    destinationCell('2_2').locator('.mona-table-cell-text').fill('XYZ'),
  ])
  await expectTableAndHistoryParity(vue, react)
  for (const [key, offset] of [['ArrowUp', 0], ['ArrowDown', 3], ['ArrowLeft', 0], ['ArrowRight', 3]] as const) {
    await Promise.all([sourceCell('2_2').click(), destinationCell('2_2').click()])
    await Promise.all([
      placeCaret(sourceCell('2_2').locator('.cell-text.active'), offset),
      placeCaret(destinationCell('2_2').locator('.mona-table-cell-text.is-active'), offset),
    ])
    await Promise.all([vue.keyboard.press(key), react.keyboard.press(key)])
    expect(await tableSelection(react, 'react')).toEqual(await tableSelection(vue, 'vue'))
  }

  // A non-boundary caret must remain in the same cell.
  await Promise.all([sourceCell('2_2').click(), destinationCell('2_2').click()])
  await Promise.all([
    placeCaret(sourceCell('2_2').locator('.cell-text.active'), 1),
    placeCaret(destinationCell('2_2').locator('.mona-table-cell-text.is-active'), 1),
  ])
  await Promise.all([vue.keyboard.press('ArrowLeft'), react.keyboard.press('ArrowLeft')])
  expect(await tableSelection(react, 'react')).toEqual(await tableSelection(vue, 'vue'))
  expect(await tableSelection(react, 'react')).toEqual(['2_2'])

  // Merge horizontally, then enter its hidden coordinate from below. PPTist's
  // traversal falls back orthogonally to the visible merge owner; Tab must
  // subsequently skip the covered cell.
  await Promise.all([
    dragCellSelection(vue, sourceCell('0_0'), sourceCell('0_1')),
    dragCellSelection(react, destinationCell('0_0'), destinationCell('0_1')),
  ])
  await Promise.all([sourceCell('0_0').click({ button: 'right' }), destinationCell('0_0').click({ button: 'right' })])
  await Promise.all([
    vue.locator('.contextmenu > .menu-content > .menu-item').filter({ hasText: /^Merge cells$/ }).click(),
    react.locator('.mona-editor-context-menu [data-action="table-merge"]').click(),
  ])
  await expectTableAndHistoryParity(vue, react)
  await Promise.all([sourceCell('1_1').click(), destinationCell('1_1').click()])
  await Promise.all([
    placeCaret(sourceCell('1_1').locator('.cell-text.active'), 0),
    placeCaret(destinationCell('1_1').locator('.mona-table-cell-text.is-active'), 0),
  ])
  await Promise.all([vue.keyboard.press('ArrowUp'), react.keyboard.press('ArrowUp')])
  expect(await tableSelection(react, 'react')).toEqual(await tableSelection(vue, 'vue'))
  expect(await tableSelection(react, 'react')).toEqual(['0_0'])
  await Promise.all([vue.keyboard.press('Tab'), react.keyboard.press('Tab')])
  expect(await tableSelection(react, 'react')).toEqual(await tableSelection(vue, 'vue'))
  expect(await tableSelection(react, 'react')).toEqual(['0_2'])
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('table edit-mask and editable-table rasters plus last-axis warnings match source', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  await openTableGenerator(vue, react)
  await Promise.all([
    vue.locator('.tippy-box:visible .table-generator td').first().click(),
    react.locator('.mona-table-generator td').first().click(),
  ])
  const sourceTable = vue.locator('.editable-element-table').last()
  const destinationTable = react.locator('[data-element-type="table"]').last()
  const sourceMask = sourceTable.locator('.table-mask')
  const destinationMask = destinationTable.locator('.mona-table-mask')
  await Promise.all([sourceMask.hover(), destinationMask.hover(), vue.waitForTimeout(350), react.waitForTimeout(350)])
  expect(roundedRect(await destinationMask.boundingBox())).toEqual(roundedRect(await sourceMask.boundingBox()))
  await compareRaster(sourceMask, destinationMask)

  await Promise.all([sourceMask.dblclick(), destinationMask.dblclick()])
  const sourceEditable = sourceTable.locator('.editable-table')
  const destinationEditable = destinationTable.locator('.mona-static-table.is-editable')
  expect(roundedRect(await destinationEditable.boundingBox())).toEqual(roundedRect(await sourceEditable.boundingBox()))
  await compareRaster(sourceEditable, destinationEditable)

  const sourcePanel = vue.locator('.table-style-panel')
  const destinationPanel = react.locator('.mona-table-style-panel')
  const assertWarning = async (axis: 'column' | 'row') => {
    const sourceRow = sourcePanel.locator('.row').filter({ hasText: axis === 'row' ? /^Rows:/ : /^Columns:/ })
    await Promise.all([
      sourceRow.locator('.popover').click(),
      destinationPanel.getByRole('button', { name: axis === 'row' ? 'Rows:' : 'Columns:' }).click(),
    ])
    await Promise.all([
      vue.locator('.tippy-box[data-theme~="popover"]:visible .popover-menu-item').filter({ hasText: new RegExp(`^Delete ${axis}$`) }).click(),
      react.locator('.mona-panel-popover-content .mona-table-command-menu').getByRole('button', { name: axis === 'row' ? 'Delete row' : 'Delete column', exact: true }).click(),
    ])
    const sourceMessage = vue.locator('.message-container')
    const destinationMessage = react.locator('.mona-message-container')
    await Promise.all([expect(sourceMessage).toBeVisible(), expect(destinationMessage).toBeVisible()])
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    expect(await destinationMessage.textContent()).toBe(await sourceMessage.textContent())
    expect(roundedRect(await destinationMessage.boundingBox())).toEqual(roundedRect(await sourceMessage.boundingBox()))
    await compareRaster(sourceMessage, destinationMessage)
    expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))
    await Promise.all([vue.waitForTimeout(3100), react.waitForTimeout(3100)])
    await Promise.all([sourceRow.locator('.popover').click({ force: true }), react.keyboard.press('Escape')])
    await Promise.all([vue.waitForTimeout(250), react.waitForTimeout(250)])
  }
  await assertWarning('row')
  await assertWarning('column')
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('floating table color, border style, and every add control match source', async ({ browser }) => {
  test.slow()
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  vue.setDefaultTimeout(5_000)
  react.setDefaultTimeout(5_000)
  const { destinationTable, sourceTable } = await createAndEditTable(vue, react)
  await Promise.all([
    vue.locator('.canvas').click({ position: { x: 30, y: 30 } }),
    react.getByRole('application', { name: 'Editable slide canvas' }).click({ position: { x: 30, y: 30 } }),
  ])
  await enableFloatingToolbar(vue, react)
  await Promise.all([sourceTable.locator('.table-mask').click(), destinationTable.locator('.mona-table-mask').click()])
  const sourceToolbar = vue.locator('.floating-toolbar')
  const destinationToolbar = react.locator('.mona-floating-table-toolbar')

  await Promise.all([
    sourceToolbar.locator('.toolbar-btn').filter({ hasText: /^Fill$/ }).click(),
    destinationToolbar.getByRole('button', { name: 'Fill', exact: true }).click(),
  ])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .picker-presets').first().locator('.picker-presets-color').nth(3).click(),
    react.getByRole('button', { name: 'Select color #1e497b' }).click(),
  ])
  await expectTableAndHistoryParity(vue, react)
  await Promise.all([
    sourceToolbar.locator('.toolbar-btn').filter({ hasText: /^Fill$/ }).click({ force: true }),
    destinationToolbar.getByRole('button', { name: 'Fill', exact: true }).click({ force: true }),
  ])

  await Promise.all([
    sourceToolbar.locator('.toolbar-btn').filter({ hasText: /^Border$/ }).click(),
    destinationToolbar.getByRole('button', { name: 'Border', exact: true }).click(),
  ])
  const sourceBorderPanel = vue.locator('.tippy-box[data-theme~="popover"]:visible .border-popover')
  const destinationBorderPanel = react.locator('.mona-floating-border-panel')
  await Promise.all([expect(sourceBorderPanel).toBeVisible(), expect(destinationBorderPanel).toBeVisible()])
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  expect(roundedRect(await destinationBorderPanel.boundingBox())).toEqual(roundedRect(await sourceBorderPanel.boundingBox()))
  await compareRaster(sourceBorderPanel, destinationBorderPanel)

  await Promise.all([
    sourceBorderPanel.locator('.select').click(),
    destinationBorderPanel.getByRole('button', { name: 'Border style' }).click(),
  ])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .options .option').nth(2).click(),
    react.locator('.mona-panel-select-popover').getByRole('button', { name: 'Dotted' }).click(),
  ])
  await expectTableAndHistoryParity(vue, react)
  await Promise.all([expect(sourceBorderPanel).toBeHidden(), expect(destinationBorderPanel).toBeHidden()])
  await Promise.all([
    sourceToolbar.locator('.toolbar-btn').filter({ hasText: /^Border$/ }).click(),
    destinationToolbar.getByRole('button', { name: 'Border', exact: true }).click(),
  ])
  await Promise.all([
    sourceBorderPanel.locator('.color-btn').click(),
    destinationBorderPanel.getByRole('button', { name: 'Border color' }).click(),
  ])
  await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"]:visible .picker-presets').first().locator('.picker-presets-color').nth(5).click(),
    react.getByRole('button', { name: 'Select color #e2534d' }).click(),
  ])
  await expectTableAndHistoryParity(vue, react)
  await Promise.all([expect(sourceBorderPanel).toBeHidden(), expect(destinationBorderPanel).toBeHidden()])

  await Promise.all([
    sourceToolbar.locator('.toolbar-btn').filter({ hasText: /^Add$/ }).click(),
    destinationToolbar.getByRole('button', { name: 'Add', exact: true }).click(),
  ])
  for (const label of ['Insert row above', 'Insert row below', 'Insert column left', 'Insert column right']) {
    await Promise.all([
      vue.locator('.tippy-box:visible .table-command-menu').getByText(label, { exact: true }).click(),
      react.locator('[data-radix-popper-content-wrapper] .mona-table-command-menu').getByRole('button', { name: label, exact: true }).click(),
    ])
    await expectTableAndHistoryParity(vue, react)
  }
  await Promise.all([
    sourceToolbar.locator('.toolbar-btn').filter({ hasText: /^Add$/ }).click({ force: true }),
    react.keyboard.press('Escape'),
  ])
  await Promise.all([sourceContext.close(), destinationContext.close()])
})

test('floating table delete controls and last-axis warnings match source', async ({ browser }) => {
  test.slow()
  const { destinationContext, react, sourceContext, vue } = await openEditorsInSeparateContexts(browser)
  vue.setDefaultTimeout(5_000)
  react.setDefaultTimeout(5_000)
  const { destinationTable, sourceTable } = await createAndEditTable(vue, react, 11)
  await Promise.all([
    vue.locator('.canvas').click({ position: { x: 30, y: 30 } }),
    react.getByRole('application', { name: 'Editable slide canvas' }).click({ position: { x: 30, y: 30 } }),
  ])
  await enableFloatingToolbar(vue, react)
  await Promise.all([sourceTable.locator('.table-mask').click(), destinationTable.locator('.mona-table-mask').click()])
  const sourceToolbar = vue.locator('.floating-toolbar')
  const destinationToolbar = react.locator('.mona-floating-table-toolbar')
  await Promise.all([
    sourceToolbar.locator('.toolbar-btn').filter({ hasText: /^Delete$/ }).click(),
    destinationToolbar.getByRole('button', { name: 'Delete', exact: true }).click(),
  ])
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  const deleteAxis = async (axis: 'column' | 'row') => {
    const label = axis === 'row' ? 'Delete row' : 'Delete column'
    await Promise.all([
      vue.locator('.tippy-box:visible .table-command-menu').getByText(label, { exact: true }).click(),
      react.locator('[data-radix-popper-content-wrapper] .mona-table-command-menu').getByRole('button', { name: label, exact: true }).click(),
    ])
    await expectTableAndHistoryParity(vue, react)
  }
  await deleteAxis('row')
  await deleteAxis('column')

  const assertFloatingWarning = async (axis: 'column' | 'row') => {
    const label = axis === 'row' ? 'Delete row' : 'Delete column'
    const warningText = axis === 'row' ? 'A table must keep at least one row' : 'A table must keep at least one column'
    await Promise.all([
      vue.locator('.tippy-box:visible .table-command-menu').getByText(label, { exact: true }).click(),
      react.locator('[data-radix-popper-content-wrapper] .mona-table-command-menu').getByRole('button', { name: label, exact: true }).click(),
    ])
    const sourceMessage = vue.locator('.message-container').filter({ hasText: warningText })
    const destinationMessage = react.locator('.mona-message-container').filter({ hasText: warningText })
    await Promise.all([expect(sourceMessage).toBeVisible(), expect(destinationMessage).toBeVisible(), vue.waitForTimeout(350), react.waitForTimeout(350)])
    expect(await destinationMessage.textContent()).toBe(await sourceMessage.textContent())
    expect(roundedRect(await destinationMessage.boundingBox())).toEqual(roundedRect(await sourceMessage.boundingBox()))
    await compareRaster(sourceMessage, destinationMessage)
    expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))
    await Promise.all([vue.waitForTimeout(3100), react.waitForTimeout(3100)])
  }
  await assertFloatingWarning('row')
  await assertFloatingWarning('column')
  await Promise.all([sourceContext.close(), destinationContext.close()])
})
