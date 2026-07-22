import type { CSSProperties } from 'react'
import tinycolor from 'tinycolor2'

import type {
  ImageElementFilters,
  PPTElementOutline,
  PPTElementShadow,
  PPTImageElement,
  PPTLineElement,
  SlideBackground,
  TableCell,
  TableCellStyle,
} from '@mona/presentation-core/model'

export type SlideCSSProperties = CSSProperties & Record<`--${string}`, string | number>

export function getSlideBackgroundStyle(background?: SlideBackground): CSSProperties {
  if (!background) return { backgroundColor: '#fff' }

  if (background.type === 'solid') return { backgroundColor: background.color }

  if (background.type === 'image' && background.image) {
    const { src, size } = background.image
    if (!src) return { backgroundColor: '#fff' }
    return {
      backgroundImage: `url(${src})`,
      backgroundPosition: 'center',
      backgroundRepeat: size === 'repeat' ? 'repeat' : 'no-repeat',
      backgroundSize: size === 'repeat' ? 'contain' : size || 'cover',
    }
  }

  if (background.type === 'gradient' && background.gradient) {
    const { type, colors, rotate } = background.gradient
    const stops = colors.map(item => `${item.color} ${item.pos}%`).join(',')
    return {
      backgroundImage: type === 'radial'
        ? `radial-gradient(${stops})`
        : `linear-gradient(${rotate + 90}deg, ${stops})`,
    }
  }

  return { backgroundColor: '#fff' }
}

export function getShadowStyle(shadow?: PPTElementShadow): string {
  if (!shadow) return ''
  return `${shadow.h}px ${shadow.v}px ${shadow.blur}px ${shadow.color}`
}

export function getFlipTransform(flipH?: boolean, flipV?: boolean): string {
  if (flipH && flipV) return 'rotateX(180deg) rotateY(180deg)'
  if (flipV) return 'rotateX(180deg)'
  if (flipH) return 'rotateY(180deg)'
  return ''
}

export interface OutlineRenderStyle {
  color: string
  dashArray: string
  width: number
}

export function getOutlineRenderStyle(outline?: PPTElementOutline): OutlineRenderStyle {
  const width = outline?.width ?? 0
  const style = outline?.style || 'solid'
  let dashArray = '0 0'
  if (style === 'dashed') dashArray = width <= 6 ? `${width * 4.5} ${width * 2}` : `${width * 4} ${width * 1.5}`
  else if (style === 'dotted') dashArray = width <= 6 ? `${width * 1.8} ${width * 1.6}` : `${width * 1.5} ${width * 1.2}`
  return { color: outline?.color || '#d14424', dashArray, width }
}

type ClipType = 'rect' | 'ellipse' | 'polygon'

export interface ClipPathDefinition {
  type: ClipType
  style: string
  radius?: string
  createPath?: (width: number, height: number) => string
}

const polygon = (
  style: string,
  createPath: (width: number, height: number) => string,
): ClipPathDefinition => ({ type: 'polygon', style, createPath })

