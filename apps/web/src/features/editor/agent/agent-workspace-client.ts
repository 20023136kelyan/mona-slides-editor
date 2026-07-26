import type { PresentationState, Slide, SlideTheme } from '@mona/presentation-core'

import { validateAgentSlides } from '@/features/editor/agent/agent-deck-validator'
import { getAgentDocumentRevision } from '@/features/editor/agent/agent-revision'
import { replaceStrings } from '@/features/editor/editor-persistence'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

/** Bytes on the wire, because the agent's side of this has no object URLs. */
export interface AgentAsset {
  base64: string
  mediaType: string
}

/** What an asset is, without what it contains. */
export interface AgentAssetInfo {
  byteLength: number
  mediaType: string
}

export interface AgentSnapshotOutput {
  assets: Record<string, AgentAssetInfo>
  revision: string
  slideIndex: number
  slides: Slide[]
  theme: SlideTheme
  title: string
  viewportRatio: number
  viewportSize: number
}

export interface AgentApplyInput {
  /** Assets the agent created, keyed by the workspace path referencing them. */
  addedAssets?: Record<string, AgentAsset>
  /** The revision the workspace was taken at. */
  expectedRevision: string
  explanation?: string
  slides: Slide[]
  theme?: Partial<SlideTheme>
  title?: string
}

export interface AgentApplyOutput {
  applied: true
  explanation: string
  slideCount: number
}

/**
 * Asset references, found by the shape of the value rather than the field name.
 *
 * The same rule as `collectBlobUrls`, widened to `data:` so a deck carrying inline
 * bytes still unbundles. Naming fields is how 191 MB of `pattern` fills went
 * unnoticed for as long as they did.
 */
const collectAssetUrls = (value: unknown, found = new Set<string>()): Set<string> => {
  if (typeof value === 'string') {
    if (value.startsWith('blob:') || value.startsWith('data:')) found.add(value)
  }
  else if (Array.isArray(value)) {
    for (const entry of value) collectAssetUrls(entry, found)
  }
  else if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) collectAssetUrls(entry, found)
  }
  return found
}

/**
 * Raw base64, never a data URL.
 *
 * Providers splice this straight into their wire format - Google's
 * `inline_data.data` is TYPE_BYTES - so a `data:image/png;base64,` prefix fails to
 * decode server-side. `readAsDataURL` always yields a string, so the narrowing is
 * a formality rather than a fallback.
 */
export const blobToBase64 = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.addEventListener('load', () => {
    const result = typeof reader.result === 'string' ? reader.result : ''
    const comma = result.indexOf(',')
    resolve(comma === -1 ? result : result.slice(comma + 1))
  })
  reader.addEventListener('error', () => reject(new Error('Could not read an asset')))
  reader.readAsDataURL(blob)
})

const base64ToBlob = (asset: AgentAsset): Blob => {
  const binary = atob(asset.base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: asset.mediaType || 'application/octet-stream' })
}

/**
 * The deck, packaged for the agent's workspace - a manifest, not the bytes.
 *
 * Sending the images with it does not work: one real deck came to 342 MB of base64
 * in a single frame against a 100 MiB socket limit, which closed the connection
 * before the agent had begun. Measured, not guessed - and not a legacy-deck
 * problem either, since a deck whose assets are stored properly still runs to
 * ~193 MB. The server asks for each one separately through `readAssetBytes`.
 */
