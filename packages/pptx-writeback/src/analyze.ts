import type {
  PPTElement,
  PPTElementOutline,
  PPTLineElement,
  PresentationState,
  ShapeText,
  Slide,
} from '@mona/presentation-core'

import type {
  PowerPointElementEntry,
  PowerPointConnectorSnapshot,
  PowerPointPatchOperation,
  PowerPointShapeStyleSnapshot,
  PowerPointTextSnapshot,
  PowerPointTransformSnapshot,
  PowerPointWritebackIssue,
  PowerPointWritebackPlan,
} from './types'

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
    ...(element.type === 'shape'
      ? {
          complexFill: Boolean(
            element.gradient
            || element.pattern
            || element.patternFit
            || element.powerPointPattern,
          ),
        }
      : {}),
    ...(element.fill !== undefined ? { fill: element.fill } : {}),
    ...(element.outline ? { outline: structuredClone(element.outline) as PPTElementOutline } : {}),
  }
}

const connectorSnapshot = (element: PPTLineElement): PowerPointConnectorSnapshot => ({
  ...(element.broken ? { broken: structuredClone(element.broken) } : {}),
  ...(element.broken2 ? { broken2: structuredClone(element.broken2) } : {}),
  ...(element.broken2Direction ? { broken2Direction: element.broken2Direction } : {}),
  color: element.color,
  ...(element.cubic ? { cubic: structuredClone(element.cubic) } : {}),
  ...(element.curve ? { curve: structuredClone(element.curve) } : {}),
  end: structuredClone(element.end),
  left: element.left,
  points: structuredClone(element.points),
  start: structuredClone(element.start),
  style: element.style,
  top: element.top,
  width: element.width,
})

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
})

const connectorIsStraight = (connector: PowerPointConnectorSnapshot): boolean => (
  !connector.broken
  && !connector.broken2
  && !connector.curve
  && !connector.cubic
)

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
  const ignored = new Set(['elements', 'id', 'source'])
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
  if (JSON.stringify(baseline.theme) !== JSON.stringify(desired.theme)) {
    issues.push(unsupported(
      'pptx.writeback.theme',
      'Theme edits cannot be written back to an imported PowerPoint yet.',
    ))
  }
  return issues
}

const relativeOrder = (
  baseline: readonly string[],
  desired: readonly string[],
): boolean => {
  const desiredSet = new Set(desired)
  return baseline.filter(objectId => desiredSet.has(objectId)).join('\0')
    === desired.join('\0')
}

