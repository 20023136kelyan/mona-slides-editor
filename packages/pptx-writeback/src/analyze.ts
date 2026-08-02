import {
  flattenElementTree,
  powerPointCommentNoteId,
  resolveSlideRenderState,
  type Note,
  type PPTChartElement,
  type PPTElement,
  type PPTElementOutline,
  type PPTLineElement,
  type PowerPointHeaderFooterPolicy,
  type PresentationState,
  type ShapeText,
  type Slide,
} from '@mona/presentation-core'

import type {
  PowerPointElementEntry,
  PowerPointImageSnapshot,
  PowerPointChartSnapshot,
  PowerPointConnectorSnapshot,
  PowerPointPatchOperation,
  PowerPointShapeStyleSnapshot,
  PowerPointShapeGeometrySnapshot,
  PowerPointTableSnapshot,
  PowerPointTextSnapshot,
  PowerPointTransformSnapshot,
  PowerPointWritebackIssue,
  PowerPointWritebackPlan,
} from './types'
import { parseAuthoredText } from './authored-text'

const relationshipPartPath = (partPath: string): string => {
  const slash = partPath.lastIndexOf('/')
  const directory = slash < 0 ? '' : partPath.slice(0, slash + 1)
  const fileName = slash < 0 ? partPath : partPath.slice(slash + 1)
  return `${directory}_rels/${fileName}.rels`
}

const nextPlannedPart = (
  used: Set<string>,
  directory: string,
  stem: string,
): string => {
  let index = 1
  while (used.has(`${directory}/${stem}${index}.xml`)) index += 1
  const part = `${directory}/${stem}${index}.xml`
  used.add(part)
  return part
}

const authoredHyperlinks = (content: string): Array<string | undefined> => (
  parseAuthoredText(content).flatMap(paragraph => paragraph.runs.map(run => run.hyperlink))
)

const outerShadowSnapshot = (element: PPTElement) => (
  element.type === 'image'
  || element.type === 'line'
  || element.type === 'shape'
  || element.type === 'text'
    ? element.shadow
    : undefined
)

const effectKinds = (element: PPTElement): string[] => Object.entries(element.effects ?? {})
  .filter(([, value]) => value !== undefined)
  .map(([kind]) => kind)
  .sort()

const chartSnapshot = (element: PPTChartElement): PowerPointChartSnapshot => ({
  ...(element.chartSpace ? { chartSpace: structuredClone(element.chartSpace) } : {}),
  chartType: element.chartType,
  data: structuredClone(element.data),
  ...(element.options ? { options: structuredClone(element.options) } : {}),
  themeColors: structuredClone(element.themeColors),
})

const textSnapshot = (
  element: PPTElement,
): PowerPointTextSnapshot | undefined => {
  const text = element.type === 'text'
    ? element
    : element.type === 'shape'
      ? element.text
      : undefined
  if (!text) return undefined
  return {
    ...(text.columnGap !== undefined ? { columnGap: text.columnGap } : {}),
    ...(text.columns !== undefined ? { columns: text.columns } : {}),
    content: text.content,
    defaultColor: text.defaultColor,
    defaultFontName: text.defaultFontName,
    ...('fixedHeight' in text && text.fixedHeight !== undefined
      ? { fixedHeight: text.fixedHeight }
      : {}),
    ...(text.inset ? { inset: structuredClone(text.inset) } : {}),
    ...(text.lineHeight !== undefined ? { lineHeight: text.lineHeight } : {}),
    ...(text.paragraphSpace !== undefined ? { paragraphSpace: text.paragraphSpace } : {}),
    ...(text.structuredText ? { structuredText: structuredClone(text.structuredText) } : {}),
    ...(('vAlign' in text ? text.vAlign : (text as ShapeText).align) !== undefined
      ? { vAlign: 'vAlign' in text ? text.vAlign : (text as ShapeText).align }
      : {}),
    ...(text.wordSpace !== undefined ? { wordSpace: text.wordSpace } : {}),
  }
}

const styleSnapshot = (element: PPTElement): PowerPointShapeStyleSnapshot | undefined => {
  if (element.type !== 'text' && element.type !== 'shape') return undefined
  return {
    ...(element.fill !== undefined ? { fill: element.fill } : {}),
    ...(element.type === 'shape' && element.gradient
      ? { gradient: structuredClone(element.gradient) }
      : {}),
    ...(element.outline ? { outline: structuredClone(element.outline) as PPTElementOutline } : {}),
    ...(element.type === 'shape' && element.pattern !== undefined
      ? { pattern: element.pattern }
      : {}),
    ...(element.type === 'shape' && element.patternFit
      ? { patternFit: structuredClone(element.patternFit) }
      : {}),
    ...(element.type === 'shape' && element.powerPointPattern
      ? { powerPointPattern: structuredClone(element.powerPointPattern) }
      : {}),
  }
}

const shapeGeometrySnapshot = (
  element: Extract<PPTElement, { type: 'shape' }>,
): PowerPointShapeGeometrySnapshot => ({
  ...(element.powerPointGeometry
    ? { powerPointGeometry: structuredClone(element.powerPointGeometry) }
    : {}),
})

const imageSnapshot = (
  element: Extract<PPTElement, { type: 'image' }>,
): PowerPointImageSnapshot => ({
  ...(element.clip ? { clip: structuredClone(element.clip) } : {}),
  ...(element.filters ? { filters: structuredClone(element.filters) } : {}),
  ...(element.opacity !== undefined ? { opacity: element.opacity } : {}),
  ...(element.outline ? { outline: structuredClone(element.outline) } : {}),
  ...(element.powerPointImage
    ? { powerPointImage: structuredClone(element.powerPointImage) }
    : {}),
  ...(element.shadow ? { shadow: structuredClone(element.shadow) } : {}),
  src: element.src,
})

const connectorSnapshot = (element: PPTLineElement): PowerPointConnectorSnapshot => ({
  ...(element.broken ? { broken: structuredClone(element.broken) } : {}),
  ...(element.broken2 ? { broken2: structuredClone(element.broken2) } : {}),
  ...(element.broken2Direction ? { broken2Direction: element.broken2Direction } : {}),
  color: element.color,
  ...(element.connections ? { connections: structuredClone(element.connections) } : {}),
  ...(element.cubic ? { cubic: structuredClone(element.cubic) } : {}),
  ...(element.curve ? { curve: structuredClone(element.curve) } : {}),
  end: structuredClone(element.end),
  left: element.left,
  points: structuredClone(element.points),
  start: structuredClone(element.start),
  style: element.style,
  top: element.top,
  width: element.width,
  ...(element.powerPointGeometry
    ? { powerPointGeometry: structuredClone(element.powerPointGeometry) }
    : {}),
})

const tableSnapshot = (element: Extract<PPTElement, { type: 'table' }>): PowerPointTableSnapshot => ({
  cellMinHeight: element.cellMinHeight,
  colWidths: structuredClone(element.colWidths),
  data: structuredClone(element.data),
  outline: structuredClone(element.outline),
  ...(element.powerPointTable
    ? { powerPointTable: structuredClone(element.powerPointTable) }
    : {}),
  ...(element.rowHeights ? { rowHeights: structuredClone(element.rowHeights) } : {}),
  ...(element.theme ? { theme: structuredClone(element.theme) } : {}),
  width: element.width,
})

const tableTopologyIssues = (
  element: Extract<PPTElement, { type: 'table' }>,
  partPath: string,
  slideId: string,
): PowerPointWritebackIssue[] => {
  const rows = element.data.length
  const columns = element.data[0]?.length ?? 0
  if (!rows || !columns || element.data.some(row => row.length !== columns)) {
    return [unsupported(
      'pptx.writeback.table-grid',
      'A PowerPoint table must have a non-empty rectangular cell grid.',
      { elementId: element.id, partPath, slideId },
    )]
  }
  const covered = new Set<string>()
  const issues: PowerPointWritebackIssue[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const cell = element.data[row]![column]!
      const key = `${row}:${column}`
      if (covered.has(key)) continue
      const rowSpan = Math.max(1, Math.round(cell.rowspan || 1))
      const columnSpan = Math.max(1, Math.round(cell.colspan || 1))
      if (row + rowSpan > rows || column + columnSpan > columns) {
        issues.push(unsupported(
          'pptx.writeback.table-span',
          `Table cell ${row + 1},${column + 1} spans outside the table grid.`,
          { elementId: element.id, partPath, slideId },
        ))
        continue
      }
      for (let coveredRow = row; coveredRow < row + rowSpan; coveredRow += 1) {
        for (let coveredColumn = column; coveredColumn < column + columnSpan; coveredColumn += 1) {
          if (coveredRow === row && coveredColumn === column) continue
          const coveredKey = `${coveredRow}:${coveredColumn}`
          if (covered.has(coveredKey)) {
            issues.push(unsupported(
              'pptx.writeback.table-span-overlap',
              'Merged table cells overlap and cannot be serialized safely.',
              { elementId: element.id, partPath, slideId },
            ))
          }
          covered.add(coveredKey)
        }
      }
    }
  }
  return issues
}

