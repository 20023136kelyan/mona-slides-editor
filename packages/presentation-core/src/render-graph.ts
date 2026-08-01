import type { PPTElement, PPTShapeElement, PPTTableElement, PPTTextElement, Slide, SlideBackground, SlideTheme } from './model'
import { copyElementTreeWithPowerPointOrigins, flattenElementTree } from './elements'
import type {
  PowerPointElementSourceLayer,
  PowerPointHeaderFooterPolicy,
  PowerPointPackageReference,
  PowerPointSlideLayout,
  PowerPointSlideMaster,
  PowerPointTheme,
} from './source'
import { compileStructuredText } from './structured-text'

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
  theme?: PowerPointTheme
}

export interface ResolvedPowerPointPlaceholder {
  elementId: string
  index?: string
  layoutObjectId?: string
  masterObjectId?: string
  type?: string
}

export interface ResolvedSlideRenderState extends PowerPointSlideRenderHierarchy {
  background?: SlideBackground
  nodes: SlideRenderNode[]
  placeholders: ResolvedPowerPointPlaceholder[]
}

/**
 * Materialize one inherited hierarchy object as a slide-local copy-on-write
 * override. The shared layout/master records remain untouched.
 *
 * The root containing `sourceObjectId` is copied so a child of a native group
 * never loses its parent coordinate system. The returned tree has new Mona IDs
 * and no exact OOXML target identity; its `copyOnWrite` origin is what lets a
 * later package serializer clone the native payload safely.
 */
export const createSlideLocalPowerPointOverride = (
  slide: Slide,
  sourcePackages: readonly PowerPointPackageReference[],
  sourceObjectId: string,
  createId: () => string,
): PPTElement | undefined => {
  if (!slide.source) return undefined
  const hierarchy = resolvePowerPointSlideRenderHierarchy(slide, sourcePackages)
  const roots = [
    ...(hierarchy.master?.elements ?? []),
    ...(hierarchy.layout?.elements ?? []),
  ]
  const root = roots.find(element => flattenElementTree([element]).some(candidate => (
    candidate.source?.sourceObjectId === sourceObjectId
  )))
  if (!root) return undefined
  return copyElementTreeWithPowerPointOrigins(
    [root],
    createId,
    'override',
    { packageId: slide.source.packageId, slidePart: slide.source.slidePart },
  ).elements[0]
}

export const resolvePowerPointSlideRenderHierarchy = (
  slide: Slide,
  sourcePackages: readonly PowerPointPackageReference[],
): PowerPointSlideRenderHierarchy => {
  if (!slide.source) return {}
  const sourcePackage = sourcePackages.find(candidate => candidate.packageId === slide.source!.packageId)
  if (!sourcePackage?.hierarchy) return { sourcePackage }
  const layout = sourcePackage.hierarchy.layouts.find(candidate => candidate.partPath === slide.source!.layoutPart)
  const master = sourcePackage.hierarchy.masters.find(candidate => candidate.partPath === slide.source!.masterPart)
  return {
    layout,
    master,
    sourcePackage,
    theme: sourcePackage.hierarchy.themes.find(candidate => (
      candidate.id === slide.source!.themeId
      || candidate.partPath === slide.source!.themePart
      || candidate.id === master?.themeId
    )),
  }
}

const isInheritedPlaceholder = (element: PPTElement): boolean => (
  element.source?.placeholderIndex !== undefined
  || element.source?.placeholderType !== undefined
)

const headerFooterPlaceholderTypes = new Set(['dt', 'ftr', 'hdr', 'sldNum'])

const isHeaderFooterPlaceholder = (element: PPTElement): boolean => (
  Boolean(element.source?.placeholderType && headerFooterPlaceholderTypes.has(element.source.placeholderType))
)

const defaultHeaderFooterPolicy: PowerPointHeaderFooterPolicy = {
  dateTime: true,
  footer: true,
  header: true,
  slideNumber: true,
}

