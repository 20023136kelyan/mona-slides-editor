import { useMemo } from 'react'
import type { TFunction } from 'i18next'
import { toJpeg, toPng } from 'html-to-image'
import PptxGenJS from 'pptxgenjs'
import { SVGPathData, SVGPathDataTransformer } from 'svg-pathdata'
import tinycolor from 'tinycolor2'

import { selectPresentation } from '@mona/editor-state'
import type { PresentationState } from '@mona/presentation-core'
import type {
  PPTElementLink,
  PPTElementOutline,
  PPTElementShadow,
  PPTLineElement,
  PPTShapeElement,
  Slide,
} from '@mona/presentation-core/model'

import type { EditorExportActions } from '@/features/editor/EditorExportPopover'
import { getExportFileStem } from '@/features/editor/editor-export-filename'
import { PRESENTATION_FILTERS, saveFile } from '@/features/editor/editor-files'
import { monaBridge } from '@/lib/mona-bridge'
import { encryptNativePresentation } from '@/features/editor/editor-file-format'
import { applyPptxSlideMetadata } from '@/features/editor/editor-pptx-slide-metadata'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorApplication } from '@/features/editor/services/editor-application'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { getLinePath, getOutlineRenderStyle } from '@/features/presentation-renderer/render-utils'

interface ExportImageConfig {
  fontEmbedCSS?: string
  quality: number
  width: number
}

type FormatColor = ReturnType<typeof formatColor>

const DEFAULT_FONT_SIZE = 16
const DASH_TYPE = { dashed: 'dash', dotted: 'sysDot', solid: 'solid' } as const

const nextFrame = (delay = 200) => new Promise<void>(resolve => window.setTimeout(resolve, delay))

function formatColor(color: string | undefined) {
  if (!color) return { alpha: 0, color: '#000000' }
  const parsed = tinycolor(color)
  const alpha = parsed.getAlpha()
  return {
    alpha,
    color: alpha === 0 ? '#ffffff' : parsed.setAlpha(1).toHexString(),
  }
}

function setPptxLayout(pptx: PptxGenJS, presentation: PresentationState, ratioPx2Inch: number) {
  if (presentation.viewportRatio === 0.625) pptx.layout = 'LAYOUT_16x10'
  else if (presentation.viewportRatio === 0.75) pptx.layout = 'LAYOUT_4x3'
  else {
    const name = 'MONA_CUSTOM_LAYOUT'
    pptx.defineLayout({
      name,
      width: presentation.viewportSize / ratioPx2Inch,
      height: presentation.viewportSize * presentation.viewportRatio / ratioPx2Inch,
    })
    pptx.layout = name
  }
}

function averageGradientColor(value: string): string | undefined {
  const matches = value.match(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}|rgba?\([^)]+\)/g)
  if (!matches?.length) return undefined
  const average = matches.map(color => tinycolor(color).toRgb()).reduce((result, color) => ({
    r: result.r + color.r / matches.length,
    g: result.g + color.g / matches.length,
    b: result.b + color.b / matches.length,
  }), { b: 0, g: 0, r: 0 })
  return tinycolor(average).toHexString()
}

function parseInlineStyle(value: string, inherited: Record<string, string>) {
  const result = { ...inherited }
  let hasGradient = false
  for (const declaration of value.split(';')) {
    const match = declaration.match(/([^:]+):\s*(.+)/)
    if (!match) continue
    const key = match[1]!.trim()
    const styleValue = match[2]!.trim()
    if (key === 'background' && styleValue.includes('linear-gradient')) {
      hasGradient = true
      const color = averageGradientColor(styleValue)
      if (color) result.color = color
    }
    else if (hasGradient && (key === 'background-clip' || key === '-webkit-background-clip' || (key === 'color' && styleValue === 'transparent'))) {
      continue
    }
    else result[key] = styleValue
  }
  return result
}

