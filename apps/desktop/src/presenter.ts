import { BrowserWindow, ipcMain, screen } from 'electron'

import { guardNavigation } from './window-guards.js'

/**
 * The audience display.
 *
 * A presenter needs two surfaces at once: notes, a timer and the next slide on
 * the laptop, and nothing but the slide on the projector. As a web page the
 * second one was `window.open(…, 'popup')` — a window the browser sized, placed
 * and decorated to its own taste, that the operating system would not put on
 * another display, that could not go fullscreen without its own user gesture,
 * and that a popup blocker was entitled to refuse outright.
 *
 * Here it is a window this process makes, on the display the audience is looking
 * at, fullscreen from the moment it appears.
 */

let audienceWindow: BrowserWindow | null = null

/**
 * The display the presenter is not on.
 *
 * With one screen there is nothing to choose and the window opens on it anyway,
 * which is the right behaviour for rehearsing: the presenter sees exactly what
 * the room will see.
 */
const audienceDisplay = (presenterWindow: BrowserWindow | null) => {
  const displays = screen.getAllDisplays()
  if (displays.length < 2 || !presenterWindow) return screen.getPrimaryDisplay()
  const presenterDisplay = screen.getDisplayMatching(presenterWindow.getBounds())
  return displays.find(display => display.id !== presenterDisplay.id) ?? presenterDisplay
}

export const registerPresenterIpc = (rendererUrl: string, preload: string): void => {
  /**
   * Relays a message to every window except the one that sent it.
   *
   * Exactly what `BroadcastChannel` did, and deliberately so: the renderer's
   * sync protocol is unchanged, only its transport moved. It has to move,
   * because two `BrowserWindow`s are two renderer processes and a
   * `BroadcastChannel` does not reach across them — the audience would have sat
   * on slide one for the whole talk.
   */
  ipcMain.on('mona:screen:sync', (event, message: unknown) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.webContents.id !== event.sender.id) window.webContents.send('mona:screen:sync', message)
    }
  })

  ipcMain.handle('mona:screen:open-audience', (event, documentPath: unknown) => {
    if (audienceWindow && !audienceWindow.isDestroyed()) {
      audienceWindow.focus()
      return
    }
    const presenterWindow = BrowserWindow.fromWebContents(event.sender)
    const { bounds } = audienceDisplay(presenterWindow)
    audienceWindow = new BrowserWindow({
      backgroundColor: '#000000',
      fullscreen: true,
      height: bounds.height,
      show: false,
      title: 'Mona',
      width: bounds.width,
      x: bounds.x,
      y: bounds.y,
      webPreferences: { contextIsolation: true, nodeIntegration: false, preload, sandbox: true },
    })
    guardNavigation(audienceWindow, rendererUrl)
    audienceWindow.once('ready-to-show', () => audienceWindow?.show())
    audienceWindow.on('closed', () => { audienceWindow = null })
    const url = new URL(rendererUrl)
    if (typeof documentPath === 'string' && /^\/documents\/[a-zA-Z0-9_-]+$/.test(documentPath)) {
      url.pathname = documentPath
    }
    url.searchParams.set('mode', 'audience')
    void audienceWindow.loadURL(url.toString())
  })

  ipcMain.handle('mona:screen:close-audience', () => {
    if (audienceWindow && !audienceWindow.isDestroyed()) audienceWindow.close()
    audienceWindow = null
  })
}
