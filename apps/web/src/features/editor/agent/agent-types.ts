
import type { PPTElement, Slide, SlideTheme } from '@mona/presentation-core/model'

import type { SerializedDrawingScene } from '@/features/editor/drawing/drawing-store'

export interface AgentSelectionContext {
  elementIds: string[]
  elements: PPTElement[]
  slideId: string
}

export interface AgentSlideContext {
  id: string
  index: number
  elements: PPTElement[]
  background?: Slide['background']
  notes?: Slide['notes']
  sectionTag?: Slide['sectionTag']
}

export interface AgentSketchContext {
  elementCount: number
  previewDataUrl: string
  scene: SerializedDrawingScene
}

export interface AgentDocumentContext {
  currentSlideId: string
  revision: string
  selection: AgentSelectionContext
  slides: AgentSlideContext[]
  summary: {
    currentSlideNumber: number
    elementCount: number
    slideCount: number
    title: string
    viewportHeight: number
    viewportWidth: number
  }
  theme: SlideTheme
  currentSlidePreviewDataUrl?: string
  sketch?: AgentSketchContext
}

export interface AgentAssetSearchResult {
  alt: string
  attribution?: string
  id: string
  previewUrl: string
}

export interface AgentManagedAsset {
  alt: string
  id: string
  src: string
}

export interface AgentAssetService {
  importImage: (result: AgentAssetSearchResult, signal?: AbortSignal) => Promise<AgentManagedAsset>
  searchImages: (query: string, signal?: AbortSignal) => Promise<AgentAssetSearchResult[]>
}



