import tinycolor from 'tinycolor2'
import { SVGPathData, SVGPathDataTransformer } from 'svg-pathdata'
import type { ChartItem, Element as PptxElement, Shape as PptxShape, Slide as ParsedSlide } from '@mona/pptx-parser'

import {
  createPresentationId,
  type PowerPointImportCapabilityReport,
  type PowerPointImportDisposition,
  type PowerPointImportDispositionCounts,
  type PowerPointImportIssue,
  type PowerPointImportReport,
  type PowerPointElementSourceLayer,
  type PowerPointPackageManifest,
  type PowerPointPackageReference,
} from '@mona/presentation-core'
import type {
  ChartOptions,
  ChartType,
  Gradient,
  LinePoint,
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
  TableCell,
  TableCellStyle,
  TextAlignVertical,
} from '@mona/presentation-core/model'
import { SHAPE_LIST, SHAPE_PATH_FORMULAS, type ShapePoolItem } from '@mona/presentation-core/shape-presets'
import { renderLatex } from '@/features/editor/editor-latex'

export { getImportedAspectRatio } from '@/features/editor/editor-import-geometry'

export interface ParsedPptxPresentation {
  slides: ParsedSlide[]
  themeColors: string[]
  usedFonts: string[]
  size: { height: number; width: number }
}

const vAlignMap: Record<string, TextAlignVertical> = { down: 'bottom', mid: 'middle', up: 'top' }

const getTextNodeStyleSpan = (textNode: Text, styleProp: 'color' | 'fontSize') => {
  let parent = textNode.parentElement
  while (parent) {
    if (parent.tagName === 'SPAN' && parent.style[styleProp]) return parent
    if (parent.tagName === 'LI') break
    parent = parent.parentElement
  }
  return null
}

const getListItemStyleValue = (li: HTMLLIElement, styleProp: 'color' | 'fontSize') => {
  const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT)
  let styleSpan: HTMLSpanElement | null = null
  let hasTextContent = false
  let currentNode = walker.nextNode()
  while (currentNode) {
    const textNode = currentNode as Text
    if (textNode.textContent?.replace(/\s+/g, '') && textNode.parentElement?.closest('li') === li) {
      hasTextContent = true
      const currentStyleSpan = getTextNodeStyleSpan(textNode, styleProp)
      if (!currentStyleSpan) return ''
      if (!styleSpan) styleSpan = currentStyleSpan as HTMLSpanElement
      else if (styleSpan !== currentStyleSpan) return ''
    }
    currentNode = walker.nextNode()
  }
  return hasTextContent && styleSpan ? styleSpan.style[styleProp] : ''
}

