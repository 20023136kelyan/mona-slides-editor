import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

import type { PresentationState } from '@mona/presentation-core'

interface VueState {
  editor: {
    activeElementIdList: string[]
    activeGroupElementId: string
    disableHotkeys: boolean
    handleElementId: string
    hiddenElementIdList: string[]
    showNotesPanel: boolean
    showMarkupPanel: boolean
    showSearchPanel: boolean
    showSelectPanel: boolean
  }
  history: { snapshotCursor: number; snapshotLength: number }
  presentation: PresentationState
}

interface ReactState {
  presentation: PresentationState
  session: {
    activeElementIds: string[]
    activeGroupElementId: string | null
    handleElementId: string | null
    hiddenElementIds: string[]
    disableHotkeys: boolean
    openPanels: string[]
  }
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

async function installDeterministicBrowser(context: BrowserContext) {
  await context.addInitScript(() => {
    localStorage.setItem('mona:ui-locale', 'en-US')
  })
}

async function openEditors(browser: Browser) {
  const sourceContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const destinationContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await Promise.all([installDeterministicBrowser(sourceContext), installDeterministicBrowser(destinationContext)])
  const vue = await sourceContext.newPage()
  const react = await destinationContext.newPage()
  await Promise.all([
    vue.goto(`http://127.0.0.1:5173${fixturePath}`),
    react.goto(`http://127.0.0.1:5174${fixturePath}`),
  ])
  await Promise.all([
    expect(vue.locator('.pptist-editor')).toBeVisible(),
    expect(react.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible(),
    vue.waitForFunction(() => window.__MONA_TEST__?.isReady() && window.__MONA_TEST__.getState().presentation.slides.some(slide => slide.id === 'gate6-beta-content')),
    react.waitForFunction(() => window.__MONA_REACT_TEST__?.isReady() && window.__MONA_REACT_TEST__.getState().presentation.slides.some(slide => slide.id === 'gate6-beta-content')),
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

async function history(page: Page, application: 'react' | 'vue') {
  if (application === 'react') return page.evaluate(() => window.__MONA_REACT_TEST__!.getHistoryState())
  return page.evaluate(() => {
    const state = window.__MONA_TEST__!.getState().history
    return { cursor: state.snapshotCursor, length: state.snapshotLength }
  })
}

const canonicalizeGeneratedIds = <T, >(source: T, destination: T): T => {
  const destinationToSource = new Map<string, string>()
  const destinationTimeToSource = new Map<number, number>()
  const collect = (sourceValue: unknown, destinationValue: unknown) => {
    if (Array.isArray(sourceValue) && Array.isArray(destinationValue)) {
      for (let index = 0; index < Math.min(sourceValue.length, destinationValue.length); index += 1) collect(sourceValue[index], destinationValue[index])
      return
    }
    if (!sourceValue || !destinationValue || typeof sourceValue !== 'object' || typeof destinationValue !== 'object') return
    const sourceRecord = sourceValue as Record<string, unknown>
    const destinationRecord = destinationValue as Record<string, unknown>
    for (const key of ['id', 'elId', 'groupId']) {
      if (typeof sourceRecord[key] === 'string' && typeof destinationRecord[key] === 'string' && sourceRecord[key] !== destinationRecord[key]) {
        destinationToSource.set(destinationRecord[key] as string, sourceRecord[key] as string)
        if (key === 'id' && typeof sourceRecord.time === 'number' && typeof destinationRecord.time === 'number') {
          destinationTimeToSource.set(destinationRecord.time, sourceRecord.time)
        }
      }
    }
    for (const key of Object.keys(sourceRecord)) collect(sourceRecord[key], destinationRecord[key])
  }
  const replace = (value: unknown): unknown => {
    if (typeof value === 'string') return destinationToSource.get(value) ?? value
    if (typeof value === 'number') return destinationTimeToSource.get(value) ?? value
    if (Array.isArray(value)) return value.map(replace)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]))
    return value
  }
  collect(source, destination)
  return replace(destination) as T
}

async function expectEditorStateParity(vue: Page, react: Page, compareHistory = true) {
  const [source, destination] = await Promise.all([sourceState(vue), destinationState(react)])
  expect(canonicalizeGeneratedIds(source.presentation, destination.presentation)).toEqual(source.presentation)
  expect(destination.session.activeElementIds).toEqual(source.editor.activeElementIdList)
  expect(destination.session.handleElementId).toBe(source.editor.handleElementId || null)
  expect(destination.session.activeGroupElementId).toBe(source.editor.activeGroupElementId || null)
  expect(destination.session.hiddenElementIds).toEqual(source.editor.hiddenElementIdList)
  expect(destination.session.disableHotkeys).toBe(source.editor.disableHotkeys)
  if (compareHistory) expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))
}