export const CLIP_PATHS: Record<string, ClipPathDefinition> = {
  rect: { type: 'rect', radius: '0', style: '' },
  snip1Rect: polygon(
    'polygon(0% 0%, 80% 0%, 100% 20%, 100% 100%, 0 100%)',
    (width, height) => `M 0 0 L ${width * 0.8} 0 L ${width} ${height * 0.2} L ${width} ${height} L 0 ${height} Z`,
  ),
  snip2DiagRect: polygon(
    'polygon(0% 0%, 80% 0%, 100% 20%, 100% 100%, 20% 100%, 0% 80%)',
    (width, height) => `M 0 0 L ${width * 0.8} 0 L ${width} ${height * 0.2} L ${width} ${height} L ${width * 0.2} ${height} L 0 ${height * 0.8} Z`,
  ),
  roundRect: { type: 'rect', radius: '10px', style: 'inset(0 round 10px)' },
  ellipse: { type: 'ellipse', style: 'ellipse(50% 50% at 50% 50%)' },
  triangle: polygon(
    'polygon(50% 0%, 0% 100%, 100% 100%)',
    (width, height) => `M ${width * 0.5} 0 L 0 ${height} L ${width} ${height} Z`,
  ),
  rtTriangle: polygon(
    'polygon(0% 0%, 0% 100%, 100% 100%)',
    (width, height) => `M 0 0 L 0 ${height} L ${width} ${height} Z`,
  ),
  triangleReverse: polygon(
    'polygon(50% 100%, 0% 0%, 100% 0%)',
    (width, height) => `M ${width * 0.5} ${height} L 0 0 L ${width} 0 Z`,
  ),
  diamond: polygon(
    'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
    (width, height) => `M ${width * 0.5} 0 L ${width} ${height * 0.5} L ${width * 0.5} ${height} L 0 ${height * 0.5} Z`,
  ),
  pentagon: polygon(
    'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)',
    (width, height) => `M ${width * 0.5} 0 L ${width} ${height * 0.38} L ${width * 0.82} ${height} L ${width * 0.18} ${height} L 0 ${height * 0.38} Z`,
  ),
  hexagon: polygon(
    'polygon(20% 0%, 80% 0%, 100% 50%, 80% 100%, 20% 100%, 0% 50%)',
    (width, height) => `M ${width * 0.2} 0 L ${width * 0.8} 0 L ${width} ${height * 0.5} L ${width * 0.8} ${height} L ${width * 0.2} ${height} L 0 ${height * 0.5} Z`,
  ),
  heptagon: polygon(
    'polygon(50% 0%, 90% 20%, 100% 60%, 75% 100%, 25% 100%, 0% 60%, 10% 20%)',
    (width, height) => `M ${width * 0.5} 0 L ${width * 0.9} ${height * 0.2} L ${width} ${height * 0.6} L ${width * 0.75} ${height} L ${width * 0.25} ${height} L 0 ${height * 0.6} L ${width * 0.1} ${height * 0.2} Z`,
  ),
  octagon: polygon(
    'polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)',
    (width, height) => `M ${width * 0.3} 0 L ${width * 0.7} 0 L ${width} ${height * 0.3} L ${width} ${height * 0.7} L ${width * 0.7} ${height} L ${width * 0.3} ${height} L 0 ${height * 0.7} L 0 ${height * 0.3} Z`,
  ),
  chevron: polygon(
    'polygon(75% 0%, 100% 50%, 75% 100%, 0% 100%, 25% 50%, 0% 0%)',
    (width, height) => `M ${width * 0.75} 0 L ${width} ${height * 0.5} L ${width * 0.75} ${height} L 0 ${height} L ${width * 0.25} ${height * 0.5} L 0 0 Z`,
  ),
  homePlate: polygon(
    'polygon(0% 0%, 75% 0%, 100% 50%, 75% 100%, 0% 100%)',
    (width, height) => `M 0 0 L ${width * 0.75} 0 L ${width} ${height * 0.5} L ${width * 0.75} ${height} L 0 ${height} Z`,
  ),
  rightArrow: polygon(
    'polygon(0% 20%, 60% 20%, 60% 0%, 100% 50%, 60% 100%, 60% 80%, 0% 80%)',
    (width, height) => `M 0 ${height * 0.2} L ${width * 0.6} ${height * 0.2} L ${width * 0.6} 0 L ${width} ${height * 0.5} L ${width * 0.6} ${height} L ${width * 0.6} ${height * 0.8} L 0 ${height * 0.8} Z`,
  ),
  parallelogram: polygon(
    'polygon(30% 0%, 100% 0%, 70% 100%, 0% 100%)',
    (width, height) => `M ${width * 0.3} 0 L ${width} 0 L ${width * 0.7} ${height} L 0 ${height} Z`,
  ),
  parallelogramReverse: polygon(
    'polygon(30% 100%, 100% 100%, 70% 0%, 0% 0%)',
    (width, height) => `M ${width * 0.3} ${height} L ${width} ${height} L ${width * 0.7} 0 L 0 0 Z`,
  ),
  trapezoid: polygon(
    'polygon(25% 0%, 75% 0%, 100% 100%, 0% 100%)',
    (width, height) => `M ${width * 0.25} 0 L ${width * 0.75} 0 L ${width} ${height} L 0 ${height} Z`,
  ),
  trapezoidReverse: polygon(
    'polygon(0% 0%, 100% 0%, 75% 100%, 25% 100%)',
    (width, height) => `M 0 0 L ${width} 0 L ${width * 0.75} ${height} L ${width * 0.25} ${height} Z`,
  ),
}

