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

const flushListeners = new Set<() => Promise<void>>()
ipcRenderer.on('mona:deck:flush', (_event, id: number) => {
  const done = Promise.all([...flushListeners].map(listener => Promise.resolve(listener())))
  void done.catch(() => {}).finally(() => ipcRenderer.send(`mona:deck:flushed:${id}`))
})

contextBridge.exposeInMainWorld('mona', {
  /** Provider accounts remain in their native CLIs; only status crosses IPC. */
  accounts: {
    connect: (providerId: string) => ipcRenderer.invoke('mona:account:connect', providerId),
    list: () => ipcRenderer.invoke('mona:accounts'),
  },

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
    send: (prompt: {
      context: unknown[]
      effort?: string
      model: string
      providerId: string
      text: string
      userMessageId: string
    }) => {
      ipcRenderer.send('mona:agent:prompt', prompt)
    },
  },

  /** Durable, project-scoped conversations over several document references. */
  projectAgent: {
    interrupt: (projectId: string) => ipcRenderer.send('mona:project-agent:interrupt', projectId),
    onChunk: (listener: (event: unknown) => void) => on('mona:project-agent:chunk', listener),
    send: (prompt: {
      context: unknown[]
      effort?: string
      model: string
      projectId: string
      providerId: string
      text: string
      userMessageId: string
    }) => ipcRenderer.send('mona:project-agent:prompt', prompt),
  },

  projectJobs: {
    cancel: (projectId: string, jobId: string) => (
      ipcRenderer.invoke('mona:project-jobs:cancel', projectId, jobId)
    ),
    list: (projectId: string) => ipcRenderer.invoke('mona:project-jobs:list', projectId),
    onChange: (listener: (projectId: string) => void) => (
      on('mona:project-jobs:changed', listener)
    ),
    read: (projectId: string, jobId: string) => (
      ipcRenderer.invoke('mona:project-jobs:read', projectId, jobId)
    ),
  },

  projects: {
    addArtifact: (id: string, artifact: unknown) => (
      ipcRenderer.invoke('mona:projects:add-artifact', id, artifact)
    ),
    appendMessage: (id: string, message: unknown) => (
      ipcRenderer.invoke('mona:projects:append-message', id, message)
    ),
    create: (input?: unknown) => ipcRenderer.invoke('mona:projects:create', input),
    delete: (id: string) => ipcRenderer.invoke('mona:projects:delete', id),
    list: () => ipcRenderer.invoke('mona:projects:list'),
    onChange: (listener: () => void) => on('mona:projects:changed', listener),
    read: (id: string) => ipcRenderer.invoke('mona:projects:read', id),
    removeArtifact: (id: string, artifactId: string) => (
      ipcRenderer.invoke('mona:projects:remove-artifact', id, artifactId)
    ),
    rename: (id: string, title: string) => ipcRenderer.invoke('mona:projects:rename', id, title),
  },

  /** User-owned documents plus their local recovery/cache mirrors. */
  documents: {
    create: (presentation: unknown, sourceReference?: unknown) => (
      ipcRenderer.invoke('mona:documents:create', presentation, sourceReference)
    ),
    createLocal: (presentation: unknown, sourceId: string) => (
      ipcRenderer.invoke('mona:documents:create-local', presentation, sourceId)
    ),
    delete: (id: string) => ipcRenderer.invoke('mona:documents:delete', id),
    discardRecovery: (id: string) => ipcRenderer.invoke('mona:documents:discard-recovery', id),
    duplicate: (id: string, title?: string) => ipcRenderer.invoke('mona:documents:duplicate', id, title),
    exportPowerPoint: (id: string, presentation: unknown, packageId?: string) => (
      ipcRenderer.invoke('mona:documents:export-powerpoint', id, presentation, packageId)
    ),
    list: () => ipcRenderer.invoke('mona:documents:list'),
    cancelPowerPoint: (operationId: string) => (
      ipcRenderer.invoke('mona:documents:cancel-powerpoint', operationId)
    ),
    ingestPowerPoint: (
      id: string,
      bytes: ArrayBuffer,
      request: {
        coordinateLabels?: string[]
        fileName: string
        fixedViewport?: boolean
        operationId: string
        theme: unknown
      },
    ) => ipcRenderer.invoke('mona:documents:ingest-powerpoint', id, bytes, request),
    moveToSource: (id: string, sourceId: string) => (
      ipcRenderer.invoke('mona:documents:move-to-source', id, sourceId)
    ),
    openSource: (reference: unknown) => ipcRenderer.invoke('mona:documents:open-source', reference),
    package: (id: string) => ipcRenderer.invoke('mona:documents:package', id),
    read: (id: string) => ipcRenderer.invoke('mona:documents:read', id),
    rename: (id: string, title: string) => ipcRenderer.invoke('mona:documents:rename', id, title),
    write: (id: string, presentation: unknown) => ipcRenderer.invoke('mona:documents:write', id, presentation),
    writePreview: (
      id: string,
      bytes: ArrayBuffer,
      request: { expectedSavedAt: number; mediaType: string; slideId: string },
    ) => ipcRenderer.invoke('mona:documents:write-preview', id, bytes, request),
  },

  /**
   * User-configured storage sources.
   *
   * The main process retains provider credentials and filesystem paths. The
   * renderer receives provider-neutral summaries and opaque item identities.
   */
  dataSources: {
    addLocalFolder: () => ipcRenderer.invoke('mona:data-sources:add-local'),
    chooseDefaultLocalFolder: () => ipcRenderer.invoke('mona:data-sources:choose-default-local'),
    list: () => ipcRenderer.invoke('mona:data-sources:list'),
    listChildren: (sourceId: string, parentItemId: string) => (
      ipcRenderer.invoke('mona:data-sources:children', sourceId, parentItemId)
    ),
    listDocuments: (query?: unknown) => ipcRenderer.invoke('mona:data-sources:documents', query),
    onChange: (listener: (event: unknown) => void) => on('mona:data-sources:changed', listener),
    readDocument: (reference: unknown) => ipcRenderer.invoke('mona:data-sources:read', reference),
    remove: (sourceId: string) => ipcRenderer.invoke('mona:data-sources:remove', sourceId),
    setDefaultSaveLocation: (sourceId: string) => ipcRenderer.invoke('mona:data-sources:set-default', sourceId),
  },
  documentData: {
    legacyMigration: {
      complete: (id: string, kind: 'powerpoint-packages' | 'sketches') => ipcRenderer.invoke('mona:document-data:legacy:complete', id, kind),
      pending: (id: string, kind: 'powerpoint-packages' | 'sketches') => ipcRenderer.invoke('mona:document-data:legacy:pending', id, kind),
    },
    powerpointPackages: {
      delete: (id: string, packageId: string) => ipcRenderer.invoke('mona:document-data:pptx:delete', id, packageId),
      listIds: (id: string) => ipcRenderer.invoke('mona:document-data:pptx:list', id),
      read: (id: string, packageId: string) => ipcRenderer.invoke('mona:document-data:pptx:read', id, packageId),
      write: (id: string, packageId: string, value: unknown) => ipcRenderer.invoke('mona:document-data:pptx:write', id, packageId, value),
    },
    sketches: {
      delete: (id: string, slideId: string) => ipcRenderer.invoke('mona:document-data:sketches:delete', id, slideId),
      list: (id: string) => ipcRenderer.invoke('mona:document-data:sketches:list', id),
      write: (id: string, slideId: string, value: unknown) => ipcRenderer.invoke('mona:document-data:sketches:write', id, slideId, value),
    },
  },

  deck: {
    collectGarbage: (id: string, keep: readonly string[]) => ipcRenderer.invoke('mona:deck:collect-garbage', id, keep),
    flushPending: async () => {
      await Promise.all([...flushListeners].map(listener => Promise.resolve(listener())))
    },
    /**
     * The shell asking for unsaved work before it closes this window.
     *
     * The reply is sent whether or not the renderer is listening: a window with
     * no deck mounted — a fresh one, an audience view — has nothing to write,
     * and the shell should not sit waiting out its timeout to learn that.
     */
    onFlushRequest: (listener: () => Promise<void>) => {
      flushListeners.add(listener)
      return () => { flushListeners.delete(listener) }
    },
    /** Returns the `mona://asset/...` URL the deck should refer to it by. */
    writeAsset: (id: string, name: string, bytes: ArrayBuffer) => ipcRenderer.invoke('mona:deck:write-asset', id, name, bytes),
  },

  /**
   * The operating system's own open and save dialogs.
   *
   * `open` returns bytes rather than paths, because the renderer has no
   * filesystem to open a path with; `save` returns the path it wrote, or null
   * when the user cancelled, which is an outcome rather than a failure.
   */
  files: {
    open: (request: unknown) => ipcRenderer.invoke('mona:files:open', request),
    printToPdf: (request: unknown) => ipcRenderer.invoke('mona:files:print-pdf', request),
    save: (request: unknown) => ipcRenderer.invoke('mona:files:save', request),
  },

  /** Stock photo and video search, for the media panels. */
  browseMedia: (kind: 'images' | 'videos', query: unknown) => (
    ipcRenderer.invoke('mona:media:browse', kind, query)
  ),

  /**
   * The slideshow, across two windows.
   *
   * `sync` and `onSync` are the transport the renderer's own sync protocol runs
   * over. They replace a `BroadcastChannel`, which cannot reach between two
   * `BrowserWindow`s because those are two renderer processes.
   */
  screen: {
    closeAudience: () => ipcRenderer.invoke('mona:screen:close-audience'),
    onSync: (listener: (message: unknown) => void) => on('mona:screen:sync', listener),
    openAudience: (documentPath: string) => ipcRenderer.invoke('mona:screen:open-audience', documentPath),
    sync: (message: unknown) => ipcRenderer.send('mona:screen:sync', message),
  },

  /** The model catalog for the signed-in plan. */
  models: () => ipcRenderer.invoke('mona:models'),

  /**
   * A command chosen from the macOS menu bar.
   *
   * The menu items do not act: they name a command and the renderer runs the same
   * handler its own header uses, so the two cannot drift apart.
   */
  onMenuCommand: (listener: (command: string) => void) => on('mona:menu', listener),

  /** Decides where the menus live and whether to clear the traffic lights. */
  platform: process.platform,
})