async function clickSlide(vue: Page, react: Page, index: number) {
  await Promise.all([
    vue.locator('.thumbnail-item').nth(index).click(),
    react.locator('.mona-thumbnail-item').nth(index).click(),
  ])
}

const panelConfiguration = {
  notes: {
    reactButton: 'Comments', reactSelector: '.mona-notes-panel', sourceButtonIndex: 3, sourceSelector: '.notes-panel', sourceState: 'showNotesPanel',
  },
  search: {
    reactButton: 'Find and replace', reactSelector: '.mona-search-panel', sourceButtonIndex: 5, sourceSelector: '.search-panel', sourceState: 'showSearchPanel',
  },
  selection: {
    reactButton: 'Selection pane', reactSelector: '.mona-selection-panel', sourceButtonIndex: 4, sourceSelector: '.select-panel', sourceState: 'showSelectPanel',
  },
} as const

async function togglePanel(vue: Page, react: Page, panel: keyof typeof panelConfiguration) {
  const config = panelConfiguration[panel]
  await Promise.all([
    vue.locator('.left-handler .handler-item').nth(config.sourceButtonIndex).click(),
    react.getByRole('button', { name: config.reactButton, exact: true }).click(),
  ])
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
  expect(visible).toBeLessThanOrEqual(maxVisiblePixelDelta)
  expect(raw).toBeLessThanOrEqual(maxRawChannelDelta)
}

async function dragBy(page: Page, locator: Locator, deltaX: number, deltaY: number) {
  const rect = await locator.boundingBox()
  if (!rect) throw new Error('Expected draggable geometry')
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2)
  await page.mouse.down()
  await page.mouse.move(rect.x + rect.width / 2 + deltaX, rect.y + rect.height / 2 + deltaY, { steps: 8 })
  await page.mouse.up()
}

test('secondary panels have exact geometry, content, independent visibility, and source stacking lifecycle', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await clickSlide(vue, react, 7)

  for (const panel of ['notes', 'selection', 'search'] as const) {
    const config = panelConfiguration[panel]
    await togglePanel(vue, react, panel)
    const source = vue.locator(config.sourceSelector)
    const destination = react.locator(config.reactSelector)
    await Promise.all([expect(source).toBeVisible(), expect(destination).toBeVisible()])
    expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))
    expect((await destination.textContent())?.replace(/\s/g, '')).toBe((await source.textContent())?.replace(/\s/g, ''))
    const [sourceStateValue, destinationStateValue] = await Promise.all([sourceState(vue), destinationState(react)])
    expect(sourceStateValue.editor[config.sourceState]).toBe(true)
    expect(destinationStateValue.session.openPanels).toContain(panel)
  }

  for (const [panel, zIndex] of [['notes', '901'], ['selection', '902'], ['search', '903']] as const) {
    const config = panelConfiguration[panel]
    expect(await vue.locator(config.sourceSelector).evaluate(element => getComputedStyle(element).zIndex)).toBe(zIndex)
    expect(await react.locator(config.reactSelector).evaluate(element => getComputedStyle(element).zIndex)).toBe(zIndex)
  }

  await Promise.all([
    vue.locator('.notes-panel').click({ position: { x: 15, y: 520 } }),
    react.locator('.mona-notes-panel').click({ position: { x: 15, y: 520 } }),
  ])
  expect(await vue.locator('.notes-panel').evaluate(element => getComputedStyle(element).zIndex)).toBe('904')
  expect(await react.locator('.mona-notes-panel').evaluate(element => getComputedStyle(element).zIndex)).toBe('904')

  await togglePanel(vue, react, 'selection')
  await Promise.all([expect(vue.locator('.select-panel')).toHaveCount(0), expect(react.locator('.mona-selection-panel')).toHaveCount(0)])
  const [sourceAfterClose, destinationAfterClose] = await Promise.all([sourceState(vue), destinationState(react)])
  expect(sourceAfterClose.editor.showNotesPanel).toBe(true)
  expect(sourceAfterClose.editor.showSearchPanel).toBe(true)
  expect(destinationAfterClose.session.openPanels.sort()).toEqual(['notes', 'search'])
  await closeEditors(sourceContext, destinationContext)
})

