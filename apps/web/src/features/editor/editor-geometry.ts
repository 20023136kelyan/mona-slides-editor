import { SHAPE_PATH_FORMULAS } from '@mona/presentation-core/shape-path-formulas'
import type {
  PPTElement,
  PPTImageElement,
  PPTLineElement,
  PPTShapeElement,
} from '@mona/presentation-core/model'
import type { AlignmentGuide, InteractionBounds, InteractionRect, ResizeHandle, SnapCandidate } from '@mona/editor-interactions/geometry'

export interface ElementTransformPreview {
  readonly guides: AlignmentGuide[]
  readonly updates: ReadonlyMap<string, Partial<PPTElement>>
}

export type LineControlHandle = 'start' | 'end' | 'control' | 'control-1' | 'control-2'

export interface ElementControlPoint {
  readonly handle: LineControlHandle
  readonly x: number
  readonly y: number
}

export type CropControlHandle = ResizeHandle | 'move'

export interface ImageCropGeometry {
  readonly originLeft: number
  readonly originTop: number
  readonly rawHeight: number
  readonly rawWidth: number
  readonly rect: InteractionRect
}

export type CreateGestureTool = 'text' | 'shape' | 'ellipse' | 'line'

export interface CreateGestureSelection {
  readonly end: { x: number; y: number }
  readonly start: { x: number; y: number }
}

interface CreateGestureModifiers {
  readonly control?: boolean
  readonly meta?: boolean
  readonly shift?: boolean
}

export const constrainCreateGesturePoint = (
  tool: CreateGestureTool,
  start: { x: number; y: number },
  point: { x: number; y: number },
  modifiers: CreateGestureModifiers,
) => {
  if (!(modifiers.control || modifiers.meta || modifiers.shift)) return point
  const moveX = point.x - start.x
  const moveY = point.y - start.y
  const absX = Math.abs(moveX)
  const absY = Math.abs(moveY)
  if (tool === 'shape' || tool === 'ellipse') {
    const isOpposite = (moveY > 0 && moveX < 0) || (moveY < 0 && moveX > 0)
    if (absX > absY) {
      return { x: point.x, y: isOpposite ? start.y - moveX : start.y + moveX }
    }
    return { x: isOpposite ? start.x - moveY : start.x + moveY, y: point.y }
  }
  if (tool === 'line') {
    if (absX > absY) return { x: point.x, y: start.y }
    return { x: start.x, y: point.y }
  }
  return point
}

export const resolveCreateGestureSelection = ({
  lastPointer,
  modifiers,
  rawPointer,
  start,
  tool,
}: {
  lastPointer: { x: number; y: number }
  modifiers: CreateGestureModifiers
  rawPointer: { x: number; y: number }
  start: { x: number; y: number }
  tool: CreateGestureTool
}): CreateGestureSelection => {
  const rawWidth = Math.abs(rawPointer.x - start.x)
  const rawHeight = Math.abs(rawPointer.y - start.y)
  const sufficient = tool === 'line'
    ? rawWidth >= 30 || rawHeight >= 30
    : rawWidth >= 30 && rawHeight >= 30
  if (sufficient) {
    return {
      start,
      end: constrainCreateGesturePoint(tool, start, lastPointer, modifiers),
    }
  }
  const minX = Math.min(rawPointer.x, start.x)
  const minY = Math.min(rawPointer.y, start.y)
  return {
    start: { x: minX, y: minY },
    end: {
      x: minX + (rawWidth >= 30 ? rawWidth : 200),
      y: minY + (rawHeight >= 30 ? rawHeight : 200),
    },
  }
}

const MINIMUM_ELEMENT_SIZE: Readonly<Record<PPTElement['type'], number>> = {
  text: 40,
  image: 20,
  shape: 20,
  line: 20,
  chart: 200,
  table: 30,
  latex: 20,
  video: 250,
  audio: 20,
}

export const getMinimumElementSize = (element: PPTElement) => MINIMUM_ELEMENT_SIZE[element.type]

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

export const normalizeAngle = (angle: number) => {
  let result = angle
  while (result > 180) result -= 360
  while (result < -180) result += 360
  return result
}

const getRotationPoints = (element: PPTElement) => {
  if (element.type === 'line') {
    return [
      { x: element.left + element.start[0], y: element.top + element.start[1] },
      { x: element.left + element.end[0], y: element.top + element.end[1] },
    ]
  }
  const center = { x: element.left + element.width / 2, y: element.top + element.height / 2 }
  return [
    { x: element.left, y: element.top },
    { x: element.left + element.width, y: element.top },
    { x: element.left + element.width, y: element.top + element.height },
    { x: element.left, y: element.top + element.height },
  ].map(point => rotatePoint(point, center, element.rotate))
}

export const getGroupRotationReference = (elements: readonly PPTElement[]): number | null => {
  const rectElements = elements.filter((element): element is Exclude<PPTElement, PPTLineElement> => element.type !== 'line')
  if (!rectElements.length) return null
  const reference = rectElements[0]!.rotate
  return rectElements.every(element => Math.abs(normalizeAngle(element.rotate - reference)) <= 0.1)
    ? reference
    : null
}

export const getGroupRotationCenter = (
  elements: readonly PPTElement[],
  reference = 0,
): { x: number; y: number } => {
  const aligned = elements
    .flatMap(getRotationPoints)
    .map(point => reference ? rotatePoint(point, { x: 0, y: 0 }, -reference) : point)
  if (!aligned.length) return { x: 0, y: 0 }
  const center = {
    x: (Math.min(...aligned.map(point => point.x)) + Math.max(...aligned.map(point => point.x))) / 2,
    y: (Math.min(...aligned.map(point => point.y)) + Math.max(...aligned.map(point => point.y))) / 2,
  }
  return reference ? rotatePoint(center, { x: 0, y: 0 }, reference) : center
}

