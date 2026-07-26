import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

/**
 * The only thing the renderer can reach outside its own window.
 *
 * A sandboxed preload with `contextIsolation` means the page cannot see Node, this
 * module's scope, or any channel not named here. That is the whole security story
 * now, and a far simpler one than the HTTP server it replaces: no port for another
 * local process to find, no Origin to check, no CORS, no session cookie to sign —
 * because there is nothing on the network to reach.
 *
 * CommonJS on purpose: a sandboxed preload cannot be an ES module.
 */

/** Main→renderer requests the renderer must answer, correlated by id. */
interface ToolRequest {
  id: string
  input: unknown
  name: string
}

// A declaration rather than a generic arrow: in a `.cts` file the latter is
// ambiguous with JSX and the bundler refuses it.
function on<Payload>(channel: string, listener: (payload: Payload) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: Payload) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => { ipcRenderer.off(channel, handler) }
}

contextBridge.exposeInMainWorld('mona', {
  /** Whether this machine is signed in to Claude, and as whom. */
  account: () => ipcRenderer.invoke('mona:account'),

  agent: {
    /** Stop the running turn. */
    interrupt: () => ipcRenderer.send('mona:agent:interrupt'),
    /** UI chunks for the transcript, in the vocabulary `useChat` already speaks. */
    onChunk: (listener: (chunk: unknown) => void) => on('mona:agent:chunk', listener),
    /**
     * The agent asking this window to do something only it can — render a slide,
     * read the deck, commit an edit. Electron has no main→renderer `invoke`, so the
     * answer carries the id back through `respondTool`.
     */
    onToolRequest: (listener: (request: ToolRequest) => void) => on('mona:agent:tool-request', listener),
    respondTool: (id: string, outcome: { errorText?: string; output?: unknown }) => {
      ipcRenderer.send('mona:agent:tool-result', { id, ...outcome })
    },
    /** Begin a turn, or steer one already running. */
    send: (prompt: { effort?: string; model?: string; text: string }) => {
      ipcRenderer.send('mona:agent:prompt', prompt)
    },
  },

  /** Stock photo and video search, for the media panels. */
  browseMedia: (kind: 'images' | 'videos', query: unknown) => (
    ipcRenderer.invoke('mona:media:browse', kind, query)
  ),

  /** The model catalog for the signed-in plan. */
  models: () => ipcRenderer.invoke('mona:models'),
})
