import { describe, expect, it, vi } from 'vitest'

import { AgentToolBridge, type AgentToolRequest } from './agent-tool-bridge.js'

const makeBridge = (timeoutMs = 90_000) => {
  const sent: AgentToolRequest[] = []
  let next = 0
  const bridge = new AgentToolBridge({
    newId: () => `call-${++next}`,
    send: request => void sent.push(request),
    timeoutMs,
  })
  return { bridge, sent }
}

describe('agent tool bridge', () => {
  it('resolves a handler with the output the browser returns', async () => {
    const { bridge, sent } = makeBridge()
    const pending = bridge.request('look', { slideIds: ['slide-1'] })

    expect(sent).toEqual([{ id: 'call-1', input: { slideIds: ['slide-1'] }, name: 'look' }])
    expect(bridge.pendingCount).toBe(1)

    bridge.fulfil('call-1', { output: { images: [{ base64: 'AAA' }] } })

    await expect(pending).resolves.toEqual({ images: [{ base64: 'AAA' }] })
    expect(bridge.pendingCount).toBe(0)
  })

  it('rejects the handler when the browser reports the tool failed', async () => {
    const { bridge } = makeBridge()
    const pending = bridge.request('edit', { program: 'boom()' })

    bridge.fulfil('call-1', { errorText: 'boom is not defined' })

    await expect(pending).rejects.toThrow('boom is not defined')
  })

  it('keeps calls independent, so answers may arrive out of order', async () => {
    const { bridge } = makeBridge()
    const first = bridge.request('look', {})
    const second = bridge.request('inspect', {})

    bridge.fulfil('call-2', { output: 'inspected' })
    bridge.fulfil('call-1', { output: 'looked' })

    await expect(second).resolves.toBe('inspected')
    await expect(first).resolves.toBe('looked')
  })

  it('ignores an outcome for an id it is not waiting on', async () => {
    const { bridge } = makeBridge()
    const pending = bridge.request('look', {})

    expect(bridge.fulfil('call-unknown', { output: 'forged' })).toBe(false)
    expect(bridge.fulfil('call-1', { output: 'real' })).toBe(true)
    // A second answer for the same call is a duplicate, not a second result.
    expect(bridge.fulfil('call-1', { output: 'again' })).toBe(false)

    await expect(pending).resolves.toBe('real')
  })

  it('times out rather than leaving the agent loop blocked forever', async () => {
    vi.useFakeTimers()
    try {
      const { bridge } = makeBridge(1_000)
      const pending = bridge.request('look', {})
      const assertion = expect(pending).rejects.toThrow('did not answer the look tool in time')

      await vi.advanceTimersByTimeAsync(1_000)
      await assertion
      expect(bridge.pendingCount).toBe(0)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('fails everything in flight when the browser disconnects', async () => {
    const { bridge } = makeBridge()
    const first = bridge.request('look', {})
    const second = bridge.request('edit', {})

    bridge.closeAll('The editor disconnected.')

    await expect(first).rejects.toThrow('The editor disconnected.')
    await expect(second).rejects.toThrow('The editor disconnected.')
    expect(bridge.pendingCount).toBe(0)
  })

  it('rejects rather than hanging when the send itself fails', async () => {
    const bridge = new AgentToolBridge({
      send: () => {
        throw new Error('socket closed')
      },
    })

    await expect(bridge.request('look', {})).rejects.toThrow('socket closed')
    expect(bridge.pendingCount).toBe(0)
  })
})