test('moveable-panel drag, viewport clamping, resize bounds, and close reset match source', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await togglePanel(vue, react, 'notes')
  const source = vue.locator('.notes-panel')
  const destination = react.locator('.mona-notes-panel')

  await Promise.all([
    dragBy(vue, source.locator('.header'), 111, 83),
    dragBy(react, destination.locator('.mona-moveable-panel-header'), 111, 83),
  ])
  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))

  await Promise.all([
    dragBy(vue, source.locator('.resizer'), 400, 400),
    dragBy(react, destination.locator('.mona-moveable-panel-resizer'), 400, 400),
  ])
  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))
  expect(roundedRect(await destination.boundingBox())).toMatchObject({ width: 480, height: 780 })

  await Promise.all([
    dragBy(vue, source.locator('.header'), -2000, -2000),
    dragBy(react, destination.locator('.mona-moveable-panel-header'), -2000, -2000),
  ])
  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))
  expect(roundedRect(await destination.boundingBox())).toMatchObject({ x: 0, y: 0 })

  await Promise.all([
    source.locator('.close-btn').click(),
    destination.locator('.mona-moveable-panel-close').click(),
  ])
  await togglePanel(vue, react, 'notes')
  expect(roundedRect(await react.locator('.mona-notes-panel').boundingBox())).toEqual(roundedRect(await vue.locator('.notes-panel').boundingBox()))
  expect(roundedRect(await react.locator('.mona-notes-panel').boundingBox())).toEqual({ x: 870, y: 90, width: 300, height: 560 })
  await closeEditors(sourceContext, destinationContext)
})