export function getImageClip(element: PPTImageElement): ClipPathDefinition {
  const base = element.clip ? CLIP_PATHS[element.clip.shape || 'rect'] : CLIP_PATHS.rect
  const clip = base || CLIP_PATHS.rect
  if (clip.radius !== undefined && element.radius) {
    return {
      ...clip,
      radius: `${element.radius}px`,
      style: `inset(0 round ${element.radius}px)`,
    }
  }
  return clip
}

export function getImagePosition(element: PPTImageElement): CSSProperties {
  if (!element.clip) return { top: 0, left: 0, width: '100%', height: '100%' }
  const [start, end] = element.clip.range
  const widthScale = (end[0] - start[0]) / 100
  const heightScale = (end[1] - start[1]) / 100
  return {
    left: `${-(start[0] / widthScale)}%`,
    top: `${-(start[1] / heightScale)}%`,
    width: `${100 / widthScale}%`,
    height: `${100 / heightScale}%`,
  }
}

export function getImageFilter(filters?: ImageElementFilters): string {
  if (!filters) return ''
  return Object.entries(filters).map(([key, value]) => `${key}(${value})`).join(' ')
}

function getBroken2Direction(element: PPTLineElement): 'horizontal' | 'vertical' {
  if (element.broken2Direction) return element.broken2Direction
  // PPTist derives the fallback from getElementRange, which for lines spans
  // from the local origin to max(start, end) per axis — not the |start-end| extent.
  return Math.max(element.start[0], element.end[0]) >= Math.max(element.start[1], element.end[1])
    ? 'horizontal'
    : 'vertical'
}

function buildLinePath(
  element: PPTLineElement,
  start: [number, number],
  end: [number, number],
): string {
  const startPoint = start.join(',')
  const endPoint = end.join(',')
  if (element.broken) return `M${startPoint} L${element.broken.join(',')} L${endPoint}`
  if (element.broken2) {
    const direction = getBroken2Direction(element)
    if (direction === 'horizontal') return `M${startPoint} L${element.broken2[0]},${element.start[1]} L${element.broken2[0]},${element.end[1]} ${endPoint}`
    return `M${startPoint} L${element.start[0]},${element.broken2[1]} L${element.end[0]},${element.broken2[1]} ${endPoint}`
  }
  if (element.curve) return `M${startPoint} Q${element.curve.join(',')} ${endPoint}`
  if (element.cubic) return `M${startPoint} C${element.cubic[0].join(',')} ${element.cubic[1].join(',')} ${endPoint}`
  return `M${startPoint} L${endPoint}`
}

function pointDistance(first: [number, number], second: [number, number]): number {
  return Math.hypot(second[0] - first[0], second[1] - first[1])
}

function movePoint(
  point: [number, number],
  target: [number, number],
  offset: number,
): [number, number] {
  const distance = pointDistance(point, target)
  if (!distance) return point
  const ratio = offset / distance
  return [
    point[0] + (target[0] - point[0]) * ratio,
    point[1] + (target[1] - point[1]) * ratio,
  ]
}

function markerOffset(point: PPTLineElement['points'][number], width: number): number {
  const size = Math.max(width, 2)
  if (point === 'arrow') return size
  if (point === 'dot') return size / 2
  return 0
}