const headerFooterVisible = (
  element: PPTElement,
  policy: PowerPointHeaderFooterPolicy,
): boolean => {
  switch (element.source?.placeholderType) {
    case 'dt': return policy.dateTime
    case 'ftr': return policy.footer
    case 'hdr': return policy.header
    case 'sldNum': return policy.slideNumber
    default: return false
  }
}

const placeholderKey = (element: PPTElement): string | undefined => {
  if (!isInheritedPlaceholder(element)) return undefined
  if (isHeaderFooterPlaceholder(element)) return `type:${element.source!.placeholderType}`
  if (element.source?.placeholderIndex !== undefined) return `index:${element.source.placeholderIndex}`
  const type = element.source?.placeholderType === 'ctrTitle' ? 'title' : element.source?.placeholderType
  return type ? `type:${type}` : undefined
}

const createLayerNodes = (
  elements: readonly PPTElement[],
  layer: PowerPointElementSourceLayer,
): SlideRenderNode[] => elements
  // Placeholder shapes in a layout or master define inheritance defaults;
  // PowerPoint does not paint their editing prompts in normal slide view.
  // That includes the date, footer, header, and slide-number prompts: turning
  // one of those on writes the placeholder onto each slide it applies to, so
  // the slide's own copy is what renders. A deck that never enabled them —
  // every Canva export, for one — carries the prompts on its layouts and must
  // show nothing.
  .filter(element => !isInheritedPlaceholder(element))
  .map((element, sourceIndex) => ({
    element,
    layer,
    sourceIndex: element.source?.sourceOrder ?? sourceIndex,
    zIndex: 0,
  }))

const replaceFirstHtmlText = (content: string, value: string): string => {
  let replaced = false
  const next = content.replace(/>([^<>]+)</g, (match, text: string) => {
    if (replaced || !text.trim()) return match
    replaced = true
    return `>${value}<`
  })
  return replaced ? next : `<p>${value}</p>`
}

const materializeSlideNumber = (
  element: PPTElement,
  slideNumber: number,
): PPTElement => {
  if (element.source?.placeholderType !== 'sldNum') return element
  const value = String(slideNumber)
  if (element.type === 'text') {
    return {
      ...element,
      content: replaceFirstHtmlText(element.content, value),
    } satisfies PPTTextElement
  }
  if (element.type === 'shape' && element.text) {
    return {
      ...element,
      text: {
        ...element.text,
        content: replaceFirstHtmlText(element.text.content, value),
      },
    } satisfies PPTShapeElement
  }
  return element
}

const elementStructuredText = (element: PPTElement) => {
  if (element.type === 'text') return element.structuredText
  if (element.type === 'shape') return element.text?.structuredText
  return undefined
}

const findHierarchyElement = (
  elements: readonly PPTElement[] | undefined,
  objectId: string | undefined,
  fallback: PPTElement,
) => {
  if (!elements) return undefined
  const flattened = flattenElementTree(elements)
  if (objectId) {
    const exact = flattened.find(element => (
      element.source?.sourceObjectId === objectId
      || element.source?.stableId === objectId
    ))
    if (exact) return exact
  }
  const key = placeholderKey(fallback)
  return key ? flattened.find(element => placeholderKey(element) === key) : undefined
}

const textStyleKind = (
  element: PPTElement,
): 'body' | 'other' | 'title' => {
  switch (element.source?.placeholderType) {
    case 'ctrTitle':
    case 'title':
      return 'title'
    case 'body':
    case 'obj':
    case 'subTitle':
      return 'body'
    default:
      return 'other'
  }
}

const verticalTextModes = new Set([
  'eaVert',
  'mongolianVert',
  'vert',
  'vert270',
  'wordArtVert',
  'wordArtVertRtl',
])

const bodyAnchor = (
  anchor: string | undefined,
): PPTTextElement['vAlign'] => (
  anchor === 'b' ? 'bottom' : anchor === 'ctr' || anchor === 'dist' || anchor === 'just' ? 'middle' : 'top'
)