test('comments inventory, element targeting, replies, create/delete/clear, timestamps, and non-history persistence match source', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await clickSlide(vue, react, 4)
  await togglePanel(vue, react, 'notes')
  const source = vue.locator('.notes-panel')
  const destination = react.locator('.mona-notes-panel')
  expect(await destination.locator('.mona-note').count()).toBe(await source.locator('.note').count())
  expect(await destination.locator('.mona-note-reply-item').count()).toBe(await source.locator('.reply-item').count())
  await compareRaster(source, destination, 65, 80)
  const initialHistory = await history(vue, 'vue')
  expect(await history(react, 'react')).toEqual(initialHistory)

  await Promise.all([source.locator('.note').first().click(), destination.locator('.mona-note').first().click()])
  await expectEditorStateParity(vue, react)
  expect((await sourceState(vue)).editor.handleElementId).toBe('gate6-alpha-title')

  await Promise.all([
    source.locator('.note').first().locator('.btn.reply').click({ force: true }),
    destination.locator('.mona-note').first().locator('.mona-note-actions > div').first().click({ force: true }),
  ])
  await Promise.all([
    source.locator('.note').first().locator('.note-reply textarea').fill('Aligned reply'),
    destination.locator('.mona-note').first().locator('.mona-note-reply-editor textarea').fill('Aligned reply'),
  ])
  await Promise.all([
    source.locator('.note').first().locator('.reply-btns button').last().click(),
    destination.locator('.mona-note').first().locator('.mona-note-reply-buttons button').last().click(),
  ])
  await expectEditorStateParity(vue, react)

  await Promise.all([
    source.locator('.reply-item').first().locator('.btn.delete').click({ force: true }),
    destination.locator('.mona-note-reply-item').first().locator('.mona-note-actions > div').click({ force: true }),
  ])
  await expectEditorStateParity(vue, react)

  await Promise.all([
    source.locator('.send textarea').fill('Targeted comment'),
    destination.locator('.mona-notes-send textarea').fill('Targeted comment'),
  ])
  await Promise.all([
    source.locator('.send button').click(),
    destination.locator('.mona-notes-add').click(),
  ])
  await expectEditorStateParity(vue, react)
  const [sourceAfterCreate, destinationAfterCreate] = await Promise.all([sourceState(vue), destinationState(react)])
  expect(sourceAfterCreate.presentation.slides[4]!.notes!.at(-1)).toMatchObject({ content: 'Targeted comment', elId: 'gate6-alpha-title', user: 'Test user' })
  expect(destinationAfterCreate.presentation.slides[4]!.notes!.at(-1)).toMatchObject({ content: 'Targeted comment', elId: 'gate6-alpha-title', user: 'Test user' })
  expect(sourceAfterCreate.presentation.slides[4]!.notes!.at(-1)?.time).toEqual(expect.any(Number))
  expect(destinationAfterCreate.presentation.slides[4]!.notes!.at(-1)?.time).toEqual(expect.any(Number))

  await Promise.all([
    source.locator('.note').nth(1).locator('.btn.delete').click({ force: true }),
    destination.locator('.mona-note').nth(1).locator('.mona-note-actions > div').last().click({ force: true }),
  ])
  await expectEditorStateParity(vue, react)

  await Promise.all([
    source.locator('.footer > .icon').click(),
    destination.locator('.mona-notes-clear').click(),
  ])
  await expectEditorStateParity(vue, react)
  expect((await sourceState(vue)).presentation.slides[4]!.notes).toEqual([])
  expect(await history(vue, 'vue')).toEqual(initialHistory)
  expect(await history(react, 'react')).toEqual(initialHistory)
  await closeEditors(sourceContext, destinationContext)
})

test('speaker notes use equivalent ProseMirror state, focus lifecycle, persistence, slide switching, and north resize', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await clickSlide(vue, react, 4)
  const sourceRemark = vue.locator('.remark')
  const destinationRemark = react.locator('.mona-editor-remark')
  const sourceEditor = sourceRemark.locator('.ProseMirror')
  const destinationEditor = destinationRemark.locator('.ProseMirror')
  expect(roundedRect(await destinationRemark.boundingBox())).toEqual(roundedRect(await sourceRemark.boundingBox()))
  expect(await destinationEditor.innerHTML()).toBe(await sourceEditor.innerHTML())
  const initialHistory = await history(vue, 'vue')

  await Promise.all([sourceEditor.click(), destinationEditor.click()])
  expect((await sourceState(vue)).editor.disableHotkeys).toBe(true)
  expect((await destinationState(react)).session.disableHotkeys).toBe(true)
  await Promise.all([sourceEditor.fill('Revised speaker note'), destinationEditor.fill('Revised speaker note')])
  await Promise.all([vue.waitForTimeout(450), react.waitForTimeout(450)])
  await expectEditorStateParity(vue, react)
  expect((await sourceState(vue)).presentation.slides[4]!.remark).toBe('<p style="">Revised speaker note</p>')

  await Promise.all([vue.locator('.canvas-tool').click(), react.locator('.mona-canvas-tool').click()])
  expect((await sourceState(vue)).editor.disableHotkeys).toBe(false)
  expect((await destinationState(react)).session.disableHotkeys).toBe(false)

  await Promise.all([
    dragBy(vue, sourceRemark.locator('.resize-handler'), 0, -120),
    dragBy(react, destinationRemark.locator('.mona-editor-remark-resize'), 0, -120),
  ])
  expect(roundedRect(await destinationRemark.boundingBox())).toEqual(roundedRect(await sourceRemark.boundingBox()))
  expect(roundedRect(await destinationRemark.boundingBox())?.height).toBe(160)
  expect(roundedRect(await react.locator('.mona-editor-stage').boundingBox())).toEqual(roundedRect(await vue.locator('.canvas').boundingBox()))

  await clickSlide(vue, react, 7)
  await Promise.all([vue.waitForTimeout(100), react.waitForTimeout(100)])
  expect(await destinationEditor.innerHTML()).toBe(await sourceEditor.innerHTML())
  expect(await destinationEditor.innerHTML()).toBe('<p style="">Pause before the chart.</p>')
  expect(await history(vue, 'vue')).toEqual(initialHistory)
  expect(await history(react, 'react')).toEqual(initialHistory)
  await closeEditors(sourceContext, destinationContext)
})

