import { expect, test, type Browser, type BrowserContext, type Download, type Locator, type Page } from '@playwright/test'
import CryptoJS from 'crypto-js'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
// The package's Node entry points at its UMD bundle; the explicit ESM build exposes the documented parser.
import { parse as parsePptx } from 'pptxtojson/dist/index.js'

import type { PresentationState } from '@mona/presentation-core'

declare global {
  interface Window {
    __MONA_TEST__?: { getState: () => { presentation: PresentationState }; isReady: () => boolean }
    __MONA_REACT_TEST__?: { getState: () => { presentation: PresentationState }; isReady: () => boolean }
  }
}

const fixturePath = '/?rendererFixture=gate6-workflows'

async function openEditors(browser: Browser) {
  const sourceContext = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } })
  const destinationContext = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } })
  await Promise.all([sourceContext, destinationContext].map(context => context.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US'))))
  const vue = await sourceContext.newPage()
  const react = await destinationContext.newPage()
  await Promise.all([vue.goto(`http://127.0.0.1:5173${fixturePath}`), react.goto(`http://127.0.0.1:5174${fixturePath}`)])
  await Promise.all([vue.waitForFunction(() => window.__MONA_TEST__?.isReady()), react.waitForFunction(() => window.__MONA_REACT_TEST__?.isReady())])
  return { destinationContext, react, sourceContext, vue }
}

async function closeEditors(sourceContext: BrowserContext, destinationContext: BrowserContext) {
  await Promise.all([sourceContext.close(), destinationContext.close()])
}

async function downloadBuffer(download: Download) {
  const path = await download.path()
  if (!path) throw new Error('Downloaded file has no local path')
  return readFile(path)
}

const toArrayBuffer = (buffer: Buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer

const stripParserMedia = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripParserMedia)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['base64', 'blob', 'order', 'picBase64', 'picBlob', 'picRef', 'ref'].includes(key)).map(([key, entry]) => [key, stripParserMedia(entry)]))
}

async function openExport(vue: Page, react: Page) {
  await Promise.all([
    vue.locator('.editor-header .right > .menu-item').nth(1).click(),
    react.getByRole('button', { name: 'Export' }).click(),
  ])
  await Promise.all([expect(vue.locator('.modal-content .export-dialog')).toBeVisible(), expect(react.locator('.mona-export-dialog')).toBeVisible()])
  await Promise.all([vue.waitForTimeout(300), react.waitForTimeout(300)])
}

const roundedRect = (rect: { height: number; width: number; x: number; y: number } | null) => rect && ({
  height: Math.round(rect.height * 100) / 100,
  width: Math.round(rect.width * 100) / 100,
  x: Math.round(rect.x * 100) / 100,
  y: Math.round(rect.y * 100) / 100,
})

async function rasterMetrics(source: Locator, destination: Locator) {
  const [sourceBuffer, destinationBuffer] = await Promise.all([source.screenshot(), destination.screenshot()])
  const expected = PNG.sync.read(sourceBuffer)
  const actual = PNG.sync.read(destinationBuffer)
  expect({ height: actual.height, width: actual.width }).toEqual({ height: expected.height, width: expected.width })
  const visible = pixelmatch(expected.data, actual.data, null, expected.width, expected.height, { threshold: 0 })
  let raw = 0
  for (let index = 0; index < expected.data.length; index += 1) raw = Math.max(raw, Math.abs(expected.data[index]! - actual.data[index]!))
  return { raw, visible }
}

