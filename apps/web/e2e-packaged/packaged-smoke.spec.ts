import { mkdir, readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertPackagedResources,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from './packaged-fixture'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')

const sendMenuCommand = async (
  app: ElectronApplication,
  page: Page,
  command: string,
  inWindowPath: readonly string[],
): Promise<void> => {
  if (process.platform === 'darwin') {
    await app.evaluate(({ BrowserWindow }, value) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('mona:menu', value)
    }, command)
    return
  }

  const file = page.getByRole('button', { exact: true, name: 'File' })
  if (await file.isVisible()) await file.click()
  else {
    await page.getByRole('button', { name: 'Menu bar' }).click()
    await page.getByRole('menuitem', { exact: true, name: 'File' }).hover()
  }
  for (const [index, label] of inWindowPath.entries()) {
    const item = page.getByRole('menuitem', { exact: true, name: label })
    if (index < inWindowPath.length - 1) await item.hover()
    else await item.click()
  }
}

const stubSaveDialog = async (app: ElectronApplication, filePath: string): Promise<void> => {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, filePath)
}

test('the packaged application loads its own renderer and completes native desktop workflows', async ({
  app,
  consoleProblems,
  page,
}, testInfo) => {
  const runtime = await app.evaluate(({ app: electron, Menu }) => ({
    appName: electron.name,
    isPackaged: electron.isPackaged,
    menuLabels: Menu.getApplicationMenu()?.items.map(item => item.label) ?? [],
    resourcesPath: process.resourcesPath,
    userData: electron.getPath('userData'),
  }))
  expect(runtime.appName).toBe('Mona')
  expect(runtime.isPackaged).toBe(true)
  if (process.platform === 'darwin') expect(runtime.menuLabels).toContain('File')
  assertPackagedResources(runtime.resourcesPath)

  const response = await page.goto('mona://app/')
  await page.waitForLoadState('domcontentloaded')
  expect(page.url()).toBe('mona://app/')
  expect(response?.headers()['content-security-policy']).toContain("script-src 'self'")
  await expect(page).toHaveTitle('Presentations - Mona')
  await expect(page.getByRole('heading', { name: 'Presentations' })).toBeVisible()
  const localFiles = join(testInfo.outputDir, 'presentations')
  await mkdir(localFiles, { recursive: true })
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, localFiles)
  await page.getByRole('main').getByRole('button', { name: 'New presentation' }).click()
  await page.waitForURL(/^mona:\/\/app\/documents\/[^/?]+/)
  await page.goto(`${page.url()}?persistTest=1`)
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Generate presentation with AI' })).toBeVisible()

  const bridge = await page.evaluate(async () => {
    const value = window.mona
    if (!value) return null
    const accounts = await value.accounts.list()
    return {
      accountProviders: accounts.map(account => account.providerId).sort(),
      hasAgent: typeof value.agent.send === 'function',
      hasDocumentData: typeof value.documentData.sketches.write === 'function',
      hasDocuments: typeof value.documents.write === 'function',
      hasPowerPointIngestion: typeof value.documents.ingestPowerPoint === 'function'
        && typeof value.documents.cancelPowerPoint === 'function',
      hasPowerPointWriteback: typeof value.documents.exportPowerPoint === 'function',
      hasFiles: typeof value.files.save === 'function',
      hasProjectJobs: typeof value.projectJobs.list === 'function'
        && typeof value.projectJobs.cancel === 'function',
      hasProjects: typeof value.projects.create === 'function',
      platform: value.platform,
    }
  })
  expect(bridge).toMatchObject({
    accountProviders: ['anthropic', 'openai'],
    hasAgent: true,
    hasDocumentData: true,
    hasDocuments: true,
    hasFiles: true,
    hasPowerPointIngestion: true,
    hasPowerPointWriteback: true,
    hasProjectJobs: true,
    hasProjects: true,
  })

  const title = page.getByRole('textbox', { name: 'Presentation title' })
  await title.click()
  await expect(title).toBeEditable()
  await title.fill('Packaged smoke deck')
  await title.press('Enter')
  const documentId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1)
  expect(documentId).toBeTruthy()
  const deckPath = join(runtime.userData, 'documents', documentId!, 'deck.json')
  await expect.poll(
    () => readFile(deckPath, 'utf8').then(value => value.includes('Packaged smoke deck'), () => false),
  ).toBe(true)

  await page.goto(`mona://app/documents/${documentId}?persistTest=1`)
  await expect(page.getByRole('textbox', { name: 'Presentation title' })).toHaveValue('Packaged smoke deck')

  const pptxFixture = await readFile(join(
    REPO_ROOT,
    'tests',
    'corpus',
    'public',
    'corpus-01-text.pptx',
  ))
  const linePptxFixture = await readFile(join(
    REPO_ROOT,
    'tests',
    'corpus',
    'public',
    'corpus-02-shapes-lines.pptx',
  ))
  const ingestion = await page.evaluate(async ({ base64, id, lineBase64 }) => {
    if (!window.mona) throw new Error('Desktop bridge unavailable.')
    const stored = await window.mona.documents.read(id)
    const presentation = stored?.presentation as {
      theme?: unknown
    } | undefined
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    const result = await window.mona.documents.ingestPowerPoint(
      id,
      bytes.buffer,
      {
        fileName: 'corpus-01-text.pptx',
        operationId: crypto.randomUUID(),
        theme: presentation?.theme as never,
      },
    )
    const writeback = await window.mona.documents.exportPowerPoint(
      id,
      result.presentation,
      result.sourcePackage.packageId,
    )
    const edited = structuredClone(result.presentation)
    const textTarget = edited.slides.flatMap(slide => slide.elements).find(element => (
      (element.type === 'text' || (element.type === 'shape' && Boolean(element.text)))
      && element.source?.sourceLayer === 'slide'
      && element.source.sourcePart === element.source.slidePart
    ))
    if (!textTarget || (textTarget.type !== 'text' && textTarget.type !== 'shape')) {
      throw new Error('Packaged PowerPoint fixture has no editable text body.')
    }
    if (textTarget.type === 'text') {
      textTarget.content = '<p>Packaged source-preserving text.</p>'
      delete textTarget.structuredText
    }
    else {
      textTarget.text!.content = '<p>Packaged source-preserving text.</p>'
      delete textTarget.text!.structuredText
    }
    edited.slides[0]!.elements.push({
      content: '<p>Packaged generated text.</p>',
      defaultColor: '#222222',
      defaultFontName: 'Arial',
      height: 48,
      id: 'packaged-generated-text',
      left: 120,
      lineHeight: 1.2,
      rotate: 0,
      top: 420,
      type: 'text',
      width: 320,
    })
    const editedWriteback = await window.mona.documents.exportPowerPoint(
      id,
      edited,
      result.sourcePackage.packageId,
    )
    const editedRoundTrip = await window.mona.documents.ingestPowerPoint(
      id,
      editedWriteback.bytes,
      {
        fileName: 'packaged-generated-object-round-trip.pptx',
        operationId: crypto.randomUUID(),
        theme: presentation?.theme as never,
      },
    )
    const generatedText = editedRoundTrip.presentation.slides
      .flatMap(slide => slide.elements)
      .find(element => (
        (element.type === 'text' && element.content.includes('Packaged generated text.'))
        || (element.type === 'shape' && element.text?.content.includes('Packaged generated text.'))
      ))
    const lineBinary = atob(lineBase64)
    const lineBytes = new Uint8Array(lineBinary.length)
    for (let index = 0; index < lineBinary.length; index += 1) {
      lineBytes[index] = lineBinary.charCodeAt(index)
    }
    const lineResult = await window.mona.documents.ingestPowerPoint(
      id,
      lineBytes.buffer,
      {
        fileName: 'corpus-02-shapes-lines.pptx',
        operationId: crypto.randomUUID(),
        theme: presentation?.theme as never,
      },
    )
    const lineEdited = structuredClone(lineResult.presentation)
    const lineTarget = lineEdited.slides.flatMap(slide => slide.elements).find(element => (
      element.type === 'line'
      && !element.broken
      && !element.broken2
      && !element.curve
      && !element.cubic
      && element.source?.sourceLayer === 'slide'
    ))
    if (!lineTarget || lineTarget.type !== 'line') {
      throw new Error('Packaged PowerPoint fixture has no editable straight line.')
    }
    const lineStart = [
      lineTarget.left + lineTarget.start[0],
      lineTarget.top + lineTarget.start[1],
    ] as [number, number]
    const oldLineEnd = [
      lineTarget.left + lineTarget.end[0],
      lineTarget.top + lineTarget.end[1],
    ] as [number, number]
    const lineEnd = [oldLineEnd[0] + 28, oldLineEnd[1] + 14] as [number, number]
    lineTarget.left = Math.min(lineStart[0], lineEnd[0])
    lineTarget.top = Math.min(lineStart[1], lineEnd[1])
    lineTarget.start = [lineStart[0] - lineTarget.left, lineStart[1] - lineTarget.top]
    lineTarget.end = [lineEnd[0] - lineTarget.left, lineEnd[1] - lineTarget.top]
    lineTarget.color = '#13579b'
    lineTarget.style = 'dotted'
    lineTarget.width = 3
    lineTarget.points = ['dot', 'arrow']
    const lineWriteback = await window.mona.documents.exportPowerPoint(
      id,
      lineEdited,
      lineResult.sourcePackage.packageId,
    )
    const lineRoundTrip = await window.mona.documents.ingestPowerPoint(
      id,
      lineWriteback.bytes,
      {
        fileName: 'packaged-line-round-trip.pptx',
        operationId: crypto.randomUUID(),
        theme: presentation?.theme as never,
      },
    )
    const roundTrippedLine = lineRoundTrip.presentation.slides
      .flatMap(slide => slide.elements)
      .find(element => (
        element.source?.nativeShapeId === lineTarget.source?.nativeShapeId
        && element.source?.sourcePart === lineTarget.source?.sourcePart
      ))
    return {
      editedWritebackBytes: editedWriteback.bytes.byteLength,
      editedWritebackMode: editedWriteback.plan.mode,
      generatedObjectSourceId: generatedText?.source?.sourceObjectId,
      packageId: result.sourcePackage.packageId,
      lineRoundTrip: roundTrippedLine?.type === 'line'
        ? {
            color: roundTrippedLine.color.toLowerCase(),
            end: [
              roundTrippedLine.left + roundTrippedLine.end[0],
              roundTrippedLine.top + roundTrippedLine.end[1],
            ],
            points: roundTrippedLine.points,
            style: roundTrippedLine.style,
            width: roundTrippedLine.width,
          }
        : null,
      lineTargetEnd: lineEnd,
      lineWritebackMode: lineWriteback.plan.mode,
      slides: result.presentation.slides.length,
      status: result.report.status,
      writebackBytes: writeback.bytes.byteLength,
      writebackMode: writeback.plan.mode,
    }
  }, {
    base64: pptxFixture.toString('base64'),
    id: documentId!,
    lineBase64: linePptxFixture.toString('base64'),
  })
  expect(ingestion.packageId).toMatch(/^pptx:[a-f0-9]{64}$/)
  expect(ingestion.slides).toBeGreaterThan(0)
  expect(ingestion.status).toMatch(/^complete/)
  expect(ingestion.writebackBytes).toBe(pptxFixture.byteLength)
  expect(ingestion.writebackMode).toBe('noop')
  expect(ingestion.editedWritebackBytes).toBeGreaterThan(0)
  expect(ingestion.editedWritebackMode).toBe('patch')
  expect(ingestion.generatedObjectSourceId).toBeTruthy()
  expect(ingestion.lineWritebackMode).toBe('patch')
  expect(ingestion.lineRoundTrip).toMatchObject({
    color: '#13579b',
    points: ['dot', 'arrow'],
    style: 'dotted',
  })
  expect(ingestion.lineRoundTrip?.width).toBeCloseTo(3, 1)
  expect(ingestion.lineRoundTrip?.end[0]).toBeCloseTo(ingestion.lineTargetEnd[0], 2)
  expect(ingestion.lineRoundTrip?.end[1]).toBeCloseTo(ingestion.lineTargetEnd[1], 2)
  await expect.poll(
    () => readdir(
      join(runtime.userData, 'documents', documentId!, 'data', 'powerpoint-packages'),
    ).then(entries => entries.some(entry => entry.endsWith('.record')), () => false),
  ).toBe(true)

  const jsonPath = join(testInfo.outputDir, 'packaged-smoke.json')
  await stubSaveDialog(app, jsonPath)
  await sendMenuCommand(app, page, 'file.export.json', ['Export', 'JSON'])
  const exportDialog = page.getByRole('dialog', { name: 'Export' })
  await exportDialog.getByRole('button', { exact: true, name: 'Export' }).click()
  await expect.poll(() => readFile(jsonPath, 'utf8').then(() => true, () => false)).toBe(true)
  expect(JSON.parse(await readFile(jsonPath, 'utf8'))).toMatchObject({ title: 'Packaged smoke deck' })
  await exportDialog.getByRole('button', { name: 'Close' }).click()

  const pdfPath = join(testInfo.outputDir, 'packaged-smoke.pdf')
  await stubSaveDialog(app, pdfPath)
  await sendMenuCommand(app, page, 'file.export.pdf', ['Export', 'PDF'])
  await exportDialog.getByRole('button', { exact: true, name: 'Export' }).click()
  await expect.poll(() => readFile(pdfPath).then(() => true, () => false), { timeout: 30_000 }).toBe(true)
  expect((await readFile(pdfPath)).subarray(0, 5).toString()).toBe('%PDF-')

  expect(consoleProblems).toEqual([])
})
