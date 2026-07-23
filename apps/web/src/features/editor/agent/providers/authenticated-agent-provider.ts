import type {
  AgentGeneratedPlan,
  AgentPlanReview,
  AgentProvider,
  AgentProviderId,
} from '@/features/editor/agent/agent-types'

type AuthenticatedProviderId = Extract<AgentProviderId, 'anthropic-claude' | 'openai-chatgpt'>

const blobToDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.addEventListener('load', () => {
    if (typeof reader.result === 'string') resolve(reader.result)
    else reject(new Error('Rendered preview could not be encoded'))
  })
  reader.addEventListener('error', () => reject(reader.error ?? new Error('Rendered preview could not be read')))
  reader.readAsDataURL(blob)
})

const requestJson = async <Value>(
  providerId: AuthenticatedProviderId,
  action: 'plan' | 'review',
  body: unknown,
  signal?: AbortSignal,
): Promise<Value> => {
  const response = await fetch(`/api/agent/providers/${providerId}/${action}`, {
    body: JSON.stringify(body),
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    signal,
  })
  const payload = await response.json().catch(() => ({})) as Value & { message?: string }
  if (response.status === 401) throw new Error('This model account is no longer connected. Sign in again.')
  if (!response.ok) throw new Error(payload.message || `Provider request failed (${response.status})`)
  return payload
}

export const createAuthenticatedAgentProvider = ({
  id,
  label,
  model,
}: {
  id: AuthenticatedProviderId
  label: string
  model: string
}): AgentProvider => ({
  id,
  label,
  async generatePlan(request): Promise<AgentGeneratedPlan> {
    const plan = await requestJson<{ code?: unknown; explanation?: unknown }>(id, 'plan', {
      context: request.context,
      instruction: request.instruction,
      model,
    }, request.signal)
    if (typeof plan.code !== 'string' || typeof plan.explanation !== 'string') {
      throw new Error(`${label} returned an invalid presentation program`)
    }
    return {
      code: plan.code,
      explanation: plan.explanation,
      providerId: id,
      providerLabel: label,
    }
  },
  async reviewPlan(request): Promise<AgentPlanReview> {
    const afterPreviewDataUrl = request.afterPreview
      ? await blobToDataUrl(request.afterPreview)
      : undefined
    const review = await requestJson<Record<string, unknown>>(id, 'review', {
      ...(afterPreviewDataUrl ? { afterPreviewDataUrl } : {}),
      context: request.context,
      instruction: request.instruction,
      model,
      plan: request.plan,
      summary: request.summary,
    }, request.signal)
    if (review.status === 'revise' && typeof review.code === 'string' && typeof review.explanation === 'string') {
      return { status: 'revise', code: review.code, explanation: review.explanation }
    }
    return { status: 'accept', explanation: typeof review.explanation === 'string' ? review.explanation : undefined }
  },
})