function formatHtml(html: string, ratioPx2Pt: number): PptxGenJS.TextProps[] {
  const documentNode = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const slices: PptxGenJS.TextProps[] = []
  let bullet = false
  let indent = 0

  const parse = (nodes: NodeListOf<ChildNode> | ChildNode[], inherited: Record<string, string> = {}) => {
    for (const node of nodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.textContent || '').replace(/\n/g, '')
        const options: PptxGenJS.TextPropsOptions = {}
        if (inherited['font-size']) options.fontSize = parseInt(inherited['font-size']) / ratioPx2Pt
        if (inherited.color) options.color = formatColor(inherited.color).color
        if (inherited['background-color']) options.highlight = formatColor(inherited['background-color']).color
        const decoration = `${inherited['text-decoration-line'] || ''} ${inherited['text-decoration'] || ''}`
        if (decoration.includes('underline')) options.underline = { color: options.color || '#000000', style: 'sng' }
        if (decoration.includes('line-through')) options.strike = 'sngStrike'
        if (inherited['vertical-align'] === 'super') options.superscript = true
        if (inherited['vertical-align'] === 'sub') options.subscript = true
        if (inherited['text-align']) options.align = inherited['text-align'] as PptxGenJS.HAlign
        if (inherited['font-weight']) options.bold = inherited['font-weight'] === 'bold' || +inherited['font-weight'] >= 600
        if (inherited['font-style']) options.italic = inherited['font-style'] === 'italic'
        if (inherited['font-family']) options.fontFace = inherited['font-family']
        if (inherited.href) options.hyperlink = { url: inherited.href }
        if (bullet && inherited['list-type'] === 'ol') {
          options.bullet = { indent: (options.fontSize || DEFAULT_FONT_SIZE) * 1.25, type: 'number' }
          options.paraSpaceBefore = 0.1
          bullet = false
        }
        if (bullet && inherited['list-type'] === 'ul') {
          options.bullet = { indent: (options.fontSize || DEFAULT_FONT_SIZE) * 1.25 }
          options.paraSpaceBefore = 0.1
          bullet = false
        }
        if (indent) {
          options.indentLevel = indent
          indent = 0
        }
        slices.push({ options, text })
        continue
      }
      if (!(node instanceof HTMLElement)) continue
      const tag = node.tagName.toLowerCase()
      if (['div', 'li', 'p'].includes(tag) && slices.length) {
        const previous = slices.at(-1)!
        previous.options ||= {}
        previous.options.breakLine = true
      }
      let styles = parseInlineStyle(node.getAttribute('style') || '', inherited)
      if (tag === 'em') styles = { ...styles, 'font-style': 'italic' }
      if (tag === 'strong') styles = { ...styles, 'font-weight': 'bold' }
      if (tag === 'sup') styles = { ...styles, 'vertical-align': 'super' }
      if (tag === 'sub') styles = { ...styles, 'vertical-align': 'sub' }
      if (tag === 'a') styles = { ...styles, href: node.getAttribute('href') || '' }
      if (tag === 'ul') styles = { ...styles, 'list-type': 'ul' }
      if (tag === 'ol') styles = { ...styles, 'list-type': 'ol' }
      if (tag === 'li') bullet = true
      if (tag === 'p' && node.dataset.indent) indent = +node.dataset.indent
      if (tag === 'br') slices.push({ options: { breakLine: true }, text: '' })
      else parse(node.childNodes, styles)
    }
  }
  parse(documentNode.body.childNodes)
  return slices
}

type SvgPoint =
  | { close: true }
  | { moveTo?: boolean; x: number; y: number }
  | { curve: { type: 'cubic'; x1: number; x2: number; y1: number; y2: number }; x: number; y: number }

function svgPoints(path: string, ratioPx2Inch: number, scale = { x: 1, y: 1 }): SvgPoint[] {
  const commands = new SVGPathData(path)
    .transform(SVGPathDataTransformer.TO_ABS())
    .transform(SVGPathDataTransformer.NORMALIZE_HVZ())
    .transform(SVGPathDataTransformer.NORMALIZE_ST())
    .transform(SVGPathDataTransformer.QT_TO_C())
    .transform(SVGPathDataTransformer.A_TO_C())
    .commands
  const result: SvgPoint[] = []
  for (const command of commands) {
    if (command.type === SVGPathData.CLOSE_PATH) result.push({ close: true })
    else if (command.type === SVGPathData.MOVE_TO) result.push({ moveTo: true, x: command.x / ratioPx2Inch * scale.x, y: command.y / ratioPx2Inch * scale.y })
    else if (command.type === SVGPathData.LINE_TO) result.push({ x: command.x / ratioPx2Inch * scale.x, y: command.y / ratioPx2Inch * scale.y })
    else if (command.type === SVGPathData.CURVE_TO) {
      result.push({
        curve: {
          type: 'cubic',
          x1: command.x1 / ratioPx2Inch * scale.x,
          x2: command.x2 / ratioPx2Inch * scale.x,
          y1: command.y1 / ratioPx2Inch * scale.y,
          y2: command.y2 / ratioPx2Inch * scale.y,
        },
        x: command.x / ratioPx2Inch * scale.x,
        y: command.y / ratioPx2Inch * scale.y,
      })
    }
  }
  return result
}

