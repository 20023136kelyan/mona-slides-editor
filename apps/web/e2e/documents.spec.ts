import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import JSZip from 'jszip'

import {
  expect,
  openApp,
  RENDERER_URL,
  resizeWindow,
  stubOpenDialog,
  test,
} from './electron-fixture'

const renameOpenPresentation = async (page: Parameters<typeof openApp>[0], title: string) => {
  const input = page.getByRole('textbox', { name: 'Presentation title' })
  await input.click()
  await input.fill(title)
  await input.press('Enter')
  await expect(input).toHaveValue(title)
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US'))
})

test('lays out a dense presentation library with real reusable covers', async ({ app, page }, testInfo) => {
  const viewport = await resizeWindow(app, 1440, 900)
  test.skip(!viewport.fits, `needs a 1440x900 window; this display is ${viewport.display}`)
  const localFiles = join(testInfo.outputDir, 'Presentations')
  await mkdir(localFiles, { recursive: true })
  await openApp(page)
  await stubOpenDialog(app, [localFiles])
  await page.getByRole('button', { name: 'New presentation' }).first().click()
  await page.waitForURL(/\/documents\/[^/?]+/)
  await page.goto(`${page.url()}?persistTest=1`)
  const originalId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1)!
  await page.getByRole('navigation', { name: 'Editor tools' })
    .getByRole('button', { name: 'All presentations' }).click()

  await expect.poll(() => page.evaluate(async documentId => (
    (await window.mona!.documents.list()).find(document => document.id === documentId)
      ?.thumbnailRevision
  ), originalId)).toBeTruthy()
  await page.evaluate(async ({ documentId }) => {
    const titles = [
      'Brand direction',
      'Campaign concept',
      'Customer insights',
      'Market overview',
      'Product launch',
      'Quarterly review',
      'Sales forecast',
    ]
    for (const title of titles) await window.mona!.documents.duplicate(documentId, title)
  }, { documentId: originalId })
  await page.reload()

  await expect(page.locator('[data-slot="card"]')).toHaveCount(8)
  await expect(page.getByRole('heading', { name: 'Previous 7 days' })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Grid view' })).toBeChecked()
  await expect(page.locator('img[src^="mona://preview/"]')).toHaveCount(8)
  await expect.poll(() => page.locator('img[src^="mona://preview/"]').evaluateAll(
    images => images.every(image => (image as HTMLImageElement).naturalWidth > 0),
  )).toBe(true)
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('presentation-library.png'),
  })
  await page.getByRole('radio', { name: 'List view' }).click()
  await expect(page.locator('[data-slot="card"]')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('radio', { name: 'List view' })).toBeChecked()
  await page.getByRole('button', { name: 'Group' }).click()
  await page.getByRole('menuitemradio', { name: 'No grouping' }).click()
  await expect(page.getByRole('heading', { name: 'Previous 7 days' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Sort' }).click()
  await page.getByRole('menuitemradio', { name: 'Name' }).click()
  const openLabels = await page.getByRole('button', { name: /^Open / }).allInnerTexts()
  expect(openLabels).toEqual([...openLabels].sort((a, b) => a.localeCompare(b, 'en-US', { numeric: true })))
})

test('creates, autosaves, manages, and reopens user-owned local files', async ({ app, page }, testInfo) => {
  const localFiles = join(testInfo.outputDir, 'Local presentations')
  await mkdir(localFiles, { recursive: true })
  await openApp(page)
  await expect(page.getByText('Create your first presentation')).toBeVisible()
  const emptyState = page.locator('[data-slot="empty"]')
  await expect(emptyState).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(emptyState).toHaveCSS('border-top-width', '0px')
  await expect(emptyState).toHaveCSS('box-shadow', 'none')
  await stubOpenDialog(app, [localFiles])
  await page.getByRole('button', { name: 'New presentation' }).first().click()
  await page.waitForURL(/\/documents\/[^/?]+/)
  await page.goto(`${page.url()}?persistTest=1`)
  await renameOpenPresentation(page, 'Quarterly review')
  const originalId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1)!

  await page.getByRole('navigation', { name: 'Editor tools' })
    .getByRole('button', { name: 'All presentations' }).click()
  await expect(page.getByRole('button', { name: 'Open Quarterly review.mona' })).toBeVisible()
  const cover = page.locator('img[src^="mona://preview/document/"]').first()
  await expect(cover).toBeVisible()
  expect(await cover.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await expect(stat(join(localFiles, 'Quarterly review.mona'))).resolves.toBeTruthy()
  const packageSignature = await readFile(join(localFiles, 'Quarterly review.mona'))
  expect([...packageSignature.subarray(0, 2)]).toEqual([0x50, 0x4b])
  const archive = await JSZip.loadAsync(packageSignature)
  expect(archive.file('previews/cover.webp')).not.toBeNull()
  expect(archive.file('previews/cover.json')).not.toBeNull()
  const configuredSources = await page.evaluate(() => window.mona!.dataSources.list())
  expect(configuredSources).toMatchObject([{
    isDefaultSaveLocation: true,
    name: 'Local presentations',
  }])

  // Seed document-owned data after leaving the editor. The live editor
  // deliberately garbage-collects retained PPTX packages that are not
  // referenced by its presentation model, while this record exists only to
  // prove that duplicating a document copies its complete on-disk directory.
  await page.evaluate(async documentId => {
    await window.mona!.documentData.sketches.write(documentId, 'slide-secondary-data', {
      scene: { elements: [{ id: 'stroke-1', type: 'freedraw' }] },
      slideId: 'slide-secondary-data',
      updatedAt: 1_700_000_000_000,
      version: 1,
    })
    await window.mona!.documentData.powerpointPackages.write(documentId, 'pptx:test-package', {
      bytes: new Uint8Array([1, 2, 3]),
      marker: 'retained-source',
      version: 1,
    })
  }, originalId)

  await page.getByRole('button', { name: 'More actions for Quarterly review.mona' }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  const renameDialog = page.getByRole('dialog', { name: 'Rename presentation' })
  await renameDialog.getByLabel('Presentation name').fill('Board review')
  await renameDialog.getByRole('button', { name: 'Rename' }).click()
  await expect(page.getByRole('button', { exact: true, name: 'Open Board review.mona' })).toBeVisible()
  await expect(stat(join(localFiles, 'Board review.mona'))).resolves.toBeTruthy()

  await page.getByRole('button', { exact: true, name: 'More actions for Board review.mona' }).click()
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()
  await expect(page.getByRole('button', { name: 'Open Board review copy.mona' })).toBeVisible()
  await expect(stat(join(localFiles, 'Board review copy.mona'))).resolves.toBeTruthy()
  const copiedData = await page.evaluate(async () => {
    const copy = (await window.mona!.documents.list()).find(document => document.title === 'Board review copy')
    if (!copy) throw new Error('The duplicated document is missing from the library.')
    return {
      package: await window.mona!.documentData.powerpointPackages.read(copy.id, 'pptx:test-package'),
      sketches: await window.mona!.documentData.sketches.list(copy.id),
    }
  })
  expect(copiedData).toMatchObject({
    package: { marker: 'retained-source' },
    sketches: [{ slideId: 'slide-secondary-data' }],
  })

  const search = page.getByRole('searchbox', { name: 'Search presentations' })
  await search.fill('copy')
  await expect(page.getByRole('button', { name: 'Open Board review copy.mona' })).toBeVisible()
  await expect(page.getByRole('button', { exact: true, name: 'Open Board review.mona' })).toHaveCount(0)
  await search.clear()

  await page.getByRole('button', { name: 'More actions for Board review copy.mona' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  const deleteDialog = page.getByRole('alertdialog', { name: 'Delete presentation?' })
  await expect(deleteDialog).toContainText('Board review copy')
  await deleteDialog.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('button', { name: 'Open Board review copy.mona' })).toHaveCount(0)
  await expect(stat(join(localFiles, 'Board review copy.mona'))).rejects.toThrow()

  await page.getByRole('button', { exact: true, name: 'Open Board review.mona' }).click()
  await expect(page.getByRole('textbox', { name: 'Presentation title' })).toHaveValue('Board review')
})

test('connects, filters, watches, reopens, and removes a local-folder data source', async ({ app, page }, testInfo) => {
  const sourceRoot = join(testInfo.outputDir, 'Design files')
  const nestedRoot = join(sourceRoot, 'Nested')
  const emptyRoot = join(sourceRoot, 'Empty folder')
  const unsupportedRoot = join(sourceRoot, 'Unsupported only')
  const fixture = join(import.meta.dirname, '../../../tests/corpus/public/corpus-01-text.pptx')
  await Promise.all([
    mkdir(nestedRoot, { recursive: true }),
    mkdir(emptyRoot, { recursive: true }),
    mkdir(unsupportedRoot, { recursive: true }),
  ])
  await Promise.all([
    copyFile(fixture, join(sourceRoot, 'Board.pptx')),
    copyFile(fixture, join(nestedRoot, 'Nested.pptx')),
    writeFile(join(sourceRoot, 'ignore.txt'), 'not a supported document'),
    writeFile(join(unsupportedRoot, 'notes.txt'), 'not a supported document'),
  ])

  await openApp(page)
  await stubOpenDialog(app, [sourceRoot])
  await page.getByRole('button', { name: 'Add local folder' }).click()

  const navigation = page.getByRole('navigation', { name: 'Mona navigation' })
  await expect(navigation.getByRole('button', { name: 'Design files', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open Board.pptx' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open Nested.pptx' })).toBeVisible()
  await expect(navigation.getByText('Board.pptx', { exact: true })).toHaveCount(0)
  await expect(navigation.getByText('Nested.pptx', { exact: true })).toHaveCount(0)
  await expect(navigation.getByRole('button', { name: 'Actions for Design files' })).toHaveCount(0)
  await expect(page.getByText('ignore.txt')).toHaveCount(0)

  const addSourceBox = await navigation.getByRole('button', { name: 'Add local folder' }).boundingBox()
  const dataSourcesLabelBox = await navigation.getByText('Data sources', { exact: true }).boundingBox()
  const disclosureBox = await navigation.locator('[data-source-disclosure="root"]').boundingBox()
  expect(addSourceBox).not.toBeNull()
  expect(dataSourcesLabelBox).not.toBeNull()
  expect(disclosureBox).not.toBeNull()
  expect(Math.abs(
    addSourceBox!.y + addSourceBox!.height / 2
      - dataSourcesLabelBox!.y - dataSourcesLabelBox!.height / 2,
  )).toBeLessThanOrEqual(0.5)
  expect(Math.abs(
    addSourceBox!.x + addSourceBox!.width / 2
      - disclosureBox!.x - disclosureBox!.width / 2,
  )).toBeLessThanOrEqual(0.5)

  await navigation.getByRole('button', { name: 'Design files', exact: true }).click()
  await expect(navigation.getByRole('button', { name: 'Nested', exact: true })).toBeVisible()
  await expect(navigation.getByRole('button', { name: 'Empty folder', exact: true })).toHaveCount(0)
  await expect(navigation.getByRole('button', { name: 'Unsupported only', exact: true })).toHaveCount(0)
  await navigation.getByRole('button', { name: 'Nested', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Open Nested.pptx' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open Board.pptx' })).toHaveCount(0)

  await copyFile(fixture, join(nestedRoot, 'Watched.pptx'))
  await expect(page.getByRole('button', { name: 'Open Watched.pptx' })).toBeVisible()
  await expect(navigation.getByText('Watched.pptx', { exact: true })).toHaveCount(0)

  await page.reload()
  await expect(navigation.getByRole('button', { name: 'Design files', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open Board.pptx' })).toBeVisible()

  await page.getByRole('button', { name: 'Open Board.pptx' }).click()
  await page.waitForURL(/\/documents\/[^/?]+/)
  const firstDocumentId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1)!
  await expect(page.getByRole('textbox', { name: 'Presentation title' })).toHaveValue('Board')
  await expect.poll(() => new URL(page.url()).searchParams.has('sourceImport')).toBe(false)
  await expect.poll(() => page.evaluate(() => (
    window.__MONA_TEST__?.getState().presentation.sourcePackages?.length ?? 0
  ))).toBe(1)

  await page.getByRole('navigation', { name: 'Editor tools' })
    .getByRole('button', { name: 'All presentations' }).click()
  await page.getByRole('button', { name: 'Open Board.pptx' }).click()
  await page.waitForURL(/\/documents\/[^/?]+/)
  expect(new URL(page.url()).pathname.split('/').filter(Boolean).at(-1)).toBe(firstDocumentId)

  await page.getByRole('navigation', { name: 'Editor tools' })
    .getByRole('button', { name: 'All presentations' }).click()
  await navigation.getByRole('button', { name: 'Design files', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Remove source' }).click()
  const removeDialog = page.getByRole('alertdialog', { name: 'Remove this data source?' })
  await expect(removeDialog).toContainText('Design files')
  await removeDialog.getByRole('button', { name: 'Remove source' }).click()
  await expect(navigation.getByRole('button', { name: 'Design files', exact: true })).toHaveCount(0)
  await expect(stat(join(sourceRoot, 'Board.pptx'))).resolves.toBeTruthy()
  await expect(page.getByRole('button', { name: 'Open Board', exact: true })).toBeVisible()
})

test('rebuilds a corrupt recovery index without orphaning local presentations', async ({ app, page }, testInfo) => {
  const localFiles = join(testInfo.outputDir, 'Presentations')
  await mkdir(localFiles, { recursive: true })
  await openApp(page)
  await stubOpenDialog(app, [localFiles])
  await page.getByRole('button', { name: 'New presentation' }).first().click()
  await page.waitForURL(/\/documents\/[^/?]+/)
  await page.goto(`${page.url()}?persistTest=1`)
  await renameOpenPresentation(page, 'Recovery one')
  await page.getByRole('button', { name: 'All presentations' }).click()

  await page.getByRole('button', { name: 'New presentation' }).first().click()
  await page.waitForURL(/\/documents\/[^/?]+/)
  await page.goto(`${page.url()}?persistTest=1`)
  await renameOpenPresentation(page, 'Recovery two')
  await page.getByRole('button', { name: 'All presentations' }).click()
  await expect(page).toHaveURL(`${RENDERER_URL}/`)
  await expect(page.getByRole('heading', { name: 'Presentations' })).toBeVisible()

  const userData = await app.evaluate(({ app: electron }) => electron.getPath('userData'))
  const libraryFile = join(userData, 'documents', 'library.json')
  await writeFile(libraryFile, '{not valid json')
  await page.reload()

  await expect(page.getByRole('button', { name: 'Open Recovery one.mona' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open Recovery two.mona' })).toBeVisible()
  const rebuilt = JSON.parse(await readFile(libraryFile, 'utf8')) as {
    documents: Array<{ title: string }>
    version: number
  }
  expect(rebuilt.version).toBe(1)
  expect(rebuilt.documents.map(document => document.title).sort()).toEqual(['Recovery one', 'Recovery two'])
})

test('keeps the previous singleton as recovery and moves it to user-owned local files', async ({ app, page }, testInfo) => {
  await openApp(page)
  const userData = await app.evaluate(({ app: electron }) => electron.getPath('userData'))
  const legacyRoot = join(userData, 'decks', 'working')
  await mkdir(join(legacyRoot, 'assets'), { recursive: true })
  await writeFile(join(legacyRoot, 'assets', 'legacy.png'), Buffer.from([1, 2, 3, 4]))
  await writeFile(join(legacyRoot, 'deck.json'), JSON.stringify({
    presentation: {
      slideIndex: 0,
      slides: [{
        background: { image: 'mona://asset/legacy.png', type: 'image' },
        elements: [],
        id: 'legacy-slide',
      }],
      templates: [],
      theme: {
        backgroundColor: '#fff',
        fontColor: '#000',
        fontName: 'Arial',
        outline: { color: '#000', style: 'solid', width: 1 },
        shadow: { blur: 0, color: '#000', h: 0, v: 0 },
        themeColors: [],
      },
      title: 'Legacy deck',
      viewportRatio: 0.5625,
      viewportSize: 1000,
    },
    savedAt: 1_700_000_000_000,
    version: 5,
  }))

  await page.goto(`${RENDERER_URL}/?migrationRefresh=1`)
  await expect(page.getByRole('button', { name: 'Open Legacy deck' })).toBeVisible()

  const index = JSON.parse(await readFile(join(userData, 'documents', 'library.json'), 'utf8')) as {
    documents: Array<{ id: string; title: string }>
  }
  expect(index.documents).toHaveLength(1)
  expect(index.documents[0]?.title).toBe('Legacy deck')
  const documentId = index.documents[0]!.id
  const migratedDeck = await readFile(
    join(userData, 'documents', documentId, 'deck.json'),
    'utf8',
  )
  expect(migratedDeck).toContain(`mona://asset/${documentId}/legacy.png`)
  await expect(stat(join(userData, 'documents', documentId, 'assets', 'legacy.png'))).resolves.toBeTruthy()
  await expect(stat(join(userData, 'decks', 'working'))).rejects.toThrow()

  const localFiles = join(testInfo.outputDir, 'Recovered presentations')
  await mkdir(localFiles, { recursive: true })
  await stubOpenDialog(app, [localFiles])
  await page.getByRole('button', { name: 'More actions for Legacy deck' }).click()
  await page.getByRole('menuitem', { name: 'Move to local files' }).click()
  await expect(page.getByRole('button', { name: 'Open Legacy deck.mona' })).toBeVisible()
  await expect(stat(join(localFiles, 'Legacy deck.mona'))).resolves.toBeTruthy()
})
