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

/**
 * Presents the machine as signed in to Claude.
 *
 * A runner has no Claude login, and a signed-out dock replaces its composer with
 * an invitation to go and sign in — so there is no message to send and no button
 * to send it with. The account is what decides that, and it is a separate
 * question from whether a turn can run, which every agent journey stubs anyway.
 */
export const stubSignedInAccount = async (app: ElectronApplication): Promise<void> => {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('mona:account')
    ipcMain.handle('mona:account', () => ({
      accountLabel: 'ci@example.com',
      connected: true,
      planLabel: 'Claude Max',
    }))
  })
}

/** Whether this run sees the macOS chrome, which hides the in-window menus. */
export const isMacChrome = process.platform === 'darwin'

/** Where the renderer is served from while testing: Playwright's own web server. */
export const RENDERER_URL = 'http://127.0.0.1:6174'

interface MonaFixtures {
  app: ElectronApplication
  page: Page
}

/**
 * Launches Electron, retrying a busy binary.
 *
 * `spawn ETXTBSY` means the kernel refused to exec a file something still holds
 * open for writing. On a runner that happens between a test and its retry, or
 * just after the shell bundle is built, and it has nothing to do with the test
 * that trips over it — it simply fails whichever one launched at the wrong
 * moment, which then reads as an unrelated journey breaking.
 */
const launchWithRetry = async (options: Parameters<typeof electron.launch>[0]) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await electron.launch(options)
    }
    catch (error) {
      const busy = (error as Error).message.includes('ETXTBSY')
      if (!busy || attempt >= 4) throw error
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)))
    }
  }
}

export const test = base.extend<MonaFixtures>({
  app: async ({}, use, testInfo) => {
    const app = await launchWithRetry({
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
 * Where a command lives in the editor's own File menu.
 *
 * Only the ones these journeys use. Export entries are one level deeper, under
 * a submenu, which is why they carry two labels.
 */
const IN_WINDOW_MENU: Record<string, readonly string[]> = {
  'file.export.image': ['Export', 'Image'],
  'file.export.json': ['Export', 'JSON'],
  'file.export.native': ['Export', 'Mona'],
  'file.export.pdf': ['Export', 'PDF'],
  'file.export.pptx': ['Export', 'PowerPoint'],
  'file.import.json': ['Import JSON'],
  'file.import.native': ['Import Mona file'],
  'file.import.pptx': ['Import PowerPoint'],
  'file.new': ['New presentation'],
}

/**
 * Chooses an item from the application menu, wherever this platform keeps it.
 *
 * The two are not interchangeable and cannot be faked into each other. On macOS
 * the editor has no menus of its own — they are in the system menu bar, which
 * Playwright cannot click — so the command is sent the way that menu sends it.
 * Everywhere else the menu is in the window and the system menu bar does not
 * exist: the renderer registers no command listener at all off darwin, so
 * sending one would reach nobody and the test would pass by doing nothing.
 *
 * Clicking through is therefore not a fallback but the real path on those
 * platforms, and it is the only e2e coverage the in-window menu has.
 */
export const chooseMenuCommand = async (
  app: ElectronApplication,
  command: string,
  page?: Page,
): Promise<void> => {
  if (isMacChrome) {
    await app.evaluate(({ BrowserWindow }, name) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('mona:menu', name)
    }, command)
    return
  }
  const target = page ?? await app.firstWindow()
  const path = IN_WINDOW_MENU[command]
  if (!path) throw new Error(`No in-window menu path is known for "${command}".`)

  // Below 760px of header the three menus fold into one icon, and File becomes
  // a submenu inside it rather than a button of its own. A narrow window is the
  // normal case on a CI runner, whose display the window cannot exceed.
  const file = target.getByRole('button', { exact: true, name: 'File' })
  if (await file.count() > 0 && await file.isVisible()) {
    await file.click()
  }
  else {
    await target.getByRole('button', { name: 'Menu bar' }).click()
    await target.getByRole('menuitem', { exact: true, name: 'File' }).hover()
  }

  // A submenu opens on hover and does nothing when clicked; a leaf is clicked.
  for (const [index, label] of path.entries()) {
    const item = target.getByRole('menuitem', { exact: true, name: label })
    if (index < path.length - 1) await item.hover()
    else await item.click()
  }
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
  page?: Page,
): Promise<void> => {
  await stubOpenDialog(app, [filePath])
  await chooseMenuCommand(app, `file.import.${kind}`, page)
}

/**
 * Resizes the window, which is the only thing that resizes the page.
 *
 * `page.setViewportSize` is a browser-context instruction and does nothing to a
 * window the shell owns, so a test that used it to reach a compact layout was
 * quietly still testing the wide one.
 */
export const resizeWindow = async (
  app: ElectronApplication,
  width: number,
  height: number,
): Promise<{ display: string; fits: boolean }> => {
  const result = await app.evaluate(({ BrowserWindow, screen }, size) => {
    const window = BrowserWindow.getAllWindows()[0]
    window?.setSize(size.width, size.height)
    const [actualWidth = 0, actualHeight = 0] = window?.getSize() ?? []
    const work = screen.getPrimaryDisplay().workAreaSize
    return {
      actualWidth,
      display: `${work.width}x${work.height}`,
      fits: actualWidth >= size.width && actualHeight >= size.height,
    }
  }, { height, width })

  // Asking is not arriving: `setSize` returns before the renderer has been
  // resized, laid out and re-rendered, so a test asserting a compact layout
  // would race the wide one.
  //
  // And asking is not getting, either. A window cannot exceed the display it is
  // on, so on a small screen `setSize` is clamped and returns as if it worked.
  // Waiting for `innerWidth <= width` accepted that silently — it is trivially
  // true when the window was already too small — and the test then measured a
  // layout nobody asked for. The caller is told instead, and can skip rather
  // than assert against the wrong one.
  const page = await app.firstWindow()
  await page.waitForFunction(target => Math.abs(window.innerWidth - target) <= 2, result.actualWidth)
  return { display: result.display, fits: result.fits }
}

/**
 * Restarts the renderer at the URL it is already on.
 *
 * Not `page.reload()`: a reload runs the unload path, and an unload prompt in a
 * desktop window is a native dialog the debugging protocol cannot answer —
 * Playwright fails with "No dialog is showing" rather than dismissing it.
 * Navigating afresh puts the renderer in the same state without asking.
 */
export const reloadApp = async (page: Page): Promise<void> => {
  const url = page.url()
  await page.goto('about:blank')
  await page.goto(url)
  await page.waitForLoadState('domcontentloaded')
}