function shadowOption(shadow: PPTElementShadow, ratioPx2Pt: number): PptxGenJS.ShadowProps {
  const color = formatColor(shadow.color)
  const { h, v } = shadow
  let offset = 4
  let angle = 45
  if (h === 0 && v !== 0) {
    offset = Math.abs(v); angle = v > 0 ? 90 : 270 
  }
  else if (v === 0 && h !== 0) {
    offset = Math.abs(h); angle = h > 0 ? 1 : 180 
  }
  else if (h > 0 && v > 0) {
    offset = Math.max(h, v); angle = 45 
  }
  else if (h > 0 && v < 0) {
    offset = Math.max(h, -v); angle = 315 
  }
  else if (h < 0 && v > 0) {
    offset = Math.max(-h, v); angle = 135 
  }
  else if (h < 0 && v < 0) {
    offset = Math.max(-h, -v); angle = 225 
  }
  return { angle, blur: shadow.blur / ratioPx2Pt, color: color.color.replace('#', ''), offset, opacity: color.alpha, type: 'outer' }
}

function outlineOption(outline: PPTElementOutline, ratioPx2Pt: number): PptxGenJS.ShapeLineProps {
  const color = formatColor(outline.color || '#000000')
  return {
    color: color.color,
    dashType: DASH_TYPE[outline.style || 'solid'],
    transparency: (1 - color.alpha) * 100,
    width: (outline.width || 1) / ratioPx2Pt,
  }
}

const isBase64Image = (url: string) => /^data:image\/[^;]+;base64,/.test(url)
const isSvgImage = (url: string) => /^data:image\/svg\+xml;base64,/.test(url) || /\.svg$/.test(url)

function linkOption(link: PPTElementLink, presentation: PresentationState): PptxGenJS.HyperlinkProps | null {
  if (link.type === 'web') return { url: link.target }
  const index = presentation.slides.findIndex(slide => slide.id === link.target)
  return index < 0 ? null : { slide: index + 1 }
}

function svgData(svg: string): string {
  const bytes = new TextEncoder().encode(svg)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `data:image/svg+xml;base64,${btoa(binary)}`
}

const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

function shapeSvg(element: PPTShapeElement): string {
  let fill = element.fill || 'none'
  let defs = ''
  if (element.pattern) {
    defs = `<pattern id="pattern" height="1" width="1" patternContentUnits="objectBoundingBox"><image href="${xml(element.pattern)}" height="1" width="1" preserveAspectRatio="xMidYMid slice"/></pattern>`
    fill = 'url(#pattern)'
  }
  else if (element.gradient) {
    const stops = element.gradient.colors.map(stop => `<stop offset="${stop.pos}%" stop-color="${xml(stop.color)}"/>`).join('')
    defs = element.gradient.type === 'linear'
      ? `<linearGradient id="gradient" gradientTransform="rotate(${element.gradient.rotate || 0},.5,.5)">${stops}</linearGradient>`
      : `<radialGradient id="gradient">${stops}</radialGradient>`
    fill = 'url(#gradient)'
  }
  // Match the on-canvas renderer: stretch the viewBox to the element size
  // (special shapes keep their original viewBox when resized), keep the
  // outline width constant, and honor dashed/dotted styles and the shared
  // outline color default.
  const outlineStyle = getOutlineRenderStyle(element.outline)
  const stroke = element.outline ? outlineStyle.color : 'transparent'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${element.width}" height="${element.height}" viewBox="0 0 ${element.viewBox[0]} ${element.viewBox[1]}" preserveAspectRatio="none"><defs>${defs}</defs><path d="${xml(element.path)}" vector-effect="non-scaling-stroke" fill="${xml(fill)}" fill-opacity="${element.opacity ?? 1}" stroke="${xml(stroke)}" stroke-width="${outlineStyle.width}" stroke-dasharray="${outlineStyle.dashArray}"/></svg>`
}

function latexSvg(path: string, viewBox: [number, number], color: string, strokeWidth: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" fill="none" stroke="${xml(color)}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"><path d="${xml(path)}"/></svg>`
}

function tableSubThemeColor(themeColor: string) {
  return [tinycolor(themeColor).setAlpha(0.3).toRgbString(), tinycolor(themeColor).setAlpha(0.1).toRgbString()]
}