/**
 * Table cells inherit from the presentation and theme like any other body, but
 * they are not placeholders and have no layout or master counterpart to
 * inherit a prompt from, so they compile against the deck defaults alone.
 */
const materializeTableText = (
  element: PPTTableElement,
  hierarchy: PowerPointSlideRenderHierarchy,
  slide: Slide,
): PPTTableElement => {
  const { layout, master, sourcePackage, theme } = hierarchy
  const colorMap = slide.source?.colorMapOverride ?? layout?.colorMapOverride ?? master?.colorMap
  let compiledAny = false
  const data = element.data.map(row => row.map(cell => {
    if (!cell.structuredText) return cell
    compiledAny = true
    const compiled = compileStructuredText(cell.structuredText, {
      colorMap,
      defaultTextStyle: sourcePackage?.hierarchy?.defaultTextStyle,
      fallbackColor: cell.style?.color ?? '#000000',
      fallbackFontName: cell.style?.fontname ?? '',
      slideNumber: 1,
      textStyleKind: 'other',
      theme,
    })
    return {
      ...cell,
      structuredText: compiled.body,
      text: compiled.html,
    }
  }))
  return compiledAny ? { ...element, data } : element
}

const materializeStructuredText = (
  element: PPTElement,
  hierarchy: PowerPointSlideRenderHierarchy,
  slide: Slide,
  slideNumber: number,
): PPTElement => {
  if (element.type === 'table') return materializeTableText(element, hierarchy, slide)
  // A group's children are ordinary bodies that happen to sit in a nested
  // coordinate space. Skipping them leaves their imported HTML compatibility
  // markup on screen while every ungrouped body renders compiled text, so the
  // same content changes size and spacing purely by being grouped.
  if (element.type === 'group') {
    return {
      ...element,
      elements: element.elements.map(child => (
        materializeStructuredText(child, hierarchy, slide, slideNumber)
      )),
    }
  }
  const structuredText = elementStructuredText(element)
  if (!structuredText) return materializeSlideNumber(element, slideNumber)
  const { layout, master, sourcePackage, theme } = hierarchy
  const source = element.source
  const layoutElement = source?.sourceLayer === 'slide'
    ? findHierarchyElement(layout?.elements, source.placeholderLayoutObjectId, element)
    : source?.sourceLayer === 'layout'
      ? element
      : undefined
  const masterElement = source?.sourceLayer === 'master'
    ? element
    : findHierarchyElement(master?.elements, source?.placeholderMasterObjectId, layoutElement ?? element)
  const colorMap = slide.source?.colorMapOverride ?? layout?.colorMapOverride ?? master?.colorMap
  const compiled = compileStructuredText(structuredText, {
    colorMap,
    defaultTextStyle: sourcePackage?.hierarchy?.defaultTextStyle,
    fallbackColor: element.type === 'text'
      ? element.defaultColor
      : element.type === 'shape'
        ? element.text?.defaultColor ?? '#000000'
        : '#000000',
    fallbackFontName: element.type === 'text'
      ? element.defaultFontName
      : element.type === 'shape'
        ? element.text?.defaultFontName ?? ''
        : '',
    layoutBody: layoutElement ? elementStructuredText(layoutElement) : undefined,
    masterBody: masterElement ? elementStructuredText(masterElement) : undefined,
    masterTextStyles: master?.textStyles,
    slideNumber,
    textStyleKind: textStyleKind(element),
    theme,
  })
  const body = compiled.bodyProperties
  const inset = body.insets?.map(value => value * structuredText.scale) as PPTTextElement['inset'] | undefined
  const columns = body.columnCount && body.columnCount > 1 ? body.columnCount : undefined
  const columnGap = body.columnSpacing !== undefined ? body.columnSpacing * structuredText.scale : undefined
  if (element.type === 'text') {
    return materializeSlideNumber({
      ...element,
      ...(columns ? { columns } : {}),
      ...(columnGap !== undefined ? { columnGap } : {}),
      content: compiled.html,
      defaultColor: compiled.defaultColor,
      defaultFontName: compiled.defaultFontName,
      fixedHeight: body.autoFit?.type !== 'shape',
      ...(inset ? { inset } : {}),
      lineHeight: 1,
      paragraphSpace: 0,
      structuredText: compiled.body,
      vAlign: bodyAnchor(body.anchor),
      vertical: body.verticalMode ? verticalTextModes.has(body.verticalMode) : element.vertical,
    } satisfies PPTTextElement, slideNumber)
  }
  if (element.type === 'shape' && element.text) {
    return materializeSlideNumber({
      ...element,
      text: {
        ...element.text,
        align: bodyAnchor(body.anchor) === 'bottom'
          ? 'bottom'
          : bodyAnchor(body.anchor) === 'top'
            ? 'top'
            : 'middle',
        ...(columns ? { columns } : {}),
        ...(columnGap !== undefined ? { columnGap } : {}),
        content: compiled.html,
        defaultColor: compiled.defaultColor,
        defaultFontName: compiled.defaultFontName,
        ...(inset ? { inset } : {}),
        lineHeight: 1,
        paragraphSpace: 0,
        structuredText: compiled.body,
      },
    } satisfies PPTShapeElement, slideNumber)
  }
  return materializeSlideNumber(element, slideNumber)
}

