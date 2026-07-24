import {
  compileSlideTheme,
  findElementById,
  flattenElementTree,
  resolveSlideRenderState,
  type PresentationState,
} from '@mona/presentation-core'
import type { PPTElement } from '@mona/presentation-core/model'

import type { SketchAgentHandoff } from '@/features/editor/drawing/drawing-serialization'
import { getAgentDocumentRevision } from '@/features/editor/agent/agent-revision'
import type { AgentDocumentContext, AgentSlideContext } from '@/features/editor/agent/agent-types'

const MAX_INLINE_SOURCE_LENGTH = 512

const compactElement = (element: PPTElement): PPTElement => {
  const clone = structuredClone(element)
  if (clone.type === 'group') clone.elements = clone.elements.map(compactElement)
  if ('src' in clone && typeof clone.src === 'string' && clone.src.length > MAX_INLINE_SOURCE_LENGTH) {
    clone.src = `managed://existing/${encodeURIComponent(clone.id)}`
  }
  if ('poster' in clone && typeof clone.poster === 'string' && clone.poster.length > MAX_INLINE_SOURCE_LENGTH) {
    clone.poster = `managed://existing/${encodeURIComponent(clone.id)}/poster`
  }
  if (clone.type === 'opaque' && clone.preview && clone.preview.length > MAX_INLINE_SOURCE_LENGTH) {
    clone.preview = `managed://existing/${encodeURIComponent(clone.id)}/preview`
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
  const resolvedSlides = presentation.slides.map(slide => ({
    renderState: resolveSlideRenderState(slide, presentation.sourcePackages),
    slide,
  }))
  const slides: AgentSlideContext[] = resolvedSlides.map(({ renderState, slide }, index) => ({
    id: slide.id,
    index,
    elements: slide.elements.map(compactElement),
    ...(renderState.background ? { background: structuredClone(renderState.background) } : {}),
    ...(slide.notes?.length ? { notes: structuredClone(slide.notes) } : {}),
    ...(slide.sectionTag ? { sectionTag: structuredClone(slide.sectionTag) } : {}),
  }))
  const currentRenderState = resolvedSlides[presentation.slideIndex]!.renderState

  return {
    currentSlideId: currentSlide.id,
    revision: getAgentDocumentRevision(presentation),
    selection: {
      elementIds: [...activeElementIds],
      elements: activeElementIds
        .map(id => findElementById(currentSlide.elements, id))
        .filter((element): element is PPTElement => element !== undefined)
        .map(compactElement),
      slideId: currentSlide.id,
    },
    slides,
    summary: {
      currentSlideNumber: presentation.slideIndex + 1,
      elementCount: presentation.slides.reduce((count, slide) => count + flattenElementTree(slide.elements).length, 0),
      slideCount: presentation.slides.length,
      title: presentation.title,
      viewportHeight: presentation.viewportSize * presentation.viewportRatio,
      viewportWidth: presentation.viewportSize,
    },
    theme: structuredClone(compileSlideTheme(
      presentation.theme,
      currentRenderState.theme,
      currentRenderState.master,
      currentRenderState.layout,
      currentSlide,
    )),
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
