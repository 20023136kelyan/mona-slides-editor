import { Buffer } from 'node:buffer'

import PptxGenJS from 'pptxgenjs'
import { SVGPathData, SVGPathDataTransformer } from 'svg-pathdata'

import type {
  PPTChartElement,
  PPTElement,
  PPTElementOutline,
  PPTElementShadow,
  PPTImageElement,
  PPTLineElement,
  PPTShapeElement,
  PPTTableElement,
  PowerPointPackageManifest,
} from '@mona/presentation-core'

import { parseAuthoredText } from './authored-text'
import type { PowerPointAssetResolver } from './types'

const DEFAULT_FONT_SIZE = 16

const markerToken = (id: string): string => Buffer.from(id).toString('base64url')

export const generatedElementMarker = (
  elementId: string,
  role: 'fill' | 'main' | 'text' = 'main',
): string => `mona-generated:${markerToken(elementId)}:${role}`

const parseColor = (value: string | undefined): { alpha: number; color: string } => {
  if (!value || value === 'transparent') return { alpha: 0, color: 'FFFFFF' }
  const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1]
  if (hex) {
    const expanded = hex.length === 3
      ? [...hex].map(entry => `${entry}${entry}`).join('')
      : hex
    return {
      alpha: expanded.length === 8 ? Number.parseInt(expanded.slice(6), 16) / 255 : 1,
      color: expanded.slice(0, 6).toUpperCase(),
    }
  }
  const rgb = value.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d*(?:\.\d+)?))?/i)
  if (!rgb) return { alpha: 1, color: '000000' }
  return {
    alpha: rgb[4] === undefined || rgb[4] === '' ? 1 : Math.max(0, Math.min(1, Number(rgb[4]))),
    color: rgb.slice(1, 4).map(entry => (
      Math.max(0, Math.min(255, Math.round(Number(entry)))).toString(16).padStart(2, '0')
    )).join('').toUpperCase(),
  }
}

const shadowOption = (
  shadow: PPTElementShadow,
  unitsPerPoint: number,
): PptxGenJS.ShadowProps => {
  const color = parseColor(shadow.color)
  const offsetX = shadow.h / unitsPerPoint
  const offsetY = shadow.v / unitsPerPoint
  return {
    angle: (Math.atan2(offsetY, offsetX) * 180 / Math.PI + 360) % 360,
    blur: shadow.blur / unitsPerPoint,
    color: color.color,
    offset: Math.hypot(offsetX, offsetY),
    opacity: color.alpha,
    type: 'outer',
  }
}

const outlineOption = (
  outline: PPTElementOutline | undefined,
  unitsPerPoint: number,
): PptxGenJS.ShapeLineProps => {
  const color = parseColor(outline?.color ?? '#000000')
  return {
    color: color.color,
    dashType: outline?.style === 'dashed'
      ? 'dash'
      : outline?.style === 'dotted'
        ? 'sysDot'
        : 'solid',
    transparency: (1 - color.alpha) * 100,
    width: (outline?.width ?? 1) / unitsPerPoint,
  }
}

const fontSize = (value: string | undefined, unitsPerPoint: number): number | undefined => {
  if (!value) return undefined
  const numeric = Number.parseFloat(value)
  if (!Number.isFinite(numeric)) return undefined
  return /pt\s*$/i.test(value) ? numeric : numeric / unitsPerPoint
}

