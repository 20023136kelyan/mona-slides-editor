import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { ElectronApplication } from '@playwright/test'

import {
  chooseMenuCommand,
  configureLocalSaveFolder,
  expect,
  openApp,
  reloadApp,
  test,
  type Page,
} from './electron-fixture'

declare global {
  interface Window {
    __MONA_TEST__?: {
      getState: () => { presentation: { slides: Array<{ id: string }>; title: string } }
    }
  }
}

const currentDocumentId = (page: Page) => {
  const match = new URL(page.url()).pathname.match(/^\/documents\/([^/]+)$/)
  if (!match?.[1]) throw new Error(`No document route is open: ${page.url()}`)
  return decodeURIComponent(match[1])
}

const storedDeckIncludes = async (
  app: ElectronApplication,
  documentId: string,
  needle: string,
) => {
  const userData = await app.evaluate(({ app: electron }) => electron.getPath('userData'))
  const contents = await readFile(
    join(userData, 'documents', documentId, 'deck.json'),
    'utf8',
  ).catch(() => '')
  return contents.includes(needle)
}

const renameOpenPresentation = async (page: Page, title: string) => {
  const input = page.getByRole('textbox', { name: 'Presentation title' })
  await input.click()
  await input.fill(title)
  await input.press('Enter')
  await expect(input).toHaveValue(title)
}

test.beforeEach(async ({ app, page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US'))
  await openApp(page)
  await configureLocalSaveFolder(app, page, join(testInfo.outputDir, 'presentations'))
  await page.getByRole('button', { name: 'New presentation' }).first().click()
  await page.waitForURL(/\/documents\/[^/?]+/)
  await page.goto(`${page.url()}?persistTest=1`)
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
})

test('a document autosaves, survives reload, and reopens from Home', async ({ app, page }) => {
  const documentId = currentDocumentId(page)
  await renameOpenPresentation(page, 'Persistence deck')

  await expect.poll(
    () => storedDeckIncludes(app, documentId, 'Persistence deck'),
    { timeout: 10_000 },
  ).toBe(true)

  await reloadApp(page)
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Presentation title' })).toHaveValue('Persistence deck')

  await page.getByRole('button', { name: 'All presentations' }).click()
  await expect(page.getByRole('heading', { name: 'Presentations', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open Persistence deck.mona' }).click()
  await expect(page).toHaveURL(new RegExp(`/documents/${documentId}$`))
  await expect(page.getByRole('textbox', { name: 'Presentation title' })).toHaveValue('Persistence deck')
})

test('new presentation creates a second document without replacing the first', async ({ app, page }) => {
  const firstId = currentDocumentId(page)
  await renameOpenPresentation(page, 'First deck')
  await expect.poll(() => storedDeckIncludes(app, firstId, 'First deck')).toBe(true)

  await chooseMenuCommand(app, 'file.new', page)
  await expect.poll(() => currentDocumentId(page)).not.toBe(firstId)
  await page.goto(`${page.url()}?persistTest=1`)
  const secondId = currentDocumentId(page)
  expect(secondId).not.toBe(firstId)
  await renameOpenPresentation(page, 'Second deck')
  await expect.poll(() => storedDeckIncludes(app, secondId, 'Second deck')).toBe(true)

  await page.getByRole('button', { name: 'All presentations' }).click()
  await expect(page.getByRole('button', { name: 'Open First deck.mona' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open Second deck.mona' })).toBeVisible()

  await page.getByRole('button', { name: 'Open First deck.mona' }).click()
  await expect(page.getByRole('textbox', { name: 'Presentation title' })).toHaveValue('First deck')
})

test('development fixtures bypass the document library', async ({ app, page }) => {
  const documentId = currentDocumentId(page)
  await renameOpenPresentation(page, 'FIXTURE-GUARD')
  await expect.poll(() => storedDeckIncludes(app, documentId, 'FIXTURE-GUARD')).toBe(true)

  await openApp(page, '?developmentFixture=editor-interactions')
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Presentation title' })).not.toHaveValue('FIXTURE-GUARD')
  await expect(page).toHaveURL(/\?developmentFixture=editor-interactions/)
})
