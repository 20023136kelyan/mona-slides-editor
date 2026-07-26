/**
 * The desktop shell, as the renderer sees it.
 *
 * Everything the editor cannot do for itself arrives through this one object,
 * exposed by a sandboxed preload. There is no fetch, no origin, and no port: the
 * renderer has no network surface at all, which is why the CORS layer, the Origin
 * gate and the signed session cookie could all go.
 *
 * Typed here rather than in the preload so the renderer's own type-check enforces
 * the contract; the two must be changed together.
 */
export interface MonaAccount {
  accountLabel?: string
  connected: boolean
  planLabel?: string
}

export interface MonaModel {
  effortLevels?: readonly string[]
  id: string
  name: string
}

export interface MonaToolRequest {
  id: string
  input: unknown
  name: string
}

/** A file the user chose, as bytes; the renderer has no path to open. */
export interface MonaPickedFile {
  bytes: ArrayBuffer
  mediaType: string
  name: string
}

/** What a dialog will accept, in the shape the platform dialogs want. */
export interface MonaFileFilter {
  extensions: string[]
  name: string
}

export interface MonaBridge {
  account: () => Promise<MonaAccount>
  agent: {
    interrupt: () => void
    /** Returns an unsubscribe, because a dock can be opened and closed repeatedly. */
    onChunk: (listener: (chunk: unknown) => void) => () => void
    onToolRequest: (listener: (request: MonaToolRequest) => void) => () => void
    respondTool: (id: string, outcome: { errorText?: string; output?: unknown }) => void
    send: (prompt: { effort?: string; model?: string; text: string }) => void
  }
  browseMedia: <Result>(kind: 'images' | 'videos', query: unknown) => Promise<Result>
  /** Null from any of these means the user cancelled, which is not a failure. */
  files: {
    open: (request: { filters: MonaFileFilter[]; multiple?: boolean; title?: string }) => Promise<MonaPickedFile[] | null>
    printToPdf: (request: {
      defaultName: string
      html: string
      page: { height: number; margin: number; width: number }
    }) => Promise<string | null>
    save: (request: { bytes: ArrayBuffer; defaultName: string; filters: MonaFileFilter[] }) => Promise<string | null>
  }
  deck: {
    clear: () => Promise<void>
    collectGarbage: (keep: readonly string[]) => Promise<void>
    read: () => Promise<{ presentation: unknown; savedAt: number; version: number } | null>
    write: (presentation: unknown) => Promise<number>
    writeAsset: (name: string, bytes: ArrayBuffer) => Promise<string>
  }
  models: () => Promise<MonaModel[]>
  /** The slideshow's second window, and the channel the two talk over. */
  screen: {
    closeAudience: () => Promise<void>
    onSync: (listener: (message: unknown) => void) => () => void
    openAudience: () => Promise<void>
    sync: (message: unknown) => void
  }
  /** Returns an unsubscribe. Only ever fires on macOS, where the menu bar exists. */
  onMenuCommand: (listener: (command: string) => void) => () => void
  platform: NodeJS.Platform
}

declare global {
  interface Window {
    mona?: MonaBridge
  }
}

/**
 * Throws rather than returning undefined.
 *
 * Mona is a desktop application; a renderer without the bridge is not a degraded
 * mode to code around, it is a build that cannot work. Failing loudly at the call
 * site beats every consumer carrying a branch that will never be taken.
 */
export const monaBridge = (): MonaBridge => {
  const bridge = window.mona
  if (!bridge) throw new Error('The Mona desktop bridge is unavailable in this window.')
  return bridge
}

/** For the few places that would rather show nothing than throw. */
export const maybeMonaBridge = (): MonaBridge | undefined => window.mona

/**
 * Whether the window's chrome belongs to macOS.
 *
 * Decides two things together, and they have to stay together: the menus live in
 * the system menu bar, and the editor's own header has to keep clear of the traffic
 * lights floating over its top-left. Split them and you get either two menu bars or
 * a close button sitting on top of a control.
 */
export const isMacChrome = (): boolean => window.mona?.platform === 'darwin'