test('all export tabs preserve source geometry, complete control inventory, defaults, and rendering', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await openExport(vue, react)
  const sourceModal = vue.locator('.modal:visible .modal-content')
  const destinationModal = react.locator('.mona-source-modal-content')
  expect(roundedRect(await destinationModal.boundingBox())).toEqual(roundedRect(await sourceModal.boundingBox()))
  const labels = ['Export PPTIST file', 'Export PPTX', 'Export images', 'Export JSON', 'Print / Export PDF']
  for (let index = 0; index < labels.length; index += 1) {
    await Promise.all([
      vue.locator('.export-dialog .tabs .tab').nth(index).click(),
      react.locator('.mona-export-tabs button').nth(index).click(),
    ])
    await Promise.all([vue.waitForTimeout(120), react.waitForTimeout(120)])
    const sourcePanel = vue.locator('.export-dialog .content > div')
    const destinationPanel = react.locator('.mona-export-content > div')
    await Promise.all([expect(sourcePanel).toBeVisible(), expect(destinationPanel).toBeVisible()])
    expect((await destinationPanel.textContent())?.replace(/\s/g, '')).toBe((await sourcePanel.textContent())?.replace(/\s/g, ''))
    expect(roundedRect(await destinationPanel.boundingBox())).toEqual(roundedRect(await sourcePanel.boundingBox()))
    const metrics = await rasterMetrics(sourceModal, destinationModal)
    expect.soft(metrics.visible, `${labels[index]} visible raster pixels`).toBeLessThanOrEqual(25)
    expect(metrics.raw, `${labels[index]} maximum raw channel delta`).toBeLessThanOrEqual(75)
  }
  await closeEditors(sourceContext, destinationContext)
})

test('PPTX, image, native, and PDF configuration transitions match source controls and state', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await openExport(vue, react)

  const sourceTabs = vue.locator('.export-dialog .tabs .tab')
  const destinationTabs = react.locator('.mona-export-tabs button')
  await Promise.all([sourceTabs.nth(1).click(), destinationTabs.nth(1).click()])
  const sourcePptx = vue.locator('.export-pptx-dialog')
  const destinationPptx = react.locator('.mona-export-pptx-panel')
  expect(await sourcePptx.locator('.button.checked').allTextContents()).toEqual(['All', 'Editable'])
  expect(await destinationPptx.locator('.mona-export-radio.is-checked').allTextContents()).toEqual(['All', 'Editable'])
  expect(await sourcePptx.locator('.switch').evaluateAll(nodes => nodes.map(node => node.classList.contains('active')))).toEqual([true, true])
  expect(await destinationPptx.getByRole('switch').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-checked') === 'true'))).toEqual([true, true])
  await Promise.all([
    sourcePptx.locator('.switch').first().click(),
    destinationPptx.getByRole('switch').first().click(),
  ])
  await Promise.all([expect(sourcePptx.locator('.tip')).toBeVisible(), expect(destinationPptx.locator('.mona-export-tip')).toBeVisible()])
  expect((await destinationPptx.locator('.mona-export-tip').textContent())?.trim()).toBe((await sourcePptx.locator('.tip').textContent())?.trim())
  await Promise.all([
    sourcePptx.locator('.switch').nth(1).click(),
    destinationPptx.getByRole('switch').nth(1).click(),
  ])
  expect(await sourcePptx.locator('.switch').evaluateAll(nodes => nodes.map(node => node.classList.contains('active')))).toEqual([false, false])
  expect(await destinationPptx.getByRole('switch').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-checked') === 'true'))).toEqual([false, false])
  await Promise.all([
    sourcePptx.getByRole('button', { name: 'Custom' }).click(),
    destinationPptx.getByRole('button', { name: 'Custom' }).click(),
  ])
  await Promise.all([expect(sourcePptx.locator('.slider')).toBeVisible(), expect(destinationPptx.getByRole('slider')).toBeVisible()])
  await Promise.all([
    sourcePptx.locator('.slider').click({ position: { x: 125, y: 6 } }),
    destinationPptx.getByRole('slider').click({ position: { x: 125, y: 6 } }),
  ])
  expect(await destinationPptx.locator('.mona-export-slider-thumb').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-tooltip')))).toEqual(await sourcePptx.locator('.slider .thumb').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-tooltip'))))
  await Promise.all([
    sourcePptx.getByRole('button', { name: 'Images only' }).click(),
    destinationPptx.getByRole('button', { name: 'Images only' }).click(),
  ])
  await Promise.all([expect(sourcePptx.locator('.switch')).toHaveCount(0), expect(destinationPptx.getByRole('switch')).toHaveCount(0)])

  await Promise.all([sourceTabs.nth(2).click(), destinationTabs.nth(2).click()])
  const sourceImage = vue.locator('.export-img-dialog')
  const destinationImage = react.locator('.mona-export-image-panel')
  expect(await sourceImage.locator('.button.checked').allTextContents()).toEqual(['JPEG', 'All'])
  expect(await destinationImage.locator('.mona-export-radio.is-checked').allTextContents()).toEqual(['JPEG', 'All'])
  expect(await sourceImage.locator('.slider .thumb').getAttribute('data-tooltip')).toBe('1')
  expect(await destinationImage.locator('.mona-export-slider-thumb').getAttribute('data-tooltip')).toBe('1')
  expect(await sourceImage.locator('.switch').evaluate(node => node.classList.contains('active'))).toBe(false)
  expect(await destinationImage.getByRole('switch').getAttribute('aria-checked')).toBe('false')
  await Promise.all([
    sourceImage.locator('.slider').click({ position: { x: 125, y: 6 } }),
    destinationImage.getByRole('slider').click({ position: { x: 125, y: 6 } }),
  ])
  expect(await destinationImage.locator('.mona-export-slider-thumb').getAttribute('data-tooltip')).toBe(await sourceImage.locator('.slider .thumb').getAttribute('data-tooltip'))

  await Promise.all([sourceTabs.nth(4).click(), destinationTabs.nth(4).click()])
  const sourcePdf = vue.locator('.export-pdf-dialog')
  const destinationPdf = react.locator('.mona-export-pdf-panel')
  expect(await sourcePdf.locator('.button.checked').allTextContents()).toEqual(['All'])
  expect(await destinationPdf.locator('.mona-export-radio.is-checked').allTextContents()).toEqual(['All'])
  expect(await sourcePdf.locator('.select .selector').textContent()).toBe('1')
  expect(await destinationPdf.locator('.mona-panel-select-label').textContent()).toBe('1')
  expect(await sourcePdf.locator('.switch').evaluate(node => node.classList.contains('active'))).toBe(true)
  expect(await destinationPdf.getByRole('switch').getAttribute('aria-checked')).toBe('true')

  await closeEditors(sourceContext, destinationContext)
})