export const buildDeckSnapshot = async (presentation: PresentationState): Promise<AgentSnapshotOutput> => {
  const assets: Record<string, AgentAssetInfo> = {}
  // A `data:` URL *is* its own bytes, so slides carrying them put the whole deck
  // on the wire however carefully the manifest is built - measured at 193 MB for
  // one real deck, which closed the socket before the agent started. Re-homing
  // each one as an object URL makes the reference short while pointing at the same
  // bytes, and is the same move the importer makes for a freshly opened file.
  const rehomed = new Map<string, string>()
  for (const url of collectAssetUrls(presentation.slides)) {
    try {
      const blob = await fetch(url).then(response => response.blob())
      const handle = url.startsWith('data:') ? URL.createObjectURL(blob) : url
      if (handle !== url) rehomed.set(url, handle)
      assets[handle] = { byteLength: blob.size, mediaType: blob.type }
    }
    catch {
      // A revoked object URL: skip it. The reference survives into the workspace
      // with no file behind it, which the agent can see and report.
    }
  }
  // Not revoked on the way out: the agent may still ask for these bytes, and an
  // applied deck keeps referencing them. They are one short URL per asset and the
  // page reload clears them.
  const slides = replaceStrings(presentation.slides, rehomed)
  return {
    assets,
    // Against the deck as it stands, not as it was re-homed: this is what the
    // staleness check compares, and re-homing changed nothing the user can see.
    revision: getAgentDocumentRevision(presentation),
    slideIndex: presentation.slideIndex,
    slides,
    theme: presentation.theme,
    title: presentation.title,
    viewportRatio: presentation.viewportRatio,
    viewportSize: presentation.viewportSize,
  }
}

/**
 * One asset's bytes, for the workspace to write as a file.
 *
 * Read through `fetch` on the object URL, which is how the save path already reads
 * them - the media store is not consulted, so an asset created this session and
 * never yet saved works too.
 */
export const readAssetBytes = async (url: string): Promise<AgentAsset | undefined> => {
  try {
    const blob = await fetch(url).then(response => response.blob())
    return { base64: await blobToBase64(blob), mediaType: blob.type }
  }
  catch {
    // A revoked object URL. Reported as absent so one dead image costs one image.
    return undefined
  }
}

/**
 * Commits what the agent left in its workspace.
 *
 * Three things happen in order, and the order matters. The revision is checked
 * first, because everything after it assumes the deck has not moved. Assets the
 * agent added are ingested next, so the slides can reference real object URLs by
 * the time they are validated. Then one transaction, so the whole run is one undo.
 */
export const applyAgentWorkspace = async (
  input: AgentApplyInput,
  runtime: EditorRuntime,
): Promise<AgentApplyOutput> => {
  const state = runtime.store.getState()
  const current = getAgentDocumentRevision(state.presentation)
  if (current !== input.expectedRevision) {
    // Refused rather than merged. A copy cannot be reconciled with edits it never
    // saw, and silently overwriting them is the one outcome with no recovery.
    throw new Error(
      'The deck changed while you were working, so these edits were not applied. '
      + 'Take a fresh snapshot and redo them against it.',
    )
  }

  const urlByPath = new Map<string, string>()
  for (const [path, asset] of Object.entries(input.addedAssets ?? {})) {
    urlByPath.set(path, URL.createObjectURL(base64ToBlob(asset)))
  }
  // Object URLs alone: the bytes are captured into the media store by the save
  // that this commit triggers, the same path every other asset in the app takes.
  const slides = replaceStrings(input.slides, urlByPath)

  const explanation = (input.explanation ?? 'Mona agent edit').trim().slice(0, 160) || 'Mona agent edit'
  let transaction
  try {
    transaction = validateAgentSlides(state.presentation, {
      slides,
      ...(input.theme ? { theme: input.theme } : {}),
      ...(typeof input.title === 'string' ? { title: input.title } : {}),
    })
  }
  catch (error) {
    // Nothing was committed, so the URLs just minted have no owner.
    for (const url of urlByPath.values()) URL.revokeObjectURL(url)
    throw error
  }
  transaction.label = explanation

  const applied = runtime.commitTransaction(transaction, { historyKey: 'mona-agent-run' })
  if (!applied.ok) {
    for (const url of urlByPath.values()) URL.revokeObjectURL(url)
    throw new Error(`The deck was rejected: ${applied.reason}`)
  }
  return { applied: true, explanation, slideCount: slides.length }
}
