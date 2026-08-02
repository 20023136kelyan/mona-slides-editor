import { expect, test, vi } from 'vitest'

import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { AgentIpcTransport } from '@/features/editor/agent/agent-ipc-transport'

test('reattaches its tool listener after a React effect replay', () => {
  const bridge = window.mona!
  const original = bridge.agent.onToolRequest
  const stops: Array<ReturnType<typeof vi.fn<() => void>>> = []
  const subscribe = vi.fn<() => () => void>(() => {
    const stop = vi.fn<() => void>()
    stops.push(stop)
    return stop
  })
  bridge.agent.onToolRequest = subscribe
  try {
    const transport = new AgentIpcTransport({
      model: 'default',
      providerId: 'anthropic',
      runtime: {} as EditorRuntime,
    })
    transport.open()
    transport.open()
    expect(subscribe).toHaveBeenCalledOnce()

    transport.close()
    expect(stops[0]).toHaveBeenCalledOnce()
    transport.open()
    expect(subscribe).toHaveBeenCalledTimes(2)
    transport.close()
    expect(stops[1]).toHaveBeenCalledOnce()
  }
  finally {
    bridge.agent.onToolRequest = original
  }
})
