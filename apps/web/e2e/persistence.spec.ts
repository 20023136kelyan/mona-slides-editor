import { expect, test, type Page } from '@playwright/test'

// Working-copy persistence journeys. Automated sessions are opted in via
// ?persistTest=1 (persistence is otherwise disabled under webdriver so every
// other suite stays hermetic). Each Playwright test gets a fresh browser
// context, so IndexedDB starts empty per test.

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

const storedDeckIncludes = (page: Page, needle: string) => page.evaluate(async text => {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('mona')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error as Error)
  })
  if (!database.objectStoreNames.contains('decks')) return false
  const stored = await new Promise<unknown>((resolve, reject) => {
    const request = database.transaction('decks', 'readonly').objectStore('decks').get('working-deck')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error as Error)
  })
  database.close()
  return JSON.stringify(stored ?? '').includes(text)
}, needle)

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US'))
  await page.goto('/?persistTest=1')
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
})

test('an edit autosaves, survives reload, and start-fresh returns to the default deck', async ({ page }) => {
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
  await expect.poll(() => storedDeckIncludes(page, 'PERSIST-EDIT'), { timeout: 10_000 }).toBe(true)

  // A full reload restores the working copy and announces it.
  await page.goto('/?persistTest=1')
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

test('fixture sessions bypass the working copy entirely', async ({ page }) => {
  // Poison the slot first (persistence enabled in this tab).
  const title = page.locator('.mona-editor-slide-canvas .mona-text-content').first()
  await title.click()
  await title.dblclick()
  const editor = page.locator('.mona-editor-slide-canvas .ProseMirror').first()
  await editor.click()
  await page.keyboard.type('FIXTURE-GUARD')
  await page.keyboard.press('Escape')
  await expect.poll(() => storedDeckIncludes(page, 'FIXTURE-GUARD'), { timeout: 10_000 }).toBe(true)

  // A fixture load must not see it (gate suites depend on this).
  await page.goto('/?developmentFixture=editor-interactions')
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
  await expect.poll(() => deckIncludes(page, 'FIXTURE-GUARD')).toBe(false)
  await expect(page.locator('.mona-restore-banner')).toHaveCount(0)
})

test('migrates a working copy from the previous database namespace', async ({ page }) => {
  const legacyTitle = 'Legacy database migration fixture'
  await page.evaluate(async title => {
    const presentation = structuredClone(window.__MONA_TEST__!.getState().presentation)
    presentation.title = title
    const payload = { presentation, savedAt: Date.now(), version: 1 }
    const open = (name: string) => new Promise<IDBDatabase>((resolve, reject) => {
      // The app probes both current and legacy namespaces during boot and may
      // already have upgraded their store schema. Opening without a requested
      // version seeds the legacy payload without causing a VersionError.
      const request = indexedDB.open(name)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('decks')) request.result.createObjectStore('decks')
        if (!request.result.objectStoreNames.contains('media')) request.result.createObjectStore('media')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error as Error)
    })
    const current = await open('mona')
    await new Promise<void>((resolve, reject) => {
      const request = current.transaction('decks', 'readwrite').objectStore('decks').delete('working-deck')
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error as Error)
    })
    current.close()
    const legacy = await open('mona-slides')
    await new Promise<void>((resolve, reject) => {
      const request = legacy.transaction('decks', 'readwrite').objectStore('decks').put(payload, 'working-deck')
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error as Error)
    })
    legacy.close()
  }, legacyTitle)

  await page.goto('/?persistTest=1')
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__MONA_TEST__?.getState().presentation.title)).toBe(legacyTitle)
  await expect.poll(() => storedDeckIncludes(page, legacyTitle)).toBe(true)
})
