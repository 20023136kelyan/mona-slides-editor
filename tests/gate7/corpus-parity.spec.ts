import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

import { expect, test, type Browser, type BrowserContext, type Download, type Locator, type Page, type TestInfo } from '@playwright/test'
import JSZip from 'jszip'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
// The package's Node entry points at its UMD bundle; the ESM build exposes parse.
import { parse as parsePptx } from 'pptxtojson/dist/index.js'

import type { PPTElement, PresentationState } from '@mona/presentation-core'

interface GroundTruthFixture {
  file: string
  location: string
  package: {
    charts: number
    groups: number
    hyperlinkReferences: number
    mergedCellAttributes: number
    notesSlides: number
    slides: number
    smartArt: number
    tables: number
  } & Record<string, number>
  sha256: string
}

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

const projectRoot = resolve(import.meta.dirname, '../..')
const corpusRoot = resolve(projectRoot, 'tests/corpus')
const baselineRoot = resolve(corpusRoot, 'baselines')
const fixturePath = '/?rendererFixture=gate6-workflows'
const writeBaselines = process.env.GATE7_WRITE_CORPUS_BASELINE === '1'
const groundTruth = JSON.parse(await readFile(resolve(corpusRoot, 'corpus-ground-truth.json'), 'utf8')) as { fixtures: GroundTruthFixture[] }

test.describe.configure({ mode: 'serial' })

const exists = async path => stat(path).then(() => true, () => false)
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