export const getElementBounds = (element: PPTElement): InteractionBounds => {
  if (element.type === 'line') {
    return {
      minX: element.left,
      maxX: element.left + Math.max(element.start[0], element.end[0]),
      minY: element.top,
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
  // Preserve the established editor's operation order rather than using an equivalent corner
  // rotation. The distinction is one IEEE-754 bit in some snapped positions,
  // which then becomes persisted document state.
  const radius = Math.sqrt(Math.pow(element.width, 2) + Math.pow(element.height, 2)) / 2
  const auxiliaryAngle = Math.atan(element.height / element.width) * 180 / Math.PI
  const tlbraRadian = (180 - element.rotate - auxiliaryAngle) * Math.PI / 180
  const trblaRadian = (auxiliaryAngle - element.rotate) * Math.PI / 180
  const middleLeft = element.left + element.width / 2
  const middleTop = element.top + element.height / 2
  const xAxis = [
    middleLeft + radius * Math.cos(tlbraRadian),
    middleLeft + radius * Math.cos(trblaRadian),
    middleLeft - radius * Math.cos(tlbraRadian),
    middleLeft - radius * Math.cos(trblaRadian),
  ]
  const yAxis = [
    middleTop - radius * Math.sin(tlbraRadian),
    middleTop - radius * Math.sin(trblaRadian),
    middleTop + radius * Math.sin(tlbraRadian),
    middleTop + radius * Math.sin(trblaRadian),
  ]
  return {
    minX: Math.min(...xAxis),
    maxX: Math.max(...xAxis),
    minY: Math.min(...yAxis),
    maxY: Math.max(...yAxis),
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

export type CanvasAlignmentCommand = 'top' | 'bottom' | 'left' | 'right' | 'vertical' | 'horizontal' | 'center'
export type MultiAlignmentCommand = Exclude<CanvasAlignmentCommand, 'center'>
export type UniformDisplayAxis = 'horizontal' | 'vertical'
export type ElementOrderCommand = 'up' | 'down' | 'top' | 'bottom'

const jsonCloneElements = (elements: readonly PPTElement[]): PPTElement[] => (
  JSON.parse(JSON.stringify(elements)) as PPTElement[]
)

// These action helpers intentionally preserve the established editor's implementation details,
// including its JSON clone boundary and its line-range assumptions. They are
// not shared with gesture geometry because changing either contract would turn
// a framework port into an editor-behavior rewrite.
export const getActionElementBounds = (element: PPTElement): InteractionBounds => {
  if (element.type === 'line') {
    return {
      minX: element.left,
      maxX: element.left + Math.max(element.start[0], element.end[0]),
      minY: element.top,
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
  const radius = Math.sqrt(Math.pow(element.width, 2) + Math.pow(element.height, 2)) / 2
  const auxiliaryAngle = Math.atan(element.height / element.width) * 180 / Math.PI
  const topLeftBottomRightRadian = (180 - element.rotate - auxiliaryAngle) * Math.PI / 180
  const topRightBottomLeftRadian = (auxiliaryAngle - element.rotate) * Math.PI / 180
  const middleLeft = element.left + element.width / 2
  const middleTop = element.top + element.height / 2
  const xAxis = [
    middleLeft + radius * Math.cos(topLeftBottomRightRadian),
    middleLeft + radius * Math.cos(topRightBottomLeftRadian),
    middleLeft - radius * Math.cos(topLeftBottomRightRadian),
    middleLeft - radius * Math.cos(topRightBottomLeftRadian),
  ]
  const yAxis = [
    middleTop - radius * Math.sin(topLeftBottomRightRadian),
    middleTop - radius * Math.sin(topRightBottomLeftRadian),
    middleTop + radius * Math.sin(topLeftBottomRightRadian),
    middleTop + radius * Math.sin(topRightBottomLeftRadian),
  ]
  return {
    minX: Math.min(...xAxis),
    maxX: Math.max(...xAxis),
    minY: Math.min(...yAxis),
    maxY: Math.max(...yAxis),
  }
}

const getRectBoundsAtRotation = (
  element: Exclude<PPTElement, PPTLineElement>,
  rotate: number,
): InteractionBounds => {
  const radius = Math.sqrt(Math.pow(element.width, 2) + Math.pow(element.height, 2)) / 2
  const auxiliaryAngle = Math.atan(element.height / element.width) * 180 / Math.PI
  const topLeftBottomRightRadian = (180 - rotate - auxiliaryAngle) * Math.PI / 180
  const topRightBottomLeftRadian = (auxiliaryAngle - rotate) * Math.PI / 180
  const middleLeft = element.left + element.width / 2
  const middleTop = element.top + element.height / 2
  const xAxis = [
    middleLeft + radius * Math.cos(topLeftBottomRightRadian),
    middleLeft + radius * Math.cos(topRightBottomLeftRadian),
    middleLeft - radius * Math.cos(topLeftBottomRightRadian),
    middleLeft - radius * Math.cos(topRightBottomLeftRadian),
  ]
  const yAxis = [
    middleTop - radius * Math.sin(topLeftBottomRightRadian),
    middleTop - radius * Math.sin(topRightBottomLeftRadian),
    middleTop + radius * Math.sin(topLeftBottomRightRadian),
    middleTop + radius * Math.sin(topRightBottomLeftRadian),
  ]
  return {
    minX: Math.min(...xAxis),
    maxX: Math.max(...xAxis),
    minY: Math.min(...yAxis),
    maxY: Math.max(...yAxis),
  }
}

const getRectRotatedOffset = (element: Exclude<PPTElement, PPTLineElement>) => {
  const origin = getRectBoundsAtRotation(element, 0)
  const rotated = getRectBoundsAtRotation(element, element.rotate)
  return {
    offsetX: rotated.minX - origin.minX,
    offsetY: rotated.minY - origin.minY,
  }
}

export const alignElementsToCanvas = (input: {
  readonly command: CanvasAlignmentCommand
  readonly elements: readonly PPTElement[]
  readonly selectedIds: ReadonlySet<string>
  readonly viewportHeight: number
  readonly viewportWidth: number
}): PPTElement[] => {
  const selected = input.elements.filter(element => input.selectedIds.has(element.id))
  if (!selected.length) return jsonCloneElements(input.elements)
  const ranges = selected.map(getActionElementBounds)
  const minX = Math.min(...ranges.map(range => range.minX))
  const maxX = Math.max(...ranges.map(range => range.maxX))
  const minY = Math.min(...ranges.map(range => range.minY))
  const maxY = Math.max(...ranges.map(range => range.maxY))
  const elements = jsonCloneElements(input.elements)

  for (const element of elements) {
    if (!input.selectedIds.has(element.id)) continue
    if (input.command === 'center') {
      const offsetY = minY + (maxY - minY) / 2 - input.viewportHeight / 2
      const offsetX = minX + (maxX - minX) / 2 - input.viewportWidth / 2
      element.top -= offsetY
      element.left -= offsetX
    }
    if (input.command === 'top') element.top -= minY
    else if (input.command === 'vertical') element.top -= minY + (maxY - minY) / 2 - input.viewportHeight / 2
    else if (input.command === 'bottom') element.top -= maxY - input.viewportHeight
    else if (input.command === 'left') element.left -= minX
    else if (input.command === 'horizontal') element.left -= minX + (maxX - minX) / 2 - input.viewportWidth / 2
    else if (input.command === 'right') element.left -= maxX - input.viewportWidth
  }
  return elements
}

/**
 * Aligns multiple selected items to one another using the established editor's exact action
 * semantics. A selected group is one item: every member is translated by the
 * same delta derived from the group's combined rotated range.
 */
export const alignActiveElements = (input: {
  readonly command: MultiAlignmentCommand
  readonly elements: readonly PPTElement[]
  readonly selectedIds: ReadonlySet<string>
}): PPTElement[] => {
  const activeElements = input.elements.filter(element => input.selectedIds.has(element.id))
  if (!activeElements.length) return jsonCloneElements(input.elements)
  const activeRange = getElementsBounds(activeElements.map(element => (
    // getElementsBounds deliberately shares the same the source editor range operation as
    // the action helpers, but clone here to preserve the source hook boundary.
    JSON.parse(JSON.stringify(element)) as PPTElement
  )))
  const elements = jsonCloneElements(input.elements)
  const groupRangeMap = new Map<string, InteractionBounds>()
  for (const activeElement of activeElements) {
    if (!activeElement.groupId || groupRangeMap.has(activeElement.groupId)) continue
    groupRangeMap.set(
      activeElement.groupId,
      getElementsBounds(activeElements.filter(element => element.groupId === activeElement.groupId)),
    )
  }

  for (const element of elements) {
    if (!input.selectedIds.has(element.id)) continue
    const groupRange = element.groupId ? groupRangeMap.get(element.groupId) : undefined
    if (input.command === 'left') {
      if (groupRange) element.left -= groupRange.minX - activeRange.minX
      else if (element.type !== 'line' && element.rotate) {
        const { offsetX } = getRectRotatedOffset(element)
        element.left = activeRange.minX - offsetX
      }
      else element.left = activeRange.minX
    }
    else if (input.command === 'right') {
      if (groupRange) element.left -= groupRange.maxX - activeRange.maxX
      else {
        const elementWidth = element.type === 'line'
          ? Math.max(element.start[0], element.end[0])
          : element.width
        if (element.type !== 'line' && element.rotate) {
          const { offsetX } = getRectRotatedOffset(element)
          element.left = activeRange.maxX - elementWidth + offsetX
        }
        else element.left = activeRange.maxX - elementWidth
      }
    }
    else if (input.command === 'top') {
      if (groupRange) element.top -= groupRange.minY - activeRange.minY
      else if (element.type !== 'line' && element.rotate) {
        const { offsetY } = getRectRotatedOffset(element)
        element.top = activeRange.minY - offsetY
      }
      else element.top = activeRange.minY
    }
    else if (input.command === 'bottom') {
      if (groupRange) element.top -= groupRange.maxY - activeRange.maxY
      else {
        const elementHeight = element.type === 'line'
          ? Math.max(element.start[1], element.end[1])
          : element.height
        if (element.type !== 'line' && element.rotate) {
          const { offsetY } = getRectRotatedOffset(element)
          element.top = activeRange.maxY - elementHeight + offsetY
        }
        else element.top = activeRange.maxY - elementHeight
      }
    }
    else if (input.command === 'horizontal') {
      const horizontalCenter = (activeRange.minX + activeRange.maxX) / 2
      if (groupRange) {
        const center = (groupRange.maxX + groupRange.minX) / 2
        element.left -= center - horizontalCenter
      }
      else {
        const elementWidth = element.type === 'line'
          ? Math.max(element.start[0], element.end[0])
          : element.width
        element.left = horizontalCenter - elementWidth / 2
      }
    }
    else {
      const verticalCenter = (activeRange.minY + activeRange.maxY) / 2
      if (groupRange) {
        const center = (groupRange.maxY + groupRange.minY) / 2
        element.top -= center - verticalCenter
      }
      else {
        const elementHeight = element.type === 'line'
          ? Math.max(element.start[1], element.end[1])
          : element.height
        element.top = verticalCenter - elementHeight / 2
      }
    }
  }
  return elements
}

interface UniformDisplayItem {
  readonly elements: PPTElement[]
  readonly grouped: boolean
  readonly max: number
  readonly min: number
}

/**
 * Ports useUniformDisplayElement without normalising its arithmetic. In
 * particular, rotated elements are positioned by their range minimum and a
 * selected group retains every member's offset within the group range.
 */
export const distributeElements = (input: {
  readonly axis: UniformDisplayAxis
  readonly elements: readonly PPTElement[]
  readonly selectedIds: ReadonlySet<string>
}): PPTElement[] => {
  const activeElements = jsonCloneElements(
    input.elements.filter(element => input.selectedIds.has(element.id)),
  )
  const elements = jsonCloneElements(input.elements)
  if (!activeElements.length) return elements
  const activeRange = getElementsBounds(activeElements)
  const singles: UniformDisplayItem[] = []
  const groups: Array<{ elements: PPTElement[]; groupId: string }> = []

  for (const element of activeElements) {
    if (!element.groupId) {
      const range = getActionElementBounds(element)
      singles.push({
        elements: [element],
        grouped: false,
        min: input.axis === 'horizontal' ? range.minX : range.minY,
        max: input.axis === 'horizontal' ? range.maxX : range.maxY,
      })
      continue
    }
    const group = groups.find(item => item.groupId === element.groupId)
    if (!group) groups.push({ groupId: element.groupId, elements: [element] })
    else group.elements = [...group.elements, element]
  }

  const items: UniformDisplayItem[] = [
    ...singles,
    ...groups.map(group => {
      const range = getElementsBounds(group.elements)
      return {
        elements: group.elements,
        grouped: true,
        min: input.axis === 'horizontal' ? range.minX : range.minY,
        max: input.axis === 'horizontal' ? range.maxX : range.maxY,
      }
    }),
  ]
  items.sort((left, right) => left.min - right.min)
  if (items.length < 2) return elements

  const minimum = input.axis === 'horizontal' ? activeRange.minX : activeRange.minY
  const maximum = input.axis === 'horizontal' ? activeRange.maxX : activeRange.maxY
  const totalSize = items.reduce((sum, item) => sum + (item.max - item.min), 0)
  const span = ((maximum - minimum) - totalSize) / (items.length - 1)
  const targetPositions = new Map<string, number>()

  const first = items[0]!
  let lastPosition = { min: first.min, max: first.max }
  if (!first.grouped) targetPositions.set(first.elements[0]!.id, first.min)
  else {
    for (const element of first.elements) {
      const range = getActionElementBounds(element)
      targetPositions.set(element.id, input.axis === 'horizontal' ? range.minX : range.minY)
    }
  }

  for (let index = 1; index < items.length; index += 1) {
    const item = items[index]!
    const lastSize = lastPosition.max - lastPosition.min
    const currentPosition = lastPosition.min + lastSize + span
    const currentSize = item.max - item.min
    lastPosition = { min: currentPosition, max: currentPosition + currentSize }
    if (!item.grouped) targetPositions.set(item.elements[0]!.id, currentPosition)
    else {
      for (const element of item.elements) {
        const range = getActionElementBounds(element)
        const elementMinimum = input.axis === 'horizontal' ? range.minX : range.minY
        const offset = elementMinimum - item.min
        targetPositions.set(element.id, currentPosition + offset)
      }
    }
  }

  for (const element of elements) {
    if (!input.selectedIds.has(element.id)) continue
    const target = targetPositions.get(element.id)
    if (target === undefined) continue
    if (input.axis === 'horizontal') {
      if (element.type !== 'line' && element.rotate) {
        const { offsetX } = getRectRotatedOffset(element)
        element.left = target - offsetX
      }
      else element.left = target
    }
    else if (element.type !== 'line' && element.rotate) {
      const { offsetY } = getRectRotatedOffset(element)
      element.top = target - offsetY
    }
    else element.top = target
  }
  return elements
}

export const getMultiSelectionState = (
  elements: readonly PPTElement[],
  selectedIds: ReadonlySet<string>,
) => {
  const activeElements = elements.filter(element => selectedIds.has(element.id))
  const firstGroupId = activeElements[0]?.groupId
  const canCombine = activeElements.length >= 2 && (
    !firstGroupId || !activeElements.every(element => element.groupId === firstGroupId)
  )
  const displayItems = new Set<string>()
  for (const element of activeElements) {
    displayItems.add(element.groupId ? `group:${element.groupId}` : `element:${element.id}`)
  }
  return { canCombine, displayItemCount: displayItems.size }
}

const getGroupLevelRange = (elements: readonly PPTElement[], group: readonly PPTElement[]) => ({
  minLevel: elements.findIndex(element => element.id === group[0]!.id),
  maxLevel: elements.findIndex(element => element.id === group[group.length - 1]!.id),
})

export const orderElement = (
  sourceElements: readonly PPTElement[],
  elementId: string,
  command: ElementOrderCommand,
): PPTElement[] | undefined => {
  const sourceElement = sourceElements.find(element => element.id === elementId)
  if (!sourceElement) return undefined
  const elements = jsonCloneElements(sourceElements)
  const element = elements.find(item => item.id === elementId)!

  if (command === 'up') {
    if (element.groupId) {
      const group = elements.filter(item => item.groupId === element.groupId)
      const { minLevel, maxLevel } = getGroupLevelRange(sourceElements, group)
      if (maxLevel === sourceElements.length - 1) return undefined
      const nextElement = elements[maxLevel + 1]!
      const moved = elements.splice(minLevel, group.length)
      if (nextElement.groupId) {
        const nextGroup = elements.filter(item => item.groupId === nextElement.groupId)
        elements.splice(minLevel + nextGroup.length, 0, ...moved)
      }
      else elements.splice(minLevel + 1, 0, ...moved)
    }
    else {
      const level = sourceElements.findIndex(item => item.id === element.id)
      if (level === sourceElements.length - 1) return undefined
      const nextElement = elements[level + 1]!
      const moved = elements.splice(level, 1)[0]!
      if (nextElement.groupId) {
        const nextGroup = elements.filter(item => item.groupId === nextElement.groupId)
        elements.splice(level + nextGroup.length, 0, moved)
      }
      else elements.splice(level + 1, 0, moved)
    }
    return elements
  }

  if (command === 'down') {
    if (element.groupId) {
      const group = elements.filter(item => item.groupId === element.groupId)
      const { minLevel } = getGroupLevelRange(sourceElements, group)
      if (minLevel === 0) return undefined
      const previousElement = elements[minLevel - 1]!
      const moved = elements.splice(minLevel, group.length)
      if (previousElement.groupId) {
        const previousGroup = elements.filter(item => item.groupId === previousElement.groupId)
        elements.splice(minLevel - previousGroup.length, 0, ...moved)
      }
      else elements.splice(minLevel - 1, 0, ...moved)
    }
    else {
      const level = sourceElements.findIndex(item => item.id === element.id)
      if (level === 0) return undefined
      const previousElement = elements[level - 1]!
      const moved = elements.splice(level, 1)[0]!
      if (previousElement.groupId) {
        const previousGroup = elements.filter(item => item.groupId === previousElement.groupId)
        elements.splice(level - previousGroup.length, 0, moved)
      }
      else elements.splice(level - 1, 0, moved)
    }
    return elements
  }

  if (command === 'top') {
    if (element.groupId) {
      const group = elements.filter(item => item.groupId === element.groupId)
      const { minLevel, maxLevel } = getGroupLevelRange(sourceElements, group)
      if (maxLevel === sourceElements.length - 1) return undefined
      elements.push(...elements.splice(minLevel, group.length))
    }
    else {
      const level = sourceElements.findIndex(item => item.id === element.id)
      if (level === sourceElements.length - 1) return undefined
      elements.splice(level, 1)
      elements.push(element)
    }
    return elements
  }

  if (element.groupId) {
    const group = elements.filter(item => item.groupId === element.groupId)
    const { minLevel } = getGroupLevelRange(sourceElements, group)
    if (minLevel === 0) return undefined
    elements.unshift(...elements.splice(minLevel, group.length))
  }
  else {
    const level = sourceElements.findIndex(item => item.id === element.id)
    if (level === 0) return undefined
    elements.splice(level, 1)
    elements.unshift(element)
  }
  return elements
}

export const groupElements = (
  sourceElements: readonly PPTElement[],
  selectedIds: ReadonlySet<string>,
  groupId: string,
): PPTElement[] => {
  let elements = jsonCloneElements(sourceElements)
  const group: PPTElement[] = []
  for (const element of elements) {
    if (!selectedIds.has(element.id)) continue
    element.groupId = groupId
    group.push(element)
  }
  if (!group.length) return elements
  const maximumLevel = elements.findIndex(element => element.id === group[group.length - 1]!.id)
  const ids = new Set(group.map(element => element.id))
  elements = elements.filter(element => !ids.has(element.id))
  elements.splice(maximumLevel - group.length + 1, 0, ...group)
  return elements
}

export const ungroupElements = (
  sourceElements: readonly PPTElement[],
  selectedIds: ReadonlySet<string>,
): PPTElement[] | undefined => {
  if (!sourceElements.some(element => selectedIds.has(element.id) && element.groupId)) return undefined
  const elements = jsonCloneElements(sourceElements)
  for (const element of elements) {
    if (selectedIds.has(element.id) && element.groupId) delete element.groupId
  }
  return elements
}

export const setElementLocks = (input: {
  readonly elements: readonly PPTElement[]
  readonly lock: boolean
  readonly selectedIds?: ReadonlySet<string>
  readonly targetElementId?: string
}): { elements: PPTElement[]; selectedIds: string[] } | undefined => {
  const elements = jsonCloneElements(input.elements)
  if (input.lock) {
    const selectedIds = input.selectedIds ?? new Set<string>()
    for (const element of elements) {
      if (selectedIds.has(element.id)) element.lock = true
    }
    return { elements, selectedIds: [] }
  }
  const target = elements.find(element => element.id === input.targetElementId)
  if (!target) return undefined
  if (target.groupId) {
    const selectedIds: string[] = []
    for (const element of elements) {
      if (element.groupId !== target.groupId) continue
      element.lock = false
      selectedIds.push(element.id)
    }
    return { elements, selectedIds }
  }
  target.lock = false
  return { elements, selectedIds: [target.id] }
}

export const getLassoSelectionIds = (input: {
  readonly elements: readonly PPTElement[]
  readonly hiddenElementIds: ReadonlySet<string>
  readonly intersecting: boolean
  readonly selection: InteractionBounds
}): string[] => {
  const candidates = input.elements.filter(element => {
    if (element.lock || input.hiddenElementIds.has(element.id)) return false
    const bounds = getElementBounds(element)
    return input.intersecting
      ? input.selection.maxX > bounds.minX && input.selection.minX < bounds.maxX &&
        input.selection.maxY > bounds.minY && input.selection.minY < bounds.maxY
      : bounds.minX > input.selection.minX && bounds.maxX < input.selection.maxX &&
        bounds.minY > input.selection.minY && bounds.maxY < input.selection.maxY
  })
  const candidateIds = new Set(candidates.map(element => element.id))
  return candidates.filter(element => {
    if (!element.groupId) return true
    return input.elements
      .filter(item => item.groupId === element.groupId)
      .every(item => candidateIds.has(item.id))
  }).map(element => element.id)
}

export const getTransformBounds = (elements: readonly PPTElement[]): InteractionBounds => {
  if (elements.length !== 1) return getElementsBounds(elements)
  const element = elements[0]
  if (!element || element.type === 'line') return getElementsBounds(elements)
  const outlineWidth = element.type === 'table' ? element.outline.width || 1 : 0
  return {
    minX: element.left,
    maxX: element.left + element.width + outlineWidth,
    minY: element.top,
    maxY: element.top + element.height,
  }
}

export const buildSnapCandidates = (
  elements: readonly PPTElement[],
  excludedIds: ReadonlySet<string>,
  viewportSize: number,
  viewportRatio: number,
): { horizontal: SnapCandidate[]; vertical: SnapCandidate[] } => {
  const horizontal: SnapCandidate[] = []
  const vertical: SnapCandidate[] = []
  for (const element of elements) {
    if (excludedIds.has(element.id) || element.type === 'line') continue
    const bounds = getElementBounds(element)
    horizontal.push(
      { value: bounds.minY, range: [bounds.minX, bounds.maxX] },
      { value: bounds.maxY, range: [bounds.minX, bounds.maxX] },
      { value: (bounds.minY + bounds.maxY) / 2, range: [bounds.minX, bounds.maxX] },
    )
    vertical.push(
      { value: bounds.minX, range: [bounds.minY, bounds.maxY] },
      { value: bounds.maxX, range: [bounds.minY, bounds.maxY] },
      { value: (bounds.minX + bounds.maxX) / 2, range: [bounds.minY, bounds.maxY] },
    )
  }
  horizontal.push(
    { value: 0, range: [0, viewportSize] },
    { value: viewportSize * viewportRatio, range: [0, viewportSize] },
    { value: viewportSize * viewportRatio / 2, range: [0, viewportSize] },
  )
  vertical.push(
    { value: 0, range: [0, viewportSize * viewportRatio] },
    { value: viewportSize, range: [0, viewportSize * viewportRatio] },
    { value: viewportSize / 2, range: [0, viewportSize * viewportRatio] },
  )
  const merge = (candidates: SnapCandidate[]) => {
    const deduped: SnapCandidate[] = []
    for (const candidate of candidates) {
      const index = deduped.findIndex(item => item.value === candidate.value)
      if (index === -1) deduped.push(candidate)
      else {
        const previous = deduped[index]!
        deduped[index] = {
          value: candidate.value,
          range: [
            Math.min(previous.range[0], candidate.range[0]),
            Math.max(previous.range[1], candidate.range[1]),
          ],
        }
      }
    }
    return deduped
  }
  return { horizontal: merge(horizontal), vertical: merge(vertical) }
}

/**
 * Resize snapping intentionally has a narrower candidate set than dragging:
 * the Vue editor uses other elements' outer edges (not their centers), then
 * the slide edges and centers, in that order. Rotated elements and lines do
 * not participate.
 */
export const buildResizeSnapCandidates = (
  elements: readonly PPTElement[],
  excludedIds: ReadonlySet<string>,
  viewportSize: number,
  viewportRatio: number,
): { horizontal: SnapCandidate[]; vertical: SnapCandidate[] } => {
  const horizontal: SnapCandidate[] = []
  const vertical: SnapCandidate[] = []
  for (const element of elements) {
    if (excludedIds.has(element.id) || element.type === 'line' || element.rotate) continue
    horizontal.push(
      { value: element.top, range: [element.left, element.left + element.width] },
      { value: element.top + element.height, range: [element.left, element.left + element.width] },
    )
    vertical.push(
      { value: element.left, range: [element.top, element.top + element.height] },
      { value: element.left + element.width, range: [element.top, element.top + element.height] },
    )
  }
  const height = viewportSize * viewportRatio
  horizontal.push(
    { value: 0, range: [0, viewportSize] },
    { value: height, range: [0, viewportSize] },
    { value: height / 2, range: [0, viewportSize] },
  )
  vertical.push(
    { value: 0, range: [0, height] },
    { value: viewportSize, range: [0, height] },
    { value: viewportSize / 2, range: [0, height] },
  )
  const merge = (candidates: SnapCandidate[]) => {
    const result: SnapCandidate[] = []
    for (const candidate of candidates) {
      const existingIndex = result.findIndex(item => item.value === candidate.value)
      if (existingIndex === -1) result.push(candidate)
      else {
        const existing = result[existingIndex]!
        result[existingIndex] = {
          value: candidate.value,
          range: [
            Math.min(existing.range[0], candidate.range[0]),
            Math.max(existing.range[1], candidate.range[1]),
          ],
        }
      }
    }
    return result
  }
  return { horizontal: merge(horizontal), vertical: merge(vertical) }
}

export const snapResizePoint = (input: {
  readonly horizontalCandidates: readonly SnapCandidate[]
  readonly point: { readonly x: number | null; readonly y: number | null }
  readonly threshold?: number
  readonly verticalCandidates: readonly SnapCandidate[]
}): { correction: { x: number; y: number }; guides: AlignmentGuide[] } => {
  const threshold = input.threshold ?? 5
  let horizontal: SnapCandidate | undefined
  let vertical: SnapCandidate | undefined
  if (input.point.y !== null) {
    horizontal = input.horizontalCandidates.find(candidate => (
      Math.abs(input.point.y! - candidate.value) < threshold
    ))
  }
  if (input.point.x !== null) {
    vertical = input.verticalCandidates.find(candidate => (
      Math.abs(input.point.x! - candidate.value) < threshold
    ))
  }
  const correction = {
    x: vertical && input.point.x !== null ? vertical.value - input.point.x : 0,
    y: horizontal && input.point.y !== null ? horizontal.value - input.point.y : 0,
  }
  const guides: AlignmentGuide[] = []
  if (horizontal) {
    guides.push({
      orientation: 'horizontal',
      axis: horizontal.value,
      from: Math.min(horizontal.range[0], input.point.x ?? 0) - 50,
      to: Math.max(horizontal.range[1], input.point.x ?? 0) + 50,
    })
  }
  if (vertical) {
    guides.push({
      orientation: 'vertical',
      axis: vertical.value,
      from: Math.min(vertical.range[0], input.point.y ?? 0) - 50,
      to: Math.max(vertical.range[1], input.point.y ?? 0) + 50,
    })
  }
  return { correction, guides }
}

export const getImageCropGeometry = (element: PPTImageElement): ImageCropGeometry => {
  const [start, end] = element.clip?.range ?? [[0, 0], [100, 100]]
  const widthScale = Math.max((end[0] - start[0]) / 100, 0.0001)
  const heightScale = Math.max((end[1] - start[1]) / 100, 0.0001)
  const originLeft = start[0] / widthScale
  const originTop = start[1] / heightScale
  return {
    originLeft,
    originTop,
    rawWidth: 100 / widthScale,
    rawHeight: 100 / heightScale,
    rect: { left: originLeft, top: originTop, width: 100, height: 100 },
  }
}

export const updateImageCropGeometry = (input: {
  readonly delta: { x: number; y: number }
  readonly element: PPTImageElement
  readonly geometry: ImageCropGeometry
  readonly handle: CropControlHandle
  readonly lockAspectRatio: boolean
}): ImageCropGeometry => {
  const { element, geometry, handle } = input
  // Keep the established editor's polar-coordinate arithmetic order literally. The matrix
  // identity is mathematically equivalent, but produces observably different
  // IEEE-754 tails in committed crop geometry.
  const moveLength = Math.sqrt(input.delta.x * input.delta.x + input.delta.y * input.delta.y)
  const moveAngle = Math.atan2(input.delta.y, input.delta.x)
  const rotatedAngle = moveAngle - (element.rotate / 180) * Math.PI
  const moveX = ((moveLength * Math.cos(rotatedAngle)) / Math.max(element.width, 1)) * 100
  let moveY = ((moveLength * Math.sin(rotatedAngle)) / Math.max(element.height, 1)) * 100
  const origin = geometry.rect
  if (handle === 'move') {
    return {
      ...geometry,
      rect: {
        ...origin,
        left: Math.min(geometry.rawWidth - origin.width, Math.max(0, origin.left + moveX)),
        top: Math.min(geometry.rawHeight - origin.height, Math.max(0, origin.top + moveY)),
      },
    }
  }

  const aspectRatio = origin.width / Math.max(origin.height, 0.0001)
  if (input.lockAspectRatio && handle.includes('-')) {
    if (handle === 'bottom-right' || handle === 'top-left') moveY = moveX / aspectRatio
    else moveY = -moveX / aspectRatio
  }
  const minimumWidth = 50 / Math.max(element.width, 1) * 100
  const minimumHeight = 50 / Math.max(element.height, 1) * 100
  let left = origin.left
  let top = origin.top
  let right = origin.left + origin.width
  let bottom = origin.top + origin.height
  if (handle.includes('left')) left = Math.min(right - minimumWidth, Math.max(0, left + moveX))
  if (handle.includes('right')) right = Math.min(geometry.rawWidth, Math.max(left + minimumWidth, right + moveX))
  if (handle.startsWith('top')) top = Math.min(bottom - minimumHeight, Math.max(0, top + moveY))
  if (handle.startsWith('bottom')) bottom = Math.min(geometry.rawHeight, Math.max(top + minimumHeight, bottom + moveY))
  return { ...geometry, rect: { left, top, width: right - left, height: bottom - top } }
}

export const commitImageCropGeometry = (
  element: PPTImageElement,
  geometry: ImageCropGeometry,
): Partial<PPTImageElement> => {
  const { rect } = geometry
  const imageLeft = -rect.left * (100 / rect.width)
  const imageTop = -rect.top * (100 / rect.height)
  const imageWidth = geometry.rawWidth / rect.width * 100
  const imageHeight = geometry.rawHeight / rect.height * 100
  // the source editor derives the range from percentage style strings with parseInt.
  // Math.trunc reproduces that intentional integer quantization.
  const rendered = {
    left: Math.trunc(imageLeft),
    top: Math.trunc(imageTop),
    width: Math.trunc(imageWidth),
    height: Math.trunc(imageHeight),
  }
  const widthScale = 100 / rendered.width
  const heightScale = 100 / rendered.height
  const start: [number, number] = [-rendered.left * widthScale, -rendered.top * heightScale]
  const end: [number, number] = [widthScale * 100 + start[0], heightScale * 100 + start[1]]
  const left = element.left + (rect.left - geometry.originLeft) / 100 * element.width
  const top = element.top + (rect.top - geometry.originTop) / 100 * element.height
  const width = element.width + (rect.width - 100) / 100 * element.width
  const height = element.height + (rect.height - 100) / 100 * element.height
  let centerOffsetX = 0
  let centerOffsetY = 0
  if (element.rotate) {
    const centerX = left + width / 2 - (element.left + element.width / 2)
    const centerY = -(top + height / 2 - (element.top + element.height / 2))
    const radians = -element.rotate * Math.PI / 180
    const rotatedCenterX = centerX * Math.cos(radians) - centerY * Math.sin(radians)
    const rotatedCenterY = centerX * Math.sin(radians) + centerY * Math.cos(radians)
    centerOffsetX = rotatedCenterX - centerX
    centerOffsetY = -(rotatedCenterY - centerY)
  }
  return {
    clip: { ...(element.clip ?? { shape: 'rect' }), range: [start, end] },
    left: left + centerOffsetX,
    top: top + centerOffsetY,
    width,
    height,
  }
}

export const isSingleGroupSelection = (elements: readonly PPTElement[]) => {
  if (elements.length < 2) return false
  const groupId = elements[0]?.groupId
  return !!groupId && elements.every(element => element.groupId === groupId)
}

export const canRotateSelection = (elements: readonly PPTElement[]) => {
  if (!elements.length || elements.some(element => element.lock)) return false
  if (elements.length === 1) return !['line', 'chart', 'video', 'audio'].includes(elements[0]!.type)
  if (!isSingleGroupSelection(elements)) return false
  return elements.every(element => {
    if (!['text', 'image', 'shape', 'line'].includes(element.type)) return false
    return element.type !== 'line' || !(element.broken || element.broken2 || element.curve || element.cubic)
  })
}

export const canResizeSelection = (elements: readonly PPTElement[]) => {
  if (!elements.length || elements.some(element => element.lock)) return false
  if (elements.length === 1) return elements[0]!.type !== 'line'
  return elements.every(element => (
    (element.type === 'image' || element.type === 'shape') && !element.rotate
  ))
}

export const getLineControlPoints = (element: PPTLineElement): ElementControlPoint[] => {
  const points: ElementControlPoint[] = [
    { handle: 'start', x: element.left + element.start[0], y: element.top + element.start[1] },
    { handle: 'end', x: element.left + element.end[0], y: element.top + element.end[1] },
  ]
  const control = element.curve || element.broken || element.broken2
  if (control) points.push({ handle: 'control', x: element.left + control[0], y: element.top + control[1] })
  else if (element.cubic) {
    points.push(
      { handle: 'control-1', x: element.left + element.cubic[0][0], y: element.top + element.cubic[0][1] },
      { handle: 'control-2', x: element.left + element.cubic[1][0], y: element.top + element.cubic[1][1] },
    )
  }
  return points
}

const getBroken2Direction = (element: PPTLineElement) => {
  if (element.broken2Direction) return element.broken2Direction
  const bounds = getElementBounds(element)
  return bounds.maxX - bounds.minX >= bounds.maxY - bounds.minY ? 'horizontal' : 'vertical'
}

const getLineAdsorptionPoints = (
  elements: readonly PPTElement[],
  viewportSize: number,
  viewportRatio: number,
) => {
  const height = viewportSize * viewportRatio
  const points = [
    { x: 0, y: 0 }, { x: viewportSize / 2, y: 0 }, { x: viewportSize, y: 0 },
    { x: 0, y: height / 2 }, { x: viewportSize, y: height / 2 },
    { x: 0, y: height }, { x: viewportSize / 2, y: height }, { x: viewportSize, y: height },
  ]
  for (const element of elements) {
    if (element.type === 'line' || element.rotate) continue
    const left = element.left
    const top = element.top
    const right = left + element.width
    const bottom = top + element.height
    const centerX = left + element.width / 2
    const centerY = top + element.height / 2
    points.push(
      { x: centerX, y: top }, { x: centerX, y: bottom },
      { x: left, y: centerY }, { x: right, y: centerY },
      { x: left, y: top }, { x: right, y: top },
      { x: left, y: bottom }, { x: right, y: bottom },
    )
  }
  return points
}

export const moveLineControlPoint = (input: {
  readonly delta: { x: number; y: number }
  readonly element: PPTLineElement
  readonly elements: readonly PPTElement[]
  readonly handle: LineControlHandle
  readonly preserveControlPoints: boolean
  readonly viewportRatio: number
  readonly viewportSize: number
}): Partial<PPTLineElement> => {
  const { delta, element, handle, preserveControlPoints, viewportRatio, viewportSize } = input
  let startX = element.left + element.start[0]
  let startY = element.top + element.start[1]
  let endX = element.left + element.end[0]
  let endY = element.top + element.end[1]
  const middle = element.broken || element.broken2 || element.curve || [0, 0]
  let middleX = element.left + middle[0]
  let middleY = element.top + middle[1]
  const cubic = element.cubic || [[0, 0], [0, 0]]
  let c1X = element.left + cubic[0][0]
  let c1Y = element.top + cubic[0][1]
  let c2X = element.left + cubic[1][0]
  let c2Y = element.top + cubic[1][1]
  const threshold = 8

  const snapEndpoint = (point: { x: number; y: number }, other: { x: number; y: number }) => {
    let next = { ...point }
    if (Math.abs(next.x - other.x) < threshold) next.x = other.x
    if (Math.abs(next.y - other.y) < threshold) next.y = other.y
    for (const candidate of getLineAdsorptionPoints(input.elements, viewportSize, viewportRatio)) {
      if (Math.abs(candidate.x - next.x) < threshold && Math.abs(candidate.y - next.y) < threshold) {
        next = candidate
        break
      }
    }
    return next
  }

  if (handle === 'start') {
    const point = snapEndpoint({ x: startX + delta.x, y: startY + delta.y }, { x: endX, y: endY })
    startX = point.x; startY = point.y
  }
  else if (handle === 'end') {
    const point = snapEndpoint({ x: endX + delta.x, y: endY + delta.y }, { x: startX, y: startY })
    endX = point.x; endY = point.y
  }
  else if (handle === 'control') {
    middleX += delta.x; middleY += delta.y
    if (Math.abs(middleX - startX) < threshold) middleX = startX
    if (Math.abs(middleY - startY) < threshold) middleY = startY
    if (Math.abs(middleX - endX) < threshold) middleX = endX
    if (Math.abs(middleY - endY) < threshold) middleY = endY
    if (Math.abs(middleX - (startX + endX) / 2) < threshold && Math.abs(middleY - (startY + endY) / 2) < threshold) {
      middleX = (startX + endX) / 2; middleY = (startY + endY) / 2
    }
  }
  else if (handle === 'control-1') {
    c1X += delta.x; c1Y += delta.y
    if (Math.abs(c1X - startX) < threshold) c1X = startX
    if (Math.abs(c1Y - startY) < threshold) c1Y = startY
    if (Math.abs(c1X - endX) < threshold) c1X = endX
    if (Math.abs(c1Y - endY) < threshold) c1Y = endY
  }
  else {
    c2X += delta.x; c2Y += delta.y
    if (Math.abs(c2X - startX) < threshold) c2X = startX
    if (Math.abs(c2Y - startY) < threshold) c2Y = startY
    if (Math.abs(c2X - endX) < threshold) c2X = endX
    if (Math.abs(c2Y - endY) < threshold) c2Y = endY
  }

  const minX = Math.min(startX, endX)
  const minY = Math.min(startY, endY)
  const start: [number, number] = [startX - minX, startY - minY]
  const end: [number, number] = [endX - minX, endY - minY]
  const update: Partial<PPTLineElement> = { left: minX, top: minY, start, end }
  if (handle === 'start' || handle === 'end') {
    if (preserveControlPoints) {
      if (element.broken) update.broken = [middleX - minX, middleY - minY]
      if (element.curve) update.curve = [middleX - minX, middleY - minY]
      if (element.cubic) update.cubic = [[c1X - minX, c1Y - minY], [c2X - minX, c2Y - minY]]
    }
    else {
      const midpoint: [number, number] = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
      if (element.broken) update.broken = midpoint
      if (element.curve) update.curve = midpoint
      if (element.cubic) update.cubic = [midpoint, midpoint]
    }
    if (element.broken2) update.broken2 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
  }
  else if (handle === 'control') {
    if (element.broken) update.broken = [middleX - minX, middleY - minY]
    if (element.curve) update.curve = [middleX - minX, middleY - minY]
    if (element.broken2) {
      update.broken2 = getBroken2Direction(element) === 'horizontal'
        ? [middleX - minX, element.broken2[1]]
        : [element.broken2[0], middleY - minY]
    }
  }
  else if (element.cubic) update.cubic = [[c1X - minX, c1Y - minY], [c2X - minX, c2Y - minY]]
  return update
}

export const getShapeKeypointPositions = (element: PPTShapeElement) => {
  if (!element.pathFormula || !element.keypoints) return []
  const formula = SHAPE_PATH_FORMULAS[element.pathFormula]
  if (!formula?.getBaseSize || !formula.relative) return []
  return element.keypoints.map((keypoint, index) => {
    const value = formula.getBaseSize![index]!(element.width, element.height) * keypoint
    const relative = formula.relative![index]
    let x = 0; let y = 0
    if (relative === 'left') x = value
    else if (relative === 'right') x = element.width - value
    else if (relative === 'center') x = (element.width - value) / 2
    else if (relative === 'top') y = value
    else if (relative === 'bottom') y = element.height - value
    else if (relative === 'left_bottom') {
      x = value; y = element.height
    }
    else if (relative === 'right_bottom') {
      x = element.width - value; y = element.height
    }
    else if (relative === 'top_right') {
      x = element.width; y = value
    }
    else if (relative === 'bottom_right') {
      x = element.width; y = element.height - value
    }
    return { index, x: element.left + x, y: element.top + y }
  })
}

export const moveShapeKeypoint = (
  element: PPTShapeElement,
  index: number,
  delta: { x: number; y: number },
): Partial<PPTShapeElement> => {
  if (!element.pathFormula || !element.keypoints) return {}
  const formula = SHAPE_PATH_FORMULAS[element.pathFormula]
  if (!formula?.editable || !formula.getBaseSize || !formula.relative || !formula.range) return {}
  const baseSize = formula.getBaseSize[index]!(element.width, element.height)
  const originPosition = baseSize * element.keypoints[index]!
  const relative = formula.relative[index]
  let keypoint = 0
  if (relative === 'center') keypoint = (originPosition - delta.x * 2) / baseSize
  else if (relative === 'left' || relative === 'left_bottom') keypoint = (originPosition + delta.x) / baseSize
  else if (relative === 'right' || relative === 'right_bottom') keypoint = (originPosition - delta.x) / baseSize
  else if (relative === 'top' || relative === 'top_right') keypoint = (originPosition + delta.y) / baseSize
  else if (relative === 'bottom' || relative === 'bottom_right') keypoint = (originPosition - delta.y) / baseSize
  const [minimum, maximum] = formula.range[index]!
  keypoint = Math.min(maximum, Math.max(minimum, keypoint))
  const keypoints = [...element.keypoints]
  keypoints[index] = keypoint
  return { keypoints, path: formula.formula(element.width, element.height, keypoints) }
}

export const scaleElementsIntoBounds = (
  elements: readonly PPTElement[],
  origin: InteractionBounds,
  target: InteractionBounds,
  options: {
    readonly enforceMinimumSize?: boolean
    readonly singleSize?: { readonly height: number; readonly width: number }
    readonly updateShapePath?: boolean
  } = {},
): ReadonlyMap<string, Partial<PPTElement>> => {
  const updates = new Map<string, Partial<PPTElement>>()
  const originWidth = Math.max(origin.maxX - origin.minX, 1)
  const originHeight = Math.max(origin.maxY - origin.minY, 1)
  const scaleX = Math.max(0, (target.maxX - target.minX) / originWidth)
  const scaleY = Math.max(0, (target.maxY - target.minY) / originHeight)
  const enforceMinimumSize = options.enforceMinimumSize ?? true
  const updateShapePath = options.updateShapePath ?? true
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
    const single = elements.length === 1
    const scaledWidth = single ? options.singleSize?.width ?? target.maxX - target.minX : element.width * scaleX
    const scaledHeight = single ? options.singleSize?.height ?? target.maxY - target.minY : element.height * scaleY
    updates.set(element.id, {
      left: single ? target.minX : target.minX + (element.left - origin.minX) * scaleX,
      top: single ? target.minY : target.minY + (element.top - origin.minY) * scaleY,
      width: enforceMinimumSize ? Math.max(getMinimumElementSize(element), scaledWidth) : scaledWidth,
      height: enforceMinimumSize ? Math.max(getMinimumElementSize(element), scaledHeight) : scaledHeight,
    } as Partial<PPTElement>)
    const update = updates.get(element.id)! as Partial<Exclude<PPTElement, PPTLineElement>>
    const width = update.width ?? element.width
    const height = update.height ?? element.height
    if (updateShapePath && element.type === 'shape' && element.pathFormula) {
      const formula = SHAPE_PATH_FORMULAS[element.pathFormula]
      if (formula) {
        updates.set(element.id, {
          ...update,
          viewBox: [width, height],
          path: formula.formula(width, height, element.keypoints),
        } as Partial<PPTElement>)
      }
    }
    else if (element.type === 'table') {
      const cellMinHeight = Math.max(36, element.cellMinHeight + (height - element.height) / element.data.length)
      updates.set(element.id, cellMinHeight === element.cellMinHeight
        ? { left: update.left, width: update.width } as Partial<PPTElement>
        : { ...update, cellMinHeight } as Partial<PPTElement>)
    }
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
    if (element.type === 'line') {
      const controls = getLineControlPoints(element)
      const all = controls.map(point => ({ ...point, ...rotatePoint(point, center, angleDelta) }))
      const minX = Math.min(...all.map(point => point.x))
      const minY = Math.min(...all.map(point => point.y))
      const byHandle = new Map(all.map(point => [point.handle, point]))
      const toRelative = (handle: LineControlHandle): [number, number] => {
        const point = byHandle.get(handle)!
        return [point.x - minX, point.y - minY]
      }
      const update: Partial<PPTLineElement> = { left: minX, top: minY, start: toRelative('start'), end: toRelative('end') }
      if (element.broken) update.broken = toRelative('control')
      if (element.broken2) update.broken2 = toRelative('control')
      if (element.curve) update.curve = toRelative('control')
      if (element.cubic) update.cubic = [toRelative('control-1'), toRelative('control-2')]
      updates.set(element.id, update as Partial<PPTElement>)
      continue
    }
    const elementCenter = { x: element.left + element.width / 2, y: element.top + element.height / 2 }
    const rotatedCenter = rotatePoint(elementCenter, center, angleDelta)
    updates.set(element.id, {
      left: rotatedCenter.x - element.width / 2,
      top: rotatedCenter.y - element.height / 2,
      rotate: normalizeAngle(element.rotate + angleDelta),
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

export const buildEditorGridPath = (viewportSize: number, viewportRatio: number, gridLineSize: number) => {
  const maxX = viewportSize
  const maxY = viewportSize * viewportRatio
  let path = ''
  for (let index = 0; index <= Math.floor(maxY / gridLineSize); index += 1) {
    path += `M0 ${index * gridLineSize} L${maxX} ${index * gridLineSize} `
  }
  for (let index = 0; index <= Math.floor(maxX / gridLineSize); index += 1) {
    path += `M${index * gridLineSize} 0 L${index * gridLineSize} ${maxY} `
  }
  return path
}