export const analyzePowerPointWriteback = (
  baseline: PresentationState,
  presentation: PresentationState,
  packageId: string,
): PowerPointWritebackPlan => {
  const operations: PowerPointPatchOperation[] = []
  const issues = comparePresentationShell(baseline, presentation)
  const sourcePackage = baseline.sourcePackages?.find(source => source.packageId === packageId)
  const baselineSlides = baseline.slides.filter(slide => slide.source?.packageId === packageId)
  const desiredSlides = presentation.slides.filter(slide => slide.source?.packageId === packageId)
  const desiredByPart = new Map(desiredSlides.map(slide => [slidePart(slide), slide]))

  if (
    baseline.slides.length !== presentation.slides.length
    || baseline.slides.some(
      (slide, index) => slideIdentity(slide) !== slideIdentity(presentation.slides[index]!),
    )
    || baselineSlides.length !== desiredSlides.length
  ) {
    issues.push(unsupported(
      'pptx.writeback.slide-structure',
      'Adding, deleting, or reordering slides in an imported PowerPoint is not writeback-safe yet.',
      { partPath: 'ppt/presentation.xml' },
    ))
  }

  for (const baselineSlide of baselineSlides) {
    const partPath = slidePart(baselineSlide)
    const desiredSlide = desiredByPart.get(partPath)
    if (!partPath || !desiredSlide) continue
    issues.push(...compareSlideShell(baselineSlide, desiredSlide))
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

    for (const desiredEntry of desiredTree.entries) {
      const source = desiredEntry.element.source
      if (!source) {
        const baselineEntry = baselineById.get(desiredEntry.element.id)
        if (
          baselineEntry
          && JSON.stringify(baselineEntry.element) === JSON.stringify(desiredEntry.element)
          && baselineEntry.parentObjectId === desiredEntry.parentObjectId
        ) {
          continue
        }
        issues.push(unsupported(
          baselineEntry
            ? 'pptx.writeback.unaddressable-object'
            : 'pptx.writeback.element-added',
          baselineEntry
            ? 'This imported object has no exact OOXML identity, so its edits cannot be written back safely.'
            : 'A Mona-created element cannot yet be inserted into an imported PowerPoint package.',
          { elementId: desiredEntry.element.id, slideId: desiredSlide.id },
        ))
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
          'color',
          'cubic',
          'curve',
          'end',
          'points',
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
            'Connector shadow and effect writeback is not enabled yet.',
            {
              elementId: afterElement.id,
              objectId,
              partPath: source.sourcePart,
              slideId: baselineSlide.id,
            },
          ))
        }
        if (
          geometryChanged
          && (!connectorIsStraight(beforeConnector) || !connectorIsStraight(afterConnector))
        ) {
          issues.push(unsupported(
            'pptx.writeback.connector-route',
            'Bent and curved connector route edits require an exact native adjustment serializer; their existing route is preserved for style-only edits.',
            {
              elementId: afterElement.id,
              objectId,
              partPath: source.sourcePart,
              slideId: baselineSlide.id,
            },
          ))
        }
        if (source.connector?.start && startMoved) {
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
        if (source.connector?.end && endMoved) {
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
        if (geometryChanged && baselineEntry.parentObjectId) {
          issues.push(unsupported(
            'pptx.writeback.connector-group-transform',
            'A connector inside a PowerPoint group uses the group coordinate space and cannot be moved safely until grouped connector transforms are modeled.',
            {
              elementId: afterElement.id,
              objectId,
              partPath: source.sourcePart,
              slideId: baselineSlide.id,
            },
          ))
        }
        if (geometryChanged || styleChanged) {
          operations.push({
            after: afterConnector,
            before: beforeConnector,
            elementId: afterElement.id,
            kind: 'connector',
            objectId,
            partPath: source.sourcePart!,
            ...(sourcePackage?.coordinateScale
              ? { scale: sourcePackage.coordinateScale }
              : {}),
            slideId: baselineSlide.id,
          })
        }
        continue
      }
      const beforeText = textSnapshot(beforeElement)
      const afterText = textSnapshot(afterElement)
      const beforeStyle = styleSnapshot(beforeElement)
      const afterStyle = styleSnapshot(afterElement)
      const hasTextChange = changed(beforeText, afterText)
      const hasStyleChange = changed(beforeStyle, afterStyle)
      const supportedKeys = new Set<string>()
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
          'text',
        ]) supportedKeys.add(key)
      }
      const unsupportedKeys = contentKeys.filter(key => !supportedKeys.has(key))
      if (beforeElement.type === 'shape' && afterElement.type === 'shape') {
        const fillModeChanged = [
          'fill',
          'gradient',
          'pattern',
          'patternFit',
          'powerPointPattern',
        ].some(key => contentKeys.includes(key))
        const desiredUsesComplexFill = Boolean(
          afterElement.gradient
          || afterElement.pattern
          || afterElement.patternFit
          || afterElement.powerPointPattern,
        )
        if (fillModeChanged && desiredUsesComplexFill) {
          unsupportedKeys.push('gradient/pattern fill')
        }
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

  const dedupedIssues = [...new Map(issues.map(issue => [
    JSON.stringify(issue),
    issue,
  ])).values()]
  const touchedParts = [...new Set(operations.map(operation => operation.partPath))].sort()
  return {
    mode: dedupedIssues.length ? 'unsupported' : operations.length ? 'patch' : 'noop',
    operations,
    touchedParts,
    unsupported: dedupedIssues,
  }
}
