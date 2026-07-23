import type {
  AgentGeneratedPlan,
  AgentPlanReview,
  AgentProvider,
} from '@/features/editor/agent/agent-types'

const requestJson = async <Value>(path: string, body: unknown, signal?: AbortSignal): Promise<Value> => {
  const response = await fetch(path, {
    body: JSON.stringify(body),
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    signal,
  })
  const payload = await response.json().catch(() => ({})) as Value & { message?: string }
  if (!response.ok) throw new Error(payload.message || `Mona agent request failed (${response.status})`)
  return payload
}

export const createManagedAgentProvider = (): AgentProvider => ({
  id: 'mona-managed',
  label: 'Mona managed',
  async generatePlan(request): Promise<AgentGeneratedPlan> {
    const plan = await requestJson<{ code?: unknown; explanation?: unknown }>('/api/agent/plan', {
      context: request.context,
      instruction: request.instruction,
    }, request.signal)
    if (typeof plan.code !== 'string' || typeof plan.explanation !== 'string') {
      throw new Error('Mona agent returned an invalid presentation program')
    }
    return {
      code: plan.code,
      explanation: plan.explanation,
      providerId: 'mona-managed',
      providerLabel: 'Mona managed',
    }
  },
  async reviewPlan(request): Promise<AgentPlanReview> {
    const review = await requestJson<Record<string, unknown>>('/api/agent/review', {
      context: request.context,
      instruction: request.instruction,
      plan: request.plan,
      summary: request.summary,
    }, request.signal)
    if (review.status === 'revise' && typeof review.code === 'string' && typeof review.explanation === 'string') {
      return { status: 'revise', code: review.code, explanation: review.explanation }
    }
    return { status: 'accept', explanation: typeof review.explanation === 'string' ? review.explanation : undefined }
  },
})

