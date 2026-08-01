import {
  resolveSlideRenderState,
  type PPTElement,
  type PowerPointSlideLayout,
  type PowerPointSlideMaster,
  type PresentationState,
  type Slide,
  type SlideTheme,
} from '@mona/presentation-core'

import { validateAgentSlides } from '@/features/editor/agent/agent-deck-validator'
import { isDeckAssetUrl, storeDeckAsset } from '@/features/editor/editor-deck-assets'
import { getAgentDocumentRevision } from '@/features/editor/agent/agent-revision'
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
  slides: AgentWorkspaceSlide[]
  powerPointSharedLayers?: AgentPowerPointSharedLayers
  theme: SlideTheme
  title: string
  viewportRatio: number
  viewportSize: number
}

export interface AgentPowerPointSharedLayers {
  packages: Array<{
    layouts: PowerPointSlideLayout[]
    masters: PowerPointSlideMaster[]
    packageId: string
  }>
  schemaVersion: 1
}

/**
 * The JSON file the agent sees. Inherited elements are exposed beside local
 * `elements` so the model can inspect and edit them without mutating a shared
 * master/layout record. The field is virtual and is consumed at apply time.
 */
export type AgentWorkspaceSlide = Slide & {
  powerPointInheritedElements?: PPTElement[]
}

export interface AgentApplyInput {
  /** Assets the agent created, keyed by the workspace path referencing them. */
  addedAssets?: Record<string, AgentAsset>
  /** The revision the workspace was taken at. */
  expectedRevision: string
  explanation?: string
  powerPointSharedLayers?: AgentPowerPointSharedLayers
  slides: AgentWorkspaceSlide[]
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
    if (isDeckAssetUrl(value)) found.add(value)
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

/** Swaps workspace paths for the deck URLs they were written to. */
const replaceReferences = <Value>(value: Value, replacements: ReadonlyMap<string, string>): Value => {
  if (!replacements.size) return value
  if (typeof value === 'string') return (replacements.get(value) ?? value) as Value
  if (Array.isArray(value)) return value.map(entry => replaceReferences(entry, replacements)) as Value
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, replaceReferences(entry, replacements)]),
    ) as Value
  }
  return value
}

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
  const slides: AgentWorkspaceSlide[] = presentation.slides.map(slide => {
    const inherited = resolveSlideRenderState(slide, presentation.sourcePackages ?? [])
      .nodes
      .filter(node => node.layer !== 'slide')
      .map(node => structuredClone(node.element))
    return {
      ...slide,
      ...(inherited.length ? { powerPointInheritedElements: inherited } : {}),
    }
  })
  const assets: Record<string, AgentAssetInfo> = {}
  const sharedPackages = (presentation.sourcePackages ?? []).flatMap(sourcePackage => (
    sourcePackage.hierarchy
      ? [{
          layouts: structuredClone(sourcePackage.hierarchy.layouts),
          masters: structuredClone(sourcePackage.hierarchy.masters),
          packageId: sourcePackage.packageId,
        }]
      : []
  ))
  const powerPointSharedLayers: AgentPowerPointSharedLayers | undefined = sharedPackages.length
    ? { packages: sharedPackages, schemaVersion: 1 }
    : undefined
  // Nothing is re-homed and nothing is copied. Every asset is already a file the
  // deck names by path, so the manifest is a description of what is on disk. This
  // used to re-mint inline `data:` payloads as object URLs first, because slides
  // carrying their own bytes put 193 MB of one real deck on the wire.
  for (const url of collectAssetUrls({ powerPointSharedLayers, slides })) {
    const blob = await fetch(url).then(response => response.blob()).catch(() => undefined)
    if (blob) assets[url] = { byteLength: blob.size, mediaType: blob.type }
  }
  return {
    assets,
    revision: getAgentDocumentRevision(presentation),
    ...(powerPointSharedLayers ? { powerPointSharedLayers } : {}),
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

  // Written to disk before the deck names them, so a commit never refers to bytes
  // that are not yet stored.
  const urlByPath = new Map<string, string>()
  for (const [path, asset] of Object.entries(input.addedAssets ?? {})) {
    urlByPath.set(path, await storeDeckAsset(base64ToBlob(asset)))
  }
  const slides = replaceReferences(input.slides, urlByPath)
  const powerPointSharedLayers = input.powerPointSharedLayers
    ? replaceReferences(input.powerPointSharedLayers, urlByPath)
    : undefined

  const explanation = (input.explanation ?? 'Mona agent edit').trim().slice(0, 160) || 'Mona agent edit'
  // If validation fails the files stay; the next successful save collects any
  // that the deck does not name.
  const transaction = validateAgentSlides(state.presentation, {
    ...(powerPointSharedLayers ? { powerPointSharedLayers } : {}),
    slides,
    ...(input.theme ? { theme: input.theme } : {}),
    ...(typeof input.title === 'string' ? { title: input.title } : {}),
  })
  transaction.label = explanation

  const applied = runtime.commitTransaction(transaction, { historyKey: 'mona-agent-run' })
  if (!applied.ok) throw new Error(`The deck was rejected: ${applied.reason}`)
  return { applied: true, explanation, slideCount: slides.length }
}
