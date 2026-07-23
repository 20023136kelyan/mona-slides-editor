import type { PPTElement, Slide } from './model'
import type {
  PowerPointElementSourceLayer,
  PowerPointPackageReference,
  PowerPointSlideLayout,
  PowerPointSlideMaster,
} from './source'

const layerOrder: Record<PowerPointElementSourceLayer, number> = {
  master: 0,
  layout: 1,
  inherited: 2,
  slide: 3,
}

export interface SlideRenderNode {
  element: PPTElement
  layer: PowerPointElementSourceLayer
  sourceIndex: number
  zIndex: number
}

export interface PowerPointSlideRenderHierarchy {
  layout?: PowerPointSlideLayout
  master?: PowerPointSlideMaster
  sourcePackage?: PowerPointPackageReference
}

const resolvePowerPointSlideRenderHierarchy = (
  slide: Slide,
  sourcePackages: readonly PowerPointPackageReference[],
): PowerPointSlideRenderHierarchy => {
  if (!slide.source) return {}
  const sourcePackage = sourcePackages.find(candidate => candidate.packageId === slide.source!.packageId)
  if (!sourcePackage?.hierarchy) return { sourcePackage }
  return {
    layout: sourcePackage.hierarchy.layouts.find(candidate => candidate.partPath === slide.source!.layoutPart),
    master: sourcePackage.hierarchy.masters.find(candidate => candidate.partPath === slide.source!.masterPart),
    sourcePackage,
  }
}

const isInheritedPlaceholder = (element: PPTElement): boolean => (
  element.source?.placeholderIndex !== undefined
  || element.source?.placeholderType !== undefined
)

const createLayerNodes = (
  elements: readonly PPTElement[],
  layer: PowerPointElementSourceLayer,
): SlideRenderNode[] => elements
  // Placeholder shapes in a layout or master define inheritance defaults;
  // PowerPoint does not paint their editing prompts in normal slide view.
  // Slide-local placeholder instances remain normal slide elements.
  .filter(element => !isInheritedPlaceholder(element))
  .map((element, sourceIndex) => ({
    element,
    layer,
    sourceIndex: element.source?.sourceOrder ?? sourceIndex,
    zIndex: 0,
  }))

/**
 * Derives render order from PowerPoint's shared master/layout hierarchy
 * without copying inherited objects into every slide.
 *
 * The final compatibility pass still accepts previously persisted flat
 * master/layout elements, while exact stable IDs prevent the shared semantic
 * nodes and those legacy copies from rendering twice.
 */
export const resolveSlideRenderGraph = (
  slide: Slide,
  sourcePackages: readonly PowerPointPackageReference[] = [],
): SlideRenderNode[] => {
  const { layout, master } = resolvePowerPointSlideRenderHierarchy(slide, sourcePackages)
  const inherited = [
    ...(slide.source?.showMasterShapes === false || layout?.showMasterShapes === false
      ? []
      : createLayerNodes(master?.elements ?? [], 'master')),
    ...createLayerNodes(layout?.elements ?? [], 'layout'),
  ]
  const inheritedStableIds = new Set(inherited.map(node => node.element.source?.stableId).filter(Boolean))
  const local = slide.elements
    .filter(element => !element.source?.stableId || !inheritedStableIds.has(element.source.stableId))
    .map((element, sourceIndex) => ({
      element,
      layer: element.source?.sourceLayer ?? 'slide',
      sourceIndex,
      zIndex: 0,
    }))

  return [...inherited, ...local]
    .sort((left, right) => (
      layerOrder[left.layer] - layerOrder[right.layer]
      || left.sourceIndex - right.sourceIndex
    ))
    .map((node, zIndex) => ({ ...node, zIndex: zIndex + 1 }))
}