const textProps = (
  html: string,
  defaults: { color: string; fontFamily: string; fontSize?: number },
  unitsPerPoint: number,
): PptxGenJS.TextProps[] => {
  const paragraphs = parseAuthoredText(html)
  const result: PptxGenJS.TextProps[] = []
  paragraphs.forEach((paragraph, paragraphIndex) => {
    if (!paragraph.runs.length) {
      result.push({
        options: {
          ...(paragraphIndex ? { breakLine: true } : {}),
          color: parseColor(defaults.color).color,
          fontFace: defaults.fontFamily,
          fontSize: defaults.fontSize ?? DEFAULT_FONT_SIZE / unitsPerPoint,
        },
        text: '',
      })
      return
    }
    paragraph.runs.forEach((run, runIndex) => {
      const color = parseColor(run.style.color ?? defaults.color)
      const decoration = `${run.style['text-decoration'] ?? ''} ${run.style['text-decoration-line'] ?? ''}`
      const weight = Number.parseInt(run.style['font-weight'] ?? '', 10)
      const options: PptxGenJS.TextPropsOptions = {
        ...(paragraphIndex && runIndex === 0 ? { breakLine: true } : {}),
        ...(run.kind === 'break' ? { breakLine: true } : {}),
        ...(paragraph.list && runIndex === 0
          ? {
              bullet: paragraph.list.type === 'number'
                ? { startAt: paragraph.list.startAt, type: 'number' }
                : { indent: 14 / unitsPerPoint },
            }
          : {}),
        ...(paragraph.level ? { indentLevel: Math.min(8, paragraph.level) } : {}),
        ...(run.hyperlink ? { hyperlink: { url: run.hyperlink } } : {}),
        ...(run.style['background-color']
          ? { highlight: parseColor(run.style['background-color']).color }
          : {}),
        ...(run.style['font-style'] === 'italic' ? { italic: true } : {}),
        ...(run.style['vertical-align'] === 'sub' ? { subscript: true } : {}),
        ...(run.style['vertical-align'] === 'super' ? { superscript: true } : {}),
        ...(decoration.includes('line-through') ? { strike: 'sngStrike' as const } : {}),
        ...(decoration.includes('underline') ? { underline: { style: 'sng' as const } } : {}),
        bold: run.style['font-weight'] === 'bold' || Number.isFinite(weight) && weight >= 600,
        color: color.color,
        fontFace: run.style['font-family']?.split(',')[0]?.replace(/^['"]|['"]$/g, '')
          || defaults.fontFamily,
        fontSize: fontSize(run.style['font-size'], unitsPerPoint)
          ?? defaults.fontSize
          ?? DEFAULT_FONT_SIZE / unitsPerPoint,
      }
      result.push({
        options,
        text: run.kind === 'tab' ? '\t' : run.kind === 'break' ? '' : run.text,
      })
    })
  })
  return result.length ? result : [{ text: '' }]
}

type SvgPoint =
  | { close: true }
  | { moveTo?: boolean; x: number; y: number }
  | {
      curve: { type: 'cubic'; x1: number; x2: number; y1: number; y2: number }
      x: number
      y: number
    }

const svgPoints = (
  path: string,
  unitsPerInch: number,
  scale = { x: 1, y: 1 },
): SvgPoint[] => new SVGPathData(path)
  .transform(SVGPathDataTransformer.TO_ABS())
  .transform(SVGPathDataTransformer.NORMALIZE_HVZ())
  .transform(SVGPathDataTransformer.NORMALIZE_ST())
  .transform(SVGPathDataTransformer.QT_TO_C())
  .transform(SVGPathDataTransformer.A_TO_C())
  .commands.map(command => {
    if (command.type === SVGPathData.CLOSE_PATH) return { close: true }
    if (command.type === SVGPathData.MOVE_TO) {
      return {
        moveTo: true,
        x: command.x * scale.x / unitsPerInch,
        y: command.y * scale.y / unitsPerInch,
      }
    }
    if (command.type === SVGPathData.LINE_TO) {
      return { x: command.x * scale.x / unitsPerInch, y: command.y * scale.y / unitsPerInch }
    }
    if (command.type === SVGPathData.CURVE_TO) {
      return {
        curve: {
          type: 'cubic' as const,
          x1: command.x1 * scale.x / unitsPerInch,
          x2: command.x2 * scale.x / unitsPerInch,
          y1: command.y1 * scale.y / unitsPerInch,
          y2: command.y2 * scale.y / unitsPerInch,
        },
        x: command.x * scale.x / unitsPerInch,
        y: command.y * scale.y / unitsPerInch,
      }
    }
    throw new Error(`Unsupported generated SVG command ${command.type}.`)
  })

const mediaData = async (
  reference: string,
  resolveAsset: PowerPointAssetResolver | undefined,
): Promise<string> => {
  if (/^data:[^;,]+;base64,/i.test(reference)) return reference
  const asset = await resolveAsset?.(reference)
  if (!asset) throw new Error(`The generated PowerPoint object references an unavailable asset: ${reference}`)
  const bytes = asset.bytes instanceof ArrayBuffer ? new Uint8Array(asset.bytes) : asset.bytes
  return `data:${asset.mediaType || 'application/octet-stream'};base64,${Buffer.from(bytes).toString('base64')}`
}

const position = (
  element: Exclude<PPTElement, { type: 'line' }>,
  unitsPerInch: number,
): PptxGenJS.PositionProps => ({
  h: element.height / unitsPerInch,
  w: element.width / unitsPerInch,
  x: element.left / unitsPerInch,
  y: element.top / unitsPerInch,
})

const addText = (
  slide: PptxGenJS.Slide,
  element: Extract<PPTElement, { type: 'text' }>,
  unitsPerInch: number,
  unitsPerPoint: number,
): void => {
  const fill = parseColor(element.fill)
  const inset = element.inset ?? [10, 10, 10, 10]
  slide.addText(textProps(element.content, {
    color: element.defaultColor,
    fontFamily: element.defaultFontName,
  }, unitsPerPoint), {
    ...position(element, unitsPerInch),
    ...(element.fill
      ? { fill: { color: fill.color, transparency: (1 - fill.alpha * (element.opacity ?? 1)) * 100 } }
      : {}),
    ...(element.fixedHeight === false ? { fit: 'resize' as const } : {}),
    ...(element.outline ? { line: outlineOption(element.outline, unitsPerPoint) } : {}),
    ...(element.rotate ? { rotate: element.rotate } : {}),
    ...(element.shadow ? { shadow: shadowOption(element.shadow, unitsPerPoint) } : {}),
    ...(element.vertical ? { vert: 'eaVert' as const } : {}),
    ...(element.wordSpace ? { charSpacing: element.wordSpace / unitsPerPoint } : {}),
    margin: [inset[0], inset[1], inset[2], inset[3]].map(value => (
      value / unitsPerPoint
    )) as [number, number, number, number],
    objectName: generatedElementMarker(element.id),
    paraSpaceBefore: (element.paragraphSpace ?? 0) / unitsPerPoint,
    valign: element.vAlign ?? 'top',
  })
}

const addShape = async (
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  element: PPTShapeElement,
  unitsPerInch: number,
  unitsPerPoint: number,
  resolveAsset: PowerPointAssetResolver | undefined,
): Promise<void> => {
  const fill = parseColor(element.fill)
  const customGeometry = !element.powerPointGeometry?.preset
    || element.powerPointGeometry.preset === 'custom'
  const shape = !customGeometry
    ? element.powerPointGeometry!.preset as PptxGenJS.ShapeType
    : 'custGeom' as PptxGenJS.ShapeType
  const options: PptxGenJS.ShapeProps = {
    ...position(element, unitsPerInch),
    ...(customGeometry
      ? {
          points: svgPoints(element.path, unitsPerInch, {
            x: element.width / Math.max(element.viewBox[0], 0.001),
            y: element.height / Math.max(element.viewBox[1], 0.001),
          }),
        }
      : {}),
    fill: {
      color: fill.color,
      transparency: (1 - fill.alpha * (element.opacity ?? 1)) * 100,
    },
    ...(element.flipH ? { flipH: true } : {}),
    ...(element.flipV ? { flipV: true } : {}),
    line: element.outline
      ? outlineOption(element.outline, unitsPerPoint)
      : { color: fill.color, transparency: 100, width: 0 },
    objectName: generatedElementMarker(element.id),
    ...(element.rotate ? { rotate: element.rotate } : {}),
    ...(element.shadow ? { shadow: shadowOption(element.shadow, unitsPerPoint) } : {}),
  }
  slide.addShape(shape || pptx.ShapeType.rect, options)
  if (element.pattern) {
    slide.addImage({
      ...position(element, unitsPerInch),
      data: await mediaData(element.pattern, resolveAsset),
      objectName: generatedElementMarker(element.id, 'fill'),
    })
  }
  if (!element.text) return
  const inset = element.text.inset ?? [10, 10, 10, 10]
  slide.addText(textProps(element.text.content, {
    color: element.text.defaultColor,
    fontFamily: element.text.defaultFontName,
  }, unitsPerPoint), {
    ...position(element, unitsPerInch),
    fill: { color: 'FFFFFF', transparency: 100 },
    line: { color: 'FFFFFF', transparency: 100, width: 0 },
    margin: [inset[0], inset[1], inset[2], inset[3]].map(value => (
      value / unitsPerPoint
    )) as [number, number, number, number],
    objectName: generatedElementMarker(element.id, 'text'),
    ...(element.rotate ? { rotate: element.rotate } : {}),
    valign: element.text.align,
  })
}

const addImage = async (
  slide: PptxGenJS.Slide,
  element: PPTImageElement,
  unitsPerInch: number,
  resolveAsset: PowerPointAssetResolver | undefined,
): Promise<void> => {
  const options: PptxGenJS.ImageProps = {
    ...position(element, unitsPerInch),
    data: await mediaData(element.src, resolveAsset),
    ...(element.accessibility?.description ? { altText: element.accessibility.description } : {}),
    ...(element.flipH ? { flipH: true } : {}),
    ...(element.flipV ? { flipV: true } : {}),
    objectName: generatedElementMarker(element.id),
    ...(element.rotate ? { rotate: element.rotate } : {}),
    ...(element.shadow ? { shadow: shadowOption(element.shadow, unitsPerInch / 72) } : {}),
  }
  const filterOpacity = Number.parseFloat(element.filters?.opacity ?? '')
  if (Number.isFinite(filterOpacity)) options.transparency = 100 - filterOpacity
  else if (element.opacity !== undefined) options.transparency = (1 - element.opacity) * 100
  if (element.clip?.shape === 'ellipse') options.rounding = true
  slide.addImage(options)
}

const addLine = (
  slide: PptxGenJS.Slide,
  element: PPTLineElement,
  unitsPerInch: number,
  unitsPerPoint: number,
): void => {
  const points: SvgPoint[] = [
    { moveTo: true, x: element.start[0] / unitsPerInch, y: element.start[1] / unitsPerInch },
    ...(element.cubic
      ? [{
          curve: {
            type: 'cubic' as const,
            x1: element.cubic[0][0] / unitsPerInch,
            x2: element.cubic[1][0] / unitsPerInch,
            y1: element.cubic[0][1] / unitsPerInch,
            y2: element.cubic[1][1] / unitsPerInch,
          },
          x: element.end[0] / unitsPerInch,
          y: element.end[1] / unitsPerInch,
        }]
      : [{ x: element.end[0] / unitsPerInch, y: element.end[1] / unitsPerInch }]),
  ]
  const maxX = Math.max(element.start[0], element.end[0], 1)
  const maxY = Math.max(element.start[1], element.end[1], 1)
  slide.addShape('custGeom' as PptxGenJS.ShapeType, {
    h: maxY / unitsPerInch,
    line: {
      ...outlineOption({
        color: element.color,
        style: element.style,
        width: element.width,
      }, unitsPerPoint),
      beginArrowType: element.points[0] ? 'arrow' : 'none',
      endArrowType: element.points[1] ? 'arrow' : 'none',
    },
    objectName: generatedElementMarker(element.id),
    points,
    w: maxX / unitsPerInch,
    x: element.left / unitsPerInch,
    y: element.top / unitsPerInch,
  })
}

const chartType = (
  type: PPTChartElement['chartType'],
): PptxGenJS.CHART_NAME => ({
  area: 'area',
  bar: 'bar',
  column: 'bar',
  line: 'line',
  pie: 'pie',
  radar: 'radar',
  ring: 'doughnut',
  scatter: 'scatter',
} as const)[type]

const addChart = (
  slide: PptxGenJS.Slide,
  element: PPTChartElement,
  unitsPerInch: number,
): void => {
  const options: PptxGenJS.IChartOpts = {
    ...position(element, unitsPerInch),
    chartColors: element.themeColors.map(color => parseColor(color).color),
    objectName: generatedElementMarker(element.id),
    showLegend: element.options?.showLegend ?? element.data.series.length > 1,
  }
  if (element.chartType === 'bar') options.barDir = 'bar'
  if (element.chartType === 'column') options.barDir = 'col'
  if (element.options?.stack) options.barGrouping = 'stacked'
  if (element.options?.percentStacked) options.barGrouping = 'percentStacked'
  if (element.options?.legendPosition) {
    options.legendPos = ({ bottom: 'b', left: 'l', right: 'r', top: 't' } as const)[element.options.legendPosition]
  }
  if (element.options?.title) {
    options.showTitle = true
    options.title = element.options.title
  }
  if (element.options?.showDataLabels) options.showValue = element.options.showValue ?? true
  slide.addChart(chartType(element.chartType), element.data.series.map((values, index) => ({
    labels: element.data.labels,
    name: element.data.legends[index] ?? `Series ${index + 1}`,
    values,
  })), options)
}

const addTable = (
  slide: PptxGenJS.Slide,
  element: PPTTableElement,
  unitsPerInch: number,
  unitsPerPoint: number,
): void => {
  const covered = new Set<string>()
  const rows: PptxGenJS.TableRow[] = element.data.map((row, rowIndex) => row.flatMap((cell, columnIndex) => {
    const key = `${rowIndex}:${columnIndex}`
    if (covered.has(key)) return []
    for (let r = rowIndex; r < rowIndex + Math.max(1, cell.rowspan); r += 1) {
      for (let c = columnIndex; c < columnIndex + Math.max(1, cell.colspan); c += 1) {
        if (r !== rowIndex || c !== columnIndex) covered.add(`${r}:${c}`)
      }
    }
    const options: PptxGenJS.TableCellProps = {
      align: cell.style?.align ?? 'left',
      bold: cell.style?.bold,
      colspan: Math.max(1, cell.colspan),
      ...(cell.style?.color ? { color: parseColor(cell.style.color).color } : {}),
      ...(cell.style?.backcolor ? { fill: { color: parseColor(cell.style.backcolor).color } } : {}),
      fontFace: cell.style?.fontname,
      fontSize: fontSize(cell.style?.fontsize, unitsPerPoint),
      italic: cell.style?.em,
      rowspan: Math.max(1, cell.rowspan),
      underline: cell.style?.underline ? { style: 'sng' } : undefined,
      valign: cell.style?.vAlign ?? 'middle',
    }
    return [{ options, text: cell.text }]
  }))
  slide.addTable(rows, {
    ...position(element, unitsPerInch),
    border: outlineOption(element.outline, unitsPerPoint),
    colW: element.colWidths.map(value => element.width * value / unitsPerInch),
    objectName: generatedElementMarker(element.id),
    ...(element.rowHeights
      ? { rowH: element.rowHeights.map(value => value / unitsPerInch) }
      : {}),
  })
}

const svgData = (svg: string): string => (
  `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
)

const addElement = async (
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  element: PPTElement,
  unitsPerInch: number,
  unitsPerPoint: number,
  resolveAsset: PowerPointAssetResolver | undefined,
): Promise<void> => {
  if (element.type === 'group') {
    for (const child of element.elements) {
      await addElement(slide, pptx, child, unitsPerInch, unitsPerPoint, resolveAsset)
    }
    return
  }
  if (element.type === 'text') addText(slide, element, unitsPerInch, unitsPerPoint)
  else if (element.type === 'shape') await addShape(
    slide,
    pptx,
    element,
    unitsPerInch,
    unitsPerPoint,
    resolveAsset,
  )
  else if (element.type === 'image') await addImage(slide, element, unitsPerInch, resolveAsset)
  else if (element.type === 'line') addLine(slide, element, unitsPerInch, unitsPerPoint)
  else if (element.type === 'chart') addChart(slide, element, unitsPerInch)
  else if (element.type === 'table') addTable(slide, element, unitsPerInch, unitsPerPoint)
  else if (element.type === 'latex') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${element.viewBox[0]} ${element.viewBox[1]}" fill="none" stroke="${element.color}" stroke-width="${element.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"><path d="${element.path.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"/></svg>`
    slide.addImage({
      ...position(element, unitsPerInch),
      data: svgData(svg),
      objectName: generatedElementMarker(element.id),
    })
  }
  else if (element.type === 'video' || element.type === 'audio') {
    const extension = element.ext || (element.type === 'video' ? 'mp4' : 'mp3')
    slide.addMedia({
      ...position(element, unitsPerInch),
      data: await mediaData(element.src, resolveAsset),
      extn: extension,
      objectName: generatedElementMarker(element.id),
      ...(element.type === 'video' && element.poster
        ? { cover: await mediaData(element.poster, resolveAsset) }
        : {}),
      type: element.type,
    })
  }
  else {
    throw new Error(`A ${element.type} object cannot be created without retained native payload.`)
  }
}

/**
 * Generate a tiny, standards-compliant donor package for one semantic object.
 *
 * PptxGenJS owns the difficult chart/workbook/media construction. The retained
 * writer owns identity, relationship retargeting and insertion into the user's
 * original package. No slide or theme from this donor is ever used directly.
 */
export const generateElementDonorPackage = async ({
  element,
  manifest,
  resolveAsset,
}: {
  element: PPTElement
  manifest: PowerPointPackageManifest
  resolveAsset?: PowerPointAssetResolver
}): Promise<ArrayBuffer> => {
  const scale = manifest.coordinateScale ?? 96 / 72
  const unitsPerPoint = scale
  const unitsPerInch = 72 * scale
  const documentProperties = manifest['document']?.properties
  const width = documentProperties?.slideWidthEmu
    ? documentProperties.slideWidthEmu / 914_400
    : 10
  const height = documentProperties?.slideHeightEmu
    ? documentProperties.slideHeightEmu / 914_400
    : 5.625
  const pptx = new PptxGenJS()
  pptx.defineLayout({ height, name: 'MONA_GENERATED_OBJECT', width })
  pptx.layout = 'MONA_GENERATED_OBJECT'
  const slide = pptx.addSlide()
  await addElement(slide, pptx, element, unitsPerInch, unitsPerPoint, resolveAsset)
  return await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer
}
