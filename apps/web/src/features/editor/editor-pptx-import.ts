import tinycolor from 'tinycolor2'
import { SVGPathData, SVGPathDataTransformer } from 'svg-pathdata'
import type { BaseElement as PptxBaseElement, ChartItem, Element as PptxElement, Shape as PptxShape, Slide as ParsedSlide } from 'pptxtojson'

import { createPresentationId } from '@mona/presentation-core'
import type {
  ChartOptions,
  ChartType,
  Gradient,
  LinePoint,
  PPTImageElement,
  PPTLineElement,
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
    const cubic: [number, number] = [Math.abs(line.start[0] - line.end[0]) / 2, Math.abs(line.start[1] - line.end[1]) / 2]
    line.cubic = [cubic, cubic]
  }
  return line
}

const flipGroupElements = (elements: PptxBaseElement[], axis: 'x' | 'y') => {
  const minX = Math.min(...elements.map(element => element.left))
  const maxX = Math.max(...elements.map(element => element.left + element.width))
  const minY = Math.min(...elements.map(element => element.top))
  const maxY = Math.max(...elements.map(element => element.top + element.height))
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  return elements.map(element => ({
    ...element,
    ...(axis === 'y' ? { left: 2 * centerX - element.left - element.width } : {}),
    ...(axis === 'x' ? { top: 2 * centerY - element.top - element.height } : {}),
  }))
}

const calculateRotatedPosition = (ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number, ak: number, bk: number) => {
  const radians = ak * (Math.PI / 180)
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const centerX = ax + aw / 2
  const centerY = ay + ah / 2
  const corners = [
    { ox: bx, oy: by },
    { ox: bx + bw, oy: by },
    { ox: bx + bw, oy: by + bh },
    { ox: bx, oy: by + bh },
  ]
  let minX = Infinity
  let minY = Infinity
  for (const corner of corners) {
    const relativeX = corner.ox - aw / 2
    const relativeY = corner.oy - ah / 2
    const rotatedX = relativeX * cosine + relativeY * sine
    const rotatedY = -relativeX * sine + relativeY * cosine
    const graphicX = centerX + rotatedX
    const graphicY = centerY + rotatedY
    minX = Math.min(minX, graphicX)
    minY = Math.min(minY, graphicY)
  }
  return { globalRotation: (bk + ak) % 360, x: minX, y: minY }
}

const slideBackground = (parsed: ParsedSlide): SlideBackground => {
  const { type, value } = parsed.fill
  if (type === 'image') return { image: { size: 'cover', src: value.base64 }, type: 'image' }
  if (type === 'gradient') return { gradient: { colors: value.colors.map(color => ({ ...color, pos: Number.parseInt(color.pos) })), rotate: value.rot, type: value.path === 'line' ? 'linear' : 'radial' }, type: 'gradient' }
  if (type === 'pattern') return { color: '#fff', type: 'solid' }
  return { color: value || '#fff', type: 'solid' }
}

