import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ElectronApplication } from '@playwright/test'

import { ingestPowerPoint } from '@mona/pptx-ingestion'
import { flattenElementTree, type SlideTheme } from '@mona/presentation-core'

import {
  chooseMenuCommand,
  configureLocalSaveFolder,
  expect,
  importFile,
  openApp,
  stubSaveDialog,
  stubSignedInAccount,
  test,
} from './electron-fixture'

const TEXT_CORPUS_PPTX = fileURLToPath(new URL(
  '../../../tests/corpus/public/corpus-01-text.pptx',
  import.meta.url,
))

/**
 * The agent journey, without a model.
 *
 * The suite this replaces drove a provider picker, a deterministic reference
 * engine and a preview-then-apply flow, none of which exist any more — the agent
 * runs through a native provider harness under the machine's own login, and
 * applies its edit as one transaction rather than proposing it.
 *
 * A real turn is not something a test can ask for: it costs money, it is not
 * deterministic, and it needs a login the machine may not have. What is worth
 * testing is everything on Mona's side of that turn — that a prompt reaches the
 * shell, that streamed chunks become a transcript, that a tool request is
 * answered by the renderer, and that a deck edit arrives as one undoable
 * transaction and is refused when it was written against a stale copy.
 *
 * So the model is replaced at the narrowest seam there is: the main-process
 * handler that would have spawned it. Everything above stays real — the same IPC
 * channels, the same chunk vocabulary, the same tool bridge, the same revision
 * guard, the same validation, the same commit.
 */

interface StubbedTurn {
  /** Appended to the first slide, or nothing to leave the deck alone. */
  addElement?: Record<string, unknown>
  duplicateNativeSlide?: boolean
  replyText: string
  /** Apply against a revision that was never current, to exercise the refusal. */
  staleRevision?: boolean
}

/**
 * Answers the next prompt with a scripted turn.
 *
 * Follows the shape a real turn has rather than a shortcut to the end of it: it
 * asks for a snapshot, edits what comes back, and applies against the revision
 * that snapshot reported. That is the sequence the revision guard exists for, so
 * a stub that skipped it would not be testing the thing it looks like it tests.
 */
const stubAgentTurn = async (app: ElectronApplication, turn: StubbedTurn): Promise<void> => {
  await app.evaluate(({ ipcMain }, script) => {
    ipcMain.removeAllListeners('mona:agent:prompt')
    ipcMain.removeAllListeners('mona:agent:tool-result')

    interface ToolOutcome { errorText?: string; id: string; output?: unknown }
    const pending = new Map<string, (outcome: ToolOutcome) => void>()
    ipcMain.on('mona:agent:tool-result', (_event, outcome: ToolOutcome) => {
      pending.get(outcome.id)?.(outcome)
      pending.delete(outcome.id)
    })

    ipcMain.on('mona:agent:prompt', event => {
      const send = (channel: string, payload: unknown) => event.sender.send(channel, payload)
      const callTool = (id: string, name: string, input: unknown) => new Promise<ToolOutcome>(resolve => {
        pending.set(id, resolve)
        send('mona:agent:tool-request', { id, input, name })
      })

      const id = 'stub-text'
      send('mona:agent:chunk', { type: 'start' })
      send('mona:agent:chunk', { id, type: 'text-start' })
      send('mona:agent:chunk', { delta: script.replyText, id, type: 'text-delta' })
      send('mona:agent:chunk', { id, type: 'text-end' })

      void (async () => {
        const snapshot = await callTool('stub-snapshot', 'snapshot', {})
        const deck = snapshot.output as { revision: string; slides: Array<{ elements: Array<Record<string, unknown>>; id: string }> }
        const slides = structuredClone(deck.slides)
        if (script.addElement) slides[0]!.elements.push(script.addElement)
        if (script.duplicateNativeSlide) {
          const duplicate = structuredClone(slides[0]!)
          duplicate.id = 'agent-native-slide-copy'
          const first = duplicate.elements[0]
          if (first && typeof first.left === 'number') first.left += 19
          slides.push(duplicate)
        }

        const applied = await callTool('stub-apply', 'apply', {
          expectedRevision: script.staleRevision ? 'mona-a-revision-that-never-existed' : deck.revision,
          explanation: 'Stubbed agent edit',
          slides,
        })
        if (applied.errorText) {
          send('mona:agent:chunk', { errorText: applied.errorText, type: 'error' })
        }
        send('mona:agent:chunk', { type: 'finish' })
      })()
    })
  }, turn)
}

