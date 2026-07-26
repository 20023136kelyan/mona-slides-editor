import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { loadAgentServerConfig } from '@mona/agent-server/config'
import { createAgentServer } from '@mona/agent-server/server'

/**
 * Mona's desktop shell.
 *
 * The agent host runs *in this process* rather than as a separate server. That is
 * the whole point of the move: the Claude Agent SDK spawns a subprocess, and as a
 * website that subprocess had to live on Mona's machine, processing other people's
 * decks. Here it runs on the user's own machine under the Claude login they already
 * have, which is what `doc/PRODUCT_ARCHITECTURE.md` always asked for.
 *
 * The renderer is loaded over loopback HTTP rather than `file://` or a custom
 * scheme, and that is deliberate. The editor fetches `/api/agent/…` relative to its
 * own origin and derives its WebSocket URL from `window.location`, so same-origin is
 * what keeps the renderer completely unchanged in this step. Chromium treats
 * `http://127.0.0.1` as potentially trustworthy, so `crypto.subtle` (used for PPTX
 * package identity) and `navigator.clipboard` keep working — verified, not assumed.
 */

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * Fixed, because the origin is the IndexedDB partition key.
 *
 * A port that moved between launches would present the editor with an empty deck
 * store and no explanation. This stops mattering once decks live on disk.
 */
const AGENT_PORT = 8788
const AGENT_ORIGIN = `http://127.0.0.1:${AGENT_PORT}`

/** Vite in development; the agent server's own static handler once packaged. */
const rendererUrl = app.isPackaged
  ? AGENT_ORIGIN
  : process.env.MONA_DESKTOP_RENDERER_URL ?? 'http://127.0.0.1:5173'

/**
 * Everything the agent server reads from the environment, decided here.
 *
 * Its config module resolves state next to its own source, which is wrong for a
 * packaged app, and its origin allowlist is a hard-coded set of dev ports that would
 * reject this window. Both are env-overridable, so the shell configures rather than
 * forks them.
 */
const configureAgentEnvironment = () => {
  process.env.MONA_AGENT_STATE_DIR ??= resolve(app.getPath('userData'), 'agent-state')
  process.env.MONA_AGENT_PORT ??= String(AGENT_PORT)
  process.env.MONA_AGENT_HOST ??= '127.0.0.1'
  // The window's origin, plus Vite's in development. Still enforced: the server
  // listens on loopback, where any other local process can reach it.
  process.env.MONA_WEB_ORIGINS ??= [...new Set([AGENT_ORIGIN, rendererUrl])].join(',')
  // The skill ships beside the agent server's source, but this process is a bundle
  // somewhere else entirely, so the relative resolution there cannot work.
  process.env.MONA_AGENT_PLUGIN_DIR ??= app.isPackaged
    ? resolve(process.resourcesPath, 'agent-plugin')
    : resolve(HERE, '../../agent-server/agent-plugin')
}

const startAgentServer = async (): Promise<void> => {
  // Safe to do after import: the server reads its environment when its config
  // function is called and when a turn starts, not at module load.
  configureAgentEnvironment()
  const config = await loadAgentServerConfig()
  const server = createAgentServer({ config })
  await new Promise<void>((ready, failed) => {
    server.once('error', failed)
    server.listen(config.port, config.host, ready)
  })
  app.once('will-quit', () => server.close())
}

const createWindow = async (): Promise<void> => {
  const window = new BrowserWindow({
    backgroundColor: '#ffffff',
    height: 900,
    minHeight: 640,
    minWidth: 1024,
    show: false,
    title: 'Mona',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: resolve(HERE, 'preload.cjs'),
      sandbox: true,
    },
    width: 1440,
  })

  // Nothing in the editor should ever navigate the shell. A deck is untrusted
  // content - it comes out of a .pptx someone else made - so a link inside one must
  // not be able to replace the application with a web page.
  const rendererOrigin = new URL(rendererUrl).origin
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== rendererOrigin) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).origin === rendererOrigin) return { action: 'allow' }
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.once('ready-to-show', () => window.show())
  await window.loadURL(rendererUrl)
}

const main = async (): Promise<void> => {
  await app.whenReady()
  try {
    await startAgentServer()
  }
  catch (error) {
    // Without this the window never appears and the only trace is an unhandled
    // rejection on a console nobody is watching. The port being taken is the
    // realistic case - a stray dev server, or a second copy of Mona.
    const detail = (error as { code?: string }).code === 'EADDRINUSE'
      ? `Something else is already using port ${AGENT_PORT} on this machine. Quit it and open Mona again.`
      : error instanceof Error ? error.message : String(error)
    dialog.showErrorBox('Mona could not start', detail)
    app.quit()
    return
  }
  await createWindow()

  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) void createWindow()
  })
}

// macOS keeps the app alive with no windows; every other platform does not.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

void main()
