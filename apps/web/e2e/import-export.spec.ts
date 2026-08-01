import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ElectronApplication } from '@playwright/test'

import { ingestPowerPoint } from '@mona/pptx-ingestion'
import {
  flattenElementTree,
  type SlideTheme,
} from '@mona/presentation-core'

import { chooseMenuCommand, configureLocalSaveFolder, expect, importFile, openApp, stubSaveDialog, test, type Page } from './electron-fixture'

const TEXT_CORPUS_PPTX = fileURLToPath(new URL(
  '../../../tests/corpus/public/corpus-01-text.pptx',
  import.meta.url,
))
const LINE_CORPUS_PPTX = fileURLToPath(new URL(
  '../../../tests/corpus/public/corpus-02-shapes-lines.pptx',
  import.meta.url,
))

const createNewPresentation = async (app: ElectronApplication, page: Page) => {
  await chooseMenuCommand(app, 'file.new', page)
  await page.waitForURL(/\/documents\/[^/?]+/)
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (
    window.__MONA_TEST__!.getState().presentation.slides.length
  ))).toBe(1)
  await expect.poll(() => page.evaluate(() => (
    window.__MONA_TEST__!.getState().presentation.slides[0]!.elements.length
  ))).toBe(0)
}

test.beforeEach(async ({ app, page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US'))
  await openApp(page, '?developmentFixture=slides')
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
  await configureLocalSaveFolder(app, page, join(testInfo.outputDir, 'presentations'))
})

test('imports a real PPTX, preserves edits in JSON and Mona artifacts, and recovers safely from invalid input', async ({ app, page }, testInfo) => {
  test.setTimeout(90_000)
  await createNewPresentation(app, page)
  await importFile(app, 'pptx', TEXT_CORPUS_PPTX, page)

  await expect.poll(() => page.evaluate(() => (
    window.__MONA_TEST__!.getState().presentation.slides[0]!.elements.length
  )), { timeout: 30_000 }).toBe(5)
  await expect(page.locator('.mona-editor-slide-canvas').getByText('Corpus 01 — Text fidelity', { exact: true })).toBeVisible()

  const title = page.getByRole('textbox', { name: 'Presentation title' })
  await title.click()
  await title.fill('Lifecycle: Corpus / Text?')
  await title.press('Enter')
  await expect.poll(() => page.evaluate(() => (
    window.__MONA_TEST__!.getState().presentation.title
  ))).toBe('Lifecycle: Corpus / Text?')

  await chooseMenuCommand(app, 'file.export.pptx', page)
  const dialog = page.getByRole('dialog', { name: 'Export' })
  const preservedPptxPath = join(testInfo.outputDir, 'Lifecycle Corpus Text.pptx')
  await stubSaveDialog(app, preservedPptxPath)
  await dialog.getByRole('button', { name: 'Export', exact: true }).click()
  await expect.poll(
    () => readFile(preservedPptxPath).then(() => true, () => false),
    { timeout: 30_000 },
  ).toBe(true)
  expect(
    (await readFile(preservedPptxPath)).equals(await readFile(TEXT_CORPUS_PPTX)),
  ).toBe(true)
  await dialog.getByRole('button', { name: 'Close' }).click()

  const transformTarget = await page.evaluate(() => {
    const presentation = window.__MONA_TEST__!.getState().presentation
    const element = presentation.slides
      .flatMap(slide => slide.elements)
      .find(candidate => (
        candidate.type !== 'line'
        && candidate.source?.sourceLayer === 'slide'
        && candidate.source.sourcePart === candidate.source.slidePart
        && candidate.width > 0
        && candidate.height > 0
      ))
    if (!element) return null
    return {
      id: element.id,
      left: element.left,
      nativeShapeId: element.source?.nativeShapeId,
      sourcePart: element.source?.sourcePart,
      theme: presentation.theme,
    }
  })
  expect(transformTarget).not.toBeNull()
  await page.locator(
    `.mona-editor-slide-canvas [data-element-id="${transformTarget!.id}"]`,
  ).click({ position: { x: 4, y: 4 } })
  await expect.poll(() => page.evaluate(targetId => (
    window.__MONA_TEST__!.getState().session.activeElementIds.includes(targetId)
  ), transformTarget!.id)).toBe(true)
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => page.evaluate(targetId => (
    window.__MONA_TEST__!.getState().presentation.slides
      .flatMap(slide => slide.elements)
      .find(element => element.id === targetId)?.left
  ), transformTarget!.id)).toBeCloseTo(transformTarget!.left + 1, 5)

  const textSurface = page.locator('.mona-editor-slide-canvas')
    .getByText('Corpus 01 — Text fidelity', { exact: true })
  const textElement = textSurface.locator('xpath=ancestor::*[@data-element-id][1]')
  await textElement.click({ position: { x: 30, y: 20 } })
  await textElement.dblclick({ position: { x: 30, y: 20 } })
  const richTextEditor = textElement.locator('.ProseMirror')
  await expect(richTextEditor).toBeVisible()
  await richTextEditor.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' AI-EDIT')
  await expect.poll(() => page.evaluate(() => (
    JSON.stringify(window.__MONA_TEST__!.getState().presentation.slides)
  ))).toContain('AI-EDIT')

  await chooseMenuCommand(app, 'file.export.pptx', page)
  const editedPptxPath = join(testInfo.outputDir, 'Lifecycle Corpus Text edited.pptx')
  await stubSaveDialog(app, editedPptxPath)
  await dialog.getByRole('button', { name: 'Export', exact: true }).click()
  await expect.poll(
    () => readFile(editedPptxPath).then(() => true, () => false),
    { timeout: 30_000 },
  ).toBe(true)
  expect(
    (await readFile(editedPptxPath)).equals(await readFile(TEXT_CORPUS_PPTX)),
  ).toBe(false)
  const editedBytes = await readFile(editedPptxPath)
  const reimported = await ingestPowerPoint(
    editedBytes.buffer.slice(
      editedBytes.byteOffset,
      editedBytes.byteOffset + editedBytes.byteLength,
    ) as ArrayBuffer,
    {
      fileName: 'Lifecycle Corpus Text edited.pptx',
      theme: transformTarget!.theme as SlideTheme,
    },
  )
  const roundTripped = reimported.presentation.slides
    .flatMap(slide => flattenElementTree(slide.elements))
    .find(element => (
      element.source?.nativeShapeId === transformTarget!.nativeShapeId
      && element.source?.sourcePart === transformTarget!.sourcePart
    ))
  expect(roundTripped?.left).toBeCloseTo(transformTarget!.left + 1, 2)
  const roundTrippedText = reimported.presentation.slides
    .flatMap(slide => flattenElementTree(slide.elements))
    .find(element => (
      (element.type === 'text' && element.content.includes('AI-EDIT'))
      || (element.type === 'shape' && element.text?.content.includes('AI-EDIT'))
    ))
  const roundTrippedContent = roundTrippedText?.type === 'text'
    ? roundTrippedText.content
    : roundTrippedText?.type === 'shape'
      ? roundTrippedText.text?.content
      : undefined
  expect(roundTrippedContent).toContain('AI-EDIT')

  await chooseMenuCommand(app, 'file.export.json', page)
  const jsonPath = join(testInfo.outputDir, 'Lifecycle Corpus Text.json')
  await stubSaveDialog(app, jsonPath)
  await dialog.getByRole('button', { name: 'Export', exact: true }).click()
  await expect.poll(() => readFile(jsonPath, 'utf8').then(() => true, () => false)).toBe(true)
  const jsonPayload = JSON.parse(await readFile(jsonPath, 'utf8')) as {
    slides: Array<{ elements: unknown[] }>
    title: string
  }
  expect(jsonPayload.title).toBe('Lifecycle: Corpus / Text?')
  expect(jsonPayload.slides).toHaveLength(1)
  expect(jsonPayload.slides[0]!.elements).toHaveLength(5)

  await chooseMenuCommand(app, 'file.export.native', page)
  const nativePath = join(testInfo.outputDir, 'Lifecycle Corpus Text.mona')
  await stubSaveDialog(app, nativePath)
  await dialog.getByRole('button', { name: 'Export', exact: true }).click()
  await expect.poll(() => readFile(nativePath).then(() => true, () => false)).toBe(true)
  await dialog.getByRole('button', { name: 'Close' }).click()

  await createNewPresentation(app, page)
  await importFile(app, 'native', nativePath, page)
  await expect.poll(() => page.evaluate(() => (
    window.__MONA_TEST__!.getState().presentation.title
  ))).toBe('Lifecycle: Corpus / Text?')
  await expect.poll(() => page.evaluate(() => (
    window.__MONA_TEST__!.getState().presentation.slides[0]!.elements.length
  ))).toBe(5)

  await createNewPresentation(app, page)
  const presentationBeforeFailure = await page.evaluate(() => (
    structuredClone(window.__MONA_TEST__!.getState().presentation)
  ))
  // A real file, because the dialog hands back bytes read off disk.
  const brokenPath = join(testInfo.outputDir, 'broken.json')
  await writeFile(brokenPath, 'not valid JSON')
  await importFile(app, 'json', brokenPath, page)
  await expect(page.getByText('This file could not be read or parsed')).toBeVisible()
  expect(await page.evaluate(() => (
    structuredClone(window.__MONA_TEST__!.getState().presentation)
  ))).toEqual(presentationBeforeFailure)
})

