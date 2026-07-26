
import type { PresentationCommand } from '@mona/presentation-core'
import type { PPTElement, Slide, SlideTheme } from '@mona/presentation-core/model'

import type { SerializedDrawingScene } from '@/features/editor/drawing/drawing-store'

/** Every provider the dock can offer. The type is derived so the two cannot drift. */
export const AGENT_PROVIDER_IDS = [
  'anthropic-claude',
  'google-ai-studio',
  'openai-chatgpt',
] as const

export type AgentProviderId = (typeof AGENT_PROVIDER_IDS)[number]

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

export interface AgentProviderConfiguration {
  apiKey?: string
  model?: string
  providerId: AgentProviderId
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

export interface AgentSandboxLog {
  level: 'info' | 'warn'
  message: string
}

export interface AgentSandboxResult {
  commands: PresentationCommand[]
  logs: AgentSandboxLog[]
}

export interface AgentOperationSummary {
  affectedElementIds: string[]
  affectedSlideIds: string[]
  commandCount: number
  createdElements: number
  deletedElements: number
  description: string
  updatedElements: number
}