const resolveBackground = (
  slide: Slide,
  layout?: PowerPointSlideLayout,
  master?: PowerPointSlideMaster,
): SlideBackground | undefined => {
  switch (slide.source?.backgroundSource) {
    case 'layout': return layout?.background ?? slide.background
    case 'master': return master?.background ?? slide.background
    case 'default': return slide.background ?? { color: '#ffffff', type: 'solid' }
    case 'slide':
    default:
      return slide.background ?? layout?.background ?? master?.background
  }
}

const normalizeThemeColor = (value: string | undefined): string | undefined => {
  if (!value) return undefined
  if (/^#[\da-f]{3,8}$/i.test(value)) return value
  if (/^[\da-f]{6}$/i.test(value)) return `#${value}`
  return undefined
}

const colorFromTheme = (
  theme: PowerPointTheme,
  name: string | undefined,
): string | undefined => {
  if (!name) return undefined
  const color = theme.colors.find(candidate => candidate.name === name)
  return normalizeThemeColor(color?.value)
}

/**
 * Adapts a retained PowerPoint theme to Mona's current presentation theme.
 * Element-level authored styles remain untouched; this supplies inherited
 * defaults to renderers that still consume SlideTheme.
 */
export const compileSlideTheme = (
  fallback: SlideTheme,
  theme?: PowerPointTheme,
  master?: PowerPointSlideMaster,
  layout?: PowerPointSlideLayout,
  slide?: Slide,
): SlideTheme => {
  if (!theme) return fallback
  const colorMap = slide?.source?.colorMapOverride ?? layout?.colorMapOverride ?? master?.colorMap
  const accents = Array.from({ length: 6 }, (_, index) => (
    colorFromTheme(theme, colorMap?.[`accent${index + 1}`] ?? `accent${index + 1}`)
  )).filter((color): color is string => Boolean(color))
  const fontColor = colorFromTheme(theme, colorMap?.tx1 ?? 'dk1')
  const backgroundColor = colorFromTheme(theme, colorMap?.bg1 ?? 'lt1')
  return {
    ...fallback,
    ...(backgroundColor ? { backgroundColor } : {}),
    ...(fontColor ? { fontColor } : {}),
    ...(theme.minorFont?.latin || theme.minorLatinFont
      ? { fontName: theme.minorFont?.latin ?? theme.minorLatinFont! }
      : {}),
    ...(accents.length ? { themeColors: accents } : {}),
  }
}

/**
 * Derives render order from PowerPoint's shared master/layout hierarchy
 * without copying inherited objects into every slide.
 *
 * The final compatibility pass still accepts previously persisted flat
 * master/layout elements, while exact stable IDs prevent the shared semantic
 * nodes and those legacy copies from rendering twice.
 */
export const resolveSlideRenderState = (
  slide: Slide,
  sourcePackages: readonly PowerPointPackageReference[] = [],
): ResolvedSlideRenderState => {
  const hierarchy = resolvePowerPointSlideRenderHierarchy(slide, sourcePackages)
  const { layout, master, sourcePackage } = hierarchy
  const headerFooterPolicy = master?.headerFooter ?? defaultHeaderFooterPolicy
  const masterNodes = slide.source?.showMasterShapes === false || layout?.showMasterShapes === false
    ? []
    : createLayerNodes(master?.elements ?? [], 'master')
  const layoutNodes = createLayerNodes(layout?.elements ?? [], 'layout')
  const localElements = flattenElementTree(slide.elements)
  const overriddenObjectIds = new Set(localElements.flatMap(element => (
    element.source?.copyOnWrite?.mode === 'override'
      ? [element.source.copyOnWrite.sourceObjectId]
      : []
  )))
  const hiddenObjectIds = new Set(slide.source?.hiddenInheritedObjectIds ?? [])
  const inherited = [...masterNodes, ...layoutNodes].filter(node => {
    const objectId = node.element.source?.sourceObjectId
    if (!objectId) return true
    return !overriddenObjectIds.has(objectId) && !hiddenObjectIds.has(objectId)
  })
  const slideNumber = sourcePackage && slide.source
    ? Math.max(1, sourcePackage.slides.findIndex(candidate => candidate.slidePart === slide.source!.slidePart) + 1)
    : 1
  const materializedInherited = inherited.map(node => ({
    ...node,
    element: materializeStructuredText(node.element, hierarchy, slide, slideNumber),
  }))
  const inheritedStableIds = new Set(materializedInherited.map(node => node.element.source?.stableId).filter(Boolean))
  const local = slide.elements
    .filter(element => !element.source?.stableId || !inheritedStableIds.has(element.source.stableId))
    // The slide declaring a field is what turns it on, but the master can
    // still switch the whole family off for every slide that uses it.
    .filter(element => (
      !isHeaderFooterPlaceholder(element) || headerFooterVisible(element, headerFooterPolicy)
    ))
    .map((element, sourceIndex) => ({
      element: materializeStructuredText(element, hierarchy, slide, slideNumber),
      layer: element.source?.sourceLayer ?? 'slide',
      sourceIndex,
      zIndex: 0,
    }))

  const nodes = [...materializedInherited, ...local]
    .sort((left, right) => (
      layerOrder[left.layer] - layerOrder[right.layer]
      || left.sourceIndex - right.sourceIndex
    ))
    .map((node, zIndex) => ({ ...node, zIndex: zIndex + 1 }))
  const placeholders = localElements.flatMap(element => {
    const source = element.source
    if (!source || (source.placeholderIndex === undefined && source.placeholderType === undefined)) return []
    return [{
      elementId: element.id,
      ...(source.placeholderIndex !== undefined ? { index: source.placeholderIndex } : {}),
      ...(source.placeholderLayoutObjectId ? { layoutObjectId: source.placeholderLayoutObjectId } : {}),
      ...(source.placeholderMasterObjectId ? { masterObjectId: source.placeholderMasterObjectId } : {}),
      ...(source.placeholderType ? { type: source.placeholderType } : {}),
    }]
  })
  return {
    ...hierarchy,
    background: resolveBackground(slide, layout, master),
    nodes,
    placeholders,
  }
}

export const resolveSlideRenderGraph = (
  slide: Slide,
  sourcePackages: readonly PowerPointPackageReference[] = [],
): SlideRenderNode[] => resolveSlideRenderState(slide, sourcePackages).nodes
