import type { PresentationCommand, PresentationState, PresentationTransactionResult } from '@mona/presentation-core'
import type { PPTElement, Slide, SlideTheme } from '@mona/presentation-core/model'

import type { SerializedDrawingScene } from '@/features/editor/drawing/drawing-store'

export type AgentProviderId =
  | 'anthropic-claude'
  | 'google-ai-studio'
  | 'mona-managed'
  | 'openai-chatgpt'
  | 'reference'

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

export interface AgentPlanRequest {
  context: AgentDocumentContext
  instruction: string
  signal?: AbortSignal
}

export interface AgentGeneratedPlan {
  code: string
  explanation: string
  providerId: AgentProviderId
  providerLabel: string
}

export type AgentPlanReview =
  | { status: 'accept'; explanation?: string }
  | { status: 'revise'; code: string; explanation: string }

export interface AgentProvider {
  generatePlan: (request: AgentPlanRequest) => Promise<AgentGeneratedPlan>
  id: AgentProviderId
  label: string
  reviewPlan?: (request: {
    afterPreview?: Blob
    context: AgentDocumentContext
    instruction: string
    plan: AgentGeneratedPlan
    signal?: AbortSignal
    summary: AgentOperationSummary
  }) => Promise<AgentPlanReview>
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

export interface AgentCandidate {
  afterPreview?: Blob
  baseRevision: string
  beforePreview?: Blob
  code: string
  createdAt: number
  explanation: string
  id: string
  logs: AgentSandboxLog[]
  preview: PresentationTransactionResult
  providerId: AgentProviderId
  providerLabel: string
  summary: AgentOperationSummary
}

export type AgentCandidateApplyResult =
  | { ok: true; state: PresentationState }
  | { ok: false; reason: 'invalid' | 'stale'; message: string }
