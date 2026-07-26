import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { dirname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, protocol, shell } from 'electron'

import { installApplicationMenu } from './app-menu.js'
import { loadDevelopmentEnvironment } from './development-env.js'
import { attachWindowAgent, registerAgentIpc } from './agent-ipc.js'
import { handleAssetRequest, registerDeckIpc } from './deck-store.js'

/**
 * Mona's desktop shell.
 *
 * The agent host runs *in this process*. That is the point of the move: the Claude
 * Agent SDK spawns a subprocess, and as a website that subprocess had to live on
 * Mona's machine, processing other people's decks. Here it runs on the user's own
 * machine under the Claude login they already have.
 *
 * Nothing listens on a TCP port. The renderer reaches the host through a sandboxed
 * preload over IPC, which is why the CORS layer, the Origin gate, the session
 * cookie and the WebSocket could all be deleted rather than ported — there is no
 * network surface left for any of them to guard.
 */

// Before anything reads `userData`: without it Electron derives the directory from
// the package name and decks land in `Application Support/@mona/desktop`.
app.setName('Mona')

const HERE = dirname(fileURLToPath(import.meta.url))
const RENDERER_ROOT = app.isPackaged
  ? join(process.resourcesPath, 'renderer')
  : resolve(HERE, '../../web/dist')

/**
 * A real origin, not `file://`.
 *
 * Registered `standard` so the router's History API paths resolve and root-absolute
 * asset references keep working, and `secure` because the editor needs a secure
 * context: `crypto.subtle` computes PPTX package identity and `navigator.clipboard`
 * backs copy and paste. `file://` provides neither.
 */
const SCHEME = 'mona'
const APP_ORIGIN = `${SCHEME}://app`

protocol.registerSchemesAsPrivileged([{
  privileges: { secure: true, standard: true, supportFetchAPI: true },
  scheme: SCHEME,
}])

const MIME = new Map(Object.entries({
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}))

const mimeFor = (path: string): string => {
  const dot = path.lastIndexOf('.')
  return (dot === -1 ? undefined : MIME.get(path.slice(dot))) ?? 'application/octet-stream'
}

/**
 * Serves the built renderer, with an SPA fallback.
 *
 * Any path that is not a file on disk returns `index.html`, because the router owns
 * routing. The containment check matters more than it looks: without it a crafted
 * URL walks out of the bundle and serves anything the process can read.
 */
const serveRenderer = () => {
  protocol.handle(SCHEME, async request => {
    // Two hosts on one scheme: `mona://app/...` is the renderer, `mona://asset/...`
    // is deck binary served straight off disk.
    const asset = await handleAssetRequest(request)
    if (asset) return asset
    const { pathname } = new URL(request.url)
    const target = normalize(join(RENDERER_ROOT, decodeURIComponent(pathname)))
    const inside = target === RENDERER_ROOT || target.startsWith(RENDERER_ROOT + sep)
    const file = inside && await stat(target).then(entry => entry.isFile()).catch(() => false)
      ? target
      : join(RENDERER_ROOT, 'index.html')
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
      headers: { 'content-type': mimeFor(file) },
    })
  })
}

/** Vite in development, for hot reload; the bundled renderer once packaged. */
const rendererUrl = app.isPackaged
  ? `${APP_ORIGIN}/`
  : process.env.MONA_DESKTOP_RENDERER_URL ?? 'http://127.0.0.1:5173'

const MAC = process.platform === 'darwin'

const createWindow = async (): Promise<void> => {
  const window = new BrowserWindow({
    backgroundColor: '#ffffff',
    height: 900,
    minHeight: 640,
    minWidth: 1024,
    show: false,
    title: 'Mona',
    // On macOS the editor fills the window and the traffic lights float over its
    // header, which is why the renderer reserves space for them. `hiddenInset`
    // rather than fully frameless: the buttons keep their standard inset and
    // system behaviour, including the green button's window menu.
    ...(MAC ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 18 } } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: resolve(HERE, 'preload.cjs'),
      sandbox: true,
    },
    width: 1440,
  })

  attachWindowAgent(window)

  // A deck is untrusted content — it comes out of a .pptx someone else made — so a
  // link inside one must never be able to replace the application with a web page.
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
  await loadDevelopmentEnvironment()
  await app.whenReady()
  installApplicationMenu()
  serveRenderer()
  registerAgentIpc()
  registerDeckIpc()
  try {
    await createWindow()
  }
  catch (error) {
    dialog.showErrorBox('Mona could not start', error instanceof Error ? error.message : String(error))
    app.quit()
    return
  }

  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) void createWindow()
  })
}

// macOS keeps the app alive with no windows; every other platform does not.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

void main()