async function openEditors(browser: Browser) {
  const sourceContext = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } })
  const destinationContext = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } })
  // Imported decks request arbitrary Google Fonts. An unavailable font host can
  // make Chromium's screenshot font barrier wait for minutes; aborting both
  // sides immediately gives a deterministic shared fallback-font environment.
  await Promise.all([sourceContext, destinationContext].map(context => context.route(
    /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//,
    route => route.abort(),
  )))
  await Promise.all([sourceContext, destinationContext].map(context => context.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US'))))
  const vue = await sourceContext.newPage()
  const react = await destinationContext.newPage()
  const pageErrors: string[] = []
  vue.on('pageerror', error => pageErrors.push(`vue: ${error.message}`))
  react.on('pageerror', error => pageErrors.push(`react: ${error.message}`))
  await Promise.all([vue.goto(`http://127.0.0.1:5173${fixturePath}`), react.goto(`http://127.0.0.1:5174${fixturePath}`)])
  await Promise.all([
    vue.waitForFunction(() => window.__MONA_TEST__?.isReady() && window.__MONA_TEST__.getState().presentation.slides.some(slide => slide.id === 'gate6-beta-content')),
    react.waitForFunction(() => window.__MONA_REACT_TEST__?.isReady() && window.__MONA_REACT_TEST__.getState().presentation.slides.some(slide => slide.id === 'gate6-beta-content')),
  ])
  return { destinationContext, pageErrors, react, sourceContext, vue }
}

async function closeEditors(sourceContext: BrowserContext, destinationContext: BrowserContext) {
  await Promise.all([sourceContext.close(), destinationContext.close()])
}

async function state(page: Page, application: 'react' | 'vue') {
  return page.evaluate(name => structuredClone(name === 'vue'
    ? window.__MONA_TEST__!.getState().presentation
    : window.__MONA_REACT_TEST__!.getState().presentation), application)
}

async function history(page: Page, application: 'react' | 'vue') {
  if (application === 'react') return page.evaluate(() => window.__MONA_REACT_TEST__!.getHistoryState())
  return page.evaluate(() => {
    const value = window.__MONA_TEST__!.getState().history
    return { cursor: value.snapshotCursor, length: value.snapshotLength }
  })
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

async function reset(vue: Page, react: Page) {
  await openMainMenu(vue, react)
  await Promise.all([
    vue.locator('.tippy-content:visible .popover-menu-item').nth(1).click(),
    react.locator('.mona-editor-main-menu .mona-header-popover-menu-item').nth(1).click(),
  ])
  await Promise.all([
    vue.waitForFunction(() => window.__MONA_TEST__!.getState().presentation.slides.length === 1 && window.__MONA_TEST__!.getState().presentation.slides[0]!.elements.length === 0),
    react.waitForFunction(() => window.__MONA_REACT_TEST__!.getState().presentation.slides.length === 1 && window.__MONA_REACT_TEST__!.getState().presentation.slides[0]!.elements.length === 0),
  ])
}

async function observeImport(page: Page, application: 'react' | 'vue') {
  await page.evaluate(name => {
    const key = name === 'vue' ? '__GATE7_VUE_IMPORT_SPIN__' : '__GATE7_REACT_IMPORT_SPIN__'
    ;(window as unknown as Record<string, boolean>)[key] = false
    const selector = name === 'vue' ? '.fullscreen-spin' : '.mona-fullscreen-spin'
    new MutationObserver(() => {
      if (document.querySelector(selector)) (window as unknown as Record<string, boolean>)[key] = true
    }).observe(document.body, { childList: true, subtree: true })
  }, application)
}

async function importDeck(vue: Page, react: Page, file: string, expectedSlides: number) {
  await reset(vue, react)
  await Promise.all([observeImport(vue, 'vue'), observeImport(react, 'react')])
  await openMainMenu(vue, react)
  await Promise.all([
    vue.locator('.tippy-content:visible input[type="file"]').nth(0).setInputFiles(file),
    react.locator('.mona-editor-main-menu input[type="file"]').nth(0).setInputFiles(file),
  ])
  await Promise.all([
    vue.waitForFunction(length => window.__MONA_TEST__!.getState().presentation.slides.length === length, expectedSlides, { timeout: 120_000 }),
    react.waitForFunction(length => window.__MONA_REACT_TEST__!.getState().presentation.slides.length === length, expectedSlides, { timeout: 120_000 }),
  ])
  await Promise.all([
    expect(vue.locator('.fullscreen-spin')).toHaveCount(0, { timeout: 120_000 }),
    expect(react.locator('.mona-fullscreen-spin')).toHaveCount(0, { timeout: 120_000 }),
    vue.evaluate(() => Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 3_000))])),
    react.evaluate(() => Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 3_000))])),
  ])
  // File selection closes the menus through their framework transition. Wait
  // for the actual dismissal before interacting with the imported document.
  await Promise.all([vue.waitForTimeout(400), react.waitForTimeout(400)])
  await vue.evaluate(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  await Promise.all([
    expect(vue.locator('.tippy-box:visible .main-menu')).toHaveCount(0),
    expect(react.locator('.mona-editor-main-menu')).toHaveCount(0),
  ])
  await Promise.all([vue.waitForTimeout(100), react.waitForTimeout(100)])
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

const digestLargeValues = (value: unknown): unknown => {
  if (typeof value === 'string' && value.length > 1024) return { bytes: Buffer.byteLength(value), sha256: sha256(value) }
  if (Array.isArray(value)) return value.map(digestLargeValues)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, digestLargeValues(item)]))
  return value
}

function countLinks(element: PPTElement) {
  const serialized = JSON.stringify(element)
  return (serialized.match(/(?:"link"\s*:|href=)/g) || []).length
}

function summarizePresentation(presentation: PresentationState) {
  const elements = presentation.slides.flatMap(slide => slide.elements)
  const types: Record<string, number> = {}
  for (const element of elements) types[element.type] = (types[element.type] || 0) + 1
  const groupIds = new Set(elements.map(element => element.groupId).filter((value): value is string => !!value))
  return {
    elementTypes: Object.fromEntries(Object.entries(types).sort(([left], [right]) => left.localeCompare(right))),
    elements: elements.length,
    groupedElements: elements.filter(element => element.groupId).length,
    groups: groupIds.size,
    hyperlinks: elements.reduce((total, element) => total + countLinks(element), 0),
    lockedElements: elements.filter(element => element.lock).length,
    notesSlides: presentation.slides.filter(slide => !!slide.remark?.trim()).length,
    rotatedElements: elements.filter(element => element.rotate && element.rotate % 360 !== 0).length,
    slides: presentation.slides.length,
    title: presentation.title,
    viewportRatio: presentation.viewportRatio,
    viewportSize: presentation.viewportSize,
  }
}

