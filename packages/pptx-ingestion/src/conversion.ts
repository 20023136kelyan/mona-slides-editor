import tinycolor from 'tinycolor2'
import { SVGPathData, SVGPathDataTransformer } from 'svg-pathdata'
import type {
  ChartItem,
  Element as PptxElement,
  Fill as PptxFill,
  Shape as PptxShape,
} from '@mona/pptx-parser'

import {
  createPresentationId,
  flattenElementTree,
  powerPointCommentNoteId,
  type PowerPointImportCapabilityReport,
  type PowerPointImportDisposition,
  type PowerPointImportDispositionCounts,
  type PowerPointImportIssue,
  type PowerPointImportReport,
  type PowerPointElementSource,
  type PowerPointElementSourceLayer,
  type PowerPointHierarchy,
  type PowerPointPackageManifest,
  type PowerPointPackageReference,
} from '@mona/presentation-core'
import type {
  ChartOptions,
  ChartType,
  Gradient,
  LinePoint,
  Note,
  PPTElement,
  PPTGroupElement,
  PPTImageElement,
  PPTLatexElement,
  PPTLineElement,
  PPTOpaqueElement,
  PPTShapeElement,
  PPTTextElement,
  Slide,
  SlideBackground,
  SlideTheme,
  StructuredTextBody,
  TableCell,
  TableCellStyle,
  TextAlignVertical,
} from '@mona/presentation-core/model'
import { SHAPE_LIST, SHAPE_PATH_FORMULAS, type ShapePoolItem } from '@mona/presentation-core/shape-presets'

import { createPowerPointAssetCollector } from './assets'
import { firstInlineStyle, promotePowerPointListTextStyle } from './html-fragment'
import { renderPowerPointLatex } from './latex'
import type {
  ParsedPptxPresentation,
  PowerPointConversionResult,
} from './types'

export type { ParsedPptxPresentation } from './types'

const importedPowerPointNotes = (
  sourcePackage: PowerPointPackageReference | undefined,
  slidePart: string | undefined,
): Note[] | undefined => {
  if (!slidePart) return undefined
  const comments = sourcePackage?.document?.comments.filter(comment => comment.slidePart === slidePart) ?? []
  if (!comments.length) return undefined
  const authors = new Map(
    sourcePackage?.document?.commentAuthors.map(author => [author.id, author]) ?? [],
  )
  const toTimestamp = (value: string | undefined): number => {
    const parsed = value ? Date.parse(value) : Number.NaN
    return Number.isFinite(parsed) ? parsed : 0
  }
  const userName = (authorId: string | undefined): string => {
    const author = authorId ? authors.get(authorId) : undefined
    return author?.name || author?.initials || 'PowerPoint'
  }
  const repliesByParent = new Map<string, typeof comments>()
  for (const comment of comments) {
    if (!comment.parentId) continue
    const replies = repliesByParent.get(comment.parentId) ?? []
    replies.push(comment)
    repliesByParent.set(comment.parentId, replies)
  }
  return comments.filter(comment => !comment.parentId).map(comment => ({
    content: comment.text,
    id: powerPointCommentNoteId(comment),
    replies: (repliesByParent.get(comment.id) ?? []).map(reply => ({
      content: reply.text,
      id: powerPointCommentNoteId(reply),
      time: toTimestamp(reply.createdAt),
      user: userName(reply.authorId),
    })),
    time: toTimestamp(comment.createdAt),
    user: userName(comment.authorId),
  }))
}

const vAlignMap: Record<string, TextAlignVertical> = { down: 'bottom', mid: 'middle', up: 'top' }

const retainStructuredText = (
  body: StructuredTextBody | undefined,
  sourceId: string,
  scale: number,
): StructuredTextBody | undefined => body
  ? {
      ...body,
      paragraphs: body.paragraphs.map((paragraph, paragraphIndex) => ({
        ...paragraph,
        runs: paragraph.runs.map((run, runIndex) => ({
          ...run,
          sourceId: `${sourceId}/text/p${paragraphIndex}/r${runIndex}`,
        })),
        sourceId: `${sourceId}/text/p${paragraphIndex}`,
      })),
      scale,
    }
  : undefined

// A picture bullet points at an image part that the structured-text parser does
// not resolve, so the marker falls back to a disc. That is a downgrade, and it
// is reported rather than left to look authored.
const hasPictureBullet = (body: StructuredTextBody | undefined): boolean => Boolean(
  body?.paragraphs.some(paragraph => paragraph.properties?.bullet?.type === 'picture'),
)

const normalizeIndentValue = (indent: string, ratio: number) => {
  const value = Number.parseFloat(indent)
  if (!value || value < 0) return 0
  let normalized = 0
  if (indent.includes('em')) normalized = Number.parseInt(indent)
  else if (indent.includes('px')) normalized = Math.floor(Number.parseInt(indent) / 16) || 1
  else if (indent.includes('pt')) normalized = Math.floor(value * ratio / 16) || 1
  return Math.min(normalized, 8)
}

const convertTextContent = (html: string, ratio: number) => {
  if (!html) return ''
  const processed = html.replace(/font-size:\s*([\d.]+)pt/g, (_match, size: string) => `font-size: ${Math.floor(Number.parseFloat(size) * ratio)}px`)
    .replace(/&nbsp;/g, ' ')
    .replace(/style="([^"]*)"/g, (_match, styleString: string) => {
      let style = styleString
      const gradient = style.match(/background:\s*(linear-gradient\([^)]+\))/)
      if (gradient) {
        const colorMatches = gradient[1]!.match(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}|rgba?\([^)]+\)/g)
        if (colorMatches?.length) {
          const colors = colorMatches.map(color => tinycolor(color))
          const average = colors.reduce((result, color) => {
            const rgb = color.toRgb()
            return { b: result.b + rgb.b / colors.length, g: result.g + rgb.g / colors.length, r: result.r + rgb.r / colors.length }
          }, { b: 0, g: 0, r: 0 })
          style = style.replace(/background:\s*linear-gradient\([^)]+\)\s*;?/g, '')
            .replace(/background-clip:\s*text\s*;?/g, '')
            .replace(/color:\s*transparent\s*;?/g, '')
          style = `color: ${tinycolor(average).toHexString()}; ${style}`
        }
      }
      const marginLeft = style.match(/margin-left\s*:\s*([^;]+);?/i)
      const indentValue = marginLeft ? normalizeIndentValue(marginLeft[1]!, ratio) : 0
      style = style.replace(/margin-(top|bottom|left)\s*:\s*[^;]+;?/g, '')
        .replace(/text-indent\s*:\s*([^;]+);?/g, (_value, indent: string) => {
          const textIndent = normalizeIndentValue(indent, ratio)
          return textIndent ? `text-indent: ${textIndent}em;` : ''
        })
        .replace(/;\s*;/g, ';').replace(/^\s*;\s*/, '').replace(/;\s*$/, ';').trim()
      return [indentValue ? `data-indent="${indentValue}"` : '', style ? `style="${style}"` : ''].filter(Boolean).join(' ')
    })
  return promotePowerPointListTextStyle(processed)
}

const getMaxFontSize = (html: string, defaultFontSize = 18) => {
  const expression = /font-size\s*:\s*(\d+(?:\.\d+)?)\s*pt/gi
  const sizes = [defaultFontSize]
  let match: RegExpExecArray | null
  while ((match = expression.exec(html))) {
    const size = Number.parseFloat(match[1]!)
    if (size > 0) sizes.push(size)
  }
  return Math.max(...sizes)
}