test('exports an editable PPTX that can be imported back into Mona', async ({ app, page }, testInfo) => {
  test.setTimeout(90_000)
  const source = await page.evaluate(() => {
    const presentation = window.__MONA_TEST__!.getState().presentation
    return {
      slideCount: presentation.slides.length,
      text: presentation.slides[0]!.elements
        .filter(element => element.type === 'text' || element.type === 'shape')
        .map(element => 'content' in element ? element.content : '')
        .join(' '),
    }
  })

  await chooseMenuCommand(app, 'file.export.pptx', page)
  const dialog = page.getByRole('dialog', { name: 'Export' })
  const pptxPath = join(testInfo.outputDir, 'Untitled presentation.pptx')
  await stubSaveDialog(app, pptxPath)
  await dialog.getByRole('button', { name: 'Export', exact: true }).click()
  await expect.poll(() => readFile(pptxPath).then(() => true, () => false), { timeout: 30_000 }).toBe(true)

  await dialog.getByRole('button', { name: 'Close' }).click()
  await createNewPresentation(app, page)
  await importFile(app, 'pptx', pptxPath, page)

  await expect.poll(() => page.evaluate(() => (
    window.__MONA_TEST__!.getState().presentation.slides.length
  )), { timeout: 30_000 }).toBe(source.slideCount)
  await expect(page.locator('.mona-editor-slide-canvas').getByText('Native, editable presentations in the browser.', { exact: true })).toBeVisible()
  expect(source.text).toContain('Native, editable presentations in the browser.')
})

