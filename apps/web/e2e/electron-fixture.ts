/* oxlint-disable react-hooks/rules-of-hooks -- Playwright hands each fixture a
   function named `use` to yield its value through; it is not React's `use`. */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test'

/**
 * The application under test is the application.
 *
 * These journeys used to run against a page in a browser, which is what Mona
 * used to be. It is a desktop application now, and most of what the tests
 * exercise — where a deck is stored, how a file is chosen, what the agent talks
 * to, whether there is a menu bar in the window at all — is decided by the shell.
 * A browser tab has no shell, so those tests were asserting against a build that
 * cannot exist.
 *
 * Launching the real thing also puts the main process within reach, which is
 * where the useful stubbing lives: replacing `dialog.showOpenDialog` there
 * exercises the whole chain — menu command, IPC, dialog, file read, import —
 * rather than mocking the renderer's own idea of it.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const DESKTOP_DIR = join(HERE, '../../desktop')
const REPO_ROOT = join(HERE, '../../..')

/** Where the renderer is served from while testing: Playwright's own web server. */
export const RENDERER_URL = 'http://127.0.0.1:6174'

interface MonaFixtures {
  app: ElectronApplication
  page: Page
}

export const test = base.extend<MonaFixtures>({
  app: async ({}, use, testInfo) => {
    const app = await electron.launch({
      args: [
        DESKTOP_DIR,
        // A deck now lives in `userData`, so tests that share one would see each
        // other's. Per-test isolation is what lets these still run in parallel.
        `--user-data-dir=${join(testInfo.outputDir, 'user-data')}`,
      ],
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        // Electron warns, on the renderer's console, that a page loaded over
        // http:// has no CSP. It is telling the truth about development and says
        // so itself — "this warning will not show up once the app is packaged" —
        // because a packaged renderer is served from mona://app instead. Specs
        // that assert a clean console would otherwise be failing on the shell's
        // own development notice rather than on anything Mona did.
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        MONA_DESKTOP_RENDERER_URL: RENDERER_URL,
      },
    })
    await use(app)
    await app.close()
  },
  page: async ({ app }, use) => {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await use(page)
  },
})

export { expect } from '@playwright/test'

/** Loads a route. Absolute, because the window is not a browser tab with a base. */
export const openApp = async (page: Page, query = ''): Promise<void> => {
  await page.goto(`${RENDERER_URL}/${query}`)
  await page.waitForLoadState('domcontentloaded')
}

/**
 * Answers the next open dialog with these files, without showing one.
 *
 * Replaced in the main process rather than in the renderer, so everything
 * between the click and the imported deck is still the real code: the IPC, the
 * handler, reading the bytes off disk, and the shape they arrive in.
 */
export const stubOpenDialog = async (app: ElectronApplication, filePaths: string[]): Promise<void> => {
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: paths.length === 0, filePaths: paths })
  }, filePaths)
}

/** Answers the next save dialog with this path. Cancels when given nothing. */
export const stubSaveDialog = async (app: ElectronApplication, filePath: string | null): Promise<void> => {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => (
      path ? { canceled: false, filePath: path } : { canceled: true, filePath: undefined }
    )
  }, filePath)
}

/**
 * Chooses an item from the application menu.
 *
 * On macOS the editor has no menus of its own — they are in the system menu bar,
 * which Playwright cannot click. This sends what that menu sends, so the path
 * under test is the one a Mac user actually takes.
 */
export const chooseMenuCommand = async (app: ElectronApplication, command: string): Promise<void> => {
  await app.evaluate(({ BrowserWindow }, name) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('mona:menu', name)
  }, command)
}

/**
 * Imports a file the way the application does now: the shell asks for it.
 *
 * The old form clicked File, then Import, then pushed a path into a hidden
 * `<input type="file">`. Neither half survives — the menu is in the system menu
 * bar on macOS, and the input is gone in favour of the platform's dialog — so
 * this drives what replaced them, end to end.
 */
export const importFile = async (
  app: ElectronApplication,
  kind: 'json' | 'native' | 'pptx',
  filePath: string,
): Promise<void> => {
  await stubOpenDialog(app, [filePath])
  await chooseMenuCommand(app, `file.import.${kind}`)
}

/** Whether this run sees the macOS chrome, which hides the in-window menus. */
export const isMacChrome = process.platform === 'darwin'