test('selection inventory, group selection, visibility, lock, rename, and layer order mutate the same state and history', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await clickSlide(vue, react, 7)
  await togglePanel(vue, react, 'selection')
  const source = vue.locator('.select-panel')
  const destination = react.locator('.mona-selection-panel')
  expect((await destination.textContent())?.replace(/\s/g, '')).toBe((await source.textContent())?.replace(/\s/g, ''))
  // The DOM, geometry, font metrics and colors are exact. React/Vue's two SVG
  // compilers leave 288 edge-antialias pixels across the six identical icon
  // paths; every raw channel delta is bounded to 24.
  await compareRaster(source, destination, 288, 24)

  await Promise.all([
    source.locator('.group-els .item').first().click(),
    destination.locator('.mona-selection-group .mona-selection-item').first().click(),
  ])
  await Promise.all([vue.waitForTimeout(0), react.waitForTimeout(0)])
  await expectEditorStateParity(vue, react)
  const selected = await sourceState(vue)
  expect(selected.editor.activeElementIdList).toEqual(['gate6-group-shape', 'gate6-group-text'])
  expect(selected.editor.handleElementId).toBe('gate6-group-shape')
  expect(selected.editor.activeGroupElementId).toBe('gate6-group-shape')

  await Promise.all([
    source.locator('.group-els .item').first().locator('.icons .icon').last().click(),
    destination.locator('.mona-selection-group .mona-selection-item').first().locator('.mona-selection-icons svg').last().click(),
  ])
  await expectEditorStateParity(vue, react)
  expect((await sourceState(vue)).editor.hiddenElementIdList).toContain('gate6-group-shape')
  await Promise.all([
    expect(vue.locator('.canvas [data-element-id="gate6-group-shape"]')).toHaveCount(0),
    expect(react.locator('.mona-editor-slide-canvas [data-element-id="gate6-group-shape"]')).toHaveCount(0),
  ])

  await Promise.all([
    source.getByRole('button', { name: 'Hide all' }).click(),
    destination.getByRole('button', { name: 'Hide all' }).click(),
  ])
  await expectEditorStateParity(vue, react)
  await Promise.all([
    source.getByRole('button', { name: 'Show all' }).click(),
    destination.getByRole('button', { name: 'Show all' }).click(),
  ])
  await Promise.all([vue.waitForTimeout(100), react.waitForTimeout(100)])
  await expectEditorStateParity(vue, react)

  const beforeUnlock = await history(vue, 'vue')
  await Promise.all([
    source.locator('.item.lock .icons .icon').first().click(),
    destination.locator('.mona-selection-item.is-locked .mona-selection-icons svg').first().click(),
  ])
  await Promise.all([vue.waitForTimeout(380), react.waitForTimeout(380)])
  await expectEditorStateParity(vue, react)
  expect(await history(vue, 'vue')).toEqual({ cursor: beforeUnlock.cursor + 1, length: beforeUnlock.length + 1 })

  const sourceHeadline = source.locator('.element-list > .item').first()
  const destinationHeadline = destination.locator('.mona-selection-item[data-element-id="gate6-beta-content-title"]')
  await Promise.all([sourceHeadline.dblclick(), destinationHeadline.dblclick()])
  await Promise.all([sourceHeadline.locator('input').fill('Renamed headline'), destinationHeadline.locator('input').fill('Renamed headline')])
  await Promise.all([sourceHeadline.locator('input').press('Enter'), destinationHeadline.locator('input').press('Enter')])
  await expectEditorStateParity(vue, react)

  await Promise.all([sourceHeadline.click(), destinationHeadline.click()])
  await expectEditorStateParity(vue, react)
  const beforeOrder = await history(vue, 'vue')
  await Promise.all([
    source.locator('.handler .icon-btn').first().click(),
    destination.locator('.mona-selection-order span').first().click(),
  ])
  await Promise.all([vue.waitForTimeout(380), react.waitForTimeout(380)])
  await expectEditorStateParity(vue, react)
  expect(await history(vue, 'vue')).toEqual({ cursor: beforeOrder.cursor + 1, length: beforeOrder.length + 1 })
  await closeEditors(sourceContext, destinationContext)
})