const connectorAbsolutePoint = (
  connector: PowerPointConnectorSnapshot,
  endpoint: 'end' | 'start',
): [number, number] => [
  connector.left + connector[endpoint][0],
  connector.top + connector[endpoint][1],
]

const pointEqual = (left: [number, number], right: [number, number]): boolean => (
  numberEqual(left[0], right[0]) && numberEqual(left[1], right[1])
)

const connectorRoute = (connector: PowerPointConnectorSnapshot): unknown => ({
  broken: connector.broken,
  broken2: connector.broken2,
  broken2Direction: connector.broken2Direction,
  cubic: connector.cubic,
  curve: connector.curve,
  powerPointGeometry: connector.powerPointGeometry,
})

const changed = (before: unknown, after: unknown): boolean => (
  JSON.stringify(before) !== JSON.stringify(after)
)

const textScale = (before: PPTElement, after: PPTElement): number | undefined => (
  textSnapshot(before)?.structuredText?.scale
  ?? textSnapshot(after)?.structuredText?.scale
)

const numberEqual = (left: number, right: number): boolean => (
  Math.abs(left - right) < 0.000_001
)

const sourceObjectId = (element: PPTElement): string | undefined => (
  element.source?.sourceObjectId
)

const collectElements = (
  slide: Slide,
): {
  entries: PowerPointElementEntry[]
  sequenceByParent: Map<string, string[]>
} => {
  const entries: PowerPointElementEntry[] = []
  const sequenceByParent = new Map<string, string[]>()
  const visit = (
    elements: readonly PPTElement[],
    parentObjectId?: string,
    parentKey = 'root',
  ): void => {
    const sequence: string[] = []
    for (const element of elements) {
      const objectId = sourceObjectId(element)
      sequence.push(objectId ?? `mona:${element.id}`)
      entries.push({ element, parentObjectId, slideId: slide.id })
      if (element.type === 'group') {
        visit(element.elements, objectId, objectId ?? `mona:${element.id}`)
      }
    }
    sequenceByParent.set(parentKey, sequence)
  }
  visit(slide.elements)
  return { entries, sequenceByParent }
}

const collectCopyInsertionRoots = (
  slide: Slide,
): Array<{ element: PPTElement; parentObjectId?: string }> => {
  const roots: Array<{ element: PPTElement; parentObjectId?: string }> = []
  const visit = (
    elements: readonly PPTElement[],
    parentObjectId?: string,
    parentIsCopy = false,
  ): void => {
    for (const element of elements) {
      const isCopy = Boolean(element.source?.copyOnWrite)
      if (isCopy && !parentIsCopy) roots.push({ element, ...(parentObjectId ? { parentObjectId } : {}) })
      if (element.type === 'group') {
        visit(
          element.elements,
          sourceObjectId(element) ?? parentObjectId,
          parentIsCopy || isCopy,
        )
      }
    }
  }
  visit(slide.elements)
  return roots
}

const collectGeneratedInsertionRoots = (
  slide: Slide,
  baselineElementIds: ReadonlySet<string>,
): Array<{ element: PPTElement; index: number; parentObjectId?: string }> => {
  const roots: Array<{ element: PPTElement; index: number; parentObjectId?: string }> = []
  const visit = (
    elements: readonly PPTElement[],
    parentObjectId?: string,
    parentIsGenerated = false,
  ): void => {
    elements.forEach((element, index) => {
      const generated = !element.source && !baselineElementIds.has(element.id)
      if (generated && !parentIsGenerated) {
        roots.push({ element, index, ...(parentObjectId ? { parentObjectId } : {}) })
      }
      if (element.type === 'group') {
        visit(
          element.elements,
          sourceObjectId(element) ?? parentObjectId,
          parentIsGenerated || generated,
        )
      }
    })
  }
  visit(slide.elements)
  return roots
}

const transformSnapshot = (
  element: Exclude<PPTElement, { type: 'line' }>,
): PowerPointTransformSnapshot => ({
  ...('flipH' in element && element.flipH !== undefined ? { flipH: element.flipH } : {}),
  ...('flipV' in element && element.flipV !== undefined ? { flipV: element.flipV } : {}),
  height: element.height,
  left: element.left,
  rotate: element.rotate,
  top: element.top,
  width: element.width,
})

const transformChanged = (
  before: PowerPointTransformSnapshot,
  after: PowerPointTransformSnapshot,
): boolean => (
  !numberEqual(before.left, after.left)
  || !numberEqual(before.top, after.top)
  || !numberEqual(before.width, after.width)
  || !numberEqual(before.height, after.height)
  || !numberEqual(before.rotate, after.rotate)
  || Boolean(before.flipH) !== Boolean(after.flipH)
  || Boolean(before.flipV) !== Boolean(after.flipV)
)

const comparableElement = (element: PPTElement): unknown => {
  const content = structuredClone(element) as unknown as Record<string, unknown>
  for (const key of ['groupId', 'id', 'left', 'source', 'top', 'width']) {
    delete content[key]
  }
  if (element.type !== 'line') {
    for (const key of ['flipH', 'flipV', 'height', 'rotate']) delete content[key]
  }
  if (element.type === 'group') delete content.elements
  return content
}

const changedContentKeys = (
  before: PPTElement,
  after: PPTElement,
): string[] => {
  const left = comparableElement(before)
  const right = comparableElement(after)
  if (JSON.stringify(left) === JSON.stringify(right)) return []
  if (
    !left
    || !right
    || typeof left !== 'object'
    || typeof right !== 'object'
    || Array.isArray(left)
    || Array.isArray(right)
  ) return ['content']
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  return [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])]
    .filter(key => JSON.stringify(leftRecord[key]) !== JSON.stringify(rightRecord[key]))
    .sort()
}

const slidePart = (slide: Slide): string | undefined => slide.source?.slidePart

const slideIdentity = (slide: Slide): string => (
  slide.source?.packageId && slide.source.slidePart
    ? `${slide.source.packageId}\0${slide.source.slidePart}`
    : `mona:${slide.id}`
)

const unsupported = (
  code: string,
  message: string,
  options: Partial<PowerPointWritebackIssue> = {},
): PowerPointWritebackIssue => ({ code, message, ...options })

const compareSlideShell = (
  baseline: Slide,
  desired: Slide,
): PowerPointWritebackIssue[] => {
  const ignored = new Set([
    'animations', 'background', 'durationMs', 'elements', 'id', 'notes', 'remark', 'source', 'turningMode',
  ])
  const keys = [...new Set([
    ...Object.keys(baseline),
    ...Object.keys(desired),
  ])].filter(key => !ignored.has(key))
  return keys.flatMap(key => (
    JSON.stringify(
      (baseline as unknown as Record<string, unknown>)[key],
    ) === JSON.stringify(
      (desired as unknown as Record<string, unknown>)[key],
    )
      ? []
      : [unsupported(
          'pptx.writeback.slide-property',
          `The slide property "${key}" cannot be patched into the retained PowerPoint package yet.`,
          {
            partPath: baseline.source?.slidePart,
            slideId: baseline.id,
          },
        )]
  ))
}

interface FlatNoteEntry {
  content: string
  id: string
  parentId?: string
  time: number
  user: string
}

const flattenNotes = (notes: readonly Note[] | undefined): FlatNoteEntry[] => (
  (notes ?? []).flatMap(note => [
    {
      content: note.content,
      id: note.id,
      time: note.time,
      user: note.user,
    },
    ...(note.replies ?? []).map(reply => ({
      content: reply.content,
      id: reply.id,
      parentId: note.id,
      time: reply.time,
      user: reply.user,
    })),
  ])
)

const comparePresentationShell = (
  baseline: PresentationState,
  desired: PresentationState,
): PowerPointWritebackIssue[] => {
  const issues: PowerPointWritebackIssue[] = []
  if (
    !numberEqual(baseline.viewportSize, desired.viewportSize)
    || !numberEqual(baseline.viewportRatio, desired.viewportRatio)
  ) {
    issues.push(unsupported(
      'pptx.writeback.slide-size',
      'Changing the slide size of an imported PowerPoint is not writeback-safe yet.',
      { partPath: 'ppt/presentation.xml' },
    ))
  }
  return issues
}

const relativeOrder = (
  baseline: readonly string[],
  desired: readonly string[],
): boolean => {
  const baselineSet = new Set(baseline)
  const desiredSet = new Set(desired)
  return baseline.filter(objectId => desiredSet.has(objectId)).join('\0')
    === desired.filter(objectId => baselineSet.has(objectId)).join('\0')
}

const unaddressedCopySnapshot = (element: PPTElement): unknown => {
  const clone = structuredClone(element) as unknown as Record<string, unknown>
  const strip = (candidate: Record<string, unknown>): void => {
    delete candidate.id
    delete candidate.source
    delete candidate.groupId
    if (candidate.type === 'group' && Array.isArray(candidate.elements)) {
      for (const child of candidate.elements) {
        if (child && typeof child === 'object' && !Array.isArray(child)) {
          strip(child as Record<string, unknown>)
        }
      }
    }
  }
  strip(clone)
  return clone
}

