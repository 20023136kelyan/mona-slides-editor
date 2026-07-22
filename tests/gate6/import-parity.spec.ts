import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import CryptoJS from 'crypto-js'
import pptxgen from 'pptxgenjs'

import type { PresentationState } from '@mona/presentation-core'

interface VueState {
  history: { snapshotCursor: number; snapshotLength: number }
  presentation: PresentationState
}

interface ReactState { presentation: PresentationState }

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
  await Promise.all([vue.goto(`http://127.0.0.1:5173${fixturePath}`), react.goto(`http://127.0.0.1:5174${fixturePath}`)])
  await Promise.all([
    vue.waitForFunction(() => window.__MONA_TEST__?.isReady()),
    react.waitForFunction(() => window.__MONA_REACT_TEST__?.isReady()),
  ])
  return { destinationContext, react, sourceContext, vue }
}

async function closeEditors(sourceContext: BrowserContext, destinationContext: BrowserContext) {
  await Promise.all([sourceContext.close(), destinationContext.close()])
}

async function state(page: Page, app: 'react' | 'vue') {
  return page.evaluate(name => structuredClone(name === 'vue' ? window.__MONA_TEST__!.getState().presentation : window.__MONA_REACT_TEST__!.getState().presentation), app)
}

async function history(page: Page, app: 'react' | 'vue') {
  if (app === 'react') return page.evaluate(() => window.__MONA_REACT_TEST__!.getHistoryState())
  return page.evaluate(() => {
    const value = window.__MONA_TEST__!.getState().history
    return { cursor: value.snapshotCursor, length: value.snapshotLength }
  })
}

const canonicalizeGeneratedIds = <T, >(source: T, destination: T): T => {
  const idMap = new Map<string, string>()
  const timeMap = new Map<number, number>()
  const collect = (expected: unknown, actual: unknown) => {
    if (Array.isArray(expected) && Array.isArray(actual)) {
      for (let index = 0; index < Math.min(expected.length, actual.length); index += 1) collect(expected[index], actual[index])
      return
    }
    if (!expected || !actual || typeof expected !== 'object' || typeof actual !== 'object') return
    const left = expected as Record<string, unknown>
    const right = actual as Record<string, unknown>
    for (const key of ['id', 'elId', 'groupId']) {
      if (typeof left[key] === 'string' && typeof right[key] === 'string' && left[key] !== right[key]) {
        idMap.set(right[key] as string, left[key] as string)
        if (key === 'id' && typeof left.time === 'number' && typeof right.time === 'number') timeMap.set(right.time, left.time)
      }
    }
    for (const key of Object.keys(left)) collect(left[key], right[key])
  }
  const replace = (value: unknown): unknown => {
    if (typeof value === 'string') return idMap.get(value) ?? value
    if (typeof value === 'number') return timeMap.get(value) ?? value
    if (Array.isArray(value)) return value.map(replace)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]))
    return value
  }
  collect(source, destination)
  return replace(destination) as T
}

async function expectStateParity(vue: Page, react: Page) {
  await Promise.all([vue.waitForTimeout(380), react.waitForTimeout(380)])
  const [source, destination] = await Promise.all([state(vue, 'vue'), state(react, 'react')])
  expect(canonicalizeGeneratedIds(source, destination)).toEqual(source)
  expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))
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
}

async function importFile(vue: Page, react: Page, index: number, file: { buffer: Buffer; mimeType: string; name: string }) {
  await openMainMenu(vue, react)
  await Promise.all([
    vue.locator('.tippy-content:visible input[type="file"]').nth(index).setInputFiles(file),
    react.locator('.mona-editor-main-menu input[type="file"]').nth(index).setInputFiles(file),
  ])
}

async function reset(vue: Page, react: Page) {
  await openMainMenu(vue, react)
  await Promise.all([
    vue.locator('.tippy-content:visible .popover-menu-item').nth(1).click(),
    react.locator('.mona-editor-main-menu .mona-header-popover-menu-item').nth(1).click(),
  ])
  await Promise.all([
    vue.waitForFunction(() => window.__MONA_TEST__!.getState().presentation.slides.length === 1),
    react.waitForFunction(() => window.__MONA_REACT_TEST__!.getState().presentation.slides.length === 1),
  ])
}

