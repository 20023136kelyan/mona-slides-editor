import type {
  PowerPointElementSource,
  PowerPointPackageReference,
  PowerPointPlaceholder,
  PowerPointSlideSource,
} from './source'

export interface PowerPointPlaceholderChain {
  layout?: PowerPointPlaceholder
  master?: PowerPointPlaceholder
}

const matchingPlaceholder = (
  placeholders: readonly PowerPointPlaceholder[],
  partPath: string | undefined,
  source: PowerPointElementSource,
): PowerPointPlaceholder | undefined => {
  if (!partPath) return undefined
  const candidates = placeholders.filter(placeholder => placeholder.partPath === partPath)
  if (source.placeholderIndex !== undefined) {
    const indexed = candidates.find(placeholder => placeholder.index === source.placeholderIndex)
    if (indexed) return indexed
  }
  if (source.placeholderType !== undefined) {
    return candidates.find(placeholder => placeholder.type === source.placeholderType)
  }
  return undefined
}

/**
 * Resolves the semantic placeholder chain without copying layout/master
 * objects into a slide. Effective geometry and text-style compilation can use
 * this chain as those models replace the current flat compatibility adapter.
 */
export const resolvePowerPointPlaceholderChain = (
  sourcePackage: PowerPointPackageReference,
  slide: PowerPointSlideSource,
  element: PowerPointElementSource,
): PowerPointPlaceholderChain => {
  const placeholders = sourcePackage.hierarchy?.placeholders ?? []
  return {
    layout: element.sourceLayer === 'master'
      ? undefined
      : matchingPlaceholder(placeholders, slide.layoutPart, element),
    master: matchingPlaceholder(placeholders, slide.masterPart, element),
  }
}