function centerCrop(image: PNG, width: number, height: number): PNG {
  if (image.width === width && image.height === height) return image
  const cropped = new PNG({ width, height })
  PNG.bitblt(image, cropped, Math.floor((image.width - width) / 2), Math.floor((image.height - height) / 2), width, height, 0, 0)
  return cropped
}

async function compareSlideRaster(source: Locator, destination: Locator, label: string, testInfo: TestInfo) {
  const [sourceBuffer, destinationBuffer] = await Promise.all([
    source.screenshot({ animations: 'disabled' }),
    destination.screenshot({ animations: 'disabled' }),
  ])
  const sourceImage = PNG.sync.read(sourceBuffer)
  const destinationImage = PNG.sync.read(destinationBuffer)
  const width = Math.min(sourceImage.width, destinationImage.width)
  const height = Math.min(sourceImage.height, destinationImage.height)
  const expected = centerCrop(sourceImage, width, height)
  const actual = centerCrop(destinationImage, width, height)
  const diff = new PNG({ width, height })
  const differentPixels = pixelmatch(expected.data, actual.data, diff.data, width, height, { includeAA: false, threshold: 0.1 })
  const ratio = differentPixels / (width * height)
  if (ratio > 0.035) {
    await Promise.all([
      testInfo.attach(`${label}-vue`, { body: PNG.sync.write(expected), contentType: 'image/png' }),
      testInfo.attach(`${label}-react`, { body: PNG.sync.write(actual), contentType: 'image/png' }),
      testInfo.attach(`${label}-diff`, { body: PNG.sync.write(diff), contentType: 'image/png' }),
    ])
  }
  expect(ratio, `${label} visual diff ratio`).toBeLessThanOrEqual(0.035)
  return Math.round(ratio * 1_000_000) / 1_000_000
}

async function compareRepresentativeSlides(vue: Page, react: Page, slideCount: number, fixture: string, testInfo: TestInfo) {
  const indexes = [...new Set([0, Math.floor((slideCount - 1) / 2), slideCount - 1])]
  const ratios: Record<string, number> = {}
  for (const index of indexes) {
    const sourceThumbnail = vue.locator('.thumbnail-item').nth(index)
    const destinationThumbnail = react.locator('.mona-thumbnail-item').nth(index)
    await Promise.all([sourceThumbnail.scrollIntoViewIfNeeded(), destinationThumbnail.scrollIntoViewIfNeeded()])
    const [sourceIndex, destinationIndex] = await Promise.all([
      vue.evaluate(() => window.__MONA_TEST__!.getState().presentation.slideIndex),
      react.evaluate(() => window.__MONA_REACT_TEST__!.getState().presentation.slideIndex),
    ])
    if (sourceIndex !== index || destinationIndex !== index) {
      await Promise.all([
        sourceThumbnail.click({ position: { x: 5, y: 5 } }),
        destinationThumbnail.click({ position: { x: 5, y: 5 } }),
      ])
    }
    await Promise.all([
      vue.waitForFunction(expected => window.__MONA_TEST__!.getState().presentation.slideIndex === expected, index),
      react.waitForFunction(expected => window.__MONA_REACT_TEST__!.getState().presentation.slideIndex === expected, index),
      vue.waitForTimeout(250),
      react.waitForTimeout(250),
    ])
    ratios[`slide-${index + 1}`] = await compareSlideRaster(
      vue.locator('.canvas .viewport-wrapper'),
      react.locator('.mona-editor-viewport-frame'),
      `${fixture}-slide-${index + 1}`,
      testInfo,
    )
  }
  return ratios
}

