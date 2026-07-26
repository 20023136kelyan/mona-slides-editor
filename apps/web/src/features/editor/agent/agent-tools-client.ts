import type { AgentClientToolName } from '@mona/agent-protocol'

import { renderAgentSlidePreview } from '@/features/editor/agent/agent-slide-preview'
import {
  applyAgentWorkspace,
  blobToBase64,
  buildDeckSnapshot,
  readAssetBytes,
  type AgentApplyInput,
  type AgentApplyOutput,
  type AgentAsset,
  type AgentSnapshotOutput,
} from '@/features/editor/agent/agent-workspace-client'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

/** What `look` hands back: one rendered slide as raw base64. */
export interface AgentSlideImage {
  base64: string
  mediaType: string
  slideId: string
}

export interface AgentLookOutput { images: AgentSlideImage[] }

const resolveSlideIds = (runtime: EditorRuntime, requested?: readonly string[]): string[] => {
  const { presentation } = runtime.store.getState()
  const ids = (requested ?? []).filter(id => presentation.slides.some(slide => slide.id === id))
  if (ids.length) return ids
  const current = presentation.slides[presentation.slideIndex]
  return current ? [current.id] : []
}

/**
 * The requests only this tab can answer, executed in the browser.
 *
 * The agent loop runs in a subprocess on the server, but the deck is a live store
 * here - so the server's tool handlers ask this, over the socket, and wait.
 * Throwing marks the call as failed; the model reads the message and recovers,
 * which is why every message is phrased for it rather than for a log.
 */
export const runClientTool = async (
  name: AgentClientToolName,
  input: unknown,
  runtime: EditorRuntime,
): Promise<AgentApplyOutput | AgentAsset | AgentLookOutput | AgentSnapshotOutput> => {
  if (name === 'look') {
    const args = (input ?? {}) as { slideIds?: string[] }
    const { presentation } = runtime.store.getState()
    const images: AgentSlideImage[] = []
    for (const slideId of resolveSlideIds(runtime, args.slideIds)) {
      const blob = await renderAgentSlidePreview(presentation, slideId)
      if (!blob) continue
      images.push({
        base64: await blobToBase64(blob),
        mediaType: blob.type || 'image/png',
        slideId,
      })
    }
    if (!images.length) throw new Error('No slides could be rendered.')
    return { images }
  }

  if (name === 'snapshot') {
    return buildDeckSnapshot(runtime.store.getState().presentation)
  }

  if (name === 'asset') {
    const { url } = (input ?? {}) as { url?: string }
    if (!url) throw new Error('No asset was named.')
    const bytes = await readAssetBytes(url)
    if (!bytes) throw new Error('That asset is no longer available.')
    return bytes
  }

  return applyAgentWorkspace(input as AgentApplyInput, runtime)
}
