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
  models: () => Promise<MonaModel[]>
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