async function openExport(vue: Page, react: Page) {
  await Promise.all([
    vue.locator('.editor-header .right > .menu-item').nth(1).click(),
    react.getByRole('button', { name: 'Export' }).click(),
  ])
  await Promise.all([
    expect(vue.locator('.modal-content .export-dialog')).toBeVisible({ timeout: 30_000 }),
    expect(react.locator('.mona-export-dialog')).toBeVisible({ timeout: 30_000 }),
  ])
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
}

async function downloadBuffer(download: Download) {
  const path = await download.path()
  if (!path) throw new Error('Downloaded file has no local path')
  return readFile(path)
}

async function exportEditableDeck(vue: Page, react: Page) {
  await openExport(vue, react)
  const [sourceDownload, destinationDownload] = await Promise.all([
    Promise.all([
      vue.waitForEvent('download', { timeout: 180_000 }),
      vue.locator('.export-pptx-dialog .export').click(),
    ]).then(([download]) => download),
    Promise.all([
      react.waitForEvent('download', { timeout: 180_000 }),
      react.locator('.mona-export-pptx-panel .mona-export-submit').click(),
    ]).then(([download]) => download),
  ])
  expect(destinationDownload.suggestedFilename()).toBe(sourceDownload.suggestedFilename())
  return Promise.all([downloadBuffer(sourceDownload), downloadBuffer(destinationDownload)])
}

const toArrayBuffer = (buffer: Buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer

const stripParserMedia = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripParserMedia)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['base64', 'blob', 'order', 'picBase64', 'picBlob', 'picRef', 'ref'].includes(key))
    .map(([key, entry]) => [key, stripParserMedia(entry)]))
}

async function packageSummary(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const names = Object.keys(zip.files)
  return {
    charts: names.filter(name => /^ppt\/charts\/chart\d+\.xml$/.test(name)).length,
    media: names.filter(name => /^ppt\/media\/[^/]+$/.test(name)).length,
    notesSlides: names.filter(name => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name)).length,
    slides: names.filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length,
  }
}

async function roundTripSummary(sourceBuffer: Buffer, destinationBuffer: Buffer) {
  const [sourcePackage, destinationPackage, sourceParsed, destinationParsed] = await Promise.all([
    packageSummary(sourceBuffer),
    packageSummary(destinationBuffer),
    parsePptx(toArrayBuffer(sourceBuffer), { audioMode: 'none', imageMode: 'none', videoMode: 'none' }),
    parsePptx(toArrayBuffer(destinationBuffer), { audioMode: 'none', imageMode: 'none', videoMode: 'none' }),
  ])
  expect(destinationPackage).toEqual(sourcePackage)
  expect(stripParserMedia(destinationParsed)).toEqual(stripParserMedia(sourceParsed))
  const elements = sourceParsed.slides.flatMap(slide => slide.elements)
  const elementTypes: Record<string, number> = {}
  for (const element of elements) elementTypes[element.type] = (elementTypes[element.type] || 0) + 1
  return {
    elementTypes: Object.fromEntries(Object.entries(elementTypes).sort(([left], [right]) => left.localeCompare(right))),
    package: sourcePackage,
    parsedSlides: sourceParsed.slides.length,
  }
}

