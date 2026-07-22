import type { PPTElement } from '@mona/presentation-core/model'

import { getElementBounds } from '@/features/editor/editor-geometry'

export type ElementOrderCommand = 'bottom' | 'down' | 'top' | 'up'
export type ElementCanvasAlignCommand = 'bottom' | 'horizontal' | 'left' | 'right' | 'top' | 'vertical'

const groupLevelRange = (elements: PPTElement[], group: PPTElement[]) => ({
  maxLevel: elements.findIndex(element => element.id === group[group.length - 1]!.id),
  minLevel: elements.findIndex(element => element.id === group[0]!.id),
})

const moveUp = (elements: PPTElement[], target: PPTElement) => {
  const result = structuredClone(elements)
  if (target.groupId) {
    const group = result.filter(element => element.groupId === target.groupId)
    const { maxLevel, minLevel } = groupLevelRange(elements, group)
    if (maxLevel === elements.length - 1) return undefined
    const next = result[maxLevel + 1]!
    const moved = result.splice(minLevel, group.length)
    if (next.groupId) {
      const nextGroup = result.filter(element => element.groupId === next.groupId)
      result.splice(minLevel + nextGroup.length, 0, ...moved)
    }
    else result.splice(minLevel + 1, 0, ...moved)
  }
  else {
    const level = elements.findIndex(element => element.id === target.id)
    if (level === elements.length - 1) return undefined
    const next = result[level + 1]!
    const moved = result.splice(level, 1)[0]!
    if (next.groupId) {
      const nextGroup = result.filter(element => element.groupId === next.groupId)
      result.splice(level + nextGroup.length, 0, moved)
    }
    else result.splice(level + 1, 0, moved)
  }
  return result
}

const moveDown = (elements: PPTElement[], target: PPTElement) => {
  const result = structuredClone(elements)
  if (target.groupId) {
    const group = result.filter(element => element.groupId === target.groupId)
    const { minLevel } = groupLevelRange(elements, group)
    if (minLevel === 0) return undefined
    const previous = result[minLevel - 1]!
    const moved = result.splice(minLevel, group.length)
    if (previous.groupId) {
      const previousGroup = result.filter(element => element.groupId === previous.groupId)
      result.splice(minLevel - previousGroup.length, 0, ...moved)
    }
    else result.splice(minLevel - 1, 0, ...moved)
  }
  else {
    const level = elements.findIndex(element => element.id === target.id)
    if (level === 0) return undefined
    const previous = result[level - 1]!
    const moved = result.splice(level, 1)[0]!
    if (previous.groupId) {
      const previousGroup = result.filter(element => element.groupId === previous.groupId)
      result.splice(level - previousGroup.length, 0, moved)
    }
    else result.splice(level - 1, 0, moved)
  }
  return result
}

const moveTop = (elements: PPTElement[], target: PPTElement) => {
  const result = structuredClone(elements)
  if (target.groupId) {
    const group = result.filter(element => element.groupId === target.groupId)
    const { maxLevel, minLevel } = groupLevelRange(elements, group)
    if (maxLevel === elements.length - 1) return undefined
    result.push(...result.splice(minLevel, group.length))
  }
  else {
    const level = elements.findIndex(element => element.id === target.id)
    if (level === elements.length - 1) return undefined
    result.splice(level, 1)
    result.push(structuredClone(target))
  }
  return result
}

const moveBottom = (elements: PPTElement[], target: PPTElement) => {
  const result = structuredClone(elements)
  if (target.groupId) {
    const group = result.filter(element => element.groupId === target.groupId)
    const { minLevel } = groupLevelRange(elements, group)
    if (minLevel === 0) return undefined
    result.unshift(...result.splice(minLevel, group.length))
  }
  else {
    const level = elements.findIndex(element => element.id === target.id)
    if (level === 0) return undefined
    result.splice(level, 1)
    result.unshift(structuredClone(target))
  }
  return result
}

export const orderElementLikeVue = (
  elements: PPTElement[],
  target: PPTElement,
  command: ElementOrderCommand,
) => {
  if (command === 'up') return moveUp(elements, target)
  if (command === 'down') return moveDown(elements, target)
  if (command === 'top') return moveTop(elements, target)
  return moveBottom(elements, target)
}

export const alignElementsToCanvasLikeVue = (
  elements: PPTElement[],
  activeElementIds: string[],
  command: ElementCanvasAlignCommand,
  viewportSize: number,
  viewportRatio: number,
) => {
  const selected = elements.filter(element => activeElementIds.includes(element.id))
  const ranges = selected.map(getElementBounds)
  const minX = Math.min(...ranges.map(range => range.minX))
  const maxX = Math.max(...ranges.map(range => range.maxX))
  const minY = Math.min(...ranges.map(range => range.minY))
  const maxY = Math.max(...ranges.map(range => range.maxY))
  const viewportHeight = viewportSize * viewportRatio
  const result = structuredClone(elements)

  for (const element of result) {
    if (!activeElementIds.includes(element.id)) continue
    if (command === 'top') element.top -= minY
    else if (command === 'vertical') element.top -= minY + ((maxY - minY) / 2) - (viewportHeight / 2)
    else if (command === 'bottom') element.top -= maxY - viewportHeight
    else if (command === 'left') element.left -= minX
    else if (command === 'horizontal') element.left -= minX + ((maxX - minX) / 2) - (viewportSize / 2)
    else if (command === 'right') element.left -= maxX - viewportSize
  }
  return result
}