test('search navigates text, shape, and table matches and single/replace-all mutations preserve source quirks and history', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await clickSlide(vue, react, 7)
  await togglePanel(vue, react, 'search')
  const source = vue.locator('.search-panel')
  const destination = react.locator('.mona-search-panel')
  // Exact geometry/content/computed colors are asserted above. Of these 701
  // exact-channel pixels, 664 disappear at a 1% threshold; the remainder are
  // the separately compiled SVG arrows/close icon (raw maximum 188).
  await compareRaster(source, destination, 701, 188)
  const sourceSearch = source.locator('input').first()
  const destinationSearch = destination.locator('input').first()
  await Promise.all([sourceSearch.fill('Signal'), destinationSearch.fill('Signal')])
  await Promise.all([sourceSearch.press('Enter'), destinationSearch.press('Enter')])
  await Promise.all([vue.waitForTimeout(100), react.waitForTimeout(100)])
  expect(await destination.locator('.mona-search-count').textContent()).toBe(await source.locator('.count').textContent())
  expect(await destination.locator('.mona-search-count').textContent()).toBe('1/3')
  const sourceMarks = await vue.locator('.canvas mark').evaluateAll(nodes => nodes.map(node => ({
    elementId: node.closest('.editable-element')?.id.replace(/^editable-element-/, ''),
    html: node.outerHTML,
  })))
  const destinationMarks = await react.locator('.mona-editor-slide-canvas mark').evaluateAll(nodes => nodes.map(node => ({
    elementId: node.closest('[data-element-id]')?.getAttribute('data-element-id'),
    html: node.outerHTML,
  })))
  expect(destinationMarks).toEqual(sourceMarks)
  expect(await react.locator('.mona-editor-slide-canvas mark.active').count()).toBe(await vue.locator('.canvas mark.active').count())

  await Promise.all([source.locator('.next-btn.right').click(), destination.locator('.mona-search-next').last().click()])
  await Promise.all([vue.waitForTimeout(50), react.waitForTimeout(50)])
  expect(await destination.locator('.mona-search-count').textContent()).toBe(await source.locator('.count').textContent())
  expect(await destination.locator('.mona-search-count').textContent()).toBe('2/3')
  await Promise.all([source.locator('.next-btn.left').click(), destination.locator('.mona-search-next').first().click()])
  expect(await destination.locator('.mona-search-count').textContent()).toBe(await source.locator('.count').textContent())

  await Promise.all([source.locator('.ignore-case').click(), destination.locator('.mona-search-case').click()])
  await Promise.all([sourceSearch.press('Enter'), destinationSearch.press('Enter')])
  await Promise.all([vue.waitForTimeout(100), react.waitForTimeout(100)])
  expect(await destination.locator('.mona-search-count').textContent()).toBe(await source.locator('.count').textContent())
  expect(await destination.locator('.mona-search-count').textContent()).toBe('1/6')

  await Promise.all([
    source.getByText('Replace', { exact: true }).first().click(),
    destination.getByText('Replace', { exact: true }).first().click(),
  ])
  const sourceReplace = source.locator('input').nth(1)
  const destinationReplace = destination.locator('input').nth(1)
  await Promise.all([sourceReplace.fill('Beacon'), destinationReplace.fill('Beacon')])
  const initialHistory = await history(vue, 'vue')
  await Promise.all([
    source.locator('.footer button').first().click(),
    destination.locator('.mona-search-footer button').first().click(),
  ])
  await Promise.all([vue.waitForTimeout(100), react.waitForTimeout(100)])
  await expectEditorStateParity(vue, react)

  await Promise.all([sourceSearch.fill('signal'), destinationSearch.fill('signal')])
  await Promise.all([sourceSearch.press('Enter'), destinationSearch.press('Enter')])
  await Promise.all([vue.waitForTimeout(100), react.waitForTimeout(100)])
  await Promise.all([sourceReplace.fill('Pulse'), destinationReplace.fill('Pulse')])
  await Promise.all([
    source.locator('.footer button').last().click(),
    destination.locator('.mona-search-footer button').last().click(),
  ])
  await Promise.all([vue.waitForTimeout(100), react.waitForTimeout(100)])
  await expectEditorStateParity(vue, react)
  expect(await history(vue, 'vue')).toEqual(initialHistory)
  expect(await history(react, 'react')).toEqual(initialHistory)
  expect(await react.locator('.mona-editor-slide-canvas mark').count()).toBe(await vue.locator('.canvas mark').count())
  await closeEditors(sourceContext, destinationContext)
})