export const convertParsedPptxSlides = ({
  coordinateLabel,
  parsed,
  ratio,
  theme,
}: {
  coordinateLabel: (index: number) => string
  parsed: ParsedPptxPresentation
  ratio: number
  theme: SlideTheme
}) => {
  const shapeList: ShapePoolItem[] = SHAPE_LIST.flatMap(group => group.children)
  const slides: Slide[] = []
  for (const item of parsed.slides) {
    const slide: Slide = { background: slideBackground(item), elements: [], id: createPresentationId(10), remark: item.note || '' }
    const parseElements = (elements: PptxElement[]) => {
      for (const element of elements.sort((a, b) => a.order - b.order)) {
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
            defaultColor: theme.fontColor,
            defaultFontName: theme.fontName,
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
          slide.elements.push(text)
        }
        else if (element.type === 'image') {
          const image: PPTImageElement = {
            fixedRatio: true, flipH: element.isFlipH, flipV: element.isFlipV, height: element.height, id: createPresentationId(10), left: element.left,
            rotate: element.rotate, src: element.base64, top: element.top, type: 'image', width: element.width,
          }
          if (element.borderWidth) image.outline = { color: element.borderColor, style: element.borderType, width: +(element.borderWidth * ratio).toFixed(2) }
          const clipShapes = ['rect', 'snip1Rect', 'snip2DiagRect', 'roundRect', 'ellipse', 'triangle', 'rtTriangle', 'diamond', 'pentagon', 'hexagon', 'heptagon', 'octagon', 'chevron', 'homePlate', 'rightArrow', 'parallelogram', 'trapezoid']
          let geometry = element.geom || 'rect'
          if (geometry.includes('custom:')) geometry = geometry.replace('custom:', '')
          if (!clipShapes.includes(geometry)) geometry = 'rect'
          if (element.rect) image.clip = { range: [[element.rect.l || 0, element.rect.t || 0], [100 - (element.rect.r || 0), 100 - (element.rect.b || 0)]], shape: geometry }
          else if (element.geom) image.clip = { range: [[0, 0], [100, 100]], shape: geometry }
          if (element.link) image.link = { target: element.link, type: 'web' }
          slide.elements.push(image)
        }
        else if (element.type === 'math') slide.elements.push({ fixedRatio: true, height: element.height, id: createPresentationId(10), left: element.left, rotate: 0, src: element.picBase64, top: element.top, type: 'image', width: element.width })
        else if (element.type === 'audio' && element.blob) slide.elements.push({ autoplay: false, color: theme.themeColors[0]!, fixedRatio: false, height: element.height, id: createPresentationId(10), left: element.left, loop: false, rotate: 0, src: element.blob, top: element.top, type: 'audio', width: element.width })
        else if (element.type === 'video' && element.blob) slide.elements.push({ autoplay: false, height: element.height, id: createPresentationId(10), left: element.left, rotate: 0, src: element.blob, top: element.top, type: 'video', width: element.width })
        else if (element.type === 'shape') {
          if (element.shapType === 'line' || /(straight|bent|curved)Connector/.test(element.shapType)) slide.elements.push(parseLineElement(element, ratio))
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
              rotate: element.rotate,
              text: { align: vAlignMap[element.vAlign] || 'middle', content: convertTextContent(element.content, ratio), defaultColor: theme.fontColor, defaultFontName: theme.fontName },
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
            if (destination.path && destination.viewBox[0] && destination.viewBox[1]) slide.elements.push(destination)
          }
        }
        else if (element.type === 'table') {
          const baseStyle: TableCellStyle = { color: theme.fontColor, fontname: theme.fontName }
          const data: TableCell[][] = element.data.map(row => row.map(cell => {
            const container = document.createElement('div')
            container.innerHTML = cell.text
            const paragraph = container.querySelector('p')
            const alignment = paragraph?.style.textAlign || 'left'
            const span = container.querySelector('span')
            const fontWeight = span?.style.fontWeight || ''
            const decoration = span?.style.textDecoration || ''
            return {
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
              text: container.innerText,
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
          slide.elements.push({
            cellMinHeight: element.rowHeights[0] ? element.rowHeights[0] * ratio : 36,
            colWidths: element.colWidths.map(width => width / allWidth), data, height: element.height, id: createPresentationId(10), left: element.left,
            outline: { color: border?.borderColor || '#eeece1', style: (border?.borderType || 'solid') as 'dashed' | 'dotted' | 'solid', width: +((border?.borderWidth || 0) * ratio || 2).toFixed(2) },
            rotate: 0, top: element.top, type: 'table', width: element.width,
          })
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
            labels = Object.values(chartData[0]!.xlabels)
            legends = chartData.map(value => value.key)
            series = chartData.map(value => value.values.map(point => point.y))
          }
          const options: ChartOptions = {}
          let chartType: ChartType = 'bar'
          switch (element.chartType) {
            case 'barChart': case 'bar3DChart': chartType = element.barDir === 'bar' ? 'column' : 'bar'; if (['stacked', 'percentStacked'].includes(element.grouping || '')) options.stack = true; break
            case 'lineChart': case 'line3DChart': chartType = 'line'; if (['stacked', 'percentStacked'].includes(element.grouping || '')) options.stack = true; break
            case 'areaChart': case 'area3DChart': chartType = 'area'; if (['stacked', 'percentStacked'].includes(element.grouping || '')) options.stack = true; break
            case 'scatterChart': case 'bubbleChart': chartType = 'scatter'; break
            case 'pieChart': case 'pie3DChart': chartType = 'pie'; break
            case 'radarChart': chartType = 'radar'; break
            case 'doughnutChart': chartType = 'ring'; break
          }
          slide.elements.push({ chartType, data: { labels, legends, series }, height: element.height, id: createPresentationId(10), left: element.left, options, rotate: 0, textColor: theme.fontColor, themeColors: element.colors.length ? element.colors : theme.themeColors, top: element.top, type: 'chart', width: element.width })
        }
        else if (element.type === 'group') {
          let elements = element.elements.map(child => {
            let left = child.left + originLeft
            let top = child.top + originTop
            let rotate = 'rotate' in child ? child.rotate : 0
            if (element.rotate) {
              const result = calculateRotatedPosition(originLeft, originTop, originWidth, originHeight, child.left, child.top, child.width, child.height, element.rotate, rotate)
              left = result.x; top = result.y; rotate = result.globalRotation
            }
            const next = { ...child, left, top }
            if (element.isFlipH && 'isFlipH' in next) next.isFlipH = true
            if (element.isFlipV && 'isFlipV' in next) next.isFlipV = true
            if ('rotate' in next && element.rotate) next.rotate = rotate
            return next
          })
          if (element.isFlipH) elements = flipGroupElements(elements, 'y')
          if (element.isFlipV) elements = flipGroupElements(elements, 'x')
          parseElements(elements)
        }
        else if (element.type === 'diagram') parseElements(element.elements.map(child => ({ ...child, left: child.left + originLeft, top: child.top + originTop })))
      }
    }
    parseElements([...item.elements, ...item.layoutElements])
    slides.push(slide)
  }
  return slides
}
