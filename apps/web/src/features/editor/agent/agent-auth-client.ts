import { useSyncExternalStore } from 'react'

import type { AgentProviderId } from '@/features/editor/agent/agent-types'

export type OAuthAgentProviderId = Extract<AgentProviderId, 'anthropic-claude' | 'openai-chatgpt'>

export interface AgentAuthPrompt {
  id: string
  message: string
  options?: readonly {
    description?: string
    id: string
    label: string
  }[]
  placeholder?: string
  type: 'manual_code' | 'secret' | 'select' | 'text'
}

export interface AgentAuthFlow {
  authorizationUrl?: string
  deviceCode?: {
    expiresInSeconds?: number
    intervalSeconds?: number
    userCode: string
    verificationUri: string
  }
  error?: string
  flowId: string
  message?: string
  prompt?: AgentAuthPrompt
  status: 'complete' | 'error' | 'pending'
}

export interface AgentAuthStatus {
  accountLabel?: string
  connected: boolean
  error?: string
  flow?: AgentAuthFlow
  loading: boolean
  planLabel?: string
}

const EMPTY_STATUS: AgentAuthStatus = { connected: false, loading: false }
const statuses = new Map<OAuthAgentProviderId, AgentAuthStatus>()
const listeners = new Set<() => void>()
const inflight = new Map<OAuthAgentProviderId, Promise<void>>()

const emit = () => listeners.forEach(listener => listener())
const setStatus = (providerId: OAuthAgentProviderId, status: AgentAuthStatus) => {
  statuses.set(providerId, status)
  emit()
}
const readJson = async <Value>(response: Response): Promise<Value> => {
  const payload = await response.json().catch(() => ({})) as Value & { message?: string }
  if (!response.ok) throw new Error(payload.message || `Provider authentication failed (${response.status})`)
  return payload
}

export const refreshAgentAuthStatus = (providerId: OAuthAgentProviderId): Promise<void> => {
  const current = inflight.get(providerId)
  if (current) return current
  setStatus(providerId, { ...statuses.get(providerId) ?? EMPTY_STATUS, loading: true, error: undefined })
  const request = fetch(`/api/agent/auth/${providerId}/status`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
    .then(response => readJson<Omit<AgentAuthStatus, 'loading'>>(response))
    .then(status => setStatus(providerId, { ...status, loading: false }))
    .catch(error => {
      setStatus(providerId, {
        connected: false,
        error: error instanceof Error ? error.message : String(error),
        loading: false,
      })
    })
    .finally(() => inflight.delete(providerId))
  inflight.set(providerId, request)
  return request
}

const updateFlow = (providerId: OAuthAgentProviderId, flow: AgentAuthFlow) => {
  setStatus(providerId, {
    ...statuses.get(providerId) ?? EMPTY_STATUS,
    connected: false,
    error: flow.status === 'error' ? flow.error || 'Provider sign-in failed' : undefined,
    flow,
    loading: flow.status === 'pending',
  })
}

const waitForConnection = async (
  providerId: OAuthAgentProviderId,
  initialFlow: AgentAuthFlow,
  popup: Window | null,
) => {
  let flow = initialFlow
  const deadline = Date.now() + 16 * 60_000
  while (Date.now() < deadline) {
    updateFlow(providerId, flow)
    if (flow.status === 'complete') {
      popup?.close()
      await refreshAgentAuthStatus(providerId)
      return
    }
    if (flow.status === 'error') throw new Error(flow.error || 'Provider sign-in failed')
    await new Promise(resolve => setTimeout(resolve, 900))
    const response = await fetch(`/api/agent/auth/${providerId}/flows/${encodeURIComponent(flow.flowId)}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
    flow = await readJson<AgentAuthFlow>(response)
  }
  popup?.close()
  throw new Error('Provider sign-in timed out')
}

export const connectAgentProvider = async (providerId: OAuthAgentProviderId): Promise<void> => {
  const popup = window.open('about:blank', `mona-${providerId}-auth`, 'popup=yes,width=620,height=760')
  if (!popup) throw new Error('Allow pop-ups to connect this provider')
  popup.document.title = 'Connecting to Mona'
  setStatus(providerId, { connected: false, loading: true })
  try {
    const response = await fetch(`/api/agent/auth/${providerId}/start`, {
      body: '{}',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    const flow = await readJson<AgentAuthFlow>(response)
    if (!flow.flowId) throw new Error('Provider returned an invalid sign-in flow')
    updateFlow(providerId, flow)
    const destination = flow.deviceCode?.verificationUri ?? flow.authorizationUrl
    if (destination) popup.location.replace(destination)
    else popup.close()
    await waitForConnection(providerId, flow, popup)
  }
  catch (error) {
    popup.close()
    setStatus(providerId, {
      connected: false,
      error: error instanceof Error ? error.message : String(error),
      flow: statuses.get(providerId)?.flow,
      loading: false,
    })
    throw error
  }
}

export const answerAgentAuthPrompt = async (
  providerId: OAuthAgentProviderId,
  promptId: string,
  answer: string,
): Promise<void> => {
  const flow = statuses.get(providerId)?.flow
  if (!flow || flow.status !== 'pending') throw new Error('Provider sign-in is no longer active')
  const response = await fetch(
    `/api/agent/auth/${providerId}/flows/${encodeURIComponent(flow.flowId)}/prompts/${encodeURIComponent(promptId)}`,
    {
      body: JSON.stringify({ answer }),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  )
  updateFlow(providerId, await readJson<AgentAuthFlow>(response))
}

export const cancelAgentAuthFlow = async (providerId: OAuthAgentProviderId): Promise<void> => {
  const flow = statuses.get(providerId)?.flow
  if (!flow || flow.status !== 'pending') return
  await fetch(`/api/agent/auth/${providerId}/flows/${encodeURIComponent(flow.flowId)}`, {
    credentials: 'include',
    method: 'DELETE',
  })
  setStatus(providerId, { connected: false, loading: false })
}

export const disconnectAgentProvider = async (providerId: OAuthAgentProviderId): Promise<void> => {
  setStatus(providerId, { ...statuses.get(providerId) ?? EMPTY_STATUS, loading: true })
  try {
    const response = await fetch(`/api/agent/auth/${providerId}`, {
      credentials: 'include',
      method: 'DELETE',
    })
    await readJson(response)
    setStatus(providerId, { connected: false, loading: false })
  }
  catch (error) {
    setStatus(providerId, {
      ...statuses.get(providerId) ?? EMPTY_STATUS,
      error: error instanceof Error ? error.message : String(error),
      loading: false,
    })
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useAgentAuthStatus = (providerId: OAuthAgentProviderId | null): AgentAuthStatus => {
  const getSnapshot = () => providerId ? statuses.get(providerId) ?? EMPTY_STATUS : EMPTY_STATUS
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