test('moves a native straight line in the editor and exports the geometry through retained OOXML', async ({ app, page }, testInfo) => {
  test.setTimeout(90_000)
  await createNewPresentation(app, page)
  await importFile(app, 'pptx', LINE_CORPUS_PPTX, page)
  const readTarget = () => page.evaluate(() => {
    const line = window.__MONA_TEST__!.getState().presentation.slides
      .flatMap(slide => slide.elements)
      .find(element => (
        element.type === 'line'
        && !element.broken
        && !element.broken2
        && !element.curve
        && !element.cubic
        && !element.source?.connector?.start
        && !element.source?.connector?.end
        && element.source?.sourceLayer === 'slide'
      ))
    if (!line || line.type !== 'line') return null
    return {
      end: [line.left + line.end[0], line.top + line.end[1]],
      id: line.id,
      nativeShapeId: line.source?.nativeShapeId,
      sourcePart: line.source?.sourcePart,
      start: [line.left + line.start[0], line.top + line.start[1]],
      theme: window.__MONA_TEST__!.getState().presentation.theme,
    }
  })
  await expect.poll(readTarget, { timeout: 30_000 }).not.toBeNull()
  const target = await readTarget()
  const line = target as unknown as {
    end: [number, number]
    id: string
    nativeShapeId?: string
    sourcePart?: string
    start: [number, number]
    theme: SlideTheme
  }
  await page.getByRole('button', { name: `Select line ${line.id}` }).click()
  await expect.poll(() => page.evaluate(id => (
    window.__MONA_TEST__!.getState().session.activeElementIds.includes(id)
  ), line.id)).toBe(true)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => page.evaluate(id => {
    const selected = window.__MONA_TEST__!.getState().presentation.slides
      .flatMap(slide => slide.elements)
      .find(element => element.id === id)
    return selected?.type === 'line'
      ? [selected.left + selected.start[0], selected.top + selected.start[1]]
      : null
  }, line.id)).toEqual([line.start[0] + 1, line.start[1] + 1])

  await chooseMenuCommand(app, 'file.export.pptx', page)
  const dialog = page.getByRole('dialog', { name: 'Export' })
  const output = join(testInfo.outputDir, 'line-edited.pptx')
  await stubSaveDialog(app, output)
  await dialog.getByRole('button', { name: 'Export', exact: true }).click()
  await expect.poll(() => readFile(output).then(() => true, () => false), { timeout: 30_000 }).toBe(true)
  const bytes = await readFile(output)
  const reimported = await ingestPowerPoint(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    { fileName: 'line-edited.pptx', theme: line.theme },
  )
  const roundTripped = reimported.presentation.slides
    .flatMap(slide => flattenElementTree(slide.elements))
    .find(element => (
      element.source?.nativeShapeId === line.nativeShapeId
      && element.source?.sourcePart === line.sourcePart
    ))
  expect(roundTripped?.type).toBe('line')
  if (roundTripped?.type !== 'line') return
  expect(roundTripped.left + roundTripped.start[0]).toBeCloseTo(line.start[0] + 1, 2)
  expect(roundTripped.top + roundTripped.start[1]).toBeCloseTo(line.start[1] + 1, 2)
  expect(roundTripped.left + roundTripped.end[0]).toBeCloseTo(line.end[0] + 1, 2)
  expect(roundTripped.top + roundTripped.end[1]).toBeCloseTo(line.end[1] + 1, 2)
})
