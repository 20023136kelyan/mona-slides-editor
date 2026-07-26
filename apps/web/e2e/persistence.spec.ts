import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { ElectronApplication } from '@playwright/test'

import { expect, openApp, test, type Page } from './electron-fixture'

// Working-copy persistence journeys. Automated sessions are opted in via
// ?persistTest=1 (persistence is otherwise disabled under webdriver so every
// other suite stays hermetic). Each test launches the application with its own
// user-data directory, so the deck on disk starts empty per test.

declare global {
  interface Window {
    __MONA_TEST__?: {
      getState: () => { presentation: { slides: Array<{ id: string }>; title: string } }
    }
  }
}

const deckIncludes = (page: Page, needle: string) => page.evaluate(text => {
  const bridge = window.__MONA_TEST__
  if (!bridge) return false
  return JSON.stringify(bridge.getState().presentation.slides).includes(text)
  // Polls span the start-fresh navigation; a torn-down execution context
  // reads as "not there yet", not as a test failure.
}, needle).catch(() => false)

/**
 * Reads what was actually written, which is now a file.
 *
 * This used to open IndexedDB in the page. The deck moved to disk, and reading
 * it from the main process asserts against the real artifact rather than the
 * renderer's account of it — if a save silently failed, this notices.
 */
const storedDeckIncludes = async (app: ElectronApplication, needle: string) => {
  // Only the location comes from the main process; the reading happens here,
  // because a function sent into `evaluate` has no dynamic import of its own.
  const userData = await app.evaluate(({ app: electron }) => electron.getPath('userData'))
  const contents = await readFile(join(userData, 'decks', 'working', 'deck.json'), 'utf8').catch(() => '')
  return contents.includes(needle)
}

test.beforeEach(async ({ app, page }) => {
  await page.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US'))
  await openApp(page, '?persistTest=1')
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
})

test('an edit autosaves, survives reload, and start-fresh returns to the default deck', async ({ app, page }) => {
  // Edit the cover title text.
  const title = page.locator('.mona-editor-slide-canvas .mona-text-content').first()
  await title.click()
  await title.dblclick()
  const editor = page.locator('.mona-editor-slide-canvas .ProseMirror').first()
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' PERSIST-EDIT')
  await page.keyboard.press('Escape')

  // The debounced autosave lands in IndexedDB without any explicit action.
  await expect.poll(() => storedDeckIncludes(app, 'PERSIST-EDIT'), { timeout: 10_000 }).toBe(true)

  // A full reload restores the working copy and announces it.
  await openApp(page, '?persistTest=1')
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
  await expect.poll(() => deckIncludes(page, 'PERSIST-EDIT')).toBe(true)
  const banner = page.locator('.mona-restore-banner')
  await expect(banner).toBeVisible()

  // Start fresh discards the copy and reloads the pristine default deck.
  await banner.getByRole('button', { name: 'Start fresh' }).click()
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
  await expect.poll(() => deckIncludes(page, 'PERSIST-EDIT')).toBe(false)
  await expect(page.locator('.mona-restore-banner')).toHaveCount(0)
})

test('fixture sessions bypass the working copy entirely', async ({ app, page }) => {
  // Poison the slot first (persistence enabled in this tab).
  const title = page.locator('.mona-editor-slide-canvas .mona-text-content').first()
  await title.click()
  await title.dblclick()
  const editor = page.locator('.mona-editor-slide-canvas .ProseMirror').first()
  await editor.click()
  await page.keyboard.type('FIXTURE-GUARD')
  await page.keyboard.press('Escape')
  await expect.poll(() => storedDeckIncludes(app, 'FIXTURE-GUARD'), { timeout: 10_000 }).toBe(true)

  // A fixture load must not see it (gate suites depend on this).
  await openApp(page, '?developmentFixture=editor-interactions')
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
  await expect.poll(() => deckIncludes(page, 'FIXTURE-GUARD')).toBe(false)
  await expect(page.locator('.mona-restore-banner')).toHaveCount(0)
})

