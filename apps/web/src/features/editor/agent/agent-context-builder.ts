import type { PresentationState } from '@mona/presentation-core'
import type { PPTElement } from '@mona/presentation-core/model'

import type { SketchAgentHandoff } from '@/features/editor/drawing/drawing-serialization'
import { getAgentDocumentRevision } from '@/features/editor/agent/agent-revision'
import type { AgentDocumentContext, AgentSlideContext } from '@/features/editor/agent/agent-types'

const MAX_INLINE_SOURCE_LENGTH = 512

const compactElement = (element: PPTElement): PPTElement => {
  const clone = structuredClone(element)
  if ('src' in clone && typeof clone.src === 'string' && clone.src.length > MAX_INLINE_SOURCE_LENGTH) {
    clone.src = `managed://existing/${encodeURIComponent(clone.id)}`
  }
  if ('poster' in clone && typeof clone.poster === 'string' && clone.poster.length > MAX_INLINE_SOURCE_LENGTH) {
    clone.poster = `managed://existing/${encodeURIComponent(clone.id)}/poster`
  }
  return clone
}

const blobToDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.addEventListener('load', () => {
    if (typeof reader.result === 'string') resolve(reader.result)
    else reject(new Error('Preview image could not be encoded'))
  })
  reader.addEventListener('error', () => reject(reader.error ?? new Error('Unable to read preview image')))
  reader.readAsDataURL(blob)
})

export interface BuildAgentContextInput {
  activeElementIds: readonly string[]
  currentSlidePreview?: Blob
  presentation: PresentationState
  sketch?: SketchAgentHandoff | null
}

export const buildAgentDocumentContext = async ({
  activeElementIds,
  currentSlidePreview,
  presentation,
  sketch,
}: BuildAgentContextInput): Promise<AgentDocumentContext> => {
  const currentSlide = presentation.slides[presentation.slideIndex]
  if (!currentSlide) throw new Error('The presentation has no active slide')
  const selected = new Set(activeElementIds)
  const slides: AgentSlideContext[] = presentation.slides.map((slide, index) => ({
    id: slide.id,
    index,
    elements: slide.elements.map(compactElement),
    ...(slide.background ? { background: structuredClone(slide.background) } : {}),
    ...(slide.notes?.length ? { notes: structuredClone(slide.notes) } : {}),
    ...(slide.sectionTag ? { sectionTag: structuredClone(slide.sectionTag) } : {}),
  }))

  return {
    currentSlideId: currentSlide.id,
    revision: getAgentDocumentRevision(presentation),
    selection: {
      elementIds: [...activeElementIds],
      elements: currentSlide.elements.filter(element => selected.has(element.id)).map(compactElement),
      slideId: currentSlide.id,
    },
    slides,
    summary: {
      currentSlideNumber: presentation.slideIndex + 1,
      elementCount: presentation.slides.reduce((count, slide) => count + slide.elements.length, 0),
      slideCount: presentation.slides.length,
      title: presentation.title,
      viewportHeight: presentation.viewportSize * presentation.viewportRatio,
      viewportWidth: presentation.viewportSize,
    },
    theme: structuredClone(presentation.theme),
    ...(currentSlidePreview ? { currentSlidePreviewDataUrl: await blobToDataUrl(currentSlidePreview) } : {}),
    ...(sketch ? {
      sketch: {
        elementCount: sketch.scene.elements.filter(element => element.isDeleted !== true).length,
        previewDataUrl: await blobToDataUrl(sketch.preview),
        scene: structuredClone(sketch.scene),
      },
    } : {}),
  }
}
