import { describe, expect, it, vi } from 'vitest'
import { createInteractionController } from './index'

describe('interaction controller', () => {
  it('publishes cached snapshots and returns one semantic completion', () => {
    const controller = createInteractionController()
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)
    const idle = controller.getSnapshot()
    expect(controller.getSnapshot()).toBe(idle)

    controller.begin({ gestureId: 'drag-1', kind: 'drag', pointer: { x: 10, y: 20 } })
    controller.updatePointer({ x: 25, y: 55 }, { shift: true })
    const active = controller.getSnapshot()
    expect(active.delta).toEqual({ x: 15, y: 35 })
    expect(active.modifiers.shift).toBe(true)
    expect(controller.getSnapshot()).toBe(active)

    expect(controller.complete()).toEqual({
      gestureId: 'drag-1',
      kind: 'drag',
      origin: { x: 10, y: 20 },
      pointer: { x: 25, y: 55 },
      delta: { x: 15, y: 35 },
      modifiers: {
        alt: false,
        control: false,
        meta: false,
        shift: true,
      },
    })
    expect(controller.complete()).toBeUndefined()
    expect(listener).toHaveBeenCalledTimes(3)
    unsubscribe()
  })
})