const elementCount = (page: import('@playwright/test').Page) => page.evaluate(() => (
  window.__MONA_TEST__!.getState().presentation.slides[0]!.elements.length
))

const ADDED_ELEMENT = {
  content: '<p>Added by the agent</p>',
  defaultColor: '#333333',
  defaultFontName: 'Microsoft Yahei',
  height: 80,
  id: 'agent-added-element',
  left: 100,
  lineHeight: 1.5,
  rotate: 0,
  top: 100,
  type: 'text',
  width: 400,
}

const sendPrompt = async (page: import('@playwright/test').Page, text: string) => {
  await page.getByRole('button', { name: 'Generate presentation with AI' }).click()
  await expect(page.getByRole('complementary', { name: 'Mona AI' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Message Mona AI' }).fill(text)
  await page.getByRole('button', { name: 'Send message' }).click()
}

test.beforeEach(async ({ app, page }) => {
  await page.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US'))
  await stubSignedInAccount(app)
  await openApp(page, '?developmentFixture=slides')
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
})

test('streams a turn into the transcript and applies its deck edit as one undo', async ({ app, page }) => {
  const before = await elementCount(page)
  await stubAgentTurn(app, { addElement: ADDED_ELEMENT, replyText: 'Added a heading for you.' })
  await sendPrompt(page, 'Add a heading to the first slide')

  await expect(page.getByText('Added a heading for you.')).toBeVisible()

  await expect.poll(() => page.evaluate(() => (
    window.__MONA_TEST__!.getState().presentation.slides[0]!.elements.some(element => element.id === 'agent-added-element')
  )), { timeout: 20_000 }).toBe(true)
  expect(await elementCount(page)).toBe(before + 1)

  // However many turns it took, it is one thing to undo.
  await page.getByRole('application', { name: 'Editable slide canvas' }).press('Control+z')
  await expect.poll(() => elementCount(page)).toBe(before)
})

test('duplicates and edits an imported native slide through the Electron agent bridge', async ({ app, page }, testInfo) => {
  await configureLocalSaveFolder(app, page, join(testInfo.outputDir, 'presentations'))
  await chooseMenuCommand(app, 'file.new', page)
  await page.waitForURL(/\/documents\/[^/?]+/)
  await expect.poll(() => page.evaluate(() => (
    window.__MONA_TEST__!.getState().presentation.slides.length
  ))).toBe(1)
  await importFile(app, 'pptx', TEXT_CORPUS_PPTX, page)
  await expect.poll(() => page.evaluate(() => (
    window.__MONA_TEST__!.getState().presentation.slides.length
  )), { timeout: 30_000 }).toBe(1)
  await expect.poll(() => page.evaluate(() => (
    window.__MONA_TEST__!.getState().presentation.slides[0]!.elements.length
  )), { timeout: 30_000 }).toBe(5)
  const originalLeft = await page.evaluate(() => (
    window.__MONA_TEST__!.getState().presentation.slides[0]!.elements[0]!.left
  ))

  await stubAgentTurn(app, {
    duplicateNativeSlide: true,
    replyText: 'Duplicated the imported slide and moved its first object.',
  })
  await sendPrompt(page, 'Duplicate this imported slide and adjust the copy')
  await expect(page.getByText('Duplicated the imported slide and moved its first object.')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (
    window.__MONA_TEST__!.getState().presentation.slides.length
  )), { timeout: 20_000 }).toBe(2)

  const result = await page.evaluate(() => {
    const state = window.__MONA_TEST__!.getState()
    const source = state.presentation.slides[0]!
    const copy = state.presentation.slides[1]!
    return {
      copyOrigin: copy.source?.copyOnWrite,
      copiedElementOrigin: copy.elements[0]?.source?.copyOnWrite,
      copiedLeft: copy.elements[0]?.left,
      sourceLeft: source.elements[0]?.left,
    }
  })
  expect(result.copyOrigin).toMatchObject({
    packageId: expect.any(String),
    sourceSlidePart: 'ppt/slides/slide1.xml',
  })
  expect(result.copiedElementOrigin).toMatchObject({
    mode: 'copy',
    sourceLayer: 'slide',
    sourceObjectId: expect.any(String),
  })
  expect(result.sourceLeft).toBeCloseTo(originalLeft, 5)
  expect(result.copiedLeft).toBeCloseTo(originalLeft + 19, 5)

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => page.evaluate(() => (
    window.__MONA_TEST__!.getState().presentation.slides.length
  ))).toBe(1)
})

test('creates and exports a new editable object in an imported deck through the Electron agent bridge', async ({ app, page }, testInfo) => {
  test.setTimeout(90_000)
  await configureLocalSaveFolder(app, page, join(testInfo.outputDir, 'presentations'))
  await chooseMenuCommand(app, 'file.new', page)
  await page.waitForURL(/\/documents\/[^/?]+/)
  await importFile(app, 'pptx', TEXT_CORPUS_PPTX, page)
  await expect.poll(() => page.evaluate(() => (
    window.__MONA_TEST__!.getState().presentation.slides[0]!.elements.length
  )), { timeout: 30_000 }).toBe(5)

  const theme = await page.evaluate(() => window.__MONA_TEST__!.getState().presentation.theme)
  await stubAgentTurn(app, {
    addElement: ADDED_ELEMENT,
    replyText: 'Added an editable native text box to the imported presentation.',
  })
  await sendPrompt(page, 'Add an editable text box to this imported PowerPoint')
  await expect(page.getByText('Added an editable native text box to the imported presentation.')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (
    window.__MONA_TEST__!.getState().presentation.slides[0]!.elements.some(
      element => element.id === 'agent-added-element',
    )
  )), { timeout: 20_000 }).toBe(true)

  await chooseMenuCommand(app, 'file.export.pptx', page)
  const dialog = page.getByRole('dialog', { name: 'Export' })
  const output = join(testInfo.outputDir, 'agent-generated-native-object.pptx')
  await stubSaveDialog(app, output)
  await dialog.getByRole('button', { exact: true, name: 'Export' }).click()
  await expect.poll(
    () => readFile(output).then(() => true, () => false),
    { timeout: 30_000 },
  ).toBe(true)

  const bytes = await readFile(output)
  const reimported = await ingestPowerPoint(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    { fileName: 'agent-generated-native-object.pptx', theme: theme as SlideTheme },
  )
  const inserted = flattenElementTree(reimported.presentation.slides[0]!.elements).find(element => (
    (element.type === 'text' && element.content.includes('Added by the agent'))
    || (element.type === 'shape' && element.text?.content.includes('Added by the agent'))
  ))
  expect(['shape', 'text']).toContain(inserted?.type)
  expect(inserted?.source?.sourceObjectId).toBeTruthy()
})