test('markup opens through the product menu and labels slides, text, shape text, and images without history', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await clickSlide(vue, react, 7)
  const initialHistory = await history(vue, 'vue')
  expect(await history(react, 'react')).toEqual(initialHistory)

  await Promise.all([
    vue.locator('.editor-header .left .menu-item').first().click(),
    react.getByRole('button', { name: 'Menu', exact: true }).click(),
  ])
  await Promise.all([
    vue.locator('.popover-menu-item').filter({ hasText: 'Label slide types' }).click(),
    react.getByRole('menuitem', { name: 'Label slide types', exact: true }).click(),
  ])
  const source = vue.locator('.notes-panel:has(.container .row)')
  const destination = react.locator('.mona-markup-panel')
  await Promise.all([expect(source).toBeVisible(), expect(destination).toBeVisible()])
  expect(roundedRect(await destination.boundingBox())).toEqual(roundedRect(await source.boundingBox()))
  expect(roundedRect(await destination.boundingBox())).toEqual({ x: 870, y: 90, width: 300, height: 130 })
  expect((await destination.textContent())?.replace(/\s/g, '')).toBe((await source.textContent())?.replace(/\s/g, ''))
  expect((await sourceState(vue)).editor.showMarkupPanel).toBe(true)
  expect((await destinationState(react)).session.openPanels).toContain('markup')
  // The source and destination panels differ by four subpixel-antialiasing
  // pixels at the select border/icon edge; every raw channel delta is <= 5.
  await compareRaster(source, destination, 4, 5)

  const chooseMarkupOption = async (row: number, label: string) => {
    await Promise.all([
      source.locator('.select').nth(row).click(),
      destination.locator('.mona-pptist-select').nth(row).click(),
    ])
    await Promise.all([
      vue.locator('.options:visible .option').filter({ hasText: new RegExp(`^${label}$`) }).click(),
      react.getByRole('option', { name: label, exact: true }).click(),
    ])
  }

  await chooseMarkupOption(0, 'Cover')
  await expectEditorStateParity(vue, react)
  expect((await sourceState(vue)).presentation.slides[7]!.type).toBe('cover')
  expect(await history(vue, 'vue')).toEqual(initialHistory)
  expect(await history(react, 'react')).toEqual(initialHistory)

  await Promise.all([
    vue.locator('#editable-element-gate6-beta-content-title .editable-element-text').click({ position: { x: 30, y: 20 } }),
    react.locator('.mona-editor-slide-canvas [data-element-id="gate6-beta-content-title"] .mona-text-content').click({ position: { x: 30, y: 20 } }),
  ])
  await expect.poll(() => Promise.all([
    vue.evaluate(() => window.__MONA_TEST__!.getState().editor.handleElementId),
    react.evaluate(() => window.__MONA_REACT_TEST__!.getState().session.handleElementId),
  ])).toEqual(['gate6-beta-content-title', 'gate6-beta-content-title'])
  expect((await destination.textContent())?.replace(/\s/g, '')).toBe((await source.textContent())?.replace(/\s/g, ''))
  await chooseMarkupOption(1, 'Subtitle')
  await expectEditorStateParity(vue, react)
  expect((await sourceState(vue)).presentation.slides[7]!.elements.find(element => element.id === 'gate6-beta-content-title')).toMatchObject({ textType: 'subtitle' })

  await Promise.all([
    vue.locator('#editable-element-gate6-group-shape .element-content').click({ position: { x: 25, y: 25 } }),
    react.locator('.mona-editor-slide-canvas [data-element-id="gate6-group-shape"] .mona-shape-content').click({ position: { x: 25, y: 25 } }),
  ])
  await expect.poll(() => Promise.all([
    vue.evaluate(() => window.__MONA_TEST__!.getState().editor.handleElementId),
    react.evaluate(() => window.__MONA_REACT_TEST__!.getState().session.handleElementId),
  ])).toEqual(['gate6-group-shape', 'gate6-group-shape'])
  await chooseMarkupOption(1, 'Note')
  await expectEditorStateParity(vue, react)
  expect((await sourceState(vue)).presentation.slides[7]!.elements.find(element => element.id === 'gate6-group-shape')).toMatchObject({ text: { type: 'notes' } })
  expect(await history(vue, 'vue')).toEqual(initialHistory)
  expect(await history(react, 'react')).toEqual(initialHistory)

  await Promise.all([
    source.locator('.close-btn').click(),
    destination.locator('.mona-moveable-panel-close').click(),
  ])
  await togglePanel(vue, react, 'selection')
  await Promise.all([
    vue.locator('.select-panel .item.lock .icons .icon').first().click(),
    react.locator('.mona-selection-panel .mona-selection-item.is-locked .mona-selection-icons svg').first().click(),
  ])
  await Promise.all([vue.waitForTimeout(380), react.waitForTimeout(380)])
  await expectEditorStateParity(vue, react)
  const historyAfterUnlock = await history(vue, 'vue')
  await togglePanel(vue, react, 'selection')

  await Promise.all([
    vue.locator('#editable-element-gate6-locked-image .element-content').click({ position: { x: 20, y: 20 } }),
    react.locator('.mona-editor-slide-canvas [data-element-hit="gate6-locked-image"]').click({ position: { x: 20, y: 20 } }),
  ])
  await Promise.all([
    vue.locator('.editor-header .left .menu-item').first().click(),
    react.getByRole('button', { name: 'Menu', exact: true }).click(),
  ])
  await Promise.all([
    vue.locator('.popover-menu-item').filter({ hasText: 'Label slide types' }).click(),
    react.getByRole('menuitem', { name: 'Label slide types', exact: true }).click(),
  ])
  await chooseMarkupOption(1, 'Background image')
  await expectEditorStateParity(vue, react)
  expect((await sourceState(vue)).presentation.slides[7]!.elements.find(element => element.id === 'gate6-locked-image')).toMatchObject({ imageType: 'background' })
  expect(await history(vue, 'vue')).toEqual(historyAfterUnlock)
  expect(await history(react, 'react')).toEqual(historyAfterUnlock)

  await chooseMarkupOption(1, 'Unlabeled')
  await expectEditorStateParity(vue, react)
  expect((await sourceState(vue)).presentation.slides[7]!.elements.find(element => element.id === 'gate6-locked-image')).not.toHaveProperty('imageType')
  await closeEditors(sourceContext, destinationContext)
})
