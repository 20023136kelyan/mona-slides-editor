import type { PointerPosition } from './index'

export interface InteractionRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface InteractionBounds {
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
}

export interface AlignmentGuide {
  readonly axis: number
  readonly from: number
  readonly orientation: 'horizontal' | 'vertical'
  readonly to: number
}

export interface SnapCandidate {
  readonly range: readonly [number, number]
  readonly value: number
}

export type ResizeHandle = 'top-left' | 'top' | 'top-right' | 'right' | 'bottom-right' | 'bottom' | 'bottom-left' | 'left'

export const clientPointToSlide = (
  point: PointerPosition,
  viewportRect: { readonly left: number; readonly top: number },
  scale: number,
): PointerPosition => ({
  x: (point.x - viewportRect.left) / scale,
  y: (point.y - viewportRect.top) / scale,
})

export const normalizeRect = (origin: PointerPosition, pointer: PointerPosition): InteractionRect => ({
  left: Math.min(origin.x, pointer.x),
  top: Math.min(origin.y, pointer.y),
  width: Math.abs(pointer.x - origin.x),
  height: Math.abs(pointer.y - origin.y),
})

export const lockDeltaToDominantAxis = (delta: PointerPosition): PointerPosition => {
  if (Math.abs(delta.x) > Math.abs(delta.y)) return { x: delta.x, y: 0 }
  if (Math.abs(delta.x) < Math.abs(delta.y)) return { x: 0, y: delta.y }
  return delta
}

export const rectToBounds = (rect: InteractionRect): InteractionBounds => ({
  minX: rect.left,
  maxX: rect.left + rect.width,
  minY: rect.top,
  maxY: rect.top + rect.height,
})

export const boundsToRect = (bounds: InteractionBounds): InteractionRect => ({
  left: bounds.minX,
  top: bounds.minY,
  width: bounds.maxX - bounds.minX,
  height: bounds.maxY - bounds.minY,
})

export const containsBounds = (outer: InteractionBounds, inner: InteractionBounds): boolean => (
  inner.minX >= outer.minX && inner.maxX <= outer.maxX &&
  inner.minY >= outer.minY && inner.maxY <= outer.maxY
)

export const intersectsBounds = (left: InteractionBounds, right: InteractionBounds): boolean => (
  left.maxX > right.minX && left.minX < right.maxX &&
  left.maxY > right.minY && left.minY < right.maxY
)

const firstSnap = (
  anchors: readonly number[],
  candidates: readonly SnapCandidate[],
  threshold: number,
) => {
  for (const candidate of candidates) {
    for (const anchor of anchors) {
      const correction = candidate.value - anchor
      if (Math.abs(correction) >= threshold) continue
      return { correction, candidate }
    }
  }
  return undefined
}

export const snapMove = (input: {
  bounds: InteractionBounds
  delta: PointerPosition
  horizontalCandidates: readonly SnapCandidate[]
  threshold?: number
  verticalCandidates: readonly SnapCandidate[]
}): { delta: PointerPosition; guides: AlignmentGuide[] } => {
  const threshold = input.threshold ?? 5
  const translated = {
    minX: input.bounds.minX + input.delta.x,
    maxX: input.bounds.maxX + input.delta.x,
    minY: input.bounds.minY + input.delta.y,
    maxY: input.bounds.maxY + input.delta.y,
  }
  const horizontal = firstSnap(
    [translated.minY, translated.maxY, (translated.minY + translated.maxY) / 2],
    input.horizontalCandidates,
    threshold,
  )
  const vertical = firstSnap(
    [translated.minX, translated.maxX, (translated.minX + translated.maxX) / 2],
    input.verticalCandidates,
    threshold,
  )
  const delta = {
    x: input.delta.x + (vertical?.correction ?? 0),
    y: input.delta.y + (horizontal?.correction ?? 0),
  }
  const guides: AlignmentGuide[] = []
  if (horizontal) {
    guides.push({
      orientation: 'horizontal',
      axis: horizontal.candidate.value,
      // Vue measures both guide extents from the translated bounds before
      // either axis' adsorption correction is applied. In particular, a
      // simultaneous vertical snap must not shift a horizontal guide's ends.
      from: Math.min(horizontal.candidate.range[0], translated.minX) - 50,
      to: Math.max(horizontal.candidate.range[1], translated.maxX) + 50,
    })
  }
  if (vertical) {
    guides.push({
      orientation: 'vertical',
      axis: vertical.candidate.value,
      from: Math.min(vertical.candidate.range[0], translated.minY) - 50,
      to: Math.max(vertical.candidate.range[1], translated.maxY) + 50,
    })
  }
  return { delta, guides }
}

export const resizeBounds = (
  origin: InteractionBounds,
  handle: ResizeHandle,
  delta: PointerPosition,
  options: {
    lockAspectRatio?: boolean
    minimumHeight?: number
    minimumSize?: number
    minimumWidth?: number
  } = {},
): InteractionBounds => {
  const minimumSize = options.minimumSize ?? 20
  const minimumWidth = options.minimumWidth ?? minimumSize
  const minimumHeight = options.minimumHeight ?? minimumSize
  let { minX, maxX, minY, maxY } = origin
  if (handle.includes('left')) minX += delta.x
  if (handle.includes('right')) maxX += delta.x
  if (handle.startsWith('top')) minY += delta.y
  if (handle.startsWith('bottom')) maxY += delta.y

  if (options.lockAspectRatio && handle.includes('-')) {
    const ratio = (origin.maxX - origin.minX) / Math.max(origin.maxY - origin.minY, 1)
    const width = maxX - minX
    const height = maxY - minY
    if (Math.abs(width - (origin.maxX - origin.minX)) > Math.abs(height - (origin.maxY - origin.minY)) * ratio) {
      const lockedHeight = width / ratio
      if (handle.startsWith('top')) minY = maxY - lockedHeight
      else maxY = minY + lockedHeight
    }
    else {
      const lockedWidth = height * ratio
      if (handle.includes('left')) minX = maxX - lockedWidth
      else maxX = minX + lockedWidth
    }
  }

  if (maxX - minX < minimumWidth) {
    if (handle.includes('left')) minX = maxX - minimumWidth
    else maxX = minX + minimumWidth
  }
  if (maxY - minY < minimumHeight) {
    if (handle.startsWith('top')) minY = maxY - minimumHeight
    else maxY = minY + minimumHeight
  }
  return { minX, maxX, minY, maxY }
}

export const snapAngle = (angle: number, increment = 45, threshold = 5): number => {
  const target = Math.round(angle / increment) * increment
  return Math.abs(angle - target) <= threshold ? target : angle
}

export const angleFromPoint = (center: PointerPosition, pointer: PointerPosition): number => {
  let angle = Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180 / Math.PI + 90
  while (angle > 180) angle -= 360
  while (angle < -180) angle += 360
  return angle
}
