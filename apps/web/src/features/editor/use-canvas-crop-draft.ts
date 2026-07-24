import { useEffect, useRef, useState } from 'react'

import { editorActions } from '@mona/editor-state'

import { commitCropDraft, type CropDraft } from '@/features/editor/editor-canvas-preview'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

/**
 * In-progress image crop. The draft is mirrored into a ref because the
 * document-level pointer listener below outlives any single render and must
 * commit whatever the latest draft is, not the one captured at subscribe time.
 */
export function useCanvasCropDraft({
  cropElementId,
  runtime,
}: {
  cropElementId: string | null
  runtime: EditorRuntime
}) {
  const cropDraftRef = useRef<CropDraft | null>(null)
  const [cropDraft, setCropDraft] = useState<CropDraft | null>(null)

  const updateCropDraft = (draft: CropDraft | null) => {
    cropDraftRef.current = draft
    setCropDraft(draft)
  }

  const finishCropEditing = (commit: boolean) => {
    const draft = cropDraftRef.current
    if (commit) commitCropDraft(runtime, draft)
    cropDraftRef.current = null
    setCropDraft(null)
    runtime.store.dispatch(editorActions.cropElementChanged(null))
  }

  // Clicking anywhere outside the crop editor commits the crop, matching the
  // source editor. Capture phase so it lands before canvas selection handling.
  useEffect(() => {
    if (!cropElementId) return undefined
    const finishWhenClickingOutside = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('.mona-image-crop-editor')) return
      commitCropDraft(runtime, cropDraftRef.current)
      cropDraftRef.current = null
      setCropDraft(null)
      runtime.store.dispatch(editorActions.cropElementChanged(null))
    }
    document.addEventListener('pointerdown', finishWhenClickingOutside, true)
    return () => document.removeEventListener('pointerdown', finishWhenClickingOutside, true)
  }, [cropElementId, runtime])

  return { cropDraft, cropDraftRef, finishCropEditing, updateCropDraft }
}
