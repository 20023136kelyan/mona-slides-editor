import { useEffect, useState } from 'react'

export interface ManagedAgentStatus {
  available: boolean
  error?: string
  loading: boolean
  message?: string
}

const UNAVAILABLE: ManagedAgentStatus = {
  available: false,
  loading: true,
}

export const useManagedAgentStatus = (): ManagedAgentStatus => {
  const [status, setStatus] = useState<ManagedAgentStatus>(UNAVAILABLE)

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/agent/providers/mona-managed/status', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async response => {
        const payload = await response.json().catch(() => ({})) as {
          available?: unknown
          message?: unknown
        }
        if (!response.ok) throw new Error(
          typeof payload.message === 'string'
            ? payload.message
            : `Managed provider status failed (${response.status})`,
        )
        setStatus({
          available: payload.available === true,
          loading: false,
          ...(typeof payload.message === 'string' ? { message: payload.message } : {}),
        })
      })
      .catch(error => {
        if (controller.signal.aborted) return
        setStatus({
          available: false,
          error: error instanceof Error ? error.message : String(error),
          loading: false,
        })
      })

    return () => controller.abort()
  }, [])

  return status
}
