import { useSyncExternalStore } from 'react'

import type { AgentProviderId } from '@mona/agent-protocol'

import { monaBridge } from '@/lib/mona-bridge'

import { refreshAgentModels } from './agent-model-catalog'

export interface AgentAccount {
  accountLabel?: string
  connected: boolean
  connecting: boolean
  loading: boolean
  planLabel?: string
  providerId: AgentProviderId
}

const EMPTY: readonly AgentAccount[] = [
  { connected: false, connecting: false, loading: true, providerId: 'anthropic' },
  { connected: false, connecting: false, loading: true, providerId: 'openai' },
]

let accounts: readonly AgentAccount[] = EMPTY
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

const emit = () => listeners.forEach(listener => listener())

export const refreshAgentAccounts = (): Promise<void> => {
  inflight ??= monaBridge().accounts.list()
    .then(payload => {
      accounts = (['anthropic', 'openai'] as const).map(providerId => {
        const account = payload.find(candidate => candidate.providerId === providerId)
        return {
          ...account,
          connected: account?.connected ?? false,
          connecting: false,
          loading: false,
          providerId,
        }
      })
    })
    .catch(() => {
      accounts = EMPTY.map(account => ({ ...account, loading: false }))
    })
    .finally(() => {
      inflight = null
      emit()
    })
  return inflight
}

/** Retained as the singular action used by existing surface effects. */
export const refreshAgentAccount = refreshAgentAccounts

export const connectAgentAccount = async (providerId: AgentProviderId): Promise<void> => {
  accounts = accounts.map(account => account.providerId === providerId
    ? { ...account, connecting: true }
    : account)
  emit()
  try {
    const connected = await monaBridge().accounts.connect(providerId)
    accounts = accounts.map(account => account.providerId === providerId
      ? { ...connected, connecting: false, loading: false }
      : account)
    await refreshAgentModels()
  }
  finally {
    accounts = accounts.map(account => account.providerId === providerId
      ? { ...account, connecting: false, loading: false }
      : account)
    emit()
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  if (accounts.some(account => account.loading)) void refreshAgentAccounts()
  return () => listeners.delete(listener)
}

export const useAgentAccounts = (): readonly AgentAccount[] => (
  useSyncExternalStore(subscribe, () => accounts, () => EMPTY)
)

export const useAgentAccount = (
  providerId: AgentProviderId = 'anthropic',
): AgentAccount => {
  const snapshot = useAgentAccounts()
  return snapshot.find(account => account.providerId === providerId)
    ?? { connected: false, connecting: false, loading: false, providerId }
}
