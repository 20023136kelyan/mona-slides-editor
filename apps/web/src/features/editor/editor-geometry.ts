import type { PPTElement } from '@mona/presentation-core/model'
import type { AlignmentGuide, InteractionBounds, InteractionRect, SnapCandidate } from '@mona/editor-interactions/geometry'

export interface ElementTransformPreview {
  readonly guides: AlignmentGuide[]
  readonly updates: ReadonlyMap<string, Partial<PPTElement>>
}

const rotatePoint = (
  point: { x: number; y: number },
  center: { x: number; y: number },
  degrees: number,
) => {
  const radians = degrees * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const x = point.x - center.x
  const y = point.y - center.y
  return {
    x: center.x + x * cosine - y * sine,
    y: center.y + x * sine + y * cosine,
  }
}

export const getElementBounds = (element: PPTElement): InteractionBounds => {
  if (element.type === 'line') {
    return {
      minX: element.left + Math.min(element.start[0], element.end[0]),
      maxX: element.left + Math.max(element.start[0], element.end[0]),
      minY: element.top + Math.min(element.start[1], element.end[1]),
      maxY: element.top + Math.max(element.start[1], element.end[1]),
    }
  }
  if (!element.rotate) {
    return {
      minX: element.left,
      maxX: element.left + element.width,
      minY: element.top,
      maxY: element.top + element.height,
    }
  }
  const center = { x: element.left + element.width / 2, y: element.top + element.height / 2 }
  const corners = [
    { x: element.left, y: element.top },
    { x: element.left + element.width, y: element.top },
    { x: element.left + element.width, y: element.top + element.height },
    { x: element.left, y: element.top + element.height },
  ].map(point => rotatePoint(point, center, element.rotate))
  return {
    minX: Math.min(...corners.map(point => point.x)),
    maxX: Math.max(...corners.map(point => point.x)),
    minY: Math.min(...corners.map(point => point.y)),
    maxY: Math.max(...corners.map(point => point.y)),
  }
}

export const getElementsBounds = (elements: readonly PPTElement[]): InteractionBounds => {
  const bounds = elements.map(getElementBounds)
  if (!bounds.length) return { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  return {
    minX: Math.min(...bounds.map(item => item.minX)),
    maxX: Math.max(...bounds.map(item => item.maxX)),
    minY: Math.min(...bounds.map(item => item.minY)),
    maxY: Math.max(...bounds.map(item => item.maxY)),
  }
}

export const buildSnapCandidates = (
  elements: readonly PPTElement[],
  excludedIds: ReadonlySet<string>,
  viewportSize: number,
  viewportRatio: number,
): { horizontal: SnapCandidate[]; vertical: SnapCandidate[] } => {
  const horizontal: SnapCandidate[] = [
    { value: 0, range: [0, viewportSize] },
    { value: viewportSize * viewportRatio / 2, range: [0, viewportSize] },
    { value: viewportSize * viewportRatio, range: [0, viewportSize] },
  ]
  const vertical: SnapCandidate[] = [
    { value: 0, range: [0, viewportSize * viewportRatio] },
    { value: viewportSize / 2, range: [0, viewportSize * viewportRatio] },
    { value: viewportSize, range: [0, viewportSize * viewportRatio] },
  ]
  for (const element of elements) {
    if (excludedIds.has(element.id) || element.type === 'line') continue
    const bounds = getElementBounds(element)
    horizontal.push(
      { value: bounds.minY, range: [bounds.minX, bounds.maxX] },
      { value: (bounds.minY + bounds.maxY) / 2, range: [bounds.minX, bounds.maxX] },
      { value: bounds.maxY, range: [bounds.minX, bounds.maxX] },
    )
    vertical.push(
      { value: bounds.minX, range: [bounds.minY, bounds.maxY] },
      { value: (bounds.minX + bounds.maxX) / 2, range: [bounds.minY, bounds.maxY] },
      { value: bounds.maxX, range: [bounds.minY, bounds.maxY] },
    )
  }
  return { horizontal, vertical }
}

export const scaleElementsIntoBounds = (
  elements: readonly PPTElement[],
  origin: InteractionBounds,
  target: InteractionBounds,
): ReadonlyMap<string, Partial<PPTElement>> => {
  const updates = new Map<string, Partial<PPTElement>>()
  const originWidth = Math.max(origin.maxX - origin.minX, 1)
  const originHeight = Math.max(origin.maxY - origin.minY, 1)
  const scaleX = (target.maxX - target.minX) / originWidth
  const scaleY = (target.maxY - target.minY) / originHeight
  for (const element of elements) {
    if (element.type === 'line') {
      updates.set(element.id, {
        left: target.minX + (element.left - origin.minX) * scaleX,
        top: target.minY + (element.top - origin.minY) * scaleY,
        start: [element.start[0] * scaleX, element.start[1] * scaleY],
        end: [element.end[0] * scaleX, element.end[1] * scaleY],
      } as Partial<PPTElement>)
      continue
    }
    updates.set(element.id, {
      left: target.minX + (element.left - origin.minX) * scaleX,
      top: target.minY + (element.top - origin.minY) * scaleY,
      width: Math.max(20, element.width * scaleX),
      height: Math.max(20, element.height * scaleY),
    } as Partial<PPTElement>)
  }
  return updates
}

export const rotateElementsAround = (
  elements: readonly PPTElement[],
  center: { x: number; y: number },
  angleDelta: number,
): ReadonlyMap<string, Partial<PPTElement>> => {
  const updates = new Map<string, Partial<PPTElement>>()
  for (const element of elements) {
    if (element.type === 'line') continue
    const elementCenter = { x: element.left + element.width / 2, y: element.top + element.height / 2 }
    const rotatedCenter = rotatePoint(elementCenter, center, angleDelta)
    updates.set(element.id, {
      left: rotatedCenter.x - element.width / 2,
      top: rotatedCenter.y - element.height / 2,
      rotate: (element.rotate + angleDelta + 360) % 360,
    } as Partial<PPTElement>)
  }
  return updates
}

export const rectFromBounds = (bounds: InteractionBounds): InteractionRect => ({
  left: bounds.minX,
  top: bounds.minY,
  width: bounds.maxX - bounds.minX,
  height: bounds.maxY - bounds.minY,
})