for (const fixture of groundTruth.fixtures) {
  test(`${fixture.file}: real import, render, and editable round trip remain source-identical`, async ({ browser }, testInfo) => {
    test.setTimeout(300_000)
    const startedAt = Date.now()
    const mark = (phase: string) => console.log(`[gate7:corpus] ${fixture.file} ${phase} +${Date.now() - startedAt}ms`)
    const file = resolve(corpusRoot, fixture.location)
    test.skip(!(await exists(file)), `Local private fixture is absent: ${fixture.location}`)
    expect(sha256(await readFile(file))).toBe(fixture.sha256)

    const { destinationContext, pageErrors, react, sourceContext, vue } = await openEditors(browser)
    mark('editors-ready')
    try {
      await importDeck(vue, react, file, fixture.package.slides)
      mark('imported')
      const [sourceState, destinationState] = await Promise.all([state(vue, 'vue'), state(react, 'react')])
      const canonicalDestination = canonicalizeGeneratedIds(sourceState, destinationState)
      expect(digestLargeValues(canonicalDestination)).toEqual(digestLargeValues(sourceState))
      expect(await history(react, 'react')).toEqual(await history(vue, 'vue'))

      const sourceSummary = summarizePresentation(sourceState)
      expect(summarizePresentation(destinationState)).toEqual(sourceSummary)
      mark('state-compared')
      const visualDiffRatios = await compareRepresentativeSlides(vue, react, fixture.package.slides, basename(fixture.file, '.pptx'), testInfo)
      mark('visuals-compared')
      const [sourceStateAfterNavigation, destinationStateAfterNavigation] = await Promise.all([state(vue, 'vue'), state(react, 'react')])
      expect(digestLargeValues(canonicalizeGeneratedIds(sourceStateAfterNavigation, destinationStateAfterNavigation))).toEqual(digestLargeValues(sourceStateAfterNavigation))
      expect(sourceStateAfterNavigation.slides).toHaveLength(fixture.package.slides)
      expect(destinationStateAfterNavigation.slides).toHaveLength(fixture.package.slides)
      const [sourceExport, destinationExport] = await exportEditableDeck(vue, react)
      mark('exported')
      const roundTrip = await roundTripSummary(sourceExport, destinationExport)
      mark('round-trip-parsed')
      expect(pageErrors).toEqual([])

      const report = {
        fixture: fixture.file,
        imported: sourceSummary,
        parserGaps: {
          nativeChartsNotEditable: Math.max(0, fixture.package.charts - (sourceSummary.elementTypes.chart || 0)),
          nativeGroupsNotRepresented: Math.max(0, fixture.package.groups - sourceSummary.groups),
          nativeSmartArtNotEditable: fixture.package.smartArt,
          nativeTableCountDifference: fixture.package.tables - (sourceSummary.elementTypes.table || 0),
          notesSlideCountDifference: fixture.package.notesSlides - sourceSummary.notesSlides,
        },
        roundTrip,
        schemaVersion: 1,
        sourcePackage: fixture.package,
        sourceSha256: fixture.sha256,
        visualDiffRatios,
      }
      const baselineFile = resolve(baselineRoot, `${basename(fixture.file, '.pptx')}.json`)
      if (writeBaselines) {
        await mkdir(baselineRoot, { recursive: true })
        await writeFile(baselineFile, `${JSON.stringify(report, null, 2)}\n`)
      }
      else {
        expect(await exists(baselineFile), `Missing corpus baseline; run GATE7_WRITE_CORPUS_BASELINE=1 npm run parity:gate7:corpus`).toBe(true)
        const baseline = JSON.parse(await readFile(baselineFile, 'utf8')) as typeof report
        const { visualDiffRatios: actualVisualRatios, ...actualStructuralReport } = report
        const { visualDiffRatios: baselineVisualRatios, ...baselineStructuralReport } = baseline
        expect(actualStructuralReport).toEqual(baselineStructuralReport)
        for (const [slide, ratio] of Object.entries(actualVisualRatios)) {
          const baselineRatio = baselineVisualRatios[slide]
          expect(baselineRatio, `${slide} must exist in the frozen corpus baseline`).toBeDefined()
          // Fresh and warmed Chromium renderer processes can classify a small
          // number of antialiased glyph-edge pixels differently. Structural
          // reports remain exact; a raster may improve freely but cannot
          // regress by more than one ten-thousandth of the slide area.
          expect(ratio, `${slide} visual ratio regression`).toBeLessThanOrEqual(baselineRatio! + 0.0001)
        }
      }
      mark('baseline-verified')
    }
    finally {
      await closeEditors(sourceContext, destinationContext)
    }
  })
}
