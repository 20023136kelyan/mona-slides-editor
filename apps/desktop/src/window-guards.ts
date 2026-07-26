import { shell, type BrowserWindow } from 'electron'

/**
 * Keeps a window on the application.
 *
 * A deck is untrusted content — it comes out of a `.pptx` someone else made — so
 * a link inside one must never be able to replace the application with a web
 * page. Anything genuinely outward-facing opens in the user's browser, where it
 * belongs and where it is visibly no longer Mona.
 *
 * Every window needs this, which is why it is here rather than beside the one
 * that happened to need it first: the audience window renders the same untrusted
 * slides, on the screen an audience is looking at.
 */
export const guardNavigation = (window: BrowserWindow, rendererUrl: string): void => {
  const rendererOrigin = new URL(rendererUrl).origin
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== rendererOrigin) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).origin === rendererOrigin) return { action: 'allow' }
    void shell.openExternal(url)
    return { action: 'deny' }
  })
}
