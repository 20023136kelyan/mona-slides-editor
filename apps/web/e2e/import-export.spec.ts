import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

const TEXT_CORPUS_PPTX = fileURLToPath(new URL(
  '../../../tests/corpus/public/corpus-01-text.pptx',
  import.meta.url,
))

const createNewPresentation = async (page: Page) => {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New presentation' }).click()
  await page.getByRole('button', { name: 'Create new' }).click()
  await expect.poll(() => page.evaluate(() => (
    window.__MONA_TEST__!.getState().presentation.slides.length
  ))).toBe(1)
  await expect.poll(() => page.evaluate(() => (
    window.__MONA_TEST__!.getState().presentation.slides[0]!.elements.length
  ))).toBe(0)
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US'))
  await page.goto('/?developmentFixture=slides')
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
})

test('imports a real PPTX, preserves edits in JSON and Mona artifacts, and recovers safely from invalid input', async ({ page }) => {
  await createNewPresentation(page)
  await page.locator('input[type="file"][accept^="application/vnd.openxmlformats"]').setInputFiles(TEXT_CORPUS_PPTX)

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

  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Export' })
  await dialog.getByRole('tab', { name: 'Export JSON' }).click()
  const [jsonDownload] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export JSON' }).click(),
  ])
  expect(jsonDownload.suggestedFilename()).toBe('Lifecycle Corpus Text.json')
  const jsonPath = await jsonDownload.path()
  expect(jsonPath).not.toBeNull()
  const jsonPayload = JSON.parse(await readFile(jsonPath!, 'utf8')) as {
    slides: Array<{ elements: unknown[] }>
    title: string
  }
  expect(jsonPayload.title).toBe('Lifecycle: Corpus / Text?')
  expect(jsonPayload.slides).toHaveLength(1)
  expect(jsonPayload.slides[0]!.elements).toHaveLength(5)

  await dialog.getByRole('tab', { name: 'Export Mona file' }).click()
  const [nativeDownload] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export Mona file' }).click(),
  ])
  expect(nativeDownload.suggestedFilename()).toBe('Lifecycle Corpus Text.mona')
  const nativePath = await nativeDownload.path()
  expect(nativePath).not.toBeNull()
  const nativeArtifact = await readFile(nativePath!)
  await dialog.getByRole('button', { name: 'Close' }).click()

  await createNewPresentation(page)
  await page.locator('input[type="file"][accept^=".mona"]').setInputFiles({
    buffer: nativeArtifact,
    mimeType: 'application/x-mona-presentation',
    name: 'lifecycle-round-trip.mona',
  })
  await expect.poll(() => page.evaluate(() => (
    window.__MONA_TEST__!.getState().presentation.title
  ))).toBe('Lifecycle: Corpus / Text?')
  await expect.poll(() => page.evaluate(() => (
    window.__MONA_TEST__!.getState().presentation.slides[0]!.elements.length
  ))).toBe(5)

  await createNewPresentation(page)
  const presentationBeforeFailure = await page.evaluate(() => (
    structuredClone(window.__MONA_TEST__!.getState().presentation)
  ))
  await page.locator('input[type="file"][accept=".json"]').setInputFiles({
    buffer: Buffer.from('not valid JSON'),
    mimeType: 'application/json',
    name: 'broken.json',
  })
  await expect(page.getByText('This file could not be read or parsed')).toBeVisible()
  expect(await page.evaluate(() => (
    structuredClone(window.__MONA_TEST__!.getState().presentation)
  ))).toEqual(presentationBeforeFailure)
})

test('exports an editable PPTX that can be imported back into Mona', async ({ page }) => {
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

  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Export' })
  const [pptxDownload] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export PPTX' }).click(),
  ])
  expect(pptxDownload.suggestedFilename()).toBe('Untitled presentation.pptx')
  const pptxPath = await pptxDownload.path()
  expect(pptxPath).not.toBeNull()
  const pptxArtifact = await readFile(pptxPath!)

  await dialog.getByRole('button', { name: 'Close' }).click()
  await createNewPresentation(page)
  await page.locator('input[type="file"][accept^="application/vnd.openxmlformats"]').setInputFiles({
    buffer: pptxArtifact,
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    name: 'round-trip.pptx',
  })

  await expect.poll(() => page.evaluate(() => (
    window.__MONA_TEST__!.getState().presentation.slides.length
  )), { timeout: 30_000 }).toBe(source.slideCount)
  await expect(page.locator('.mona-editor-slide-canvas').getByText('Native, editable presentations in the browser.', { exact: true })).toBeVisible()
  expect(source.text).toContain('Native, editable presentations in the browser.')
})