const getParagraphMetrics = (html: string, ratio: number) => {
  const expression = /<(div|p)(?![a-z0-9])[^>]*>/gi
  const lineHeights: number[] = []
  const margins: number[] = []
  let paragraphCount = 0
  let paragraphIndex = 0
  let match: RegExpExecArray | null
  while ((match = expression.exec(html))) {
    const tag = match[0]
    paragraphCount += 1
    const styleMatch = tag.match(/\bstyle\s*=\s*(['"])(.*?)\1/i)
    const style = styleMatch?.[2] ?? ''
    const property = (name: string) => style.match(new RegExp(`${name}\\s*:\\s*([^;]+)`, 'i'))?.[1]?.trim() ?? null
    const marginTop = property('margin-top')
    const marginBottom = property('margin-bottom')
    const lineHeight = property('line-height')
    const tagName = match[1]!
    let tagEnd = html.indexOf(`</${tagName}>`, match.index)
    if (tagEnd === -1) tagEnd = match.index + tag.length
    const maxFontSize = getMaxFontSize(html.substring(match.index, tagEnd))
    lineHeights.push(lineHeight ? (lineHeight.includes('pt') ? Number.parseFloat(lineHeight) / maxFontSize : Number.parseFloat(lineHeight)) : 1)
    const isFirst = paragraphIndex === 0
    const isLast = match.index + tag.length >= html.lastIndexOf(`</${tagName}>`)
    for (const [margin, applies] of [[marginTop, !isFirst], [marginBottom, !isLast]] as const) {
      if (!margin || !applies) continue
      let value = 0
      if (margin.includes('pt')) value = Number.parseFloat(margin)
      else if (margin.includes('em')) value = Number.parseFloat(margin) * maxFontSize
      if (value > 0) margins.push(value)
    }
    paragraphIndex += 1
  }
  const lineHeight = lineHeights.length ? +(lineHeights.reduce((sum, height) => sum + height, 0) / paragraphCount).toFixed(2) : 1
  const margin = margins.length && paragraphCount > 1 ? margins.reduce((sum, value) => sum + value, 0) / (paragraphCount - 1) : 0
  return { lineHeight, margin: margin ? +(margin * ratio).toFixed(1) : null }
}

const svgPathRange = (path: string) => {
  try {
    const commands = new SVGPathData(path).transform(SVGPathDataTransformer.TO_ABS()).transform(SVGPathDataTransformer.NORMALIZE_HVZ())
      .transform(SVGPathDataTransformer.NORMALIZE_ST()).transform(SVGPathDataTransformer.QT_TO_C()).transform(SVGPathDataTransformer.A_TO_C()).commands
    const x = commands.flatMap(item => 'x' in item ? [item.x] : [])
    const y = commands.flatMap(item => 'y' in item ? [item.y] : [])
    return { maxX: Math.max(...x), maxY: Math.max(...y) }
  }
  catch {
    return { maxX: 0, maxY: 0 }
  }
}

const pathPoints = (path: string) => new SVGPathData(path).transform(SVGPathDataTransformer.TO_ABS()).transform(SVGPathDataTransformer.NORMALIZE_HVZ())
  .transform(SVGPathDataTransformer.NORMALIZE_ST()).transform(SVGPathDataTransformer.QT_TO_C()).transform(SVGPathDataTransformer.A_TO_C()).commands.flatMap(command => {
    if ('x' in command && 'y' in command) return [{ x: command.x, y: command.y }]
    return []
  })

const rotateLine = (line: PPTLineElement, angle: number) => {
  const { start, end } = line
  const radians = angle * Math.PI / 180
  const middleX = (start[0] + end[0]) / 2
  const middleY = (start[1] + end[1]) / 2
  const rotate = ([x, y]: [number, number]) => [
    (x - middleX) * Math.cos(radians) - (y - middleY) * Math.sin(radians) + middleX,
    (x - middleX) * Math.sin(radians) + (y - middleY) * Math.cos(radians) + middleY,
  ] as [number, number]
  const rotatedStart = rotate(start)
  const rotatedEnd = rotate(end)
  const beforeMinX = Math.min(start[0], end[0])
  const beforeMinY = Math.min(start[1], end[1])
  const afterMinX = Math.min(rotatedStart[0], rotatedEnd[0])
  const afterMinY = Math.min(rotatedStart[1], rotatedEnd[1])
  return {
    end: [rotatedEnd[0] - afterMinX, rotatedEnd[1] - afterMinY] as [number, number],
    offset: [afterMinX - beforeMinX, afterMinY - beforeMinY] as [number, number],
    start: [rotatedStart[0] - afterMinX, rotatedStart[1] - afterMinY] as [number, number],
  }
}

const parseLineEnd = (lineEnd?: { type?: string }): LinePoint => {
  if (!lineEnd?.type || lineEnd.type === 'none') return ''
  if (['triangle', 'stealth', 'arrow'].includes(lineEnd.type)) return 'arrow'
  if (['diamond', 'oval'].includes(lineEnd.type)) return 'dot'
  return ''
}

const parseLineElement = (element: PptxShape, ratio: number) => {
  let start: [number, number]
  let end: [number, number]
  let rotateOffset: [number, number] = [0, 0]
  if (!element.isFlipV && !element.isFlipH) {
    start = [0, 0]; end = [element.width, element.height]
  }
  else if (element.isFlipV && element.isFlipH) {
    start = [element.width, element.height]; end = [0, 0]
  }
  else if (element.isFlipV) {
    start = [0, element.height]; end = [element.width, 0]
  }
  else {
    start = [element.width, 0]; end = [0, element.height]
  }
  const line: PPTLineElement = {
    color: element.borderColor,
    end,
    id: createPresentationId(10),
    left: element.left,
    points: [parseLineEnd(element.headEnd), parseLineEnd(element.tailEnd)],
    start,
    style: element.borderType,
    top: element.top,
    type: 'line',
    width: +((element.borderWidth || 1) * ratio).toFixed(2),
    powerPointGeometry: {
      adjustments: structuredClone(element.keypoints ?? {}),
      preset: element.shapType,
    },
  }
  if (element.rotate) {
    const rotated = rotateLine(line, element.rotate)
    line.start = rotated.start
    line.end = rotated.end
    line.left += rotated.offset[0]
    line.top += rotated.offset[1]
    rotateOffset = rotated.offset
  }
  const mapPathPoint = (point: { x: number; y: number }): [number, number] => {
    let x = element.pathViewBox?.width
      ? point.x / element.pathViewBox.width * element.width
      : point.x * ratio
    let y = element.pathViewBox?.height
      ? point.y / element.pathViewBox.height * element.height
      : point.y * ratio
    if (element.isFlipH) x = element.width - x
    if (element.isFlipV) y = element.height - y
    if (element.rotate) {
      const radians = element.rotate * Math.PI / 180
      const middleX = (start[0] + end[0]) / 2
      const middleY = (start[1] + end[1]) / 2
      const xRotated = (x - middleX) * Math.cos(radians) - (y - middleY) * Math.sin(radians) + middleX
      const yRotated = (x - middleX) * Math.sin(radians) + (y - middleY) * Math.cos(radians) + middleY
      x = xRotated - Math.min(start[0], end[0]) - rotateOffset[0]
      y = yRotated - Math.min(start[1], end[1]) - rotateOffset[1]
    }
    return [x, y]
  }
  if (/bentConnector/.test(element.shapType)) {
    const defaults = () => {
      line.broken2 = [Math.abs(line.start[0] - line.end[0]) / 2, Math.abs(line.start[1] - line.end[1]) / 2]
    }
    const points = (limit: number) => {
      if (!element.path) return []
      return pathPoints(element.path).map(mapPathPoint).slice(0, limit)
    }
    if (element.shapType === 'bentConnector2') {
      const values = points(3)
      line.broken = values.length >= 3 && values.every(point => point.every(Number.isFinite))
        ? (Math.abs(values[1]![0] - values[0]![0]) >= Math.abs(values[1]![1] - values[0]![1]) ? [line.start[0], line.end[1]] : [line.end[0], line.start[1]])
        : [line.start[0], line.end[1]]
    }
    else if (element.shapType === 'bentConnector3') {
      const values = points(4)
      if (values.length >= 4 && values.every(point => point.every(Number.isFinite))) {
        line.broken2 = [(values[1]![0] + values[2]![0]) / 2, (values[1]![1] + values[2]![1]) / 2]
        line.broken2Direction = Math.abs(values[1]![0] - values[0]![0]) >= Math.abs(values[1]![1] - values[0]![1]) ? 'horizontal' : 'vertical'
      }
      else defaults()
    }
    else defaults()
  }
  if (/curvedConnector/.test(element.shapType)) {
    if (element.shapType === 'curvedConnector2') {
      line.curve = [line.end[0], line.start[1]]
    }
    else {
      const middleX = (line.start[0] + line.end[0]) / 2
      line.cubic = [[middleX, line.start[1]], [middleX, line.end[1]]]
    }
  }
  if (
    element.shapType === 'custom'
    && (element.native?.kind === 'connector' || (element.strokeOnly && !element.content))
    && element.path
  ) {
    try {
      const commands = new SVGPathData(element.path)
        .transform(SVGPathDataTransformer.TO_ABS())
        .commands
      const lineCommands = commands.filter(command => command.type === SVGPathData.LINE_TO)
      const quadratic = commands.find(command => command.type === SVGPathData.QUAD_TO)
      const cubic = commands.find(command => command.type === SVGPathData.CURVE_TO)
      if (
        cubic
        && 'x1' in cubic && 'y1' in cubic
        && 'x2' in cubic && 'y2' in cubic
      ) {
        line.cubic = [
          mapPathPoint({ x: cubic.x1, y: cubic.y1 }),
          mapPathPoint({ x: cubic.x2, y: cubic.y2 }),
        ]
      }
      else if (quadratic && 'x1' in quadratic && 'y1' in quadratic) {
        line.curve = mapPathPoint({ x: quadratic.x1, y: quadratic.y1 })
      }
      else if (lineCommands.length === 2) {
        const control = lineCommands[0]!
        if ('x' in control && 'y' in control) {
          line.broken = mapPathPoint({ x: control.x, y: control.y })
        }
      }
      else if (lineCommands.length >= 3) {
        const first = lineCommands[0]!
        const second = lineCommands[1]!
        if ('x' in first && 'y' in first && 'x' in second && 'y' in second) {
          const firstPoint = mapPathPoint({ x: first.x, y: first.y })
          const secondPoint = mapPathPoint({ x: second.x, y: second.y })
          line.broken2 = [
            (firstPoint[0] + secondPoint[0]) / 2,
            (firstPoint[1] + secondPoint[1]) / 2,
          ]
          line.broken2Direction = Math.abs(firstPoint[0] - line.start[0])
            >= Math.abs(firstPoint[1] - line.start[1])
            ? 'horizontal'
            : 'vertical'
        }
      }
    }
    catch {
      // The source package still retains the exact custom geometry. Leaving
      // route controls absent keeps the connector visible as a straight
      // fallback without inventing an editable path.
    }
  }
  return line
}

const slideBackground = (
  fill: PptxFill,
  assetUrl: (source: string) => string,
): SlideBackground => {
  const { type, value } = fill
  if (type === 'image') return { image: { size: 'stretch', src: assetUrl(value.base64) }, type: 'image' }
  if (type === 'gradient') return { gradient: { colors: value.colors.map(color => ({ ...color, pos: Number.parseInt(color.pos) })), rotate: value.rot, type: value.path === 'line' ? 'linear' : 'radial' }, type: 'gradient' }
  if (type === 'pattern') {
    return {
      pattern: {
        backgroundColor: value.backgroundColor,
        foregroundColor: value.foregroundColor,
        patternType: value.type,
      },
      type: 'pattern',
    }
  }
  return { color: value || '#fff', type: 'solid' }
}

const normalizedPlaceholderType = (type: string | undefined): string | undefined => {
  if (type === 'ctrTitle') return 'title'
  return type
}

const findMatchingPlaceholder = (
  elements: readonly PPTElement[],
  source: PowerPointElementSource,
): PPTElement | undefined => {
  const placeholders = flattenElementTree(elements).filter(element => (
    element.source?.placeholderIndex !== undefined
    || element.source?.placeholderType !== undefined
  ))
  if (source.placeholderIndex !== undefined) {
    const indexed = placeholders.find(element => (
      element.source?.placeholderIndex === source.placeholderIndex
    ))
    if (indexed) return indexed
  }
  const type = normalizedPlaceholderType(source.placeholderType)
  return type
    ? placeholders.find(element => normalizedPlaceholderType(element.source?.placeholderType) === type)
    : undefined
}

const emptyDispositionCounts = (): PowerPointImportDispositionCounts => ({
  approximated: 0,
  dropped: 0,
  modeled: 0,
  opaque: 0,
})

export const convertParsedPptxPresentation = ({
  assetUrl,
  coordinateLabel,
  parsed,
  ratio,
  sourceManifest,
  sourcePackage,
  theme,
}: {
  assetUrl?: (asset: { mediaType: string; name: string }) => string
  coordinateLabel: (index: number) => string
  parsed: ParsedPptxPresentation
  ratio: number
  sourceManifest?: PowerPointPackageManifest
  sourcePackage?: PowerPointPackageReference
  theme: SlideTheme
}): PowerPointConversionResult => {
  const assetCollector = createPowerPointAssetCollector(assetUrl)
  const importedAssetUrl = assetCollector.resolve
  const shapeList: ShapePoolItem[] = SHAPE_LIST.flatMap(group => group.children)
  const slides: Slide[] = []
  const packageCounts = emptyDispositionCounts()
  const slideReports: PowerPointImportReport['slides'] = []
  const sourceOrder = new Map(sourcePackage?.slides.map((slide, index) => [slide.slidePart, index]) ?? [])
  const identitiesByPartAndNativeId = new Map<string, PowerPointPackageManifest['objects']>()
  const layoutBackgroundsByPart = new Map<string, SlideBackground>()
  const layoutElementsByPart = new Map<string, PPTElement[]>()
  const masterBackgroundsByPart = new Map<string, SlideBackground>()
  const masterElementsByPart = new Map<string, PPTElement[]>()
  for (const identity of sourceManifest?.objects ?? []) {
    const key = `${identity.partPath}\0${identity.nativeId}`
    const identities = identitiesByPartAndNativeId.get(key) ?? []
    identities.push(identity)
    identitiesByPartAndNativeId.set(key, identities)
  }
  const parsedSlides = [...parsed.slides].sort((left, right) => {
    const leftIndex = left.sourcePart ? sourceOrder.get(left.sourcePart) : undefined
    const rightIndex = right.sourcePart ? sourceOrder.get(right.sourcePart) : undefined
    if (leftIndex === undefined || rightIndex === undefined) return 0
    return leftIndex - rightIndex
  })
  for (const [slideIndex, item] of parsedSlides.entries()) {
    const sourceDependency = (item.sourcePart
      ? sourcePackage?.slides.find(slide => slide.slidePart === item.sourcePart)
      : undefined)
      ?? sourcePackage?.slides[slideIndex]
    const sourceTheme = sourcePackage?.hierarchy?.themes.find(candidate => (
      candidate.partPath === sourceDependency?.themePart
    ))
    const importedNotes = importedPowerPointNotes(sourcePackage, sourceDependency?.slidePart)
    const slideTheme: SlideTheme = {
      ...theme,
      fontName: sourceTheme?.minorLatinFont || theme.fontName,
      themeColors: item.themeColors?.length ? item.themeColors : theme.themeColors,
    }
    const turningModes: Record<string, NonNullable<Slide['turningMode']>> = {
      cover: 'slideX',
      cube: 'slideX3D',
      fade: 'fade',
      pull: 'slideX',
      push: 'slideX',
      random: 'random',
      reveal: 'slideX',
      uncover: 'slideX',
      wipe: 'slideX',
      zoom: 'scale',
    }
    const slide: Slide = {
      background: slideBackground(item.backgrounds?.effective ?? item.fill, importedAssetUrl),
      ...(item.transition?.autoNextAfter && item.transition.autoNextAfter >= 1000
        ? { durationMs: item.transition.autoNextAfter }
        : {}),
      elements: [],
      hidden: item.hidden,
      id: createPresentationId(10),
      ...(importedNotes ? { notes: importedNotes } : {}),
      remark: item.note || '',
      title: item.name,
      turningMode: item.transition?.type ? turningModes[item.transition.type] ?? 'no' : 'no',
    }
    const slideCounts = emptyDispositionCounts()
    const capabilityCounts = new Map<string, PowerPointImportCapabilityReport>()
    const issues: PowerPointImportIssue[] = []
    const sourceIdentityFor = (
      element: PptxElement,
    ) => {
      if (!element.native) return undefined
      const candidates = identitiesByPartAndNativeId.get(`${element.native.partPath}\0${element.native.id}`) ?? []
      return candidates.length === 1 ? candidates[0] : undefined
    }
    let sourceObjectCount = 0
    const recordOutcome = (
      element: PptxElement,
      sourceLayer: PowerPointElementSourceLayer,
      disposition: PowerPointImportDisposition,
      issue?: Pick<PowerPointImportIssue, 'code' | 'message'>,
    ) => {
      sourceObjectCount += 1
      slideCounts[disposition] += 1
      packageCounts[disposition] += 1
      const sourceType = element.type
      const capability = capabilityCounts.get(sourceType) ?? {
        ...emptyDispositionCounts(),
        sourceType,
      }
      capability[disposition] += 1
      capabilityCounts.set(sourceType, capability)
      if (issue) {
        issues.push({
          ...issue,
          disposition,
          sourceLayer,
          sourceOrder: element.order,
          sourceType,
        })
      }
    }
    if (sourcePackage && sourceDependency) {
      slide.source = {
        ...sourceDependency,
        ...(item.backgrounds ? { backgroundSource: item.backgrounds.source } : {}),
        kind: 'pptx',
        packageId: sourcePackage.packageId,
      }
    }
    const parseElements = (
      elements: PptxElement[],
      sourceLayer: PowerPointElementSourceLayer,
      groupId?: string,
      destinationElements: PPTElement[] = slide.elements,
    ) => {
      for (const element of elements.sort((a, b) => a.order - b.order)) {
        const outputCountBefore = destinationElements.length
        let disposition: PowerPointImportDisposition | undefined
        let issue: Pick<PowerPointImportIssue, 'code' | 'message'> | undefined
        const sourceIdentity = sourceIdentityFor(element)
        const resolvedSourceLayer: PowerPointElementSourceLayer = sourceIdentity?.partPath === sourceDependency?.layoutPart
          ? 'layout'
          : sourceIdentity?.partPath === sourceDependency?.masterPart
            ? 'master'
            : sourceLayer
        if (sourcePackage && sourceManifest && !sourceIdentity) {
          issues.push({
            code: element.native ? 'pptx.identity.not-in-manifest' : 'pptx.identity.missing',
            disposition: 'approximated',
            message: element.native
              ? `Native PowerPoint object ${element.native.partPath}#${element.native.id} did not resolve to one unique package object`
              : 'Parsed PowerPoint object did not expose a native OOXML identity and will not be eligible for exact source patching',
            sourceLayer,
            sourceOrder: element.order,
            sourceType: element.type,
          })
        }
        const pushElement = (destination: PPTElement) => {
          if (groupId) destination.groupId = groupId
          if (
            sourceIdentity?.decorative !== undefined
            || sourceIdentity?.description !== undefined
            || sourceIdentity?.hidden !== undefined
            || sourceIdentity?.title !== undefined
          ) {
            destination.accessibility = {
              ...(sourceIdentity.decorative !== undefined
                ? { decorative: sourceIdentity.decorative }
                : {}),
              ...(sourceIdentity.description !== undefined
                ? { description: sourceIdentity.description }
                : {}),
              ...(sourceIdentity.hidden !== undefined ? { hidden: sourceIdentity.hidden } : {}),
              ...(sourceIdentity.title !== undefined ? { title: sourceIdentity.title } : {}),
            }
          }
          if (
            sourceIdentity?.locks?.noSelect
            || sourceIdentity?.locks?.noMove
            || sourceIdentity?.locks?.noResize
          ) destination.lock = true
          if (sourcePackage && sourceDependency && sourceIdentity) {
            destination.source = {
              ...(sourceIdentity.connector
                ? { connector: structuredClone(sourceIdentity.connector) }
                : {}),
              ...(sourceIdentity.decorative !== undefined
                ? { decorative: sourceIdentity.decorative }
                : {}),
              ...(sourceIdentity.description ? { description: sourceIdentity.description } : {}),
              ...(sourceIdentity.hidden !== undefined ? { hidden: sourceIdentity.hidden } : {}),
              kind: 'pptx',
              ...(sourceIdentity.locks ? { locks: structuredClone(sourceIdentity.locks) } : {}),
              nativeShapeId: sourceIdentity.nativeId,
              packageId: sourcePackage.packageId,
              placeholderIndex: sourceIdentity.placeholderIndex,
              placeholderType: sourceIdentity.placeholderType,
              ...(sourceIdentity.relationshipIds?.length
                ? { relationshipIds: structuredClone(sourceIdentity.relationshipIds) }
                : {}),
              slidePart: sourceDependency.slidePart,
              sourceObjectId: sourceIdentity.stableId,
              sourceLayer: resolvedSourceLayer,
              sourceOrder: element.order,
              sourcePart: sourceIdentity.partPath,
              stableId: sourceIdentity.stableId,
              ...(sourceIdentity.title ? { title: sourceIdentity.title } : {}),
              ...(sourceIdentity.visual
                ? { visual: structuredClone(sourceIdentity.visual) }
                : {}),
            }
          }
          destinationElements.push(destination)
        }
        let backstop = 1
        if (element.type === 'shape' && (element.shapType === 'line' || /(straight|bent|curved)Connector/.test(element.shapType))) backstop = 0
        const originWidth = element.width || backstop
        const originHeight = element.height || backstop
        const originLeft = element.left || 0
        const originTop = element.top || 0
        element.width = originWidth * ratio
        element.height = originHeight * ratio
        element.left = originLeft * ratio
        element.top = originTop * ratio

        if (element.type === 'text') {
          const autoFitType = element.autoFit?.type
          const adaptive = autoFitType === 'shape'
          const fontScale = autoFitType === 'text' ? (element.autoFit!.fontScale || 100) / 100 : 1
          const textRatio = ratio * fontScale
          const metrics = getParagraphMetrics(element.content, textRatio)
          const textId = createPresentationId(10)
          const structuredText = retainStructuredText(
            element.textBody,
            sourceIdentity?.stableId ?? textId,
            ratio,
          )
          const text: PPTTextElement = {
            content: convertTextContent(element.content, textRatio),
            defaultColor: slideTheme.fontColor,
            defaultFontName: slideTheme.fontName,
            fill: element.fill?.type === 'color' ? element.fill.value : '',
            height: element.height,
            id: textId,
            left: element.left,
            lineHeight: 1,
            outline: { color: element.borderColor, style: element.borderType, width: +(element.borderWidth * ratio).toFixed(2) },
            rotate: element.rotate,
            top: element.top,
            type: 'text',
            vertical: element.isVertical,
            width: element.width,
            ...(structuredText ? { structuredText } : {}),
          }
          if (!adaptive) {
            text.fixedHeight = true; text.vAlign = vAlignMap[element.vAlign] || 'top'
          }
          if (element.shadow) text.shadow = { blur: element.shadow.blur * ratio, color: element.shadow.color, h: element.shadow.h * ratio, v: element.shadow.v * ratio }
          if (element.link) text.link = { target: element.link, type: 'web' }
          if (element.textInset) text.inset = [
            element.textInset.t * ratio,
            element.textInset.r * ratio,
            element.textInset.b * ratio,
            element.textInset.l * ratio,
          ]
          if (metrics.lineHeight) text.lineHeight = metrics.lineHeight
          if (metrics.margin) text.paragraphSpace = metrics.margin
          pushElement(text)
          disposition = 'approximated'
          if (hasPictureBullet(structuredText)) {
            issue = { code: 'pptx.bullet.picture-unsupported', message: 'Picture bullets are not resolved; the paragraph falls back to a disc marker' }
          }
        }
        else if (element.type === 'image') {
          const image: PPTImageElement = {
            fixedRatio: true, flipH: element.isFlipH, flipV: element.isFlipV, height: element.height, id: createPresentationId(10), left: element.left,
            opacity: element.opacity, rotate: element.rotate, src: importedAssetUrl(element.base64), top: element.top, type: 'image', width: element.width,
            powerPointImage: {
              ...(element.rect ? { crop: structuredClone(element.rect) } : {}),
              geometry: element.geom || 'rect',
              ...(element.ref ? { mediaPart: element.ref } : {}),
              ...(element.relationshipId ? { relationshipId: element.relationshipId } : {}),
            },
          }
          if (element.borderWidth) image.outline = { color: element.borderColor, style: element.borderType, width: +(element.borderWidth * ratio).toFixed(2) }
          const clipShapes = ['rect', 'snip1Rect', 'snip2DiagRect', 'roundRect', 'ellipse', 'triangle', 'rtTriangle', 'diamond', 'pentagon', 'hexagon', 'heptagon', 'octagon', 'chevron', 'homePlate', 'rightArrow', 'parallelogram', 'trapezoid']
          let geometry = element.geom || 'rect'
          if (geometry.includes('custom:')) geometry = geometry.replace('custom:', '')
          if (!clipShapes.includes(geometry)) {
            // The picture still imports at the right bounds, but its mask is
            // squared off. Silently swapping a star-cropped photo for a
            // rectangle is exactly the kind of loss the report exists to name.
            issue = {
              code: 'pptx.image.unsupported-mask',
              message: `Picture mask ${geometry} has no Mona clip path; the image is cropped to its bounding rectangle instead`,
            }
            geometry = 'rect'
          }
          if (element.rect) image.clip = { range: [[element.rect.l || 0, element.rect.t || 0], [100 - (element.rect.r || 0), 100 - (element.rect.b || 0)]], shape: geometry }
          else if (element.geom) image.clip = { range: [[0, 0], [100, 100]], shape: geometry }
          if (element.link) image.link = { target: element.link, type: 'web' }
          if (element.shadow) image.shadow = { blur: element.shadow.blur * ratio, color: element.shadow.color, h: element.shadow.h * ratio, v: element.shadow.v * ratio }
          if (element.filters) {
            image.filters = {
              ...(element.filters.brightness !== undefined ? { brightness: `${Math.max(0, 1 + element.filters.brightness) * 100}%` } : {}),
              ...(element.filters.contrast !== undefined ? { contrast: `${Math.max(0, 1 + element.filters.contrast) * 100}%` } : {}),
              ...(element.filters.saturation !== undefined ? { saturate: `${Math.max(0, element.filters.saturation) * 100}%` } : {}),
            }
          }
          pushElement(image)
          disposition = 'approximated'
        }
        else if (element.type === 'math') {
          if (element.latex) {
            try {
              const rendered = renderPowerPointLatex(element.latex)
              const equation: PPTLatexElement = {
                color: slideTheme.fontColor,
                fallbackImage: element.picBase64 || undefined,
                fixedRatio: true,
                height: element.height,
                id: createPresentationId(10),
                latex: element.latex,
                left: element.left,
                path: rendered.path,
                ...(element.omml ? { powerPointMath: { omml: structuredClone(element.omml) } } : {}),
                rotate: element.rotate ?? 0,
                strokeWidth: 2,
                top: element.top,
                type: 'latex',
                viewBox: [rendered.w, rendered.h],
                width: element.width,
              }
              pushElement(equation)
            }
            catch {
              pushElement({ fixedRatio: true, height: element.height, id: createPresentationId(10), left: element.left, rotate: element.rotate ?? 0, src: element.picBase64, top: element.top, type: 'image', width: element.width })
            }
          }
          else {
            pushElement({ fixedRatio: true, height: element.height, id: createPresentationId(10), left: element.left, rotate: element.rotate ?? 0, src: element.picBase64, top: element.top, type: 'image', width: element.width })
          }
          disposition = 'approximated'
        }
        else if (element.type === 'audio') {
          const source = element.blob || (/^https?:\/\//.test(element.ref) ? element.ref : '')
          if (source) {
            pushElement({ autoplay: false, color: slideTheme.themeColors[0] ?? slideTheme.fontColor, fixedRatio: false, height: element.height, id: createPresentationId(10), left: element.left, loop: false, rotate: element.rotate ?? 0, src: importedAssetUrl(source), top: element.top, type: 'audio', width: element.width })
            disposition = 'approximated'
          }
          else {
            disposition = 'dropped'
            issue = { code: 'pptx.audio.missing-payload', message: 'Audio relationship could not be decoded into an importable payload' }
          }
        }
        else if (element.type === 'video') {
          const source = element.blob || (/^https?:\/\//.test(element.ref) ? element.ref : '')
          if (source || element.posterBase64) {
            pushElement({ autoplay: false, height: element.height, id: createPresentationId(10), left: element.left, poster: element.posterBase64 ? importedAssetUrl(element.posterBase64) : undefined, rotate: element.rotate ?? 0, src: importedAssetUrl(source), top: element.top, type: 'video', width: element.width })
            disposition = 'approximated'
          }
          else {
            disposition = 'dropped'
            issue = { code: 'pptx.video.missing-payload', message: 'Video relationship could not be decoded into an importable payload' }
          }
        }
        else if (element.type === 'shape') {
          if (
            element.shapType === 'line'
            || /(straight|bent|curved)Connector/.test(element.shapType)
            || element.native?.kind === 'connector'
            || (element.shapType === 'custom' && element.strokeOnly && !element.content)
          ) {
            const line = parseLineElement(element, ratio)
            if (sourceIdentity?.connector) {
              line.connections = structuredClone(sourceIdentity.connector)
            }
            pushElement(line)
          }
          else {
            const shape = shapeList.find(candidate => candidate.pptxShapeType === element.shapType)
            const gradient: Gradient | undefined = element.fill?.type === 'gradient' ? { colors: element.fill.value.colors.map(color => ({ ...color, pos: Number.parseInt(color.pos) })), rotate: element.fill.value.rot, type: element.fill.value.path === 'line' ? 'linear' : 'radial' } : undefined
            const metrics = getParagraphMetrics(element.content, ratio)
            const shapeId = createPresentationId(10)
            const structuredText = retainStructuredText(
              element.textBody,
              sourceIdentity?.stableId ?? shapeId,
              ratio,
            )
            const destination: PPTShapeElement = {
              fill: !element.strokeOnly && element.fill?.type === 'color' ? element.fill.value : '',
              fixedRatio: false,
              flipH: element.isFlipH,
              flipV: element.isFlipV,
              gradient,
              height: element.height,
              id: shapeId,
              left: element.left,
              outline: { color: element.borderColor, style: element.borderType, width: +(element.borderWidth * ratio).toFixed(2) },
              path: 'M 0 0 L 200 0 L 200 200 L 0 200 Z',
              pattern: element.fill?.type === 'image' ? importedAssetUrl(element.fill.value.base64) : undefined,
              // Canva and other web editors paint pictures as shape fills
              // rather than picture elements, so the fill mode decides whether
              // the artwork is stretched to the shape or cropped by it.
              patternFit: element.fill?.type === 'image' ? element.fill.value.fit : undefined,
              powerPointPattern: element.fill?.type === 'pattern'
                ? {
                    backgroundColor: element.fill.value.backgroundColor,
                    foregroundColor: element.fill.value.foregroundColor,
                    patternType: element.fill.value.type,
                  }
                : undefined,
              powerPointGeometry: {
                adjustments: Object.fromEntries(Object.entries(element.keypoints ?? {}).map(
                  ([name, value]) => [name, value * 50_000],
                )),
                preset: element.shapType,
              },
              rotate: element.rotate,
              text: {
                align: vAlignMap[element.vAlign] || 'middle',
                content: convertTextContent(element.content, ratio),
                defaultColor: slideTheme.fontColor,
                defaultFontName: slideTheme.fontName,
                ...(structuredText ? { structuredText } : {}),
              },
              top: element.top,
              type: 'shape',
              viewBox: [200, 200],
              width: element.width,
            }
            if (element.link) destination.link = { target: element.link, type: 'web' }
            if (element.textInset) destination.text!.inset = [
              element.textInset.t * ratio,
              element.textInset.r * ratio,
              element.textInset.b * ratio,
              element.textInset.l * ratio,
            ]
            if (metrics.lineHeight) destination.text!.lineHeight = metrics.lineHeight
            if (metrics.margin) destination.text!.paragraphSpace = metrics.margin
            if (element.shadow) destination.shadow = { blur: element.shadow.blur * ratio, color: element.shadow.color, h: element.shadow.h * ratio, v: element.shadow.v * ratio }
            if (shape) {
              destination.path = shape.path
              destination.viewBox = shape.viewBox
              if (shape.pathFormula) {
                destination.pathFormula = shape.pathFormula
                destination.viewBox = [element.width, element.height]
                const formula = SHAPE_PATH_FORMULAS[shape.pathFormula]
                if (formula?.editable) {
                  let values = formula.defaultValue
                  if (element.keypoints) {
                    let keypoint = 0
                    const point = element.keypoints
                    if (['roundRect', 'snip1Rect', 'round1Rect'].includes(element.shapType)) keypoint = (point.adj === undefined ? 0.334 : point.adj) * 0.5
                    if (element.shapType === 'snip2SameRect') keypoint = (point.adj1 === undefined ? 0.334 : point.adj1) * 0.5
                    if (element.shapType === 'snip2DiagRect') keypoint = (point.adj2 === undefined ? 0.334 : point.adj2) * 0.5
                    if (element.shapType === 'snipRoundRect') keypoint = ((point.adj1 === undefined ? 0.334 : point.adj1) + (point.adj2 === undefined ? 0.334 : point.adj2)) / 2 * 0.5
                    if (['round2SameRect', 'round2DiagRect'].includes(element.shapType)) keypoint = (point.adj1 === undefined ? 0.334 : point.adj1) * 0.5
                    if (element.shapType === 'triangle') keypoint = (point.adj === undefined ? 1 : point.adj) * 0.5
                    if (element.shapType === 'trapezoid') keypoint = (point.adj === undefined ? 0.5 : point.adj) * 0.5
                    if (element.shapType === 'frame') keypoint = (point.adj1 === undefined ? 0.25 : point.adj1) * 0.5
                    if (element.shapType === 'corner') keypoint = ((point.adj1 === undefined ? 1 : point.adj1) + (point.adj2 === undefined ? 1 : point.adj2)) / 2 * 0.5
                    if (['diagStripe', 'donut'].includes(element.shapType)) keypoint = (point.adj === undefined ? (element.shapType === 'donut' ? 0.5 : 1) : point.adj) * 0.5
                    if (element.shapType === 'plus') keypoint = 1 - (point.adj === undefined ? 0.5 : point.adj)
                    if (formula.range) keypoint = Math.max(formula.range[0]![0], Math.min(formula.range[0]![1], keypoint))
                    values = [keypoint]
                  }
                  destination.path = formula.formula(element.width, element.height, values)
                  destination.keypoints = values
                }
                else if (formula) destination.path = formula.formula(element.width, element.height)
              }
            }
            else if (element.path && !element.path.includes('NaN')) {
              destination.path = element.path
              const fixed = ['blockArc', 'pie', 'pieWedge', 'arc', 'chord', 'teardrop', 'mathPlus', 'mathMinus', 'mathMultiply', 'mathDivide', 'mathEqual', 'mathNotEqual']
              if (fixed.includes(element.shapType) && element.pathViewBox) destination.viewBox = [element.pathViewBox.width, element.pathViewBox.height]
              else {
                const { maxX, maxY } = svgPathRange(element.path)
                destination.viewBox = maxX / maxY > originWidth / originHeight ? [maxX, maxX * originHeight / originWidth] : [maxY * originWidth / originHeight, maxY]
              }
            }
            if (element.shapType === 'custom') {
              if (element.path!.includes('NaN')) {
                if (destination.width === 0) destination.width = 0.1
                if (destination.height === 0) destination.height = 0.1
                destination.path = element.path!.replace(/NaN/g, '0')
              }
              else destination.path = element.path!
              const { maxX, maxY } = svgPathRange(destination.path)
              destination.viewBox = maxX / maxY > originWidth / originHeight ? [maxX, maxX * originHeight / originWidth] : [maxY * originWidth / originHeight, maxY]
            }
            if (destination.path && destination.viewBox[0] && destination.viewBox[1]) pushElement(destination)
            if (hasPictureBullet(structuredText)) {
              issue = { code: 'pptx.bullet.picture-unsupported', message: 'Picture bullets are not resolved; the paragraph falls back to a disc marker' }
            }
          }
          disposition = destinationElements.length > outputCountBefore ? 'approximated' : 'dropped'
          if (disposition === 'dropped') {
            issue = { code: 'pptx.shape.invalid-geometry', message: 'Shape geometry could not be converted into a renderable Mona shape' }
          }
        }
        else if (element.type === 'table') {
          const baseStyle: TableCellStyle = { color: slideTheme.fontColor, fontname: slideTheme.fontName }
          const tableId = sourceIdentity?.stableId ?? createPresentationId(10)
          const data: TableCell[][] = element.data.map((row, rowIndex) => row.map((cell, columnIndex) => {
            const paragraphStyle = firstInlineStyle(cell.text, 'p')
            const spanStyle = firstInlineStyle(cell.text, 'span')
            const alignment = paragraphStyle.get('text-align') || 'left'
            const fontWeight = spanStyle.get('font-weight') || ''
            const decoration = spanStyle.get('text-decoration') || ''
            const borders = Object.fromEntries(Object.entries(cell.borders ?? {}).map(([side, border]) => [
              side,
              {
                color: border.borderColor,
                style: border.borderType,
                width: +((border.borderWidth ?? 0) * ratio).toFixed(2),
              },
            ])) as TableCell['borders']
            const structuredText = retainStructuredText(
              cell.textBody,
              `${tableId}/cell/r${rowIndex}c${columnIndex}`,
              ratio,
            )
            return {
              borders,
              colspan: cell.colSpan || 1,
              id: createPresentationId(10),
              powerPointCell: { columnIndex, rowIndex },
              rowspan: cell.rowSpan || 1,
              ...(cell.margin
                ? {
                    margin: [
                      cell.margin.t * ratio,
                      cell.margin.r * ratio,
                      cell.margin.b * ratio,
                      cell.margin.l * ratio,
                    ] as [number, number, number, number],
                  }
                : {}),
              ...(structuredText ? { structuredText } : {}),
              style: {
                ...baseStyle,
                align: ['left', 'right', 'center'].includes(alignment) ? alignment as 'center' | 'left' | 'right' : 'left',
                backcolor: cell.fillColor,
                bold: fontWeight === 'bold' || +fontWeight >= 600 || cell.fontBold,
                color: spanStyle.get('color') || cell.fontColor,
                em: spanStyle.get('font-style') === 'italic',
                fontname: spanStyle.get('font-family') || '',
                fontsize: spanStyle.get('font-size') ? `${(Number.parseInt(spanStyle.get('font-size') ?? '') * ratio).toFixed(1)}px` : '',
                strikethrough: decoration.includes('line-through'),
                underline: decoration.includes('underline'),
                vAlign: vAlignMap[cell.vAlign] || 'middle',
              },
              text: convertTextContent(cell.text, ratio),
            }
          }))
          const allWidth = element.colWidths.reduce((sum, width) => sum + width, 0)
          const borderCounter = new Map<string, { border: { borderColor?: string; borderType?: string; borderWidth?: number }; count: number }>()
          const collect = (borders?: Record<string, { borderColor?: string; borderType?: string; borderWidth?: number }>) => {
            if (!borders) return
            for (const side of ['top', 'bottom', 'left', 'right']) {
              const border = borders[side]
              if (!border?.borderWidth || (/^#[0-9a-fA-F]{8}$/.test(border.borderColor || '') && border.borderColor!.slice(-2).toLowerCase() === '00')) continue
              const key = `${border.borderColor}|${border.borderWidth}|${border.borderType}`
              const found = borderCounter.get(key)
              if (found) found.count += 1
              else borderCounter.set(key, { border, count: 1 })
            }
          }
          collect(element.borders)
          for (const row of element.data) for (const cell of row) collect(cell.borders)
          const border = [...borderCounter.values()].sort((a, b) => b.count - a.count)[0]?.border
          pushElement({
            cellMinHeight: element.rowHeights[0] ? element.rowHeights[0] * ratio : 36,
            colWidths: element.colWidths.map(width => width / allWidth), data, height: element.height, id: createPresentationId(10), left: element.left,
            outline: { color: border?.borderColor || '#eeece1', style: (border?.borderType || 'solid') as 'dashed' | 'dotted' | 'solid', width: +((border?.borderWidth || 0) * ratio || 2).toFixed(2) },
            rotate: element.rotate ?? 0,
            rowHeights: element.rowHeights.map(height => height * ratio),
            ...(element.tableProperties
              ? { powerPointTable: structuredClone(element.tableProperties) }
              : {}),
            top: element.top, type: 'table', width: element.width,
          })
          disposition = 'approximated'
        }
        else if (element.type === 'chart') {
          let labels: string[]
          let legends: string[]
          let series: number[][]
          if (element.chartType === 'scatterChart' || element.chartType === 'bubbleChart') {
            labels = element.data[0]!.map((_value, index) => coordinateLabel(index + 1))
            legends = element.data.map((_value, index) => index === 0 ? 'X' : index === 1 ? 'Y' : `Y${index}`)
            series = element.data
          }
          else {
            const chartData = element.data as ChartItem[]
            const categoryIndexes = [...new Set(chartData.flatMap(value => [
              ...Object.keys(value.xlabels),
              ...value.values.map(point => point.x),
            ]))].sort((left, right) => Number(left) - Number(right))
            labels = categoryIndexes.map(index => (
              chartData.find(value => value.xlabels[index] !== undefined)?.xlabels[index] ?? index
            ))
            legends = chartData.map(value => String(value.key))
            series = chartData.map(value => {
              const valuesByIndex = new Map(value.values.map(point => [point.x, point.y]))
              return categoryIndexes.map(index => valuesByIndex.get(index) ?? 0)
            })
          }
          const options: ChartOptions = {}
          const legendPositions: Record<string, NonNullable<ChartOptions['legendPosition']>> = {
            b: 'bottom',
            l: 'left',
            r: 'right',
            t: 'top',
            tr: 'right',
          }
          options.categoryAxisTitle = element.categoryAxisTitle || undefined
          options.gapWidth = element.gapWidth !== undefined ? Number.parseFloat(element.gapWidth) : undefined
          options.holeSize = element.holeSize !== undefined ? Number.parseFloat(element.holeSize) : undefined
          options.legendPosition = element.legendPosition ? legendPositions[element.legendPosition] : undefined
          options.marker = element.marker
          options.maximumValue = Number.isFinite(element.maximumValue) ? element.maximumValue : undefined
          options.minimumValue = Number.isFinite(element.minimumValue) ? element.minimumValue : undefined
          options.overlap = element.overlap !== undefined ? Number.parseFloat(element.overlap) : undefined
          options.showCategoryName = element.showCategoryName
          options.showDataLabels = element.showDataLabels
          options.showLegend = element.showLegend
          options.showMajorGridlines = element.showMajorGridlines
          options.showSeriesName = element.showSeriesName
          options.showValue = element.showValue
          options.title = element.title || undefined
          options.valueAxisTitle = element.valueAxisTitle || undefined
          if (element.chartSpace) {
            const valueAxes = element.chartSpace.plotArea.axes.filter(axis => axis.kind === 'value')
            if (valueAxes.length) {
              options.valueAxes = valueAxes.map(axis => ({
                id: axis.id,
                ...(axis.scaling?.max !== undefined ? { maximumValue: axis.scaling.max } : {}),
                ...(axis.scaling?.min !== undefined ? { minimumValue: axis.scaling.min } : {}),
                ...(axis.numberFormat?.formatCode ? { numberFormat: axis.numberFormat.formatCode } : {}),
                ...(axis.position ? { position: axis.position } : {}),
                ...(axis.title ? { title: axis.title } : {}),
              }))
              const axisIndexById = new Map(valueAxes.map((axis, index) => [axis.id, index]))
              options.seriesAxisIndexes = element.chartSpace.plotArea.families.flatMap(family => {
                const valueAxisId = family.axisIds.find(id => axisIndexById.has(id))
                const axisIndex = valueAxisId ? axisIndexById.get(valueAxisId) ?? 0 : 0
                return family.series.map(() => axisIndex)
              })
            }
          }
          const importedBarDirection = 'barDir' in element ? element.barDir : undefined
          // Chart families Mona has no equivalent for. They still import with
          // their retained series so the data stays visible and editable, but
          // the drawn marks are not the source family and the report has to
          // say so rather than presenting a candlestick as a bar chart.
          const unmodelledChartTypes = new Set(['stockChart', 'surface3DChart', 'surfaceChart'])
          const unmodelled = new Set<string>()
          const mapChartType = (value: string): ChartType => {
            if (value === 'barChart' || value === 'bar3DChart') return importedBarDirection === 'bar' ? 'column' : 'bar'
            if (value === 'lineChart' || value === 'line3DChart') return 'line'
            if (value === 'areaChart' || value === 'area3DChart') return 'area'
            if (value === 'scatterChart' || value === 'bubbleChart') return 'scatter'
            if (value === 'pieChart' || value === 'pie3DChart') return 'pie'
            if (value === 'radarChart') return 'radar'
            if (value === 'doughnutChart') return 'ring'
            unmodelled.add(value)
            return 'bar'
          }
          if (element.seriesChartTypes?.length) {
            options.seriesTypes = element.seriesChartTypes.map(mapChartType)
          }
          if (unmodelledChartTypes.has(element.chartType)) unmodelled.add(element.chartType)
          let chartType: ChartType = 'bar'
          switch (element.chartType) {
            case 'barChart': case 'bar3DChart': chartType = element.barDir === 'bar' ? 'column' : 'bar'; if (['stacked', 'percentStacked'].includes(element.grouping || '')) options.stack = true; if (element.grouping === 'percentStacked') options.percentStacked = true; break
            case 'lineChart': case 'line3DChart': chartType = 'line'; if (['stacked', 'percentStacked'].includes(element.grouping || '')) options.stack = true; if (element.grouping === 'percentStacked') options.percentStacked = true; break
            case 'areaChart': case 'area3DChart': chartType = 'area'; if (['stacked', 'percentStacked'].includes(element.grouping || '')) options.stack = true; if (element.grouping === 'percentStacked') options.percentStacked = true; break
            case 'scatterChart': case 'bubbleChart': chartType = 'scatter'; break
            case 'pieChart': case 'pie3DChart': chartType = 'pie'; break
            case 'radarChart': chartType = 'radar'; break
            case 'doughnutChart': chartType = 'ring'; break
          }
          pushElement({ chartType, ...(element.resources ? { chartSource: element.resources } : {}), ...(element.chartSpace ? { chartSpace: element.chartSpace } : {}), data: { labels, legends, series }, height: element.height, id: createPresentationId(10), left: element.left, options, rotate: element.rotate ?? 0, textColor: slideTheme.fontColor, themeColors: element.colors.filter(Boolean).length ? element.colors.filter(Boolean) : slideTheme.themeColors, top: element.top, type: 'chart', width: element.width })
          disposition = 'approximated'
          if (unmodelled.size) {
            issue = {
              code: 'pptx.chart.unsupported-type',
              message: `PowerPoint chart type ${[...unmodelled].sort().join(', ')} has no Mona chart family; its series are retained but drawn as ${chartType}`,
            }
          }
          else if (element.resources?.externalWorkbook) {
            issue = {
              code: 'pptx.chart.external-workbook',
              message: `Chart data links to ${element.resources.externalWorkbook}, which the deck does not embed; the cached values render but the source cannot be opened`,
            }
          }
        }
        else if (element.type === 'group') {
          const children: PPTElement[] = []
          parseElements(structuredClone(element.elements), resolvedSourceLayer, undefined, children)
          const group: PPTGroupElement = {
            coordinateHeight: Math.max(element.height, 0.001),
            coordinateWidth: Math.max(element.width, 0.001),
            elements: children,
            flipH: element.isFlipH,
            flipV: element.isFlipV,
            height: element.height,
            id: createPresentationId(10),
            left: element.left,
            rotate: element.rotate ?? 0,
            semanticType: 'group',
            top: element.top,
            type: 'group',
            width: element.width,
          }
          pushElement(group)
          disposition = children.length ? 'approximated' : 'opaque'
          if (!children.length) {
            issue = { code: 'pptx.group.empty-conversion', message: 'The native group is preserved, but none of its children have a semantic renderer yet' }
          }
        }
        else if (element.type === 'diagram') {
          const children: PPTElement[] = []
          parseElements(structuredClone(element.elements), resolvedSourceLayer, undefined, children)
          const diagram: PPTGroupElement = {
            coordinateHeight: Math.max(element.height, 0.001),
            coordinateWidth: Math.max(element.width, 0.001),
            elements: children,
            height: element.height,
            id: createPresentationId(10),
            left: element.left,
            rotate: 0,
            semanticType: 'diagram',
            ...(element.resources
              ? {
                  powerPointDiagram: {
                    ...structuredClone(element.resources),
                    ...(element.semanticModel
                      ? { model: structuredClone(element.semanticModel) }
                      : {}),
                  },
                }
              : {}),
            top: element.top,
            type: 'group',
            width: element.width,
          }
          pushElement(diagram)
          disposition = children.length ? 'approximated' : 'opaque'
          if (!children.length) {
            issue = { code: 'pptx.diagram.empty-conversion', message: 'The SmartArt frame is preserved, but its diagram drawing has no renderable children' }
          }
        }
        else if (element.type === 'opaque') {
          const opaque: PPTOpaqueElement = {
            height: element.height,
            id: createPresentationId(10),
            label: element.label,
            left: element.left,
            opaqueType: element.opaqueType,
            reason: element.reason,
            relationshipIds: element.relationshipIds,
            rotate: element.rotate ?? 0,
            top: element.top,
            type: 'opaque',
            width: element.width,
          }
          pushElement(opaque)
          disposition = 'opaque'
          issue = {
            code: 'pptx.element.opaque',
            message: element.reason || 'The original PowerPoint object is preserved without a semantic Mona renderer',
          }
        }
        if (!disposition) {
          disposition = 'dropped'
          issue = {
            code: 'pptx.element.unsupported',
            message: `Unsupported PowerPoint element type: ${element.type}`,
          }
        }
        const unsupportedEffects = sourceIdentity?.visual?.effects.filter(effect => (
          !['outerShdw', 'solidFill'].includes(effect.type)
        )) ?? []
        if (
          !issue
          && sourceIdentity?.visual
          && (unsupportedEffects.length || sourceIdentity.visual.hasScene3d || sourceIdentity.visual.hasShape3d)
        ) {
          issue = {
            code: 'pptx.visual.approximated-effects',
            message: `Native visual effects are retained but not fully rendered: ${[
              ...new Set(unsupportedEffects.map(effect => effect.type)),
              ...(sourceIdentity.visual.hasScene3d ? ['scene3d'] : []),
              ...(sourceIdentity.visual.hasShape3d ? ['sp3d'] : []),
            ].join(', ')}`,
          }
        }
        recordOutcome(element, resolvedSourceLayer, disposition, issue)
      }
    }
    if (sourceDependency?.masterPart && !masterElementsByPart.has(sourceDependency.masterPart)) {
      const masterElements: PPTElement[] = []
      parseElements(item.masterElements ?? [], 'master', undefined, masterElements)
      masterElementsByPart.set(sourceDependency.masterPart, masterElements)
    }
    if (sourceDependency?.masterPart && item.backgrounds?.master && !masterBackgroundsByPart.has(sourceDependency.masterPart)) {
      masterBackgroundsByPart.set(
        sourceDependency.masterPart,
        slideBackground(item.backgrounds.master, importedAssetUrl),
      )
    }
    if (sourceDependency?.layoutPart && !layoutElementsByPart.has(sourceDependency.layoutPart)) {
      const layoutElements: PPTElement[] = []
      parseElements(item.layoutElements, 'layout', undefined, layoutElements)
      layoutElementsByPart.set(sourceDependency.layoutPart, layoutElements)
    }
    if (sourceDependency?.layoutPart && item.backgrounds?.layout && !layoutBackgroundsByPart.has(sourceDependency.layoutPart)) {
      layoutBackgroundsByPart.set(
        sourceDependency.layoutPart,
        slideBackground(item.backgrounds.layout, importedAssetUrl),
      )
    }
    parseElements(item.elements, 'slide')
    slides.push(slide)
    slideReports.push({
      capabilities: [...capabilityCounts.values()].sort((left, right) => left.sourceType.localeCompare(right.sourceType)),
      counts: slideCounts,
      issues,
      outputElementCount: slide.elements.length
        + (sourceDependency?.layoutPart ? layoutElementsByPart.get(sourceDependency.layoutPart)?.length ?? 0 : 0)
        + (sourceDependency?.masterPart ? masterElementsByPart.get(sourceDependency.masterPart)?.length ?? 0 : 0),
      slideIndex,
      slidePart: sourceDependency?.slidePart,
      sourceObjectCount,
    })
  }
  for (const slide of slides) {
    const layoutElements = slide.source?.layoutPart
      ? layoutElementsByPart.get(slide.source.layoutPart) ?? []
      : []
    const masterElements = slide.source?.masterPart
      ? masterElementsByPart.get(slide.source.masterPart) ?? []
      : []
    for (const element of flattenElementTree(slide.elements)) {
      const source = element.source
      if (
        !source
        || source.sourceLayer !== 'slide'
        || (source.placeholderIndex === undefined && source.placeholderType === undefined)
      ) continue
      const layoutPlaceholder = findMatchingPlaceholder(layoutElements, source)
      const masterPlaceholder = findMatchingPlaceholder(
        masterElements,
        layoutPlaceholder?.source ?? source,
      )
      if (layoutPlaceholder?.source?.sourceObjectId) {
        source.placeholderLayoutObjectId = layoutPlaceholder.source.sourceObjectId
      }
      if (masterPlaceholder?.source?.sourceObjectId) {
        source.placeholderMasterObjectId = masterPlaceholder.source.sourceObjectId
      }
    }
  }
  const report: PowerPointImportReport = {
    counts: packageCounts,
    packageId: sourcePackage?.packageId ?? 'pptx:untracked',
    packageIssues: sourceManifest?.issues ?? [],
    packageParts: {
      preserved: sourceManifest?.parts.length ?? 0,
      relationships: sourceManifest?.relationships.length ?? 0,
      total: sourceManifest?.parts.length ?? 0,
      unknown: sourceManifest?.parts.filter(part => part.kind === 'unknown').length ?? 0,
    },
    schemaVersion: 1,
    slides: slideReports,
    status: packageCounts.dropped || sourceManifest?.issues.some(issue => issue.severity === 'error')
      ? 'complete-with-loss'
      : packageCounts.approximated || packageCounts.opaque
        ? 'complete-with-approximations'
        : 'complete',
  }
  const baseHierarchy: PowerPointHierarchy | undefined = sourcePackage
    ? sourcePackage.hierarchy ?? {
        layouts: [...new Map(sourcePackage.slides.flatMap(dependency => dependency.layoutPart
          ? [[dependency.layoutPart, {
              id: `${sourcePackage.packageId}/${dependency.layoutPart}`,
              masterId: dependency.masterPart ? `${sourcePackage.packageId}/${dependency.masterPart}` : undefined,
              objectIds: (sourceManifest?.objects ?? []).filter(object => object.partPath === dependency.layoutPart).map(object => object.stableId),
              packageId: sourcePackage.packageId,
              partPath: dependency.layoutPart,
              preserve: false,
              showMasterPlaceholderAnimations: true,
              showMasterShapes: true,
            }] as const]
          : [])).values()],
        masters: [...new Map(sourcePackage.slides.flatMap(dependency => dependency.masterPart
          ? [[dependency.masterPart, {
              id: `${sourcePackage.packageId}/${dependency.masterPart}`,
              layoutIds: sourcePackage.slides
                .filter(candidate => candidate.masterPart === dependency.masterPart && candidate.layoutPart)
                .map(candidate => `${sourcePackage.packageId}/${candidate.layoutPart}`),
              objectIds: (sourceManifest?.objects ?? []).filter(object => object.partPath === dependency.masterPart).map(object => object.stableId),
              packageId: sourcePackage.packageId,
              partPath: dependency.masterPart,
              preserve: false,
              themeId: dependency.themePart ? `${sourcePackage.packageId}/${dependency.themePart}` : undefined,
            }] as const]
          : [])).values()],
        placeholders: [],
        themes: [],
      }
    : undefined
  const semanticSourcePackage = sourcePackage && baseHierarchy
    ? {
        ...sourcePackage,
        hierarchy: {
          ...baseHierarchy,
          layouts: baseHierarchy.layouts.map(layout => ({
            ...layout,
            background: layoutBackgroundsByPart.get(layout.partPath) ?? layout.background,
            elements: layoutElementsByPart.get(layout.partPath) ?? layout.elements ?? [],
          })),
          masters: baseHierarchy.masters.map(master => ({
            ...master,
            background: masterBackgroundsByPart.get(master.partPath) ?? master.background,
            elements: masterElementsByPart.get(master.partPath) ?? master.elements ?? [],
          })),
          placeholders: baseHierarchy.placeholders.map(placeholder => {
            const elements = placeholder.layer === 'layout'
              ? layoutElementsByPart.get(placeholder.partPath)
              : placeholder.layer === 'master'
                ? masterElementsByPart.get(placeholder.partPath)
                : slides.flatMap(slide => slide.elements)
            const elementId = flattenElementTree(elements ?? []).find(element => (
              element.source?.sourceObjectId === placeholder.objectId
            ))?.id
            return {
              ...placeholder,
              ...(elementId ? { elementId } : {}),
            }
          }),
        },
      }
    : sourcePackage
  return {
    assets: assetCollector.take(),
    report,
    slides,
    sourcePackage: semanticSourcePackage,
  }
}

export const convertParsedPptxSlides = (
  options: Parameters<typeof convertParsedPptxPresentation>[0],
): Slide[] => convertParsedPptxPresentation(options).slides