test('JSON and encrypted PPTIST downloads preserve exact source payloads and filenames', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await openExport(vue, react)
  const sourceTabs = vue.locator('.export-dialog .tabs .tab')
  const destinationTabs = react.locator('.mona-export-tabs button')

  await Promise.all([sourceTabs.nth(3).click(), destinationTabs.nth(3).click()])
  const [sourceJson, destinationJson] = await Promise.all([
    Promise.all([vue.waitForEvent('download'), vue.locator('.export-json-dialog .export').click()]).then(([download]) => download),
    Promise.all([react.waitForEvent('download'), react.locator('.mona-export-json-panel .mona-export-submit').click()]).then(([download]) => download),
  ])
  expect(destinationJson.suggestedFilename()).toBe(sourceJson.suggestedFilename())
  const [sourceJsonText, destinationJsonText] = await Promise.all([sourceJson.createReadStream(), destinationJson.createReadStream()]).then(async streams => Promise.all(streams.map(async stream => {
    const chunks: Buffer[] = []
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString()
  })))
  expect(JSON.parse(destinationJsonText)).toEqual(JSON.parse(sourceJsonText))

  await Promise.all([sourceTabs.nth(0).click(), destinationTabs.nth(0).click()])
  const [sourceNative, destinationNative] = await Promise.all([
    Promise.all([vue.waitForEvent('download'), vue.locator('.export-pptist-dialog .export').click()]).then(([download]) => download),
    Promise.all([react.waitForEvent('download'), react.locator('.mona-export-native-panel .mona-export-submit').click()]).then(([download]) => download),
  ])
  expect(destinationNative.suggestedFilename()).toBe(sourceNative.suggestedFilename())
  const read = async (download: typeof sourceNative) => {
    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString()
  }
  const [sourceEncrypted, destinationEncrypted] = await Promise.all([read(sourceNative), read(destinationNative)])
  const decrypt = (value: string) => CryptoJS.AES.decrypt(value, 'pptist').toString(CryptoJS.enc.Utf8)
  expect(JSON.parse(decrypt(destinationEncrypted))).toEqual(JSON.parse(decrypt(sourceEncrypted)))
  await closeEditors(sourceContext, destinationContext)
})