const unaddressedCopyPayloadIsUnchanged = (
  before: PPTElement,
  after: PPTElement,
): boolean => {
  if (before.type !== after.type) return false
  if (!after.source?.copyOnWrite) {
    if (before.source?.sourceObjectId) return false
    return JSON.stringify(unaddressedCopySnapshot(before))
      === JSON.stringify(unaddressedCopySnapshot(after))
  }
  if (before.type !== 'group' || after.type !== 'group') return true
  if (before.elements.length !== after.elements.length) return false
  return before.elements.every((child, index) => (
    Boolean(after.elements[index])
    && unaddressedCopyPayloadIsUnchanged(child, after.elements[index]!)
  ))
}

const layerShell = (layer: Record<string, unknown>): Record<string, unknown> => {
  const clone = structuredClone(layer)
  delete clone.background
  delete clone.elements
  delete clone.headerFooter
  return clone
}

const validHeaderFooterPolicy = (value: unknown): value is PowerPointHeaderFooterPolicy => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return ['dateTime', 'footer', 'header', 'slideNumber'].every(key => (
    typeof candidate[key] === 'boolean'
  ))
}

const asSlideLocalLayerElements = (
  elements: readonly PPTElement[],
  partPath: string,
): PPTElement[] => structuredClone(elements).map(function rewrite(element): PPTElement {
  const next = {
    ...element,
    ...(element.source
      ? {
          source: {
            ...element.source,
            slidePart: partPath,
            sourceLayer: 'slide' as const,
            sourcePart: partPath,
          },
        }
      : {}),
  } as PPTElement
  if (next.type === 'group') next.elements = next.elements.map(rewrite)
  return next
})

const sharedLayerAnalysis = (
  baseline: PresentationState,
  desired: PresentationState,
  packageId: string,
): PowerPointWritebackPlan => {
  const baselinePackage = baseline.sourcePackages?.find(source => source.packageId === packageId)
  const desiredPackage = desired.sourcePackages?.find(source => source.packageId === packageId)
  const operations: PowerPointPatchOperation[] = []
  const sharedIssues: PowerPointWritebackIssue[] = []
  if (!baselinePackage?.hierarchy || !desiredPackage?.hierarchy) {
    if (changed(baselinePackage?.hierarchy, desiredPackage?.hierarchy)) {
      sharedIssues.push(unsupported(
        'pptx.writeback.shared-hierarchy',
        'The retained PowerPoint hierarchy cannot be added or removed during writeback.',
      ))
    }
    return {
      mode: sharedIssues.length ? 'unsupported' : 'noop',
      operations,
      touchedParts: [],
      unsupported: sharedIssues,
    }
  }

  for (const key of ['defaultTextStyle', 'placeholders', 'themes'] as const) {
    if (changed(baselinePackage.hierarchy[key], desiredPackage.hierarchy[key])) {
      sharedIssues.push(unsupported(
        'pptx.writeback.shared-hierarchy-metadata',
        `The shared hierarchy field "${key}" is retained metadata and cannot be authored through the layer workspace.`,
      ))
    }
  }
  const baselineLayers = [
    ...baselinePackage.hierarchy.masters,
    ...baselinePackage.hierarchy.layouts,
  ] as unknown as Array<Record<string, unknown>>
  const desiredLayers = [
    ...desiredPackage.hierarchy.masters,
    ...desiredPackage.hierarchy.layouts,
  ] as unknown as Array<Record<string, unknown>>
  const baselineByPart = new Map(baselineLayers.flatMap(layer => (
    typeof layer.partPath === 'string' ? [[layer.partPath, layer] as const] : []
  )))
  const desiredByPart = new Map(desiredLayers.flatMap(layer => (
    typeof layer.partPath === 'string' ? [[layer.partPath, layer] as const] : []
  )))
  if (
    baselineByPart.size !== baselineLayers.length
    || desiredByPart.size !== desiredLayers.length
    || baselineByPart.size !== desiredByPart.size
    || [...baselineByPart.keys()].some(part => !desiredByPart.has(part))
  ) {
    sharedIssues.push(unsupported(
      'pptx.writeback.shared-layer-structure',
      'Adding, removing, or reassigning PowerPoint master/layout parts is not supported.',
    ))
  }

  const explicitlyAuthored = new Set(desiredPackage.sharedAuthoring?.partPaths ?? [])
  const masterParts = new Set(baselinePackage.hierarchy.masters.map(master => master.partPath))
  for (const [partPath, baselineLayer] of baselineByPart) {
    const desiredLayer = desiredByPart.get(partPath)
    if (!desiredLayer || !changed(baselineLayer, desiredLayer)) continue
    if (!explicitlyAuthored.has(partPath)) {
      sharedIssues.push(unsupported(
        'pptx.writeback.shared-layer-intent',
        'A master/layout part changed outside the explicit shared-layer authoring surface.',
        { partPath },
      ))
      continue
    }
    if (changed(layerShell(baselineLayer), layerShell(desiredLayer))) {
      sharedIssues.push(unsupported(
        'pptx.writeback.shared-layer-identity',
        'PowerPoint master/layout identity fields are immutable; only backgrounds, drawing elements, and master header/footer policy are authorable.',
        { partPath },
      ))
      continue
    }
    if (changed(baselineLayer.headerFooter, desiredLayer.headerFooter)) {
      if (!masterParts.has(partPath)) {
        sharedIssues.push(unsupported(
          'pptx.writeback.header-footer-layer',
          'Header/footer policy can only be authored on a PowerPoint slide master.',
          { partPath },
        ))
        continue
      }
      if (
        desiredLayer.headerFooter !== undefined
        && !validHeaderFooterPolicy(desiredLayer.headerFooter)
      ) {
        sharedIssues.push(unsupported(
          'pptx.writeback.header-footer-policy',
          'Header/footer policy requires boolean dateTime, footer, header, and slideNumber values.',
          { partPath },
        ))
        continue
      }
      const beforePolicy = validHeaderFooterPolicy(baselineLayer.headerFooter)
        ? baselineLayer.headerFooter
        : undefined
      const afterPolicy = validHeaderFooterPolicy(desiredLayer.headerFooter)
        ? desiredLayer.headerFooter
        : undefined
      operations.push({
        ...(afterPolicy
          ? { after: structuredClone(afterPolicy) }
          : {}),
        ...(beforePolicy
          ? { before: structuredClone(beforePolicy) }
          : {}),
        kind: 'header-footer',
        partPath,
      })
    }
    const baselineElements = Array.isArray(baselineLayer.elements)
      ? baselineLayer.elements as PPTElement[]
      : []
    const desiredElements = Array.isArray(desiredLayer.elements)
      ? desiredLayer.elements as PPTElement[]
      : []
    const shell = baseline.slides[0] ?? { elements: [], id: 'shared-layer-shell' }
    const baselineSlide: Slide = {
      ...structuredClone(shell),
      elements: asSlideLocalLayerElements(baselineElements, partPath),
      id: `shared:${partPath}`,
      source: { kind: 'pptx', packageId, slidePart: partPath },
    }
    const desiredSlide: Slide = {
      ...structuredClone(shell),
      elements: asSlideLocalLayerElements(desiredElements, partPath),
      id: `shared:${partPath}`,
      source: { kind: 'pptx', packageId, slidePart: partPath },
    }
    if (baselineLayer.background) {
      baselineSlide.background = structuredClone(baselineLayer.background) as Slide['background']
    }
    else delete baselineSlide.background
    if (desiredLayer.background) {
      desiredSlide.background = structuredClone(desiredLayer.background) as Slide['background']
    }
    else delete desiredSlide.background
    const synthetic = analyzePowerPointWriteback(
      { ...baseline, slides: [baselineSlide] },
      { ...baseline, slides: [desiredSlide] },
      packageId,
      false,
    )
    operations.push(...synthetic.operations)
    sharedIssues.push(...synthetic.unsupported)
  }
  return {
    mode: sharedIssues.length ? 'unsupported' : operations.length ? 'patch' : 'noop',
    operations,
    touchedParts: [],
    unsupported: sharedIssues,
  }
}