test('JSON append remaps the complete imported graph and preserves source title, theme, viewport, focus, and history', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const initial = await state(vue, 'vue')
  const slide = structuredClone(initial.slides[7]!)
  slide.id = 'json-import-slide'
  for (let index = 0; index < slide.elements.length; index += 1) slide.elements[index]!.id = `json-import-element-${index}`
  const payload = JSON.stringify({
    height: 600,
    slides: [slide],
    theme: { ...initial.theme, backgroundColor: '#123456' },
    title: 'Ignored append title',
    width: 800,
  })
  await importFile(vue, react, 1, { buffer: Buffer.from(payload), mimeType: 'application/json', name: 'append.json' })
  await Promise.all([
    vue.waitForFunction(length => window.__MONA_TEST__!.getState().presentation.slides.length === length, initial.slides.length + 1),
    react.waitForFunction(length => window.__MONA_REACT_TEST__!.getState().presentation.slides.length === length, initial.slides.length + 1),
  ])
  await expectStateParity(vue, react)
  const imported = await state(react, 'react')
  expect(imported.title).toBe(initial.title)
  expect(imported.theme).toEqual(initial.theme)
  expect(imported.viewportSize).toBe(initial.viewportSize)
  expect(imported.viewportRatio).toBe(initial.viewportRatio)
  await closeEditors(sourceContext, destinationContext)
})

test('JSON empty-deck replacement applies theme and viewport but preserves the existing source title', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const initial = await state(vue, 'vue')
  const slide = structuredClone(initial.slides[0]!)
  slide.id = 'json-cover-slide'
  const theme = { ...initial.theme, backgroundColor: '#234567', fontColor: '#abcdef' }
  await reset(vue, react)
  const payload = JSON.stringify({ height: 750, slides: [slide], theme, title: 'Not adopted without cover', width: 1000 })
  await importFile(vue, react, 1, { buffer: Buffer.from(payload), mimeType: 'application/json', name: 'replace.json' })
  await Promise.all([
    vue.waitForFunction(() => window.__MONA_TEST__!.getState().presentation.slides[0]?.id === 'json-cover-slide'),
    react.waitForFunction(() => window.__MONA_REACT_TEST__!.getState().presentation.slides[0]?.id === 'json-cover-slide'),
  ])
  await expectStateParity(vue, react)
  const imported = await state(react, 'react')
  expect(imported.title).toBe(initial.title)
  expect(imported.theme).toEqual(theme)
  expect(imported.viewportSize).toBe(1000)
  expect(imported.viewportRatio).toBe(0.75)
  await closeEditors(sourceContext, destinationContext)
})

test('native PPTIST decryption and append behavior match source exactly', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const initial = await state(vue, 'vue')
  const slide = structuredClone(initial.slides[1]!)
  slide.id = 'native-import-slide'
  const json = JSON.stringify({ height: 562.5, slides: [slide], theme: initial.theme, title: 'Native title', width: 1000 })
  const encrypted = CryptoJS.AES.encrypt(json, 'pptist').toString()
  await importFile(vue, react, 2, { buffer: Buffer.from(encrypted), mimeType: 'application/octet-stream', name: 'native.pptist' })
  await Promise.all([
    vue.waitForFunction(length => window.__MONA_TEST__!.getState().presentation.slides.length === length, initial.slides.length + 1),
    react.waitForFunction(length => window.__MONA_REACT_TEST__!.getState().presentation.slides.length === length, initial.slides.length + 1),
  ])
  await expectStateParity(vue, react)
  await closeEditors(sourceContext, destinationContext)
})

async function createPptxFixture() {
  const pptx = new pptxgen()
  pptx.layout = 'LAYOUT_WIDE'
  const slide = pptx.addSlide()
  slide.background = { color: 'F4F1EA' }
  slide.addText('Imported deck', { bold: true, color: '24364B', fontFace: 'Arial', fontSize: 28, h: 0.5, w: 4, x: 0.5, y: 0.35 })
  slide.addShape(pptx.ShapeType.roundRect, { fill: { color: '72DCA4' }, h: 1.2, line: { color: '11745B', pt: 1.5 }, radius: 0.12, rotate: 12, w: 2.4, x: 0.8, y: 1.4 })
  slide.addTable([
    [{ options: { bold: true, fill: 'DCE8F4' }, text: 'Stage' }, { options: { bold: true, fill: 'DCE8F4' }, text: 'Value' }],
    ['Build', '64'],
  ], { border: { color: '52708D', pt: 1 }, colW: [1.2, 1.2], h: 1.2, w: 2.4, x: 3.7, y: 1.35 })
  slide.addChart(pptx.ChartType.bar, [
    { labels: ['Plan', 'Build', 'Ship'], name: 'North', values: [18, 42, 67] },
    { labels: ['Plan', 'Build', 'Ship'], name: 'South', values: [12, 36, 58] },
  ], { catAxisLabelColor: '24364B', chartColors: ['2D7FF9', 'F1A33C'], h: 2.7, legendPos: 'b', showLegend: true, showTitle: false, valAxisLabelColor: '24364B', w: 5.7, x: 6.3, y: 1.1 })
  slide.addNotes('Imported speaker note')
  const output = await pptx.write({ outputType: 'arraybuffer' })
  return Buffer.from(output as ArrayBuffer)
}

