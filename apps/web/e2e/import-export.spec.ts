import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ElectronApplication } from '@playwright/test'

import { chooseMenuCommand, expect, importFile, openApp, stubSaveDialog, test, type Page } from './electron-fixture'

const TEXT_CORPUS_PPTX = fileURLToPath(new URL(
  '../../../tests/corpus/public/corpus-01-text.pptx',
  import.meta.url,
))

const createNewPresentation = async (app: ElectronApplication, page: Page) => {
  await chooseMenuCommand(app, 'file.new', page)
  await page.getByRole('button', { name: 'Create new' }).click()
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
})

test('imports a real PPTX, preserves edits in JSON and Mona artifacts, and recovers safely from invalid input', async ({ app, page }, testInfo) => {
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

  await chooseMenuCommand(app, 'file.export.json', page)
  const dialog = page.getByRole('dialog', { name: 'Export' })
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