export const analyzePowerPointWriteback = (
  baseline: PresentationState,
  presentation: PresentationState,
  packageId: string,
  includeSharedLayers = true,
): PowerPointWritebackPlan => {
  const operations: PowerPointPatchOperation[] = []
  const issues = comparePresentationShell(baseline, presentation)
  const sourcePackage = baseline.sourcePackages?.find(source => source.packageId === packageId)
  const plannedParts = new Set<string>([
    ...(sourcePackage?.slides.flatMap(slide => [
      slide.slidePart,
      slide.layoutPart,
      slide.masterPart,
      slide.notesPart,
      slide.themePart,
    ].filter((part): part is string => Boolean(part))) ?? []),
    ...(sourcePackage?.hierarchy?.themes.map(theme => theme.partPath) ?? []),
    ...(sourcePackage?.document?.notesMasters.map(master => master.partPath) ?? []),
    ...(sourcePackage?.document?.notesSlides.map(notes => notes.partPath) ?? []),
    ...(sourcePackage?.document?.comments.map(comment => comment.partPath) ?? []),
  ])
  if (changed(baseline.theme, presentation.theme)) {
    const themeParts = [...new Set(
      sourcePackage?.hierarchy?.themes
        .filter(theme => !theme.isOverride)
        .map(theme => theme.partPath) ?? [],
    )]
    if (!themeParts.length) {
      issues.push(unsupported(
        'pptx.writeback.theme-part',
        'The imported presentation has no retained base theme part to author.',
        { partPath: 'ppt/theme' },
      ))
    }
    else {
      for (const partPath of themeParts) {
        operations.push({
          after: structuredClone(presentation.theme),
          before: structuredClone(baseline.theme),
          kind: 'theme',
          partPath,
        })
      }
    }
  }
  const baselineSlides = baseline.slides.filter(slide => slide.source?.packageId === packageId)
  const desiredSlides = presentation.slides.filter(slide => slide.source?.packageId === packageId)
  const desiredCommentAuthors = [...new Set(desiredSlides.flatMap(slide => (
    flattenNotes(slide.notes).map(note => note.user || 'Mona')
  )))].sort((left, right) => left.localeCompare(right))
  const commentIndexByKey = new Map<string, number>()
  const commentIndexByAuthor = new Map<string, number>()
  for (const slide of desiredSlides) {
    for (const note of flattenNotes(slide.notes)) {
      const user = note.user || 'Mona'
      const index = (commentIndexByAuthor.get(user) ?? 0) + 1
      commentIndexByAuthor.set(user, index)
      commentIndexByKey.set(note.id, index)
    }
  }
  const desiredExactSlides = desiredSlides.filter(slide => !slide.source?.copyOnWrite)
  const desiredSlideCopies = desiredSlides.filter(slide => Boolean(slide.source?.copyOnWrite))
  const desiredByPart = new Map(desiredExactSlides.map(slide => [slidePart(slide), slide]))
  const knownSourceObjectIds = new Set<string>()
  const originElementByObjectId = new Map<string, PPTElement>()
  for (const slide of baselineSlides) {
    for (const element of flattenElementTree(slide.elements)) {
      if (element.source?.sourceObjectId) {
        knownSourceObjectIds.add(element.source.sourceObjectId)
        originElementByObjectId.set(element.source.sourceObjectId, element)
      }
    }
  }
  for (const layer of [
    ...(sourcePackage?.hierarchy?.masters ?? []),
    ...(sourcePackage?.hierarchy?.layouts ?? []),
  ]) {
    for (const element of flattenElementTree(layer.elements ?? [])) {
      if (element.source?.sourceObjectId) {
        knownSourceObjectIds.add(element.source.sourceObjectId)
        originElementByObjectId.set(element.source.sourceObjectId, element)
      }
    }
  }

  const baselineOrder = baselineSlides.map(slideIdentity)
  const desiredExistingOrder = desiredExactSlides.map(slideIdentity)
  const baselineIdentities = new Set(baselineOrder)
  const desiredExistingIdentities = new Set(desiredExistingOrder)
  const unsupportedNewSlides = presentation.slides.filter(slide => (
    slide.source?.packageId === packageId
      ? !baselineIdentities.has(slideIdentity(slide)) && !slide.source.copyOnWrite
      : !baseline.slides.some(candidate => candidate.id === slide.id)
  ))
  if (
    JSON.stringify(baselineOrder) !== JSON.stringify(desiredExistingOrder)
    || unsupportedNewSlides.length
    || baselineSlides.some(slide => !desiredExistingIdentities.has(slideIdentity(slide)))
  ) {
    issues.push(unsupported(
      'pptx.writeback.slide-structure',
      'Deleting, reordering, or inserting a slide without one retained native clone origin is not writeback-safe yet.',
      { partPath: 'ppt/presentation.xml' },
    ))
  }
  for (const slide of desiredSlideCopies) {
    const sourcePart = slide.source?.copyOnWrite?.sourceSlidePart
    const sourceSlide = baselineSlides.find(candidate => candidate.source?.slidePart === sourcePart)
    if (!sourcePart || !sourceSlide || slide.source?.copyOnWrite?.packageId !== packageId) {
      issues.push(unsupported(
        'pptx.writeback.slide-copy-origin',
        'A duplicated slide no longer resolves to one retained native slide part.',
        { partPath: sourcePart, slideId: slide.id },
      ))
      continue
    }
    issues.push(...compareSlideShell(sourceSlide, slide))
    if (changed(sourceSlide.notes ?? [], slide.notes ?? [])) {
      issues.push(unsupported(
        'pptx.writeback.slide-copy-comments',
        'Changing comments while duplicating a native slide requires comment-author allocation.',
        { partPath: sourcePart, slideId: slide.id },
      ))
    }
    const sourceElements = flattenElementTree(sourceSlide.elements)
    for (const [elementIndex, element] of flattenElementTree(slide.elements).entries()) {
      const origin = element.source?.copyOnWrite
      if (!origin) {
        const sourceElement = sourceElements[elementIndex]
        if (
          sourceElement
          && !sourceElement.source?.sourceObjectId
          && JSON.stringify(unaddressedCopySnapshot(sourceElement))
            === JSON.stringify(unaddressedCopySnapshot(element))
        ) continue
        if (!element.source && element.type !== 'opaque') continue
        issues.push(unsupported(
          'pptx.writeback.slide-copy-element-added',
          'Every object on a copied native slide must retain an exact native copy origin.',
          { elementId: element.id, partPath: sourcePart, slideId: slide.id },
        ))
        continue
      }
      if (origin.packageId !== packageId || !knownSourceObjectIds.has(origin.sourceObjectId)) {
        issues.push(unsupported(
          'pptx.writeback.slide-copy-element-origin',
          'An object on the copied slide no longer resolves to one retained native PowerPoint object.',
          {
            elementId: element.id,
            objectId: origin.sourceObjectId,
            partPath: origin.sourcePart,
            slideId: slide.id,
          },
        ))
      }
    }
    operations.push({
      after: structuredClone(slide),
      before: structuredClone(sourceSlide),
      index: presentation.slides.indexOf(slide),
      ...(sourcePackage ? {
        inheritedBefore: resolveSlideRenderState(sourceSlide, [sourcePackage]).nodes
          .filter(node => node.layer !== 'slide')
          .map(node => structuredClone(node.element)),
      } : {}),
      kind: 'insert-slide',
      slideId: slide.id,
      sourcePart,
    })
  }

  for (const baselineSlide of baselineSlides) {
    const partPath = slidePart(baselineSlide)
    const desiredSlide = desiredByPart.get(partPath)
    if (!partPath || !desiredSlide) continue
    issues.push(...compareSlideShell(baselineSlide, desiredSlide))
    if (changed(
      baselineSlide.source?.hiddenInheritedObjectIds ?? [],
      desiredSlide.source?.hiddenInheritedObjectIds ?? [],
    )) {
      const dependency = sourcePackage?.slides.find(slide => slide.slidePart === partPath)
      if (!dependency?.layoutPart) {
        issues.push(unsupported(
          'pptx.writeback.inherited-visibility-layout',
          'The slide has no exact native layout from which a private visibility layer can be derived.',
          { partPath, slideId: baselineSlide.id },
        ))
      }
      else {
        operations.push({
          hiddenObjectIds: structuredClone(desiredSlide.source?.hiddenInheritedObjectIds ?? []),
          kind: 'inherited-visibility',
          layoutPart: dependency.layoutPart,
          ...(dependency.masterPart ? { masterPart: dependency.masterPart } : {}),
          partPath,
          slideId: baselineSlide.id,
        })
      }
    }
    if (changed(baselineSlide.background, desiredSlide.background)) {
      operations.push({
        ...(desiredSlide.background ? { after: structuredClone(desiredSlide.background) } : {}),
        ...(baselineSlide.background ? { before: structuredClone(baselineSlide.background) } : {}),
        kind: 'background',
        partPath,
        slideId: baselineSlide.id,
      })
    }
    if (changed(baselineSlide.animations ?? [], desiredSlide.animations ?? [])) {
      const targets: Record<string, string> = {}
      for (const animation of desiredSlide.animations ?? []) {
        const element = flattenElementTree(desiredSlide.elements).find(candidate => (
          candidate.id === animation.elId
        ))
        if (!element) {
          issues.push(unsupported(
            'pptx.writeback.animation-target',
            `Animation ${animation.id} targets an element that is not on the slide.`,
            { partPath, slideId: baselineSlide.id },
          ))
          continue
        }
        if (element.source?.copyOnWrite) {
          issues.push(unsupported(
            'pptx.writeback.animation-copy-target',
            'Animations on newly copied native objects require their post-allocation shape identity.',
            { elementId: element.id, partPath, slideId: baselineSlide.id },
          ))
          continue
        }
        targets[element.id] = element.source?.nativeShapeId ?? `generated:${element.id}`
      }
      operations.push({
        after: structuredClone(desiredSlide.animations ?? []),
        before: structuredClone(baselineSlide.animations ?? []),
        kind: 'timing',
        partPath,
        slideId: baselineSlide.id,
        targets,
      })
    }
    if (
      baselineSlide.turningMode !== desiredSlide.turningMode
      || baselineSlide.durationMs !== desiredSlide.durationMs
    ) {
      const supportedModes = new Set(['fade', 'no', 'random', 'slideX', 'slideY'])
      if (desiredSlide.turningMode && !supportedModes.has(desiredSlide.turningMode)) {
        issues.push(unsupported(
          'pptx.writeback.transition-mode',
          `The Mona transition "${desiredSlide.turningMode}" has no exact native PowerPoint mapping.`,
          { partPath, slideId: baselineSlide.id },
        ))
      }
      else {
        operations.push({
          after: {
            ...(desiredSlide.durationMs !== undefined ? { durationMs: desiredSlide.durationMs } : {}),
            ...(desiredSlide.turningMode ? { turningMode: desiredSlide.turningMode } : {}),
          },
          before: {
            ...(baselineSlide.durationMs !== undefined ? { durationMs: baselineSlide.durationMs } : {}),
            ...(baselineSlide.turningMode ? { turningMode: baselineSlide.turningMode } : {}),
          },
          kind: 'transition',
          partPath,
          slideId: baselineSlide.id,
        })
      }
    }
    if ((baselineSlide.remark ?? '') !== (desiredSlide.remark ?? '')) {
      const notesPart = sourcePackage?.slides.find(slide => slide.slidePart === partPath)?.notesPart
      if (!notesPart) {
        const allocated = nextPlannedPart(plannedParts, 'ppt/notesSlides', 'notesSlide')
        operations.push({
          after: desiredSlide.remark ?? '',
          before: baselineSlide.remark ?? '',
          kind: 'notes',
          notesPart: allocated,
          partPath: allocated,
          ...(sourcePackage?.coordinateScale ? { scale: sourcePackage.coordinateScale } : {}),
          slideId: baselineSlide.id,
          slidePart: partPath,
        })
      }
      else {
        operations.push({
          after: desiredSlide.remark ?? '',
          before: baselineSlide.remark ?? '',
          kind: 'notes',
          notesPart,
          partPath: notesPart,
          ...(sourcePackage?.coordinateScale ? { scale: sourcePackage.coordinateScale } : {}),
          slideId: baselineSlide.id,
          slidePart: partPath,
        })
      }
    }
    if (JSON.stringify(baselineSlide.notes ?? []) !== JSON.stringify(desiredSlide.notes ?? [])) {
      const sourceComments = sourcePackage?.document?.comments.filter(comment => (
        comment.slidePart === partPath
      )) ?? []
      const desiredNotes = flattenNotes(desiredSlide.notes)
      const sourceByNoteId = new Map(sourceComments.map(comment => (
        [powerPointCommentNoteId(comment), comment] as const
      )))
      const legacyPart = sourceComments.find(comment => /^ppt\/comments\//i.test(comment.partPath))?.partPath
      const commentPart = legacyPart
        ?? nextPlannedPart(plannedParts, 'ppt/comments', 'comment')
      operations.push({
        authors: desiredCommentAuthors,
        authorsPart: 'ppt/commentAuthors.xml',
        comments: desiredNotes.map(note => {
          const sourceComment = sourceByNoteId.get(note.id)
          return {
            content: note.content,
            index: commentIndexByKey.get(note.id) ?? 1,
            key: note.id,
            ...(note.parentId ? { parentKey: note.parentId } : {}),
            ...(sourceComment?.position ? { position: structuredClone(sourceComment.position) } : {}),
            ...(sourceComment?.status ? { status: sourceComment.status } : {}),
            time: note.time,
            user: note.user || 'Mona',
          }
        }),
        kind: 'comments',
        partPath: commentPart,
        ...(sourceComments.some(comment => comment.partPath !== commentPart)
          ? { removePartPaths: [...new Set(sourceComments.map(comment => comment.partPath).filter(path => path !== commentPart))] }
          : {}),
        slideId: baselineSlide.id,
        slidePart: partPath,
      })
    }
    const baselineTree = collectElements(baselineSlide)
    const desiredTree = collectElements(desiredSlide)
    const baselineByObject = new Map(
      baselineTree.entries.flatMap(entry => {
        const objectId = sourceObjectId(entry.element)
        return objectId ? [[objectId, entry] as const] : []
      }),
    )
    const desiredByObject = new Map(
      desiredTree.entries.flatMap(entry => {
        const objectId = sourceObjectId(entry.element)
        return objectId ? [[objectId, entry] as const] : []
      }),
    )
    const baselineById = new Map(
      baselineTree.entries.map(entry => [entry.element.id, entry] as const),
    )
    const desiredById = new Map(
      desiredTree.entries.map(entry => [entry.element.id, entry] as const),
    )
    const insertionRootById = new Map(
      collectCopyInsertionRoots(desiredSlide).map(entry => [entry.element.id, entry]),
    )
    const insertionTreeIds = new Set(
      [...insertionRootById.values()].flatMap(entry => (
        flattenElementTree([entry.element]).map(element => element.id)
      )),
    )
    const generatedInsertionRootById = new Map(
      collectGeneratedInsertionRoots(desiredSlide, new Set(baselineById.keys()))
        .map(entry => [entry.element.id, entry]),
    )
    const generatedInsertionTreeIds = new Set(
      [...generatedInsertionRootById.values()].flatMap(entry => (
        flattenElementTree([entry.element]).map(element => element.id)
      )),
    )

    for (const desiredEntry of desiredTree.entries) {
      const source = desiredEntry.element.source
      if (source?.copyOnWrite) {
        const origin = source.copyOnWrite
        if (
          origin.packageId !== packageId
          || !knownSourceObjectIds.has(origin.sourceObjectId)
        ) {
          issues.push(unsupported(
            'pptx.writeback.copy-origin',
            'A source-backed copy no longer resolves to one retained native PowerPoint object.',
            {
              elementId: desiredEntry.element.id,
              objectId: origin.sourceObjectId,
              partPath: origin.sourcePart,
              slideId: desiredSlide.id,
            },
          ))
        }
        else if (insertionRootById.has(desiredEntry.element.id)) {
          const before = originElementByObjectId.get(origin.sourceObjectId)
          if (!before || !partPath) {
            issues.push(unsupported(
              'pptx.writeback.copy-origin-model',
              'The retained native copy origin has no semantic source element or target slide part.',
              {
                elementId: desiredEntry.element.id,
                objectId: origin.sourceObjectId,
                partPath: origin.sourcePart,
                slideId: desiredSlide.id,
              },
            ))
          }
          else {
            const insertion = insertionRootById.get(desiredEntry.element.id)!
            if (!unaddressedCopyPayloadIsUnchanged(before, desiredEntry.element)) {
              issues.push(unsupported(
                'pptx.writeback.copy-unaddressable-child',
                'An unaddressable child inside the copied native object was changed or structurally replaced.',
                {
                  elementId: desiredEntry.element.id,
                  objectId: origin.sourceObjectId,
                  partPath: origin.sourcePart,
                  slideId: desiredSlide.id,
                },
              ))
              continue
            }
            operations.push({
              after: structuredClone(desiredEntry.element),
              before: structuredClone(before),
              elementId: desiredEntry.element.id,
              kind: 'insert-object',
              mode: origin.mode,
              ...(insertion.parentObjectId ? { parentObjectId: insertion.parentObjectId } : {}),
              slideId: desiredSlide.id,
              sourceObjectId: origin.sourceObjectId,
              sourcePart: origin.sourcePart,
              targetPart: partPath,
            })
          }
        }
        continue
      }
      if (!source) {
        if (insertionTreeIds.has(desiredEntry.element.id)) continue
        const baselineEntry = baselineById.get(desiredEntry.element.id)
        if (
          baselineEntry
          && JSON.stringify(baselineEntry.element) === JSON.stringify(desiredEntry.element)
          && baselineEntry.parentObjectId === desiredEntry.parentObjectId
        ) {
          continue
        }
        const generatedRoot = generatedInsertionRootById.get(desiredEntry.element.id)
        if (generatedRoot && partPath && desiredEntry.element.type !== 'opaque') {
          operations.push({
            after: structuredClone(desiredEntry.element),
            elementId: desiredEntry.element.id,
            index: generatedRoot.index,
            kind: 'insert-element',
            ...(generatedRoot.parentObjectId
              ? { parentObjectId: generatedRoot.parentObjectId }
              : {}),
            slideId: desiredSlide.id,
            targetPart: partPath,
          })
        }
        else if (!generatedInsertionTreeIds.has(desiredEntry.element.id)) {
          issues.push(unsupported(
            baselineEntry
              ? 'pptx.writeback.unaddressable-object'
              : 'pptx.writeback.element-added',
            baselineEntry
              ? 'This imported object has no exact OOXML identity, so its edits cannot be written back safely.'
              : desiredEntry.element.type === 'opaque'
                ? 'An opaque object cannot be created without one retained native payload.'
                : 'The Mona-created element is not rooted in an addressable PowerPoint shape tree.',
            { elementId: desiredEntry.element.id, slideId: desiredSlide.id },
          ))
        }
        continue
      }
      if (source.packageId !== packageId || !source.sourceObjectId) {
        issues.push(unsupported(
          'pptx.writeback.element-source',
          'An edited element does not have one exact source object in this PowerPoint package.',
          {
            elementId: desiredEntry.element.id,
            objectId: source.sourceObjectId,
            partPath: source.sourcePart,
            slideId: desiredSlide.id,
          },
        ))
        continue
      }
      if (!baselineByObject.has(source.sourceObjectId)) {
        issues.push(unsupported(
          'pptx.writeback.element-source',
          'An edited element refers to a source object that is not present in the retained writeback baseline.',
          {
            elementId: desiredEntry.element.id,
            objectId: source.sourceObjectId,
            partPath: source.sourcePart,
            slideId: desiredSlide.id,
          },
        ))
      }
    }

    for (const baselineEntry of baselineTree.entries) {
      if (
        !baselineEntry.element.source
        && !desiredById.has(baselineEntry.element.id)
      ) {
        issues.push(unsupported(
          'pptx.writeback.unaddressable-object',
          'This imported object has no exact OOXML identity, so it cannot be deleted safely.',
          {
            elementId: baselineEntry.element.id,
            slideId: baselineSlide.id,
          },
        ))
      }
    }

    for (const [parent, baselineOrder] of baselineTree.sequenceByParent) {
      const desiredOrder = desiredTree.sequenceByParent.get(parent) ?? []
      if (!relativeOrder(baselineOrder, desiredOrder)) {
        issues.push(unsupported(
          'pptx.writeback.element-order',
          'Changing PowerPoint object stacking or group membership is not writeback-safe yet.',
          { partPath, slideId: baselineSlide.id },
        ))
      }
    }

    const deletedObjects = new Set(
      [...baselineByObject.keys()].filter(objectId => !desiredByObject.has(objectId)),
    )
    for (const objectId of deletedObjects) {
      const entry = baselineByObject.get(objectId)!
      if (entry.parentObjectId && deletedObjects.has(entry.parentObjectId)) continue
      const source = entry.element.source!
      if (
        source.sourceLayer !== 'slide'
        || source.sourcePart !== baselineSlide.source?.slidePart
      ) {
        issues.push(unsupported(
          'pptx.writeback.inherited-object',
          'Inherited, layout, master, or linked drawing objects cannot be deleted from the slide package directly.',
          {
            elementId: entry.element.id,
            objectId,
            partPath: source.sourcePart,
            slideId: baselineSlide.id,
          },
        ))
        continue
      }
      operations.push({
        elementId: entry.element.id,
        kind: 'delete',
        objectId,
        partPath: source.sourcePart!,
        slideId: baselineSlide.id,
      })
    }

    for (const [objectId, baselineEntry] of baselineByObject) {
      const desiredEntry = desiredByObject.get(objectId)
      if (!desiredEntry) continue
      const beforeElement = baselineEntry.element
      const afterElement = desiredEntry.element
      const source = beforeElement.source!
      if (beforeElement.type !== afterElement.type) {
        issues.push(unsupported(
          'pptx.writeback.element-type',
          'Changing the semantic type of an imported PowerPoint object is not supported.',
          {
            elementId: afterElement.id,
            objectId,
            partPath: source.sourcePart,
            slideId: baselineSlide.id,
          },
        ))
        continue
      }
      if (JSON.stringify(source) !== JSON.stringify(afterElement.source)) {
        issues.push(unsupported(
          'pptx.writeback.element-source',
          'PowerPoint source provenance is immutable and cannot be reassigned to another package object.',
          {
            elementId: afterElement.id,
            objectId,
            partPath: source.sourcePart,
            slideId: baselineSlide.id,
          },
        ))
        continue
      }
      const contentKeys = changedContentKeys(beforeElement, afterElement)
      const lineChanged = (
        beforeElement.type === 'line'
        && JSON.stringify(beforeElement) !== JSON.stringify(afterElement)
      )
      const before = beforeElement.type === 'line'
        ? undefined
        : transformSnapshot(beforeElement)
      const after = afterElement.type === 'line'
        ? undefined
        : transformSnapshot(afterElement)
      const hasTransformChange = (
        before !== undefined
        && after !== undefined
        && transformChanged(before, after)
      )
      if (!contentKeys.length && !lineChanged && !hasTransformChange) continue
      if (
        source.sourceLayer !== 'slide'
        || source.sourcePart !== baselineSlide.source?.slidePart
      ) {
        issues.push(unsupported(
          'pptx.writeback.inherited-object',
          'Direct edits to inherited, layout, master, or linked drawing objects require an explicit source-layer editing mode.',
          {
            elementId: afterElement.id,
            objectId,
            partPath: source.sourcePart,
            slideId: baselineSlide.id,
          },
        ))
        continue
      }
      if (changed(beforeElement.accessibility, afterElement.accessibility)) {
        operations.push({
          ...(afterElement.accessibility
            ? { after: structuredClone(afterElement.accessibility) }
            : {}),
          ...(beforeElement.accessibility
            ? { before: structuredClone(beforeElement.accessibility) }
            : {}),
          elementId: afterElement.id,
          kind: 'accessibility',
          objectId,
          partPath: source.sourcePart!,
          slideId: baselineSlide.id,
        })
      }
      const effectsChanged = changed(beforeElement.effects, afterElement.effects)
      const effectsSupported = new Set([
        'audio', 'group', 'image', 'line', 'shape', 'text', 'video',
      ]).has(beforeElement.type)
      const changesEffectDagTopology = Boolean(
        effectsChanged
        && source.visual?.hasEffectDag
        && changed(effectKinds(beforeElement), effectKinds(afterElement)),
      )
      if (changesEffectDagTopology) {
        issues.push(unsupported(
          'pptx.writeback.effect-dag-topology',
          'Adding or removing effects would change this composited DrawingML effect graph. Existing supported graph effects may be edited in place.',
          {
            elementId: afterElement.id,
            objectId,
            partPath: source.sourcePart,
            slideId: baselineSlide.id,
          },
        ))
      }
      else if (effectsChanged && effectsSupported) {
        const afterOuterShadow = outerShadowSnapshot(afterElement)
        const beforeOuterShadow = outerShadowSnapshot(beforeElement)
        operations.push({
          ...(afterElement.effects ? { after: structuredClone(afterElement.effects) } : {}),
          ...(afterOuterShadow ? { afterOuterShadow: structuredClone(afterOuterShadow) } : {}),
          ...(beforeElement.effects ? { before: structuredClone(beforeElement.effects) } : {}),
          ...(beforeOuterShadow ? { beforeOuterShadow: structuredClone(beforeOuterShadow) } : {}),
          elementId: afterElement.id,
          kind: 'effects',
          objectId,
          partPath: source.sourcePart!,
          ...(sourcePackage?.coordinateScale
            ? { scale: sourcePackage.coordinateScale }
            : {}),
          slideId: baselineSlide.id,
        })
      }
      else if (effectsChanged) {
        issues.push(unsupported(
          'pptx.writeback.effect-target',
          `Native advanced effects are not editable on ${beforeElement.type} objects.`,
          {
            elementId: afterElement.id,
            objectId,
            partPath: source.sourcePart,
            slideId: baselineSlide.id,
          },
        ))
      }
      const threeDChanged = changed(beforeElement.threeD, afterElement.threeD)
      const threeDSupported = new Set(['group', 'image', 'shape', 'text']).has(beforeElement.type)
      const materializeInheritedThreeD = Boolean(
        effectsChanged
        && afterElement.threeD
        && (source.effectReference?.index ?? 0) > 0
        && (source.visual?.hasScene3d || source.visual?.hasShape3d),
      )
      if (
        threeDChanged
        && beforeElement.threeD
        && !afterElement.threeD
        && (source.effectReference?.index ?? 0) > 0
      ) {
        issues.push(unsupported(
          'pptx.writeback.three-d-inherited-removal',
          'Removing theme-inherited 3D would reveal the same theme style. Edit its values or explicitly change the source theme instead.',
          {
            elementId: afterElement.id,
            objectId,
            partPath: source.sourcePart,
            slideId: baselineSlide.id,
          },
        ))
      }
      else if ((threeDChanged || materializeInheritedThreeD) && threeDSupported) {
        operations.push({
          ...(afterElement.threeD ? { after: structuredClone(afterElement.threeD) } : {}),
          ...(beforeElement.threeD ? { before: structuredClone(beforeElement.threeD) } : {}),
          elementId: afterElement.id,
          kind: 'three-d',
          ...(materializeInheritedThreeD ? { materializeInherited: true } : {}),
          objectId,
          partPath: source.sourcePart!,
          ...(sourcePackage?.coordinateScale
            ? { scale: sourcePackage.coordinateScale }
            : {}),
          slideId: baselineSlide.id,
        })
      }
      else if (threeDChanged) {
        issues.push(unsupported(
          'pptx.writeback.three-d-target',
          `Native 3D is not supported on ${beforeElement.type} objects.`,
          {
            elementId: afterElement.id,
            objectId,
            partPath: source.sourcePart,
            slideId: baselineSlide.id,
          },
        ))
      }
      if (beforeElement.type === 'line' && afterElement.type === 'line') {
        const beforeConnector = connectorSnapshot(beforeElement)
        const afterConnector = connectorSnapshot(afterElement)
        const beforeStart = connectorAbsolutePoint(beforeConnector, 'start')
        const beforeEnd = connectorAbsolutePoint(beforeConnector, 'end')
        const afterStart = connectorAbsolutePoint(afterConnector, 'start')
        const afterEnd = connectorAbsolutePoint(afterConnector, 'end')
        const startMoved = !pointEqual(beforeStart, afterStart)
        const endMoved = !pointEqual(beforeEnd, afterEnd)
        const routeChanged = changed(connectorRoute(beforeConnector), connectorRoute(afterConnector))
        const geometryChanged = startMoved || endMoved || routeChanged
        const relationshipsChanged = changed(
          beforeConnector.connections,
          afterConnector.connections,
        )
        const styleChanged = (
          !numberEqual(beforeConnector.width, afterConnector.width)
          || beforeConnector.color !== afterConnector.color
          || beforeConnector.style !== afterConnector.style
          || changed(beforeConnector.points, afterConnector.points)
        )
        const shadowChanged = changed(beforeElement.shadow, afterElement.shadow)
        const allowedLineKeys = new Set([
          'broken',
          'broken2',
          'broken2Direction',
          'accessibility',
          'color',
          'connections',
          'cubic',
          'curve',
          'end',
          'effects',
          'points',
          'powerPointGeometry',
          'shadow',
          'start',
          'style',
        ])
        const unsupportedLineKeys = contentKeys.filter(key => !allowedLineKeys.has(key))
        if (unsupportedLineKeys.length) {
          issues.push(unsupported(
            'pptx.writeback.element-content',
            `The imported line changed unsupported properties: ${unsupportedLineKeys.join(', ')}.`,
            {
              elementId: afterElement.id,
              objectId,
              partPath: source.sourcePart,
              slideId: baselineSlide.id,
            },
          ))
        }
        if (shadowChanged) {
          issues.push(unsupported(
            'pptx.writeback.connector-effect',
            'Connector outer-shadow writeback is not enabled yet.',
            {
              elementId: afterElement.id,
              objectId,
              partPath: source.sourcePart,
              slideId: baselineSlide.id,
            },
          ))
        }
        if (
          source.connector?.start
          && startMoved
          && JSON.stringify(afterConnector.connections?.start)
            === JSON.stringify(source.connector.start)
        ) {
          issues.push(unsupported(
            'pptx.writeback.connector-start-relationship',
            'The connector start is attached to a PowerPoint shape. Move or detach that relationship explicitly before changing the endpoint.',
            {
              elementId: afterElement.id,
              objectId,
              partPath: source.sourcePart,
              slideId: baselineSlide.id,
            },
          ))
        }
        if (
          source.connector?.end
          && endMoved
          && JSON.stringify(afterConnector.connections?.end)
            === JSON.stringify(source.connector.end)
        ) {
          issues.push(unsupported(
            'pptx.writeback.connector-end-relationship',
            'The connector end is attached to a PowerPoint shape. Move or detach that relationship explicitly before changing the endpoint.',
            {
              elementId: afterElement.id,
              objectId,
              partPath: source.sourcePart,
              slideId: baselineSlide.id,
            },
          ))
        }
        if (geometryChanged && !sourcePackage?.coordinateScale) {
          issues.push(unsupported(
            'pptx.writeback.connector-scale',
            'This retained PowerPoint predates exact connector coordinate metadata and must be reimported before its line geometry can be edited.',
            {
              elementId: afterElement.id,
              objectId,
              partPath: source.sourcePart,
              slideId: baselineSlide.id,
            },
          ))
        }
        for (const [endpointName, endpoint] of Object.entries(
          afterConnector.connections ?? {},
        )) {
          if (!endpoint) continue
          const target = baselineByObject.get(endpoint.targetObjectId ?? '')
          if (
            !endpoint.nativeShapeId
            || endpoint.siteIndex === undefined
            || (endpoint.targetObjectId && !target)
            || (target && target.element.source?.sourcePart !== source.sourcePart)
          ) {
            issues.push(unsupported(
              'pptx.writeback.connector-relationship-target',
              `The connector ${endpointName} attachment does not resolve to an exact shape and connection site in the same PowerPoint shape tree.`,
              {
                elementId: afterElement.id,
                objectId,
                partPath: source.sourcePart,
                slideId: baselineSlide.id,
              },
            ))
          }
        }
        if (geometryChanged || styleChanged || relationshipsChanged) {
          operations.push({
            after: afterConnector,
            before: beforeConnector,
            elementId: afterElement.id,
            kind: 'connector',
            objectId,
            ...(baselineEntry.parentObjectId
              ? { parentObjectId: baselineEntry.parentObjectId }
              : {}),
            partPath: source.sourcePart!,
            ...(sourcePackage?.coordinateScale
              ? { scale: sourcePackage.coordinateScale }
              : {}),
            slideId: baselineSlide.id,
          })
        }
        continue
      }
      if (beforeElement.type === 'chart' && afterElement.type === 'chart') {
        const beforeChart = chartSnapshot(beforeElement)
        const afterChart = chartSnapshot(afterElement)
        const chartChanged = changed(beforeChart, afterChart)
        if (changed(beforeElement.chartSource, afterElement.chartSource)) {
          issues.push(unsupported(
            'pptx.writeback.chart-source',
            'PowerPoint chart-part and workbook addresses are immutable source provenance.',
            {
              elementId: afterElement.id,
              objectId,
              partPath: source.sourcePart,
              slideId: baselineSlide.id,
            },
          ))
        }
        if (chartChanged) {
          const chartPart = beforeElement.chartSource?.partPath
          if (!chartPart) {
            issues.push(unsupported(
              'pptx.writeback.chart-part',
              'The imported chart has no exact native chart-part address.',
              {
                elementId: afterElement.id,
                objectId,
                partPath: source.sourcePart,
                slideId: baselineSlide.id,
              },
            ))
          }
          else if (
            beforeElement.chartSource?.externalWorkbook
            && changed(beforeChart.data, afterChart.data)
          ) {
            issues.push(unsupported(
              'pptx.writeback.chart-external-workbook',
              'This chart links an external workbook. Mona will not overwrite linked data without an embedded source package.',
              {
                elementId: afterElement.id,
                objectId,
                partPath: chartPart,
                slideId: baselineSlide.id,
              },
            ))
          }
          else {
            operations.push({
              after: afterChart,
              before: beforeChart,
              chartPart,
              elementId: afterElement.id,
              kind: 'chart',
              objectId,
              partPath: source.sourcePart!,
              slideId: baselineSlide.id,
              ...(beforeElement.chartSource?.workbookPart
                ? { workbookPart: beforeElement.chartSource.workbookPart }
                : {}),
            })
          }
        }
        if (hasTransformChange) {
          operations.push({
            after: after!,
            before: before!,
            elementId: afterElement.id,
            kind: 'transform',
            objectId,
            partPath: source.sourcePart!,
            slideId: baselineSlide.id,
          })
        }
        continue
      }
      if (beforeElement.type === 'image' && afterElement.type === 'image') {
        const beforeImage = imageSnapshot(beforeElement)
        const afterImage = imageSnapshot(afterElement)
        if (changed(beforeImage.src, afterImage.src)) {
          operations.push({
            after: structuredClone(afterElement),
            elementId: afterElement.id,
            kind: 'replace-element',
            objectId,
            slideId: baselineSlide.id,
            targetPart: source.sourcePart!,
          })
          continue
        }
        if (changed(beforeImage.powerPointImage, afterImage.powerPointImage)) {
          issues.push(unsupported(
            'pptx.writeback.image-source',
            'Native picture relationship, media-part, and source crop provenance are immutable.',
            {
              elementId: afterElement.id,
              objectId,
              partPath: source.sourcePart,
              slideId: baselineSlide.id,
            },
          ))
        }
        const supportedImageKeys = new Set([
          'accessibility',
          'clip',
          'effects',
          'filters',
          'opacity',
          'outline',
          'powerPointImage',
          'shadow',
          'src',
          'threeD',
        ])
        const unsupportedImageKeys = contentKeys.filter(key => !supportedImageKeys.has(key))
        if (unsupportedImageKeys.length) {
          issues.push(unsupported(
            'pptx.writeback.element-content',
            `The imported image changed unsupported properties: ${unsupportedImageKeys.join(', ')}.`,
            {
              elementId: afterElement.id,
              objectId,
              partPath: source.sourcePart,
              slideId: baselineSlide.id,
            },
          ))
        }
        if (changed(
          { ...beforeImage, powerPointImage: undefined, src: undefined },
          { ...afterImage, powerPointImage: undefined, src: undefined },
        )) {
          operations.push({
            after: afterImage,
            before: beforeImage,
            elementId: afterElement.id,
            kind: 'image',
            objectId,
            partPath: source.sourcePart!,
            ...(sourcePackage?.coordinateScale
              ? { scale: sourcePackage.coordinateScale }
              : {}),
            slideId: baselineSlide.id,
          })
        }
        if (hasTransformChange) {
          operations.push({
            after: after!,
            before: before!,
            elementId: afterElement.id,
            kind: 'transform',
            objectId,
            partPath: source.sourcePart!,
            slideId: baselineSlide.id,
          })
        }
        continue
      }
      if (beforeElement.type === 'latex' && afterElement.type === 'latex') {
        if (contentKeys.length) {
          operations.push({
            after: structuredClone(afterElement),
            elementId: afterElement.id,
            kind: 'replace-element',
            objectId,
            slideId: baselineSlide.id,
            targetPart: source.sourcePart!,
          })
        }
        else if (hasTransformChange) {
          operations.push({
            after: after!,
            before: before!,
            elementId: afterElement.id,
            kind: 'transform',
            objectId,
            partPath: source.sourcePart!,
            slideId: baselineSlide.id,
          })
        }
        continue
      }
      if (beforeElement.type === 'table' && afterElement.type === 'table') {
        const beforeTable = tableSnapshot(beforeElement)
        const afterTable = tableSnapshot(afterElement)
        const tableChanged = changed(beforeTable, afterTable)
        if (tableChanged) {
          issues.push(...tableTopologyIssues(afterElement, source.sourcePart!, baselineSlide.id))
          if (changed(beforeTable.theme, afterTable.theme)) {
            issues.push(unsupported(
              'pptx.writeback.table-theme',
              'Changing Mona table theme colors cannot be mapped to an exact PowerPoint table style ID.',
              {
                elementId: afterElement.id,
                objectId,
                partPath: source.sourcePart,
                slideId: baselineSlide.id,
              },
            ))
          }
          operations.push({
            after: afterTable,
            before: beforeTable,
            beforeWidth: beforeElement.width,
            elementId: afterElement.id,
            kind: 'table',
            objectId,
            partPath: source.sourcePart!,
            ...(sourcePackage?.coordinateScale
              ? { scale: sourcePackage.coordinateScale }
              : {}),
            slideId: baselineSlide.id,
          })
        }
        if (hasTransformChange) {
          operations.push({
            after: after!,
            before: before!,
            elementId: afterElement.id,
            kind: 'transform',
            objectId,
            partPath: source.sourcePart!,
            slideId: baselineSlide.id,
          })
        }
        continue
      }
      const beforeText = textSnapshot(beforeElement)
      const afterText = textSnapshot(afterElement)
      const beforeStyle = styleSnapshot(beforeElement)
      const afterStyle = styleSnapshot(afterElement)
      const beforeGeometry = beforeElement.type === 'shape'
        ? shapeGeometrySnapshot(beforeElement)
        : undefined
      const afterGeometry = afterElement.type === 'shape'
        ? shapeGeometrySnapshot(afterElement)
        : undefined
      const hasTextChange = changed(beforeText, afterText)
      const hasStyleChange = changed(beforeStyle, afterStyle)
      const supportedKeys = new Set<string>()
      supportedKeys.add('accessibility')
      if (effectsSupported) supportedKeys.add('effects')
      if (threeDSupported) supportedKeys.add('threeD')
      if (beforeElement.type === 'text') {
        for (const key of [
          'columnGap',
          'columns',
          'content',
          'defaultColor',
          'defaultFontName',
          'fill',
          'fixedHeight',
          'inset',
          'lineHeight',
          'outline',
          'paragraphSpace',
          'structuredText',
          'vAlign',
          'wordSpace',
        ]) supportedKeys.add(key)
      }
      if (beforeElement.type === 'shape' && afterElement.type === 'shape') {
        for (const key of [
          'fill',
          'gradient',
          'outline',
          'pattern',
          'patternFit',
          'powerPointPattern',
          'powerPointGeometry',
          'text',
        ]) supportedKeys.add(key)
      }
      const unsupportedKeys = contentKeys.filter(key => !supportedKeys.has(key))
      if (
        beforeElement.type === 'shape'
        && afterElement.type === 'shape'
        && beforeElement.pattern !== afterElement.pattern
      ) {
        unsupportedKeys.push('picture-fill media replacement')
      }
      if (hasTextChange && (!beforeText || !afterText)) {
        unsupportedKeys.push('text body insertion/removal')
      }
      if (unsupportedKeys.length) {
        issues.push(unsupported(
          'pptx.writeback.element-content',
          `The imported ${afterElement.type} changed unsupported properties: ${[...new Set(unsupportedKeys)].join(', ')}.`,
          {
            elementId: afterElement.id,
            objectId,
            partPath: source.sourcePart,
            slideId: baselineSlide.id,
          },
        ))
      }
      if (hasTextChange && beforeText && afterText) {
        operations.push({
          after: afterText,
          before: beforeText,
          beforeWidth: beforeElement.type === 'line' ? 0 : beforeElement.width,
          elementId: afterElement.id,
          kind: 'text',
          objectId,
          partPath: source.sourcePart!,
          ...(textScale(beforeElement, afterElement) !== undefined
            ? { scale: textScale(beforeElement, afterElement) }
            : {}),
          slideId: baselineSlide.id,
        })
      }
      if (hasStyleChange && beforeStyle && afterStyle) {
        operations.push({
          after: afterStyle,
          before: beforeStyle,
          beforeWidth: beforeElement.type === 'line' ? 0 : beforeElement.width,
          elementId: afterElement.id,
          kind: 'style',
          objectId,
          partPath: source.sourcePart!,
          ...(textScale(beforeElement, afterElement) !== undefined
            ? { scale: textScale(beforeElement, afterElement) }
            : {}),
          slideId: baselineSlide.id,
        })
      }
      if (
        beforeGeometry
        && afterGeometry
        && changed(beforeGeometry, afterGeometry)
      ) {
        operations.push({
          after: afterGeometry,
          before: beforeGeometry,
          elementId: afterElement.id,
          kind: 'shape-geometry',
          objectId,
          partPath: source.sourcePart!,
          slideId: baselineSlide.id,
        })
      }
      if (beforeElement.type === 'line' || afterElement.type === 'line') continue
      if (hasTransformChange) {
        operations.push({
          after: after!,
          before: before!,
          elementId: afterElement.id,
          kind: 'transform',
          objectId,
          partPath: source.sourcePart!,
          slideId: baselineSlide.id,
        })
      }
    }
  }

  if (includeSharedLayers) {
    const shared = sharedLayerAnalysis(baseline, presentation, packageId)
    operations.push(...shared.operations)
    issues.push(...shared.unsupported)
  }
  const dedupedIssues = [...new Map(issues.map(issue => [
    JSON.stringify(issue),
    issue,
  ])).values()]
  const touchedParts = [...new Set(operations.flatMap(operation => (
    operation.kind === 'insert-slide'
      ? [operation.sourcePart, 'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels']
      : operation.kind === 'insert-object'
        ? [
            operation.sourcePart,
            operation.targetPart,
            relationshipPartPath(operation.sourcePart),
            relationshipPartPath(operation.targetPart),
          ]
        : operation.kind === 'insert-element'
          ? [operation.targetPart, relationshipPartPath(operation.targetPart)]
        : operation.kind === 'replace-element'
          ? [operation.targetPart, relationshipPartPath(operation.targetPart)]
        : operation.kind === 'inherited-visibility'
          ? [
              operation.partPath,
              operation.layoutPart,
              relationshipPartPath(operation.partPath),
              relationshipPartPath(operation.layoutPart),
            ]
        : operation.kind === 'chart'
      ? [operation.chartPart, ...(operation.workbookPart ? [operation.workbookPart] : [])]
      : operation.kind === 'comments'
        ? [
            operation.partPath,
            operation.authorsPart,
            relationshipPartPath(operation.slidePart),
            relationshipPartPath('ppt/presentation.xml'),
            '[Content_Types].xml',
          ]
      : operation.kind === 'background' || operation.kind === 'notes' || operation.kind === 'theme' || operation.kind === 'timing' || operation.kind === 'transition'
        ? [operation.partPath]
        : operation.kind === 'text' && changed(
            authoredHyperlinks(operation.before.content),
            authoredHyperlinks(operation.after.content),
          )
          ? [operation.partPath, relationshipPartPath(operation.partPath)]
      : [operation.partPath]
  )))].sort()
  return {
    mode: dedupedIssues.length ? 'unsupported' : operations.length ? 'patch' : 'noop',
    operations,
    touchedParts,
    unsupported: dedupedIssues,
  }
}