function lineRange(element: PPTLineElement) {
  return {
    maxX: element.left + Math.max(element.start[0], element.end[0]),
    maxY: element.top + Math.max(element.start[1], element.end[1]),
    minX: element.left,
    minY: element.top,
  }
}

/**
 * The document a PDF is rendered from.
 *
 * Still assembled here rather than in the shell, because everything it needs is
 * in this document: the slide markup as the editor laid it out, and the rules
 * that styled it, which are only knowable by walking the live stylesheets.
 *
 * `<base>` is what lets the result be rendered somewhere else. The scraped rules
 * are full of root-absolute references — fonts especially — and they have to go
 * on meaning what they meant here.
 */
function printableDocument(node: HTMLElement, size: { height: number; margin: number; title: string; width: number }) {
  let stylesheet = ''
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) stylesheet += rule.cssText
    }
    catch {
      // Cross-origin stylesheets are skipped, as they are for any print.
    }
  }
  return `<!DOCTYPE html><html><head><base href="${xml(document.baseURI)}"><title>${xml(size.title)}</title>`
    + `<style>${stylesheet}html,body{height:auto;overflow:auto;margin:0}</style></head>`
    + `<body>${node.innerHTML}</body></html>`
}

async function exportEditablePptx(
  presentation: PresentationState,
  slides: Slide[],
  masterOverwrite: boolean,
  ignoreMedia: boolean,
  fileStem: string,
  t: TFunction,
) {
  const ratioPx2Inch = 96 * (presentation.viewportSize / 960)
  const ratioPx2Pt = 96 / 72 * (presentation.viewportSize / 960)
  const pptx = new PptxGenJS()
  setPptxLayout(pptx, presentation, ratioPx2Inch)
  if (masterOverwrite) {
    const background = formatColor(presentation.theme.backgroundColor)
    pptx.defineSlideMaster({ title: 'MONA_MASTER', background: { color: background.color, transparency: (1 - background.alpha) * 100 } })
  }

  for (const slide of slides) {
    const output = pptx.addSlide()
    applyPptxSlideMetadata(output, slide)
    const background = slide.background
    if (background?.type === 'image' && background.image) {
      if (isSvgImage(background.image.src)) output.addImage({ data: background.image.src, h: presentation.viewportSize * presentation.viewportRatio / ratioPx2Inch, w: presentation.viewportSize / ratioPx2Inch, x: 0, y: 0 })
      else if (isBase64Image(background.image.src)) output.background = { data: background.image.src }
      else output.background = { path: background.image.src }
    }
    else if (background?.type === 'solid' && background.color) {
      const color = formatColor(background.color)
      output.background = { color: color.color, transparency: (1 - color.alpha) * 100 }
    }
    else if (background?.type === 'gradient' && background.gradient) {
      const colors = background.gradient.colors
      const color = formatColor(tinycolor.mix(colors[0]!.color, colors.at(-1)!.color).toHexString())
      output.background = { color: color.color, transparency: (1 - color.alpha) * 100 }
    }
    if (slide.remark) {
      const notes = [...new DOMParser().parseFromString(slide.remark, 'text/html').body.querySelectorAll('p')].map(paragraph => paragraph.textContent || '')
      output.addNotes(notes.join('\n'))
    }

    for (const element of slide.elements || []) {
      if (element.type === 'text') {
        const inset = element.inset || [10, 10, 10, 10]
        const options: PptxGenJS.TextPropsOptions = {
          color: '#000000',
          fontFace: '微软雅黑',
          fontSize: DEFAULT_FONT_SIZE / ratioPx2Pt,
          h: element.height / ratioPx2Inch,
          lineSpacingMultiple: 1.5 / 1.25,
          margin: [inset[3], inset[1], inset[2], inset[0]].map(value => value / ratioPx2Pt) as [number, number, number, number],
          paraSpaceBefore: 5 / ratioPx2Pt,
          valign: element.vAlign || 'top',
          w: element.width / ratioPx2Inch,
          x: element.left / ratioPx2Inch,
          y: element.top / ratioPx2Inch,
        }
        if (element.rotate) options.rotate = element.rotate
        if (element.wordSpace) options.charSpacing = element.wordSpace / ratioPx2Pt
        if (element.lineHeight) options.lineSpacingMultiple = element.lineHeight / 1.25
        if (element.fill) {
          const color = formatColor(element.fill)
          options.fill = { color: color.color, transparency: (1 - color.alpha * (element.opacity ?? 1)) * 100 }
        }
        if (element.defaultColor) options.color = formatColor(element.defaultColor).color
        if (element.defaultFontName) options.fontFace = element.defaultFontName
        if (element.shadow) options.shadow = shadowOption(element.shadow, ratioPx2Pt)
        if (element.outline?.width) options.line = outlineOption(element.outline, ratioPx2Pt)
        if (element.opacity !== undefined) options.transparency = (1 - element.opacity) * 100
        if (element.paragraphSpace !== undefined) options.paraSpaceBefore = element.paragraphSpace / ratioPx2Pt
        if (element.vertical) options.vert = 'eaVert'
        if (!element.fixedHeight) options.fit = 'resize'
        output.addText(formatHtml(element.content, ratioPx2Pt), options)
      }
      else if (element.type === 'image') {
        const options: PptxGenJS.ImageProps = { h: element.height / ratioPx2Inch, w: element.width / ratioPx2Inch, x: element.left / ratioPx2Inch, y: element.top / ratioPx2Inch }
        if (isBase64Image(element.src)) options.data = element.src
        else options.path = element.src
        if (element.flipH) options.flipH = true
        if (element.flipV) options.flipV = true
        if (element.rotate) options.rotate = element.rotate
        if (element.link) {
          const link = linkOption(element.link, presentation); if (link) options.hyperlink = link 
        }
        if (element.filters?.opacity) options.transparency = 100 - parseInt(element.filters.opacity)
        if (element.clip) {
          if (element.clip.shape === 'ellipse') options.rounding = true
          const [[startX, startY], [endX, endY]] = element.clip.range
          const originW = element.width / ((endX - startX) / ratioPx2Inch)
          const originH = element.height / ((endY - startY) / ratioPx2Inch)
          options.w = originW / ratioPx2Inch
          options.h = originH / ratioPx2Inch
          options.sizing = {
            h: (endY - startY) / ratioPx2Inch * originH / ratioPx2Inch,
            type: 'crop',
            w: (endX - startX) / ratioPx2Inch * originW / ratioPx2Inch,
            x: startX / ratioPx2Inch * originW / ratioPx2Inch,
            y: startY / ratioPx2Inch * originH / ratioPx2Inch,
          }
        }
        output.addImage(options)
      }
      else if (element.type === 'shape') {
        if (element.special) {
          const options: PptxGenJS.ImageProps = { data: svgData(shapeSvg(element)), h: element.height / ratioPx2Inch, w: element.width / ratioPx2Inch, x: element.left / ratioPx2Inch, y: element.top / ratioPx2Inch }
          if (element.rotate) options.rotate = element.rotate
          if (element.flipH) options.flipH = true
          if (element.flipV) options.flipV = true
          if (element.link) {
            const link = linkOption(element.link, presentation); if (link) options.hyperlink = link 
          }
          output.addImage(options)
        }
        else {
          let fill = formatColor(element.fill)
          if (element.gradient) fill = formatColor(tinycolor.mix(element.gradient.colors[0]!.color, element.gradient.colors.at(-1)!.color).toHexString())
          if (element.pattern) fill = formatColor('#00000000')
          const options: PptxGenJS.ShapeProps = {
            fill: { color: fill.color, transparency: (1 - fill.alpha * (element.opacity ?? 1)) * 100 },
            h: element.height / ratioPx2Inch,
            points: svgPoints(element.path, ratioPx2Inch, { x: element.width / element.viewBox[0], y: element.height / element.viewBox[1] }),
            w: element.width / ratioPx2Inch,
            x: element.left / ratioPx2Inch,
            y: element.top / ratioPx2Inch,
          }
          if (element.flipH) options.flipH = true
          if (element.flipV) options.flipV = true
          if (element.shadow) options.shadow = shadowOption(element.shadow, ratioPx2Pt)
          if (element.outline?.width) options.line = outlineOption(element.outline, ratioPx2Pt)
          if (element.rotate) options.rotate = element.rotate
          if (element.link) {
            const link = linkOption(element.link, presentation); if (link) options.hyperlink = link 
          }
          output.addShape('custGeom' as PptxGenJS.ShapeType, options)
        }
        if (element.text) {
          const inset = element.text.inset || [10, 10, 10, 10]
          const options: PptxGenJS.TextPropsOptions = {
            color: element.text.defaultColor ? formatColor(element.text.defaultColor).color : '#000000',
            fontFace: element.text.defaultFontName || '微软雅黑',
            fontSize: DEFAULT_FONT_SIZE / ratioPx2Pt,
            h: element.height / ratioPx2Inch,
            margin: [inset[3], inset[1], inset[2], inset[0]].map(value => value / ratioPx2Pt) as [number, number, number, number],
            paraSpaceBefore: 5 / ratioPx2Pt,
            rotate: element.rotate || undefined,
            valign: element.text.align,
            w: element.width / ratioPx2Inch,
            x: element.left / ratioPx2Inch,
            y: element.top / ratioPx2Inch,
          }
          output.addText(formatHtml(element.text.content, ratioPx2Pt), options)
        }
        if (element.pattern) {
          const options: PptxGenJS.ImageProps = { h: element.height / ratioPx2Inch, w: element.width / ratioPx2Inch, x: element.left / ratioPx2Inch, y: element.top / ratioPx2Inch }
          if (isBase64Image(element.pattern)) options.data = element.pattern
          else options.path = element.pattern
          if (element.flipH) options.flipH = true
          if (element.flipV) options.flipV = true
          if (element.rotate) options.rotate = element.rotate
          if (element.link) {
            const link = linkOption(element.link, presentation); if (link) options.hyperlink = link 
          }
          output.addImage(options)
        }
      }
      else if (element.type === 'line') {
        const range = lineRange(element)
        const color = formatColor(element.color)
        const options: PptxGenJS.ShapeProps = {
          h: (range.maxY - range.minY) / ratioPx2Inch,
          line: {
            beginArrowType: element.points[0] ? 'arrow' : 'none',
            color: color.color,
            dashType: DASH_TYPE[element.style],
            endArrowType: element.points[1] ? 'arrow' : 'none',
            transparency: (1 - color.alpha) * 100,
            width: element.width / ratioPx2Pt,
          },
          points: svgPoints(getLinePath(element), ratioPx2Inch),
          w: (range.maxX - range.minX) / ratioPx2Inch,
          x: element.left / ratioPx2Inch,
          y: element.top / ratioPx2Inch,
        }
        if (element.shadow) options.shadow = shadowOption(element.shadow, ratioPx2Pt)
        output.addShape('custGeom' as PptxGenJS.ShapeType, options)
      }
      else if (element.type === 'chart') {
        const data = element.data.series.map((values, index) => ({ labels: element.data.labels, name: t('chartData.series', { number: index + 1 }), values }))
        let colors: string[]
        if (element.themeColors.length === 10) colors = element.themeColors.map(color => formatColor(color).color)
        else if (element.themeColors.length === 1) colors = tinycolor(element.themeColors[0]).analogous(10).map(color => formatColor(color.toHexString()).color)
        else {
          const count = element.themeColors.length
          const supplement = tinycolor(element.themeColors[count - 1]).analogous(11 - count).map(color => color.toHexString())
          colors = [...element.themeColors.slice(0, count - 1), ...supplement].map(color => formatColor(color).color)
        }
        const textColor = formatColor(element.textColor || '#000000').color
        const fontSize = 14 / ratioPx2Pt
        const options: PptxGenJS.IChartOpts = {
          catAxisLabelColor: textColor,
          catAxisLabelFontSize: fontSize,
          chartColors: (element.chartType === 'pie' || element.chartType === 'ring') ? colors : colors.slice(0, element.data.series.length),
          h: element.height / ratioPx2Inch,
          valAxisLabelColor: textColor,
          valAxisLabelFontSize: fontSize,
          w: element.width / ratioPx2Inch,
          x: element.left / ratioPx2Inch,
          y: element.top / ratioPx2Inch,
        }
        if (element.fill || element.outline) {
          options.plotArea = {}
          if (element.fill) options.plotArea.fill = { color: formatColor(element.fill).color }
          if (element.outline) options.plotArea.border = { color: formatColor(element.outline.color || '#000000').color, pt: (element.outline.width || 1) / ratioPx2Pt }
        }
        if ((element.data.series.length > 1 && element.chartType !== 'scatter') || ['pie', 'ring'].includes(element.chartType)) {
          Object.assign(options, { legendColor: textColor, legendFontSize: fontSize, legendPos: 'b', showLegend: true })
        }
        let type = pptx.ChartType.bar
        if (element.chartType === 'bar') {
          type = pptx.ChartType.bar; options.barDir = 'col'; if (element.options?.stack) options.barGrouping = 'stacked' 
        }
        else if (element.chartType === 'column') {
          type = pptx.ChartType.bar; options.barDir = 'bar'; if (element.options?.stack) options.barGrouping = 'stacked' 
        }
        else if (element.chartType === 'line') {
          type = pptx.ChartType.line; if (element.options?.lineSmooth) options.lineSmooth = true 
        }
        else if (element.chartType === 'area') type = pptx.ChartType.area
        else if (element.chartType === 'radar') type = pptx.ChartType.radar
        else if (element.chartType === 'scatter') {
          type = pptx.ChartType.scatter; options.lineSize = 0 
        }
        else if (element.chartType === 'pie') type = pptx.ChartType.pie
        else if (element.chartType === 'ring') {
          type = pptx.ChartType.doughnut; options.holeSize = 60 
        }
        output.addChart(type, data, options)
      }
      else if (element.type === 'table') {
        const hidden = new Set<string>()
        element.data.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => {
          if (cell.colspan <= 1 && cell.rowspan <= 1) return
          for (let rowOffset = rowIndex; rowOffset < rowIndex + cell.rowspan; rowOffset++) {
            for (let columnOffset = rowOffset === rowIndex ? columnIndex + 1 : columnIndex; columnOffset < columnIndex + cell.colspan; columnOffset++) hidden.add(`${rowOffset}_${columnOffset}`)
          }
        }))
        const themeColor = element.theme ? formatColor(element.theme.color) : null
        const subThemeColors = element.theme ? tableSubThemeColor(element.theme.color).map(formatColor) : []
        const rows: PptxGenJS.TableRow[] = []
        element.data.forEach((row, rowIndex) => {
          const cells: PptxGenJS.TableCell[] = []
          row.forEach((cell, columnIndex) => {
            if (hidden.has(`${rowIndex}_${columnIndex}`)) return
            const options: PptxGenJS.TableCellProps = {
              align: cell.style?.align || 'left',
              bold: cell.style?.bold || false,
              colspan: cell.colspan,
              fontFace: cell.style?.fontname || '微软雅黑',
              fontSize: (cell.style?.fontsize ? parseInt(cell.style.fontsize) : 14) / ratioPx2Pt,
              italic: cell.style?.em || false,
              rowspan: cell.rowspan,
              underline: { style: cell.style?.underline ? 'sng' : 'none' },
              valign: 'middle',
            }
            if (element.theme && themeColor) {
              let color: FormatColor = rowIndex % 2 === 0 ? subThemeColors[1]! : subThemeColors[0]!
              if (element.theme.rowHeader && rowIndex === 0) color = themeColor
              else if (element.theme.rowFooter && rowIndex === element.data.length - 1) color = themeColor
              else if (element.theme.colHeader && columnIndex === 0) color = themeColor
              else if (element.theme.colFooter && columnIndex === row.length - 1) color = themeColor
              options.fill = { color: color.color, transparency: (1 - color.alpha) * 100 }
            }
            if (cell.style?.backcolor) {
              const color = formatColor(cell.style.backcolor); options.fill = { color: color.color, transparency: (1 - color.alpha) * 100 } 
            }
            if (cell.style?.color) options.color = formatColor(cell.style.color).color
            cells.push({ options, text: cell.text })
          })
          if (cells.length) rows.push(cells)
        })
        const options: PptxGenJS.TableProps = {
          colW: element.colWidths.map(value => element.width * value / ratioPx2Inch),
          h: element.height / ratioPx2Inch,
          w: element.width / ratioPx2Inch,
          x: element.left / ratioPx2Inch,
          y: element.top / ratioPx2Inch,
        }
        if (element.theme) options.fill = { color: '#ffffff' }
        if (element.outline.width && element.outline.color) options.border = { color: formatColor(element.outline.color).color, pt: element.outline.width / ratioPx2Pt, type: element.outline.style === 'solid' ? 'solid' : 'dash' }
        output.addTable(rows, options)
      }
      else if (element.type === 'latex') {
        const options: PptxGenJS.ImageProps = { data: svgData(latexSvg(element.path, element.viewBox, element.color, element.strokeWidth)), h: element.height / ratioPx2Inch, w: element.width / ratioPx2Inch, x: element.left / ratioPx2Inch, y: element.top / ratioPx2Inch }
        if (element.link) {
          const link = linkOption(element.link, presentation); if (link) options.hyperlink = link 
        }
        output.addImage(options)
      }
      else if (!ignoreMedia && (element.type === 'video' || element.type === 'audio')) {
        const options: PptxGenJS.MediaProps = { h: element.height / ratioPx2Inch, path: element.src, type: element.type, w: element.width / ratioPx2Inch, x: element.left / ratioPx2Inch, y: element.top / ratioPx2Inch }
        if (element.type === 'video' && element.poster) options.cover = element.poster
        const match = element.src.match(/\.([a-zA-Z0-9]+)(?:[?#]|$)/)
        options.extn = match?.[1] || element.ext
        if (options.extn && ['avi', 'mp4', 'm4v', 'mov', 'wmv', 'mp3', 'm4a', 'wav', 'wma'].includes(options.extn)) output.addMedia(options)
      }
    }
  }
  await nextFrame()
  await savePptx(pptx, fileStem)
}

/**
 * `writeFile` triggers a browser download; the bytes go through the save dialog
 * instead, so the user picks the name and the place.
 */
async function savePptx(pptx: PptxGenJS, fileStem: string) {
  const bytes = await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer
  await saveFile(bytes, `${fileStem}.pptx`, PRESENTATION_FILTERS.pptx)
}

function exportPayload(presentation: PresentationState, slides = presentation.slides) {
  return {
    height: presentation.viewportSize * presentation.viewportRatio,
    slides,
    theme: presentation.theme,
    title: presentation.title,
    width: presentation.viewportSize,
  }
}

export function useEditorExportActions(runtime: EditorRuntime, t: TFunction): EditorExportActions {
  const { notifications } = useEditorApplication()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const fileStem = getExportFileStem(presentation.title, t('header.untitledPresentation'))
  return useMemo(() => ({
    exportImage: async (node, format, quality, ignoreWebfont) => {
      try {
        node.querySelectorAll('foreignObject [xmlns]').forEach(element => element.removeAttribute('xmlns'))
        await nextFrame()
        const config: ExportImageConfig = { quality, width: 1600 }
        if (ignoreWebfont) config.fontEmbedCSS = ''
        const data = await (format === 'png' ? toPng : toJpeg)(node, config)
        await saveFile(data, `${fileStem}.${format}`, [{ extensions: [format], name: format.toUpperCase() }])
      }
      catch {
        notifications.notify({ text: t('runtime.exportImageFailed'), type: 'error' })
      }
    },
    exportImagePptx: async nodes => {
      try {
        await nextFrame()
        const pptx = new PptxGenJS()
        const ratioPx2Inch = 96 * (presentation.viewportSize / 960)
        setPptxLayout(pptx, presentation, ratioPx2Inch)
        const images = await Promise.all([...nodes].map(async node => {
          node.querySelectorAll('foreignObject [xmlns]').forEach(element => element.removeAttribute('xmlns'))
          return toJpeg(node as HTMLElement, { quality: 1, width: 1600 })
        }))
        for (const data of images) pptx.addSlide().addImage({ data, h: presentation.viewportSize * presentation.viewportRatio / ratioPx2Inch, w: presentation.viewportSize / ratioPx2Inch, x: 0, y: 0 })
        await savePptx(pptx, fileStem)
      }
      catch {
        notifications.notify({ text: t('runtime.exportFailed'), type: 'error' })
      }
    },
    exportJson: async () => {
      try {
        await saveFile(JSON.stringify(exportPayload(presentation)), `${fileStem}.json`, PRESENTATION_FILTERS.json)
      }
      catch {
        notifications.notify({ text: t('runtime.exportFailed'), type: 'error' })
      }
    },
    exportNative: async slides => {
      try {
        await saveFile(encryptNativePresentation(JSON.stringify(exportPayload(presentation, slides))), `${fileStem}.mona`, PRESENTATION_FILTERS.native)
      }
      catch {
        notifications.notify({ text: t('runtime.exportFailed'), type: 'error' })
      }
    },
    exportPptx: async (slides, masterOverwrite, ignoreMedia) => {
      try {
        await exportEditablePptx(presentation, slides, masterOverwrite, ignoreMedia, fileStem, t)
      }
      catch {
        notifications.notify({ text: t('runtime.exportFailed'), type: 'error' })
      }
    },
    printPdf: async (node, page) => {
      try {
        await monaBridge().files.printToPdf({
          defaultName: fileStem,
          html: printableDocument(node, { ...page, title: fileStem }),
          page,
        })
      }
      catch {
        notifications.notify({ text: t('runtime.exportFailed'), type: 'error' })
      }
    },
  }), [fileStem, notifications, presentation, t])
}
