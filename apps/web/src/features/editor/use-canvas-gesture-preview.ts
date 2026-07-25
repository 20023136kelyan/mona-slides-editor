import { useRef, useState, useSyncExternalStore } from 'react'

import type { EditorSessionState } from '@mona/editor-state'
import type { PresentationState } from '@mona/presentation-core'
import type { PPTImageElement, Slide } from '@mona/presentation-core/model'
import type { PointerPosition } from '@mona/editor-interactions'

import {
  applyElementUpdates,
  derivePreview,
  type CropDraft,
  type GestureContext,
} from '@/features/editor/editor-canvas-preview'
import { getElementsBounds, getImageCropGeometry } from '@/features/editor/editor-geometry'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

/**
 * Owns the in-flight gesture and everything derived from it.
 *
 * The gesture and the preview form a cycle: handlers write the gesture
 * context, the preview is derived from it, and the handlers then operate on
 * the derived `transformElements`. Keeping the whole loop here means callers
 * read a finished view of the slide instead of assembling it and passing the
 * pieces back down - which is what previously forced every gesture helper to
 * take the derived state as a parameter.
 */
export function useCanvasGesturePreview({
  activeElementIds,
  canvasPan,
  cropDraft,
  cropElementId,
  currentSlide,
  presentation,
  runtime,
  session,
}: {
  activeElementIds: readonly string[]
  canvasPan: PointerPosition
  cropDraft: CropDraft | null
  cropElementId: string | null
  currentSlide: Slide
  presentation: PresentationState
  runtime: EditorRuntime
  session: EditorSessionState
}) {
  const gestureRef = useRef<GestureContext | null>(null)
  const rawGestureOriginRef = useRef<PointerPosition | null>(null)
  const [gestureContext, setGestureContext] = useState<GestureContext | null>(null)

  const interaction = useSyncExternalStore(
    runtime.interaction.subscribe,
    runtime.interaction.getSnapshot,
    runtime.interaction.getSnapshot,
  )

  const preview = derivePreview(gestureContext, interaction, currentSlide, presentation.viewportSize, presentation.viewportRatio)
  const previewSlide = preview.duplicateElements
    ? (() => {
      const replacements = new Map(preview.duplicateElements.map(element => [element.id, element]))
      return {
        ...currentSlide,
        elements: currentSlide.elements.map(element => replacements.get(element.id) ?? element),
      }
    })()
    : applyElementUpdates(currentSlide, preview.updates)
  const selectedElements = previewSlide.elements.filter(element => activeElementIds.includes(element.id))
  const activeGroupElement = session.activeGroupElementId
    ? selectedElements.find(element => element.id === session.activeGroupElementId)
    : undefined
  const transformElements = activeGroupElement ? [activeGroupElement] : selectedElements
  const selectionBounds = selectedElements.length ? getElementsBounds(selectedElements) : undefined
  const pan = preview.pan ?? canvasPan
  const cropSourceImage = cropElementId
    ? previewSlide.elements.find((element): element is PPTImageElement => element.id === cropElementId && element.type === 'image')
    : undefined
  const cropGeometry = preview.cropGeometry ?? (
    cropDraft?.element.id === cropElementId
      ? cropDraft.geometry
      : cropSourceImage ? getImageCropGeometry(cropSourceImage) : undefined
  )

  return {
    activeGroupElement,
    cropGeometry,
    cropSourceImage,
    gestureContext,
    gestureRef,
    interaction,
    pan,
    preview,
    previewSlide,
    rawGestureOriginRef,
    selectedElements,
    selectionBounds,
    setGestureContext,
    transformElements,
  }
}
