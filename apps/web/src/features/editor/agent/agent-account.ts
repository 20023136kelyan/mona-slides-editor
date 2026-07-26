import { useSyncExternalStore } from 'react'

/**
 * Whether this machine is signed in to Claude.
 *
 * Not a credential Mona holds. The Agent SDK authenticates from the user's own
 * `claude` login, so this reports a fact about the machine — which is why there is
 * nothing here to connect, disconnect, or store.
 *
 * It replaces a 223-line client that drove OAuth flows for three providers as
 * pollable REST resources, kept per-provider status, and offered an API-key field.
 * All of it fed a vault whose credentials no code path ever turned into a running
 * turn: the only provider that works is Claude, and it never consulted the vault.
 */
export interface AgentAccount {
  accountLabel?: string
  connected: boolean
  loading: boolean
  planLabel?: string
}

const DISCONNECTED: AgentAccount = { connected: false, loading: true }

let account: AgentAccount = DISCONNECTED
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

const emit = () => listeners.forEach(listener => listener())

export const refreshAgentAccount = (): Promise<void> => {
  inflight ??= fetch('/api/agent/account', { credentials: 'include' })
    .then(async response => {
      if (!response.ok) throw new Error('Could not read the Claude account')
      const payload = await response.json() as Omit<AgentAccount, 'loading'>
      account = { ...payload, loading: false }
    })
    .catch(() => {
      // Signed out looks the same as unreachable from here, and both mean the
      // dock should offer to sign in rather than pretend a turn will work.
      account = { connected: false, loading: false }
    })
    .finally(() => {
      inflight = null
      emit()
    })
  return inflight
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  // On first subscription rather than at module load, so nothing is fetched for a
  // window that never opens the dock.
  if (account.loading) void refreshAgentAccount()
  return () => listeners.delete(listener)
}

export const useAgentAccount = (): AgentAccount => (
  useSyncExternalStore(subscribe, () => account, () => DISCONNECTED)
)