test('close button, mask, and Escape preserve source modal lifecycle', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  for (const route of ['button', 'mask', 'escape'] as const) {
    await openExport(vue, react)
    if (route === 'button') await Promise.all([vue.locator('.export-pptx-dialog .close').click(), react.locator('.mona-export-pptx-panel .mona-export-close').click()])
    else if (route === 'mask') await Promise.all([vue.locator('.modal:visible .mask').click({ position: { x: 5, y: 5 } }), react.locator('.mona-source-modal-mask').click({ position: { x: 5, y: 5 } })])
    else await Promise.all([vue.keyboard.press('Escape'), react.keyboard.press('Escape')])
    await Promise.all([expect(vue.locator('.modal-content .export-dialog')).toBeHidden({ timeout: 600 }), expect(react.locator('.mona-export-dialog')).toHaveCount(0, { timeout: 600 })])
  }
  await closeEditors(sourceContext, destinationContext)
})

test('editable PPTX export reopens with source-equivalent chart, table, equation, text, and geometry semantics', async ({ browser }) => {
  test.setTimeout(90_000)
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await Promise.all([
    vue.locator('.thumbnail-item').nth(2).click(),
    react.locator('.mona-thumbnail-item').nth(2).click(),
  ])
  await openExport(vue, react)
  await Promise.all([
    vue.locator('.export-pptx-dialog').getByRole('button', { name: 'Current slide' }).click(),
    react.locator('.mona-export-pptx-panel').getByRole('button', { name: 'Current slide' }).click(),
  ])
  const [sourceDownload, destinationDownload] = await Promise.all([
    Promise.all([vue.waitForEvent('download', { timeout: 60_000 }), vue.locator('.export-pptx-dialog .export').click()]).then(([download]) => download),
    Promise.all([react.waitForEvent('download', { timeout: 60_000 }), react.locator('.mona-export-pptx-panel .mona-export-submit').click()]).then(([download]) => download),
  ])
  expect(destinationDownload.suggestedFilename()).toBe(sourceDownload.suggestedFilename())
  const [sourceBuffer, destinationBuffer] = await Promise.all([downloadBuffer(sourceDownload), downloadBuffer(destinationDownload)])
  const [sourceZip, destinationZip, sourceParsed, destinationParsed] = await Promise.all([
    JSZip.loadAsync(sourceBuffer),
    JSZip.loadAsync(destinationBuffer),
    parsePptx(toArrayBuffer(sourceBuffer), { audioMode: 'none', imageMode: 'none', videoMode: 'none' }),
    parsePptx(toArrayBuffer(destinationBuffer), { audioMode: 'none', imageMode: 'none', videoMode: 'none' }),
  ])
  const sourceFiles = Object.keys(sourceZip.files).filter(path => /ppt\/(charts|media|slides|notesSlides)\//.test(path)).sort()
  const destinationFiles = Object.keys(destinationZip.files).filter(path => /ppt\/(charts|media|slides|notesSlides)\//.test(path)).sort()
  expect(destinationFiles).toEqual(sourceFiles)
  expect(destinationFiles.some(path => path.startsWith('ppt/charts/chart'))).toBe(true)
  expect(destinationFiles.some(path => path.endsWith('.svg'))).toBe(true)
  const destinationSlideXml = await destinationZip.file('ppt/slides/slide1.xml')!.async('string')
  expect(destinationSlideXml).toContain('<a:tbl>')
  expect(destinationSlideXml).toContain('r:id="rId')
  expect(stripParserMedia(destinationParsed)).toEqual(stripParserMedia(sourceParsed))
  expect(destinationParsed.slides).toHaveLength(1)
  expect(destinationParsed.slides[0]!.elements.map(element => element.type)).toEqual(sourceParsed.slides[0]!.elements.map(element => element.type))

  await Promise.all([
    vue.locator('.export-pptx-dialog .close').click(),
    react.locator('.mona-export-pptx-panel .mona-export-close').click(),
  ])
  await Promise.all([expect(vue.locator('.export-dialog')).toBeHidden({ timeout: 600 }), expect(react.locator('.mona-export-dialog')).toHaveCount(0, { timeout: 600 })])
  await Promise.all([
    vue.locator('.thumbnail-item').nth(4).click(),
    react.locator('.mona-thumbnail-item').nth(4).click(),
  ])
  await Promise.all([
    vue.locator('.remark .ProseMirror').fill('Opening speaker remark'),
    react.locator('.mona-editor-remark .ProseMirror').fill('Opening speaker remark'),
  ])
  await Promise.all([vue.waitForTimeout(450), react.waitForTimeout(450)])
  await openExport(vue, react)
  await Promise.all([
    vue.locator('.export-pptx-dialog').getByRole('button', { name: 'Current slide' }).click(),
    react.locator('.mona-export-pptx-panel').getByRole('button', { name: 'Current slide' }).click(),
  ])
  const [sourceNotesDownload, destinationNotesDownload] = await Promise.all([
    Promise.all([vue.waitForEvent('download', { timeout: 60_000 }), vue.locator('.export-pptx-dialog .export').click()]).then(([download]) => download),
    Promise.all([react.waitForEvent('download', { timeout: 60_000 }), react.locator('.mona-export-pptx-panel .mona-export-submit').click()]).then(([download]) => download),
  ])
  const [sourceNotes, destinationNotes] = await Promise.all([downloadBuffer(sourceNotesDownload), downloadBuffer(destinationNotesDownload)])
  const [sourceNotesZip, destinationNotesZip, sourceNotesParsed, destinationNotesParsed] = await Promise.all([
    JSZip.loadAsync(sourceNotes), JSZip.loadAsync(destinationNotes),
    parsePptx(toArrayBuffer(sourceNotes), { audioMode: 'none', imageMode: 'none', videoMode: 'none' }),
    parsePptx(toArrayBuffer(destinationNotes), { audioMode: 'none', imageMode: 'none', videoMode: 'none' }),
  ])
  expect(Object.keys(destinationNotesZip.files).filter(path => path.startsWith('ppt/notesSlides/')).sort()).toEqual(Object.keys(sourceNotesZip.files).filter(path => path.startsWith('ppt/notesSlides/')).sort())
  expect(destinationNotesParsed.slides[0]!.note).toContain('Opening speaker remark')
  expect(stripParserMedia(destinationNotesParsed)).toEqual(stripParserMedia(sourceNotesParsed))
  await closeEditors(sourceContext, destinationContext)
})

test('lossless PNG export captures the same selected slide raster at source size', async ({ browser }) => {
  test.setTimeout(90_000)
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await Promise.all([
    vue.locator('.thumbnail-item').nth(2).click(),
    react.locator('.mona-thumbnail-item').nth(2).click(),
  ])
  await openExport(vue, react)
  await Promise.all([
    vue.locator('.export-dialog .tabs .tab').nth(2).click(),
    react.locator('.mona-export-tabs button').nth(2).click(),
  ])
  await Promise.all([
    vue.locator('.export-img-dialog').getByRole('button', { name: 'PNG' }).click(),
    react.locator('.mona-export-image-panel').getByRole('button', { name: 'PNG' }).click(),
  ])
  await Promise.all([
    vue.locator('.export-img-dialog').getByRole('button', { name: 'Current slide' }).click(),
    react.locator('.mona-export-image-panel').getByRole('button', { name: 'Current slide' }).click(),
  ])
  const [sourceDownload, destinationDownload] = await Promise.all([
    Promise.all([vue.waitForEvent('download', { timeout: 60_000 }), vue.locator('.export-img-dialog .export').click()]).then(([download]) => download),
    Promise.all([react.waitForEvent('download', { timeout: 60_000 }), react.locator('.mona-export-image-panel .mona-export-submit').click()]).then(([download]) => download),
  ])
  expect(destinationDownload.suggestedFilename()).toBe(sourceDownload.suggestedFilename())
  const [sourcePng, destinationPng] = await Promise.all([downloadBuffer(sourceDownload), downloadBuffer(destinationDownload)]).then(buffers => buffers.map(buffer => PNG.sync.read(buffer)))
  expect({ height: destinationPng.height, width: destinationPng.width }).toEqual({ height: sourcePng.height, width: sourcePng.width })
  expect(destinationPng.width).toBe(1600)
  const visible = pixelmatch(sourcePng.data, destinationPng.data, null, sourcePng.width, sourcePng.height, { threshold: 0.01 })
  expect(visible).toBe(0)
  await closeEditors(sourceContext, destinationContext)
})

test('image-only PPTX embeds the same full-slide raster and reopens as one image slide', async ({ browser }) => {
  test.setTimeout(90_000)
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await Promise.all([vue.locator('.thumbnail-item').nth(2).click(), react.locator('.mona-thumbnail-item').nth(2).click()])
  await openExport(vue, react)
  await Promise.all([
    vue.locator('.export-pptx-dialog').getByRole('button', { name: 'Current slide' }).click(),
    react.locator('.mona-export-pptx-panel').getByRole('button', { name: 'Current slide' }).click(),
  ])
  await Promise.all([
    vue.locator('.export-pptx-dialog').getByRole('button', { name: 'Images only' }).click(),
    react.locator('.mona-export-pptx-panel').getByRole('button', { name: 'Images only' }).click(),
  ])
  const [sourceDownload, destinationDownload] = await Promise.all([
    Promise.all([vue.waitForEvent('download', { timeout: 60_000 }), vue.locator('.export-pptx-dialog .export').click()]).then(([download]) => download),
    Promise.all([react.waitForEvent('download', { timeout: 60_000 }), react.locator('.mona-export-pptx-panel .mona-export-submit').click()]).then(([download]) => download),
  ])
  const [sourceBuffer, destinationBuffer] = await Promise.all([downloadBuffer(sourceDownload), downloadBuffer(destinationDownload)])
  const [sourceZip, destinationZip, sourceParsed, destinationParsed] = await Promise.all([
    JSZip.loadAsync(sourceBuffer), JSZip.loadAsync(destinationBuffer),
    parsePptx(toArrayBuffer(sourceBuffer), { audioMode: 'none', imageMode: 'none', videoMode: 'none' }),
    parsePptx(toArrayBuffer(destinationBuffer), { audioMode: 'none', imageMode: 'none', videoMode: 'none' }),
  ])
  const sourceMedia = Object.keys(sourceZip.files).find(path => /^ppt\/media\/image.+\.jpeg$/.test(path))!
  const destinationMedia = Object.keys(destinationZip.files).find(path => /^ppt\/media\/image.+\.jpeg$/.test(path))!
  expect(await destinationZip.file(destinationMedia)!.async('base64')).toBe(await sourceZip.file(sourceMedia)!.async('base64'))
  expect(stripParserMedia(destinationParsed)).toEqual(stripParserMedia(sourceParsed))
  expect(destinationParsed.slides).toHaveLength(1)
  expect(destinationParsed.slides[0]!.elements.map(element => element.type)).toEqual(['image'])
  await closeEditors(sourceContext, destinationContext)
})

test('PDF printing preserves source page size, margins, slide grouping, and current-slide behavior', async ({ browser }) => {
  const { destinationContext, react, sourceContext, vue } = await openEditors(browser)
  await openExport(vue, react)
  await Promise.all([
    vue.locator('.export-dialog .tabs .tab').nth(4).click(),
    react.locator('.mona-export-tabs button').nth(4).click(),
  ])
  const preservePrintFrame = (page: Page) => page.evaluate(() => {
    const capture = (element: Element) => {
      if (element instanceof HTMLIFrameElement) (window as unknown as { __PRINT_FRAME__?: HTMLIFrameElement }).__PRINT_FRAME__ = element
    }
    const removeChild = Node.prototype.removeChild
    Node.prototype.removeChild = function <T extends Node>(child: T): T {
      if (child instanceof HTMLIFrameElement) {
        capture(child); return child 
      }
      return removeChild.call(this, child) as T
    }
    const remove = Element.prototype.remove
    Element.prototype.remove = function() {
      if (this instanceof HTMLIFrameElement) {
        capture(this); return 
      }
      remove.call(this)
    }
  })
  await Promise.all([preservePrintFrame(vue), preservePrintFrame(react)])
  await Promise.all([
    vue.locator('.export-pdf-dialog .select').click(),
    react.locator('.mona-export-pdf-panel .mona-panel-select').click(),
  ])
  await Promise.all([
    vue.locator('.options:visible .option').filter({ hasText: /^2$/ }).click(),
    react.locator('.mona-panel-select-popover:visible .mona-panel-select-option').filter({ hasText: /^2$/ }).click(),
  ])
  await Promise.all([
    vue.locator('.export-pdf-dialog .export').click(),
    react.locator('.mona-export-pdf-panel .mona-export-submit').click(),
  ])
  await Promise.all([vue.waitForTimeout(200), react.waitForTimeout(200)])
  const printState = (page: Page, app: 'react' | 'vue') => page.evaluate(name => {
    const frames = document.querySelectorAll('iframe')
    const frame = frames.item(frames.length - 1) || (window as unknown as { __PRINT_FRAME__?: HTMLIFrameElement }).__PRINT_FRAME__
    const documentNode = frame?.contentDocument
    return {
      breaks: documentNode?.querySelectorAll(name === 'vue' ? '.thumbnail.break-page' : '.mona-export-pdf-thumbnail.break-page').length,
      slides: documentNode?.querySelectorAll(name === 'vue' ? 'body > .thumbnail' : 'body > .mona-export-pdf-thumbnail').length,
      style: documentNode?.querySelector('style')?.textContent.match(/@page\s*\{[^}]+\}/)?.[0].replace(/\s+/g, ''),
    }
  }, app)
  const sourceAll = await printState(vue, 'vue')
  const destinationAll = await printState(react, 'react')
  expect(destinationAll).toEqual(sourceAll)
  expect(destinationAll).toMatchObject({ breaks: 4, slides: 9 })
  expect(destinationAll.style).toContain('size:1700px1909.4999999999998px')
  expect(destinationAll.style).toContain('margin:50px')

  await Promise.all([
    vue.locator('.export-pdf-dialog').getByRole('button', { name: 'Current slide' }).click(),
    react.locator('.mona-export-pdf-panel').getByRole('button', { name: 'Current slide' }).click(),
  ])
  await Promise.all([
    vue.locator('.export-pdf-dialog .switch').click(),
    react.locator('.mona-export-pdf-panel').getByRole('switch').click(),
  ])
  await Promise.all([
    vue.locator('.export-pdf-dialog .export').click(),
    react.locator('.mona-export-pdf-panel .mona-export-submit').click(),
  ])
  await Promise.all([vue.waitForTimeout(200), react.waitForTimeout(200)])
  const sourceCurrent = await printState(vue, 'vue')
  const destinationCurrent = await printState(react, 'react')
  expect(destinationCurrent).toEqual(sourceCurrent)
  expect(destinationCurrent).toMatchObject({ breaks: 0, slides: 1 })
  expect(destinationCurrent.style).toContain('size:1600px904.4999999999999px')
  expect(destinationCurrent.style).toContain('margin:0px')
  await closeEditors(sourceContext, destinationContext)
})
