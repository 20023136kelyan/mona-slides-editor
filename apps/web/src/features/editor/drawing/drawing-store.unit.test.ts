import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createDrawingStore,
  SLIDE_SKETCH_VERSION,
  type DrawingPersistenceAdapter,
  type SlideSketch,
} from '@/features/editor/drawing/drawing-store'

describe('drawing store', () => {
  let records: Map<string, SlideSketch>
  let adapter: DrawingPersistenceAdapter

  beforeEach(() => {
    vi.useFakeTimers()
    records = new Map()
    adapter = {
      delete: async slideId => records.delete(slideId),
      list: async () => [...records.values()],
      write: async (slideId, sketch) => records.set(slideId, structuredClone(sketch)),
    }
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('persists one independent editable scene per slide and hydrates it after reload', async () => {
    const store = createDrawingStore({ adapter })
    store.setScene('slide-a', { elements: [{ id: 'a', type: 'rectangle' }] })
    store.setScene('slide-b', { elements: [{ id: 'b', type: 'freedraw' }] })
    await store.flush()

    const restored = createDrawingStore({ adapter })
    await restored.hydrate()
    expect(restored.getSketch('slide-a')).toMatchObject({
      slideId: 'slide-a',
      version: SLIDE_SKETCH_VERSION,
      scene: { elements: [{ id: 'a', type: 'rectangle' }] },
    })
    expect(restored.getSketch('slide-b')?.scene.elements).toEqual([{ id: 'b', type: 'freedraw' }])
  })

  it('clears only the requested sketch and never mutates presentation content', async () => {
    const untouchedElements = [{ id: 'presentation-shape', type: 'shape' }]
    const store = createDrawingStore({ adapter })
    store.setScene('slide-a', { elements: [{ id: 'sketch', type: 'ellipse' }] })
    store.setScene('slide-b', { elements: [{ id: 'other', type: 'arrow' }] })

    store.clear('slide-a')
    await store.flush()

    expect(store.hasSketch('slide-a')).toBe(false)
    expect(store.hasSketch('slide-b')).toBe(true)
    expect(untouchedElements).toEqual([{ id: 'presentation-shape', type: 'shape' }])
  })

  it('prunes orphaned slide sketches and rejects oversized scenes', () => {
    const store = createDrawingStore({ adapter, persistenceEnabled: false })
    store.setScene('keep', { elements: [{ id: 'keep' }] })
    store.setScene('remove', { elements: [{ id: 'remove' }] })
    store.prune(new Set(['keep']))
    expect(store.hasSketch('keep')).toBe(true)
    expect(store.hasSketch('remove')).toBe(false)

    expect(store.setScene('huge', {
      elements: [{ id: 'huge', data: 'x'.repeat(9 * 1024 * 1024) }],
    })).toBeUndefined()
  })
})