test('routes text-inspector AI actions through the same deck-editing agent', async ({ app, page }) => {
  await stubAgentTurn(app, { replyText: 'The targeted text rewrite is complete.' })

  await page
    .locator('.mona-editor-slide-canvas [data-element-id]')
    .filter({ hasText: 'Native, editable presentations in the browser.' })
    .click()
  await page.getByRole('button', { exact: true, name: 'Style' }).click()
  await page.getByRole('button', { name: 'AI assist' }).click()
  await page.getByRole('button', { exact: true, name: 'Polish' }).click()

  const dock = page.getByRole('complementary', { name: 'Mona AI' })
  await expect(dock).toBeVisible()
  await expect(dock.getByText('Edit one existing text-bearing element in the presentation.')).toBeVisible()
  await expect(dock.getByText(/Slide id:/)).toBeVisible()
  await expect(dock.getByText(/Element id:/)).toBeVisible()
  await expect(dock.getByText('The targeted text rewrite is complete.')).toBeVisible()
})

test('refuses an edit written against a deck that has since changed', async ({ app, page }) => {
  const before = await elementCount(page)
  await stubAgentTurn(app, { addElement: ADDED_ELEMENT, replyText: 'Trying an edit.', staleRevision: true })
  await sendPrompt(page, 'Edit against a stale copy')

  // Refused rather than merged: a copy cannot be reconciled with edits it never
  // saw, and overwriting them is the one outcome with no recovery.
  await expect(page.getByText(/deck changed while you were working/i)).toBeVisible()
  expect(await elementCount(page)).toBe(before)
})