const promoteListTextStyle = (html: string) => {
  if (!/<(ul|ol)\b/i.test(html) || (!/font-size\s*:/i.test(html) && !/color\s*:/i.test(html))) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.body.querySelectorAll<HTMLElement>('ul, ol').forEach(list => {
    const items = Array.from(list.children).filter(child => child.tagName === 'LI') as HTMLLIElement[]
    if (!items.length) return
    for (const property of ['fontSize', 'color'] as const) {
      if (list.style[property]) continue
      let value = ''
      for (const item of items) {
        const current = getListItemStyleValue(item, property)
        if (!current || (value && value !== current)) {
          value = ''
          break
        }
        value = current
      }
      if (value) list.style[property] = value
    }
  })
  return doc.body.innerHTML
}

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
  return promoteListTextStyle(processed)
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
  }
  if (element.rotate) {
    const rotated = rotateLine(line, element.rotate)
    line.start = rotated.start
    line.end = rotated.end
    line.left += rotated.offset[0]
    line.top += rotated.offset[1]
    rotateOffset = rotated.offset
  }
  if (/bentConnector/.test(element.shapType)) {
    const defaults = () => {
      line.broken2 = [Math.abs(line.start[0] - line.end[0]) / 2, Math.abs(line.start[1] - line.end[1]) / 2] 
    }
    const points = (limit: number) => {
      if (!element.path) return []
      return pathPoints(element.path).map(point => {
        let x = element.pathViewBox?.width ? point.x / element.pathViewBox.width * element.width : point.x * ratio
        let y = element.pathViewBox?.height ? point.y / element.pathViewBox.height * element.height : point.y * ratio
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
        return [x, y] as [number, number]
      }).slice(0, limit)
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
  return line
}

const slideBackground = (parsed: ParsedSlide): SlideBackground => {
  const { type, value } = parsed.fill
  if (type === 'image') return { image: { size: 'stretch', src: value.base64 }, type: 'image' }
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

const emptyDispositionCounts = (): PowerPointImportDispositionCounts => ({
  approximated: 0,
  dropped: 0,
  modeled: 0,
  opaque: 0,
})

export const convertParsedPptxPresentation = ({
  coordinateLabel,
  parsed,
  ratio,
  sourceManifest,
  sourcePackage,
  theme,
}: {
  coordinateLabel: (index: number) => string
  parsed: ParsedPptxPresentation
  ratio: number
  sourceManifest?: PowerPointPackageManifest
  sourcePackage?: PowerPointPackageReference
  theme: SlideTheme
}) => {
  const shapeList: ShapePoolItem[] = SHAPE_LIST.flatMap(group => group.children)
  const slides: Slide[] = []
  const packageCounts = emptyDispositionCounts()
  const slideReports: PowerPointImportReport['slides'] = []
  const sourceOrder = new Map(sourcePackage?.slides.map((slide, index) => [slide.slidePart, index]) ?? [])
  const identitiesByPartAndNativeId = new Map<string, PowerPointPackageManifest['objects']>()
  const layoutElementsByPart = new Map<string, PPTElement[]>()
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
      background: slideBackground(item),
      ...(item.transition?.autoNextAfter && item.transition.autoNextAfter >= 1000
        ? { durationMs: item.transition.autoNextAfter }
        : {}),
      elements: [],
      hidden: item.hidden,
      id: createPresentationId(10),
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
          if (sourcePackage && sourceDependency && sourceIdentity) {
            destination.source = {
              kind: 'pptx',
              nativeShapeId: sourceIdentity.nativeId,
              packageId: sourcePackage.packageId,
              placeholderIndex: sourceIdentity.placeholderIndex,
              placeholderType: sourceIdentity.placeholderType,
              slidePart: sourceDependency.slidePart,
              sourceObjectId: sourceIdentity.stableId,
              sourceLayer: resolvedSourceLayer,
              sourceOrder: element.order,
              sourcePart: sourceIdentity.partPath,
              stableId: sourceIdentity.stableId,
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
          const text: PPTTextElement = {
            content: convertTextContent(element.content, textRatio),
            defaultColor: slideTheme.fontColor,
            defaultFontName: slideTheme.fontName,
            fill: element.fill?.type === 'color' ? element.fill.value : '',
            height: element.height,
            id: createPresentationId(10),
            left: element.left,
            lineHeight: 1,
            outline: { color: element.borderColor, style: element.borderType, width: +(element.borderWidth * ratio).toFixed(2) },
            rotate: element.rotate,
            top: element.top,
            type: 'text',
            vertical: element.isVertical,
            width: element.width,
          }
          if (!adaptive) {
            text.fixedHeight = true; text.vAlign = vAlignMap[element.vAlign] || 'top' 
          }
          if (element.shadow) text.shadow = { blur: element.shadow.blur * ratio, color: element.shadow.color, h: element.shadow.h * ratio, v: element.shadow.v * ratio }
          if (element.link) text.link = { target: element.link, type: 'web' }
          if (element.textInset) text.inset = [element.textInset.t, element.textInset.r, element.textInset.b, element.textInset.l]
          if (metrics.lineHeight) text.lineHeight = metrics.lineHeight
          if (metrics.margin) text.paragraphSpace = metrics.margin
          pushElement(text)
          disposition = 'approximated'
        }
        else if (element.type === 'image') {
          const image: PPTImageElement = {
            fixedRatio: true, flipH: element.isFlipH, flipV: element.isFlipV, height: element.height, id: createPresentationId(10), left: element.left,
            opacity: element.opacity, rotate: element.rotate, src: element.base64, top: element.top, type: 'image', width: element.width,
          }
          if (element.borderWidth) image.outline = { color: element.borderColor, style: element.borderType, width: +(element.borderWidth * ratio).toFixed(2) }
          const clipShapes = ['rect', 'snip1Rect', 'snip2DiagRect', 'roundRect', 'ellipse', 'triangle', 'rtTriangle', 'diamond', 'pentagon', 'hexagon', 'heptagon', 'octagon', 'chevron', 'homePlate', 'rightArrow', 'parallelogram', 'trapezoid']
          let geometry = element.geom || 'rect'
          if (geometry.includes('custom:')) geometry = geometry.replace('custom:', '')
          if (!clipShapes.includes(geometry)) geometry = 'rect'
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
              const rendered = renderLatex(element.latex)
              const equation: PPTLatexElement = {
                color: slideTheme.fontColor,
                fallbackImage: element.picBase64 || undefined,
                fixedRatio: true,
                height: element.height,
                id: createPresentationId(10),
                latex: element.latex,
                left: element.left,
                path: rendered.path,
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
            pushElement({ autoplay: false, color: slideTheme.themeColors[0] ?? slideTheme.fontColor, fixedRatio: false, height: element.height, id: createPresentationId(10), left: element.left, loop: false, rotate: element.rotate ?? 0, src: source, top: element.top, type: 'audio', width: element.width })
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
            pushElement({ autoplay: false, height: element.height, id: createPresentationId(10), left: element.left, poster: element.posterBase64, rotate: element.rotate ?? 0, src: source, top: element.top, type: 'video', width: element.width })
            disposition = 'approximated'
          }
          else {
            disposition = 'dropped'
            issue = { code: 'pptx.video.missing-payload', message: 'Video relationship could not be decoded into an importable payload' }
          }
        }
        else if (element.type === 'shape') {
          if (element.shapType === 'line' || /(straight|bent|curved)Connector/.test(element.shapType)) pushElement(parseLineElement(element, ratio))
          else {
            const shape = shapeList.find(candidate => candidate.pptxShapeType === element.shapType)
            const gradient: Gradient | undefined = element.fill?.type === 'gradient' ? { colors: element.fill.value.colors.map(color => ({ ...color, pos: Number.parseInt(color.pos) })), rotate: element.fill.value.rot, type: element.fill.value.path === 'line' ? 'linear' : 'radial' } : undefined
            const metrics = getParagraphMetrics(element.content, ratio)
            const destination: PPTShapeElement = {
              fill: !element.strokeOnly && element.fill?.type === 'color' ? element.fill.value : '',
              fixedRatio: false,
              flipH: element.isFlipH,
              flipV: element.isFlipV,
              gradient,
              height: element.height,
              id: createPresentationId(10),
              left: element.left,
              outline: { color: element.borderColor, style: element.borderType, width: +(element.borderWidth * ratio).toFixed(2) },
              path: 'M 0 0 L 200 0 L 200 200 L 0 200 Z',
              pattern: element.fill?.type === 'image' ? element.fill.value.base64 : undefined,
              powerPointPattern: element.fill?.type === 'pattern'
                ? {
                    backgroundColor: element.fill.value.backgroundColor,
                    foregroundColor: element.fill.value.foregroundColor,
                    patternType: element.fill.value.type,
                  }
                : undefined,
              rotate: element.rotate,
              text: { align: vAlignMap[element.vAlign] || 'middle', content: convertTextContent(element.content, ratio), defaultColor: slideTheme.fontColor, defaultFontName: slideTheme.fontName },
              top: element.top,
              type: 'shape',
              viewBox: [200, 200],
              width: element.width,
            }
            if (element.link) destination.link = { target: element.link, type: 'web' }
            if (element.textInset) destination.text!.inset = [element.textInset.t, element.textInset.r, element.textInset.b, element.textInset.l]
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
                if (formula.editable) {
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
                else destination.path = formula.formula(element.width, element.height)
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
          }
          disposition = destinationElements.length > outputCountBefore ? 'approximated' : 'dropped'
          if (disposition === 'dropped') {
            issue = { code: 'pptx.shape.invalid-geometry', message: 'Shape geometry could not be converted into a renderable Mona shape' }
          }
        }
        else if (element.type === 'table') {
          const baseStyle: TableCellStyle = { color: slideTheme.fontColor, fontname: slideTheme.fontName }
          const data: TableCell[][] = element.data.map(row => row.map(cell => {
            const container = document.createElement('div')
            container.innerHTML = cell.text
            const paragraph = container.querySelector('p')
            const alignment = paragraph?.style.textAlign || 'left'
            const span = container.querySelector('span')
            const fontWeight = span?.style.fontWeight || ''
            const decoration = span?.style.textDecoration || ''
            const borders = Object.fromEntries(Object.entries(cell.borders ?? {}).map(([side, border]) => [
              side,
              {
                color: border.borderColor,
                style: border.borderType,
                width: +((border.borderWidth ?? 0) * ratio).toFixed(2),
              },
            ])) as TableCell['borders']
            return {
              borders,
              colspan: cell.colSpan || 1,
              id: createPresentationId(10),
              rowspan: cell.rowSpan || 1,
              style: {
                ...baseStyle,
                align: ['left', 'right', 'center'].includes(alignment) ? alignment as 'center' | 'left' | 'right' : 'left',
                backcolor: cell.fillColor,
                bold: fontWeight === 'bold' || +fontWeight >= 600 || cell.fontBold,
                color: span?.style.color || cell.fontColor,
                em: span?.style.fontStyle === 'italic',
                fontname: span?.style.fontFamily || '',
                fontsize: span?.style.fontSize ? `${(Number.parseInt(span.style.fontSize) * ratio).toFixed(1)}px` : '',
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
          const importedBarDirection = 'barDir' in element ? element.barDir : undefined
          const mapChartType = (value: string): ChartType => {
            if (value === 'barChart' || value === 'bar3DChart') return importedBarDirection === 'bar' ? 'column' : 'bar'
            if (value === 'lineChart' || value === 'line3DChart') return 'line'
            if (value === 'areaChart' || value === 'area3DChart') return 'area'
            if (value === 'scatterChart' || value === 'bubbleChart') return 'scatter'
            if (value === 'pieChart' || value === 'pie3DChart') return 'pie'
            if (value === 'radarChart') return 'radar'
            if (value === 'doughnutChart') return 'ring'
            return 'bar'
          }
          if (element.seriesChartTypes?.length) {
            options.seriesTypes = element.seriesChartTypes.map(mapChartType)
          }
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
          pushElement({ chartType, data: { labels, legends, series }, height: element.height, id: createPresentationId(10), left: element.left, options, rotate: element.rotate ?? 0, textColor: slideTheme.fontColor, themeColors: element.colors.filter(Boolean).length ? element.colors.filter(Boolean) : slideTheme.themeColors, top: element.top, type: 'chart', width: element.width })
          disposition = 'approximated'
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
        recordOutcome(element, resolvedSourceLayer, disposition, issue)
      }
    }
    if (sourceDependency?.masterPart && !masterElementsByPart.has(sourceDependency.masterPart)) {
      const masterElements: PPTElement[] = []
      parseElements(item.masterElements ?? [], 'master', undefined, masterElements)
      masterElementsByPart.set(sourceDependency.masterPart, masterElements)
    }
    if (sourceDependency?.layoutPart && !layoutElementsByPart.has(sourceDependency.layoutPart)) {
      const layoutElements: PPTElement[] = []
      parseElements(item.layoutElements, 'layout', undefined, layoutElements)
      layoutElementsByPart.set(sourceDependency.layoutPart, layoutElements)
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
  const baseHierarchy = sourcePackage
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
            elements: layoutElementsByPart.get(layout.partPath) ?? [],
          })),
          masters: baseHierarchy.masters.map(master => ({
            ...master,
            elements: masterElementsByPart.get(master.partPath) ?? [],
          })),
        },
      }
    : sourcePackage
  return { report, slides, sourcePackage: semanticSourcePackage }
}

export const convertParsedPptxSlides = (
  options: Parameters<typeof convertParsedPptxPresentation>[0],
): Slide[] => convertParsedPptxPresentation(options).slides
