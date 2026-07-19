import { describe, expect, it } from 'vitest'
import {
  angleFromPoint,
  clientPointToSlide,
  containsBounds,
  intersectsBounds,
  normalizeRect,
  resizeBounds,
  snapMove,
} from './geometry'

describe('editor interaction geometry', () => {
  it('converts client coordinates and normalizes reverse drags', () => {
    expect(clientPointToSlide({ x: 260, y: 170 }, { left: 60, top: 70 }, 2)).toEqual({ x: 100, y: 50 })
    expect(normalizeRect({ x: 80, y: 90 }, { x: 20, y: 30 })).toEqual({ left: 20, top: 30, width: 60, height: 60 })
  })

  it('distinguishes containment selection from crossing selection', () => {
    const selection = { minX: 0, maxX: 100, minY: 0, maxY: 100 }
    const partial = { minX: 90, maxX: 120, minY: 20, maxY: 40 }
    expect(containsBounds(selection, partial)).toBe(false)
    expect(intersectsBounds(selection, partial)).toBe(true)
  })

  it('snaps movement to the closest horizontal and vertical candidates', () => {
    const result = snapMove({
      bounds: { minX: 10, maxX: 30, minY: 20, maxY: 40 },
      delta: { x: 67, y: 58 },
      horizontalCandidates: [{ value: 100, range: [0, 200] }],
      verticalCandidates: [{ value: 100, range: [0, 200] }],
    })
    expect(result.delta).toEqual({ x: 70, y: 60 })
    expect(result.guides.map(guide => guide.orientation)).toEqual(['horizontal', 'vertical'])
  })

  it('resizes from named handles with minimum and aspect-ratio constraints', () => {
    const origin = { minX: 10, maxX: 110, minY: 20, maxY: 70 }
    expect(resizeBounds(origin, 'right', { x: 20, y: 99 })).toEqual({ minX: 10, maxX: 130, minY: 20, maxY: 70 })
    expect(resizeBounds(origin, 'bottom-right', { x: 20, y: 1 }, { lockAspectRatio: true })).toEqual({ minX: 10, maxX: 130, minY: 20, maxY: 80 })
  })

  it('snaps rotation close to 45-degree increments', () => {
    expect(angleFromPoint({ x: 50, y: 50 }, { x: 52, y: 0 })).toBe(0)
    expect(angleFromPoint({ x: 50, y: 50 }, { x: 100, y: 50 })).toBe(90)
  })
})
