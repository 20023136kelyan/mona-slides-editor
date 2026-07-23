import { editorActions } from '@mona/editor-state'
import { getMonaAgentModel } from '@mona/agent-protocol'
import { buildElementIndex, type PresentationTransactionResult } from '@mona/presentation-core'

import type { EditorRuntime } from '@/features/editor/editor-runtime'
import type { SketchAgentHandoff } from '@/features/editor/drawing/drawing-serialization'
import { buildAgentDocumentContext } from '@/features/editor/agent/agent-context-builder'
import {
  summarizeAgentTransaction,
  validateAgentCommands,
} from '@/features/editor/agent/agent-command-validator'
import { getAgentDocumentRevision } from '@/features/editor/agent/agent-revision'
import { renderAgentSlidePreview } from '@/features/editor/agent/agent-slide-preview'
import { runAgentSandbox } from '@/features/editor/agent/agent-sandbox'
import { createManagedAgentAssetService } from '@/features/editor/agent/agent-assets'
import { createGoogleGeminiProvider } from '@/features/editor/agent/providers/google-gemini-provider'
import { createManagedAgentProvider } from '@/features/editor/agent/providers/managed-agent-provider'
import { createReferenceAgentProvider } from '@/features/editor/agent/providers/reference-agent-provider'
import { createAuthenticatedAgentProvider } from '@/features/editor/agent/providers/authenticated-agent-provider'
import type {
  AgentCandidate,
  AgentCandidateApplyResult,
  AgentGeneratedPlan,
  AgentProvider,
  AgentProviderConfiguration,
} from '@/features/editor/agent/agent-types'

export type AgentProgressStage =
  | 'reading'
  | 'planning'
  | 'executing'
  | 'validating'
  | 'rendering'
  | 'reviewing'

export interface GenerateAgentCandidateInput {
  configuration: AgentProviderConfiguration
  handoff?: SketchAgentHandoff | null
  instruction: string
  onProgress?: (stage: AgentProgressStage) => void
  runtime: EditorRuntime
  signal?: AbortSignal
}

const resolveProvider = (configuration: AgentProviderConfiguration): AgentProvider => {
  switch (configuration.providerId) {
    case 'anthropic-claude': {
      const model = getMonaAgentModel('anthropic-claude', configuration.model)
      if (!model) throw new Error('Choose a supported Anthropic model')
      return createAuthenticatedAgentProvider({ id: 'anthropic-claude', label: model.name, model: model.id })
    }
    case 'google-ai-studio':
      return createGoogleGeminiProvider({
        apiKey: configuration.apiKey ?? '',
        model: configuration.model,
      })
    case 'mona-managed':
      return createManagedAgentProvider()
    case 'openai-chatgpt': {
      const model = getMonaAgentModel('openai-chatgpt', configuration.model)
      if (!model) throw new Error('Choose a supported OpenAI model')
      return createAuthenticatedAgentProvider({ id: 'openai-chatgpt', label: model.name, model: model.id })
    }
    case 'reference':
      return createReferenceAgentProvider()
  }
}

const withPlanExplanation = (
  preview: PresentationTransactionResult,
  plan: AgentGeneratedPlan,
): PresentationTransactionResult => {
  const transaction = {
    ...preview.transaction,
    label: plan.explanation.trim().slice(0, 160) || 'Mona agent edit',
  }
  return preview.ok
    ? { ...preview, transaction }
    : { ...preview, transaction }
}

