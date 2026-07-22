import { describe, expect, it } from 'vitest'
import {
  angleFromPoint,
  clientPointToSlide,
  containsBounds,
  intersectsBounds,
  lockDeltaToDominantAxis,
  normalizeRect,
  resizeBounds,
  snapMove,
  snapAngle,
} from './geometry'

describe('editor interaction geometry', () => {
  it('converts client coordinates and normalizes reverse drags', () => {
    expect(clientPointToSlide({ x: 260, y: 170 }, { left: 60, top: 70 }, 2)).toEqual({ x: 100, y: 50 })
    expect(normalizeRect({ x: 80, y: 90 }, { x: 20, y: 30 })).toEqual({ left: 20, top: 30, width: 60, height: 60 })
  })

  it('locks Shift drags to the dominant axis while preserving exact ties', () => {
    expect(lockDeltaToDominantAxis({ x: 40, y: 20 })).toEqual({ x: 40, y: 0 })
    expect(lockDeltaToDominantAxis({ x: 20, y: 40 })).toEqual({ x: 0, y: 40 })
    expect(lockDeltaToDominantAxis({ x: 40, y: 40 })).toEqual({ x: 40, y: 40 })
  })

  it('distinguishes containment selection from crossing selection', () => {
    const selection = { minX: 0, maxX: 100, minY: 0, maxY: 100 }
    const partial = { minX: 90, maxX: 120, minY: 20, maxY: 40 }
    expect(containsBounds(selection, partial)).toBe(false)
    expect(intersectsBounds(selection, partial)).toBe(true)
  })

  it('snaps movement to the first Vue-ordered horizontal and vertical candidates', () => {
    const result = snapMove({
      bounds: { minX: 10, maxX: 30, minY: 20, maxY: 40 },
      delta: { x: 67, y: 58 },
      horizontalCandidates: [{ value: 100, range: [0, 200] }],
      verticalCandidates: [{ value: 100, range: [0, 200] }],
    })
    expect(result.delta).toEqual({ x: 70, y: 60 })
    expect(result.guides.map(guide => guide.orientation)).toEqual(['horizontal', 'vertical'])
  })

  it('preserves candidate priority instead of silently selecting a closer later line', () => {
    const result = snapMove({
      bounds: { minX: 10, maxX: 30, minY: 20, maxY: 40 },
      delta: { x: 67, y: 58 },
      horizontalCandidates: [
        { value: 97, range: [0, 100] },
        { value: 100, range: [0, 200] },
      ],
      verticalCandidates: [],
    })
    expect(result.delta.y).toBe(57)
    expect(result.guides[0]?.axis).toBe(97)
  })

  it('measures crossed guide extents before either adsorption correction, like Vue', () => {
    const result = snapMove({
      bounds: { minX: 10, maxX: 30, minY: 20, maxY: 40 },
      delta: { x: 67, y: 58 },
      horizontalCandidates: [{ value: 100, range: [200, 300] }],
      verticalCandidates: [{ value: 100, range: [200, 300] }],
    })
    expect(result.delta).toEqual({ x: 70, y: 60 })
    expect(result.guides).toEqual([
      { orientation: 'horizontal', axis: 100, from: 27, to: 350 },
      { orientation: 'vertical', axis: 100, from: 28, to: 350 },
    ])
  })

  it('resizes from named handles with minimum and aspect-ratio constraints', () => {
    const origin = { minX: 10, maxX: 110, minY: 20, maxY: 70 }
    expect(resizeBounds(origin, 'right', { x: 20, y: 99 })).toEqual({ minX: 10, maxX: 130, minY: 20, maxY: 70 })
    expect(resizeBounds(origin, 'bottom-right', { x: 20, y: 1 }, { lockAspectRatio: true })).toEqual({ minX: 10, maxX: 130, minY: 20, maxY: 80 })
    expect(resizeBounds(origin, 'top-left', { x: 500, y: 500 }, {
      minimumHeight: 30,
      minimumWidth: 60,
    })).toEqual({ minX: 50, maxX: 110, minY: 40, maxY: 70 })
  })

  it('snaps rotation close to 45-degree increments', () => {
    const nearZero = angleFromPoint({ x: 50, y: 50 }, { x: 52, y: 0 })
    expect(nearZero).toBeCloseTo(2.2906100426385336, 12)
    expect(snapAngle(nearZero)).toBe(0)
    expect(angleFromPoint({ x: 50, y: 50 }, { x: 100, y: 50 })).toBe(90)
    expect(angleFromPoint({ x: 0, y: 0 }, { x: Math.sin(-178 * Math.PI / 180), y: -Math.cos(-178 * Math.PI / 180) })).toBeCloseTo(-178, 8)
    expect(snapAngle(40)).toBe(45)
    expect(snapAngle(39.999)).toBe(39.999)
    expect(snapAngle(-140)).toBe(-135)
    expect(snapAngle(175)).toBe(180)
  })
})
