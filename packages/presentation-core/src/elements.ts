import type { PPTElement, PPTGroupElement } from './model'

export interface ElementTreeEntry {
  element: PPTElement
  parent?: PPTGroupElement
  path: readonly number[]
}

export const isGroupElement = (element: PPTElement): element is PPTGroupElement => (
  element.type === 'group'
)

export const walkElementTree = (
  elements: readonly PPTElement[],
  visit: (entry: ElementTreeEntry) => void,
  parent?: PPTGroupElement,
  parentPath: readonly number[] = [],
): void => {
  elements.forEach((element, index) => {
    const path = [...parentPath, index]
    visit({ element, parent, path })
    if (isGroupElement(element)) walkElementTree(element.elements, visit, element, path)
  })
}

export const flattenElementTree = (elements: readonly PPTElement[]): PPTElement[] => {
  const flattened: PPTElement[] = []
  walkElementTree(elements, ({ element }) => flattened.push(element))
  return flattened
}

export const collectElementTreeIds = (elements: readonly PPTElement[]): string[] => (
  flattenElementTree(elements).map(element => element.id)
)

/**
 * Disconnects cloned editor elements from the native PowerPoint objects that
 * produced their source elements. Call this only on newly cloned trees: an
 * imported original must retain its provenance so it can remain a safe native
 * patch target.
 */
export const detachElementTreeSources = (elements: readonly PPTElement[]): void => {
  walkElementTree(elements, ({ element }) => {
    delete element.source
  })
}

export const findElementById = (
  elements: readonly PPTElement[],
  id: string,
): PPTElement | undefined => {
  for (const element of elements) {
    if (element.id === id) return element
    if (isGroupElement(element)) {
      const nested = findElementById(element.elements, id)
      if (nested) return nested
    }
  }
  return undefined
}

export const updateElementTreeByIds = (
  elements: readonly PPTElement[],
  ids: ReadonlySet<string>,
  update: (element: PPTElement) => PPTElement,
): PPTElement[] => elements.map(element => {
  const updated = ids.has(element.id) ? update(element) : element
  if (!isGroupElement(updated)) return updated
  const children = updateElementTreeByIds(updated.elements, ids, update)
  return children.every((child, index) => child === updated.elements[index])
    ? updated
    : { ...updated, elements: children }
})

export const removeElementsFromTree = (
  elements: readonly PPTElement[],
  ids: ReadonlySet<string>,
): PPTElement[] => {
  const result: PPTElement[] = []
  for (const element of elements) {
    if (ids.has(element.id)) continue
    if (!isGroupElement(element)) {
      result.push(element)
      continue
    }
    const children = removeElementsFromTree(element.elements, ids)
    result.push(children.length === element.elements.length
      && children.every((child, index) => child === element.elements[index])
      ? element
      : { ...element, elements: children })
  }
  return result
}

export const remapElementTreeIds = (
  elements: readonly PPTElement[],
  createId: () => string,
): { elements: PPTElement[]; idMap: ReadonlyMap<string, string> } => {
  const idMap = new Map<string, string>()
  walkElementTree(elements, ({ element }) => idMap.set(element.id, createId()))
  const remap = (source: readonly PPTElement[]): PPTElement[] => source.map(element => {
    const clone = JSON.parse(JSON.stringify(element)) as PPTElement
    clone.id = idMap.get(element.id)!
    if (clone.type === 'group') clone.elements = remap(element.type === 'group' ? element.elements : [])
    return clone
  })
  return { elements: remap(elements), idMap }
}