export const generateAgentCandidate = async ({
  configuration,
  handoff,
  instruction,
  onProgress,
  runtime,
  signal,
}: GenerateAgentCandidateInput): Promise<AgentCandidate> => {
  const request = instruction.trim()
  if (!request) throw new Error('Describe the presentation change you want')
  const provider = resolveProvider(configuration)
  const assetService = createManagedAgentAssetService()
  const basePresentation = runtime.store.getState().presentation
  const currentSlide = basePresentation.slides[basePresentation.slideIndex]
  if (!currentSlide) throw new Error('The presentation has no active slide')

  onProgress?.('reading')
  const beforePreview = await renderAgentSlidePreview(basePresentation, currentSlide.id)
  const context = await buildAgentDocumentContext({
    activeElementIds: runtime.store.getState().session.activeElementIds,
    currentSlidePreview: beforePreview,
    presentation: basePresentation,
    sketch: handoff,
  })

  onProgress?.('planning')
  let plan = await provider.generatePlan({ context, instruction: request, signal })

  const executePlan = async (generated: AgentGeneratedPlan) => {
    onProgress?.('executing')
    const sandbox = await runAgentSandbox({
      assetService,
      code: generated.code,
      context,
      signal,
    })
    onProgress?.('validating')
    const transaction = validateAgentCommands(basePresentation, sandbox.commands)
    transaction.label = generated.explanation.trim().slice(0, 160) || 'Mona agent edit'
    const preview = withPlanExplanation(runtime.previewTransaction(transaction), generated)
    if (!preview.ok) throw new Error(preview.reason)
    const summary = summarizeAgentTransaction(transaction, preview, generated.explanation)
    onProgress?.('rendering')
    const afterPreview = await renderAgentSlidePreview(preview.state, currentSlide.id)
    return { afterPreview, preview, sandbox, summary }
  }

  let result = await executePlan(plan)
  if (provider.reviewPlan && result.afterPreview) {
    onProgress?.('reviewing')
    const review = await provider.reviewPlan({
      afterPreview: result.afterPreview,
      context,
      instruction: request,
      plan,
      signal,
      summary: result.summary,
    })
    if (review.status === 'revise') {
      plan = {
        code: review.code,
        explanation: review.explanation,
        providerId: provider.id,
        providerLabel: provider.label,
      }
      result = await executePlan(plan)
    }
    else if (review.explanation) {
      result.summary.description = review.explanation
    }
  }

  return {
    afterPreview: result.afterPreview,
    baseRevision: context.revision,
    beforePreview,
    code: plan.code,
    createdAt: Date.now(),
    explanation: plan.explanation,
    id: result.preview.transaction.id,
    logs: result.sandbox.logs,
    preview: result.preview,
    providerId: plan.providerId,
    providerLabel: plan.providerLabel,
    summary: result.summary,
  }
}

export const applyAgentCandidate = (
  runtime: EditorRuntime,
  candidate: AgentCandidate,
): AgentCandidateApplyResult => {
  if (!candidate.preview.ok) {
    return { ok: false, reason: 'invalid', message: candidate.preview.reason }
  }
  const current = runtime.store.getState().presentation
  if (getAgentDocumentRevision(current) !== candidate.baseRevision) {
    return {
      ok: false,
      reason: 'stale',
      message: 'The presentation changed after this preview. Generate the edit again from the current version.',
    }
  }
  const committed = runtime.commitTransaction(candidate.preview.transaction, {
    historyKey: `agent:${candidate.id}`,
  })
  if (!committed.ok) {
    return { ok: false, reason: 'invalid', message: committed.reason }
  }
  const state = runtime.store.getState().presentation
  const currentSlideId = state.slides[state.slideIndex]?.id
  const elementIndex = buildElementIndex(state)
  const selectedIds = currentSlideId && candidate.summary.affectedSlideIds.includes(currentSlideId)
    ? [...new Set(candidate.summary.affectedElementIds.flatMap(id => {
        const location = elementIndex.get(id)
        if (!location || location.slideId !== currentSlideId) return []
        const rootId = state.slides[state.slideIndex]?.elements[location.elementPath[0]!]?.id
        return rootId ? [rootId] : []
      }))]
    : []
  runtime.store.dispatch(editorActions.selectionChanged(selectedIds))
  runtime.store.dispatch(editorActions.pageSelectionChanged(selectedIds.length === 0))
  return { ok: true, state }
}