test('real PPTX parsing, loading lifecycle, parser degradation, notes, viewport, state, and history match source', async ({ browser }) => {
  test.setTimeout(60_000)
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const initial = await state(vue, 'vue')
  const buffer = await createPptxFixture()
  await Promise.all([
    vue.evaluate(() => {
      (window as unknown as { __IMPORT_SPIN_OBSERVED__: boolean }).__IMPORT_SPIN_OBSERVED__ = false
      new MutationObserver(() => {
        if (document.querySelector('.fullscreen-spin')) (window as unknown as { __IMPORT_SPIN_OBSERVED__: boolean }).__IMPORT_SPIN_OBSERVED__ = true
      }).observe(document.body, { childList: true, subtree: true })
    }),
    react.evaluate(() => {
      (window as unknown as { __IMPORT_SPIN_OBSERVED__: boolean }).__IMPORT_SPIN_OBSERVED__ = false
      new MutationObserver(() => {
        if (document.querySelector('.mona-fullscreen-spin')) (window as unknown as { __IMPORT_SPIN_OBSERVED__: boolean }).__IMPORT_SPIN_OBSERVED__ = true
      }).observe(document.body, { childList: true, subtree: true })
    }),
  ])
  await importFile(vue, react, 0, { buffer, mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', name: 'fixture.pptx' })
  await Promise.all([
    vue.waitForFunction(length => window.__MONA_TEST__!.getState().presentation.slides.length === length, initial.slides.length + 1),
    react.waitForFunction(length => window.__MONA_REACT_TEST__!.getState().presentation.slides.length === length, initial.slides.length + 1),
  ])
  await Promise.all([
    expect(vue.locator('.fullscreen-spin')).toHaveCount(0),
    expect(react.locator('.mona-fullscreen-spin')).toHaveCount(0),
  ])
  expect(await vue.evaluate(() => (window as unknown as { __IMPORT_SPIN_OBSERVED__: boolean }).__IMPORT_SPIN_OBSERVED__)).toBe(true)
  expect(await react.evaluate(() => (window as unknown as { __IMPORT_SPIN_OBSERVED__: boolean }).__IMPORT_SPIN_OBSERVED__)).toBe(true)
  await expectStateParity(vue, react)
  const initialSlideIds = new Set(initial.slides.map(slide => slide.id))
  const imported = (await state(react, 'react')).slides.find(slide => !initialSlideIds.has(slide.id))!
  expect(imported.remark).toContain('Imported speaker note')
  expect(imported.elements.map(element => element.type)).toEqual(expect.arrayContaining(['shape', 'table']))
  // pptxtojson 2.1.0 silently omits the native two-series chart generated by
  // PptxGenJS. This two-sided assertion preserves and documents the current
  // source parser boundary instead of disguising it with React-only behavior.
  expect(imported.elements.filter(element => element.type === 'chart')).toHaveLength(0)
  await closeEditors(sourceContext, destinationContext)
})

test('malformed JSON and native files preserve state/history and surface the same parse error', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  const sourceBefore = await state(vue, 'vue')
  const destinationBefore = await state(react, 'react')
  const sourceHistory = await history(vue, 'vue')
  const destinationHistory = await history(react, 'react')
  await importFile(vue, react, 1, { buffer: Buffer.from('{broken'), mimeType: 'application/json', name: 'broken.json' })
  await Promise.all([
    expect(vue.locator('.message-wrap').getByText('This file could not be read or parsed')).toBeVisible(),
    expect(react.locator('.mona-message-wrap').getByText('This file could not be read or parsed')).toBeVisible(),
  ])
  expect(await state(vue, 'vue')).toEqual(sourceBefore)
  expect(await state(react, 'react')).toEqual(destinationBefore)
  expect(await history(vue, 'vue')).toEqual(sourceHistory)
  expect(await history(react, 'react')).toEqual(destinationHistory)
  await closeEditors(sourceContext, destinationContext)
})