function lineTurningPoints(element: PPTLineElement): [number, number][] {
  if (element.broken) return [element.broken]
  if (element.broken2) {
    return getBroken2Direction(element) === 'horizontal'
      ? [[element.broken2[0], element.start[1]], [element.broken2[0], element.end[1]]]
      : [[element.start[0], element.broken2[1]], [element.end[0], element.broken2[1]]]
  }
  if (element.curve) return [element.curve]
  if (element.cubic) return [element.cubic[0], element.cubic[1]]
  return []
}

export function getLinePath(element: PPTLineElement): string {
  return buildLinePath(element, element.start, element.end)
}

export function getLineRenderPath(element: PPTLineElement): string {
  const turns = lineTurningPoints(element)
  let start = element.start
  let end = element.end
  const startOffset = markerOffset(element.points[0], element.width)
  const endOffset = markerOffset(element.points[1], element.width)
  if (startOffset) {
    const target = turns[0] || element.end
    start = movePoint(element.start, target, Math.min(startOffset, pointDistance(element.start, target) / 2))
  }
  if (endOffset) {
    const target = turns[turns.length - 1] || element.start
    end = movePoint(element.end, target, Math.min(endOffset, pointDistance(target, element.end) / 2))
  }
  return buildLinePath(element, start, end)
}

export function getLineDashArray(element: PPTLineElement): string {
  const size = element.width
  if (element.style === 'dashed') return size <= 8 ? `${size * 5} ${size * 2.5}` : `${size * 5} ${size * 1.5}`
  if (element.style === 'dotted') return size <= 8 ? `${size * 1.8} ${size * 1.6}` : `${size * 1.5} ${size * 1.2}`
  return '0 0'
}

export function getHiddenTableCells(data: TableCell[][]): ReadonlySet<string> {
  const hidden = new Set<string>()
  for (let rowIndex = 0; rowIndex < data.length; rowIndex += 1) {
    const row = data[rowIndex] || []
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const cell = row[columnIndex]
      if (!cell || (cell.colspan <= 1 && cell.rowspan <= 1)) continue
      for (let rowOffset = rowIndex; rowOffset < rowIndex + cell.rowspan; rowOffset += 1) {
        const startColumn = rowOffset === rowIndex ? columnIndex + 1 : columnIndex
        for (let columnOffset = startColumn; columnOffset < columnIndex + cell.colspan; columnOffset += 1) {
          hidden.add(`${rowOffset}_${columnOffset}`)
        }
      }
    }
  }
  return hidden
}

export function getTableThemeColors(color?: string): [string, string] {
  if (!color) return ['', '']
  const parsed = tinycolor(color)
  return [parsed.clone().setAlpha(0.3).toRgbString(), parsed.clone().setAlpha(0.1).toRgbString()]
}

export function getTableCellStyle(outline: PPTElementOutline, style?: TableCellStyle): CSSProperties {
  return {
    backgroundColor: style?.backcolor || '',
    borderStyle: outline.style,
    borderColor: outline.color,
    borderWidth: `${outline.width}px`,
  }
}

export function getTableTextStyle(cellMinHeight: number, style?: TableCellStyle): CSSProperties {
  if (!style) return {}
  const verticalAlignment = { top: 'flex-start', middle: 'center', bottom: 'flex-end' } as const
  const decorations = [style.underline ? 'underline' : '', style.strikethrough ? 'line-through' : ''].filter(Boolean)
  return {
    fontWeight: style.bold ? 'bold' : 'normal',
    fontStyle: style.em ? 'italic' : 'normal',
    textDecoration: decorations.length ? decorations.join(' ') : 'none',
    color: style.color || '#000',
    fontSize: style.fontsize || '14px',
    fontFamily: style.fontname || '',
    justifyContent: verticalAlignment[style.vAlign || 'top'],
    textAlign: style.align || 'left',
    minHeight: `${cellMinHeight - 4}px`,
  }
}

export function formatTableText(text: string): string {
  return text.replace(/\n/g, '</br>').replace(/ /g, '&nbsp;')
}
