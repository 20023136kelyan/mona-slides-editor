import type { ElectronApplication } from '@playwright/test'

import { expect, openApp, test } from './electron-fixture'

/**
 * The agent journey, without a model.
 *
 * The suite this replaces drove a provider picker, a deterministic reference
 * engine and a preview-then-apply flow, none of which exist any more — the agent
 * runs through the Claude Agent SDK under the machine's own login, and applies
 * its edit as one transaction rather than proposing it.
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
        const deck = snapshot.output as { revision: string; slides: Array<{ elements: unknown[] }> }
        const slides = structuredClone(deck.slides)
        if (script.addElement) slides[0]!.elements.push(script.addElement)

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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US'))
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

test('refuses an edit written against a deck that has since changed', async ({ app, page }) => {
  const before = await elementCount(page)
  await stubAgentTurn(app, { addElement: ADDED_ELEMENT, replyText: 'Trying an edit.', staleRevision: true })
  await sendPrompt(page, 'Edit against a stale copy')

  // Refused rather than merged: a copy cannot be reconciled with edits it never
  // saw, and overwriting them is the one outcome with no recovery.
  await expect(page.getByText(/deck changed while you were working/i)).toBeVisible()
  expect(await elementCount(page)).toBe(before)
})
