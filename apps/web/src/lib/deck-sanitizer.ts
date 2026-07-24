import DOMPurify from 'dompurify'

import type { PPTElement, Slide, StructuredTextBody, TableCell } from '@mona/presentation-core/model'
import type { PowerPointPackageReference } from '@mona/presentation-core'

// Deck content from outside this session (imported files, foreign clipboard
// payloads, persisted working copies) renders through dangerouslySetInnerHTML
// and navigation sinks, so it is sanitized at every entry boundary.
//
// Benign content must pass through BYTE-IDENTICAL: imported decks are compared
// byte-for-byte for benign editor markup, and DOMPurify's parse/serialize
// round trip would otherwise normalize entities and void tags. The rule:
// keep the original string unless DOMPurify actually removed something.

export const sanitizeRichHtml = (html: string): string => {
  // target is legitimate the source editor link markup (ProseMirror emits target=_blank);
  // DOMPurify would otherwise strip it and force the sanitized form.
  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ['target'] })
  return DOMPurify.removed.length === 0 ? html : clean
}

const urlScheme = (url: string): string | null => {
  const match = /^\s*([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url)
  return match ? `${match[1]!.toLowerCase()}:` : null
}

// Media sinks (img/video/audio src, poster, slide backgrounds). data: and
// blob: are load targets here, never navigation, so both stay allowed.
const MEDIA_SCHEMES = new Set(['http:', 'https:', 'data:', 'blob:'])
export const sanitizeMediaUrl = (url: string): string => {
  const scheme = urlScheme(url)
  return scheme === null || MEDIA_SCHEMES.has(scheme) ? url : ''
}

// Navigation sinks (element links open via href/window.open, where data: and
// javascript: would execute in the presentation's context).
const NAVIGATION_SCHEMES = new Set(['http:', 'https:', 'mailto:'])
export const sanitizeNavigationUrl = (url: string): string => {
  const scheme = urlScheme(url)
  return scheme !== null && NAVIGATION_SCHEMES.has(scheme) ? url : ''
}

type Patch<T> = { changed: boolean; value: T }

const patchString = (value: string, sanitize: (input: string) => string): Patch<string> => {
  const next = sanitize(value)
  return { changed: next !== value, value: next }
}

const sanitizeTableData = (data: TableCell[][]): Patch<TableCell[][]> => {
  let changed = false
  const rows = data.map(row => {
    let rowChanged = false
    const cells = row.map(cell => {
      if (typeof cell?.text !== 'string') return cell
      const text = patchString(cell.text, sanitizeRichHtml)
      if (!text.changed) return cell
      rowChanged = true
      return { ...cell, text: text.value }
    })
    if (!rowChanged) return row
    changed = true
    return cells
  })
  return { changed, value: changed ? rows : data }
}

const sanitizeStructuredText = (
  body: StructuredTextBody | undefined,
): StructuredTextBody | undefined => {
  if (!body) return body
  let changed = false
  const paragraphs = body.paragraphs.map(paragraph => {
    let paragraphChanged = false
    const runs = paragraph.runs.map(run => {
      if (!run.hyperlink) return run
      const hyperlink = sanitizeNavigationUrl(run.hyperlink)
      if (hyperlink === run.hyperlink) return run
      changed = true
      paragraphChanged = true
      return { ...run, hyperlink: hyperlink || undefined }
    })
    return paragraphChanged ? { ...paragraph, runs } : paragraph
  })
  return changed ? { ...body, paragraphs } : body
}

export const sanitizeElement = (element: PPTElement): PPTElement => {
  const diff: Record<string, unknown> = {}

  if (element.type === 'group') {
    const elements = sanitizeElements(element.elements)
    if (elements !== element.elements) diff.elements = elements
  }
  if (element.type === 'opaque' && typeof element.preview === 'string') {
    const preview = patchString(element.preview, sanitizeMediaUrl)
    if (preview.changed) diff.preview = preview.value
  }
  if (element.type === 'text' && typeof element.content === 'string') {
    const content = patchString(element.content, sanitizeRichHtml)
    if (content.changed) diff.content = content.value
    const structuredText = sanitizeStructuredText(element.structuredText)
    if (structuredText !== element.structuredText) diff.structuredText = structuredText
  }
  if (element.type === 'shape' && typeof element.text?.content === 'string') {
    const content = patchString(element.text.content, sanitizeRichHtml)
    const structuredText = sanitizeStructuredText(element.text.structuredText)
    if (content.changed || structuredText !== element.text.structuredText) {
      diff.text = {
        ...element.text,
        content: content.value,
        structuredText,
      }
    }
  }
  if (element.type === 'table' && Array.isArray(element.data)) {
    const data = sanitizeTableData(element.data)
    if (data.changed) diff.data = data.value
  }
  if ((element.type === 'image' || element.type === 'video' || element.type === 'audio') && typeof element.src === 'string') {
    const src = patchString(element.src, sanitizeMediaUrl)
    if (src.changed) diff.src = src.value
  }
  if (element.type === 'video' && typeof element.poster === 'string') {
    const poster = patchString(element.poster, sanitizeMediaUrl)
    if (poster.changed) diff.poster = poster.value
  }
  if (element.link) {
    if (element.link.type === 'web') {
      const target = patchString(String(element.link.target ?? ''), sanitizeNavigationUrl)
      if (target.changed) diff.link = target.value ? { ...element.link, target: target.value } : undefined
    }
    else if (typeof element.link.target !== 'string') {
      diff.link = undefined
    }
  }

  return Object.keys(diff).length === 0 ? element : { ...element, ...diff } as PPTElement
}

export const sanitizeElements = (elements: PPTElement[]): PPTElement[] => {
  const next = elements.map(sanitizeElement)
  return next.some((element, index) => element !== elements[index]) ? next : elements
}

export const sanitizePowerPointPackageReference = (
  sourcePackage: PowerPointPackageReference,
): PowerPointPackageReference => {
  const hierarchy = sourcePackage.hierarchy
  if (!hierarchy) return sourcePackage
  let changed = false
  const sanitizeLayers = <Layer extends { background?: Slide['background']; elements?: PPTElement[] }>(
    layers: Layer[],
  ): Layer[] => layers.map(layer => {
    const elements = layer.elements ? sanitizeElements(layer.elements) : layer.elements
    let background = layer.background
    if (background?.type === 'image' && background.image) {
      const src = sanitizeMediaUrl(background.image.src)
      if (src !== background.image.src) {
        background = { ...background, image: { ...background.image, src } }
      }
    }
    if (elements === layer.elements && background === layer.background) return layer
    changed = true
    return { ...layer, background, elements }
  })
  const layouts = sanitizeLayers(hierarchy.layouts)
  const masters = sanitizeLayers(hierarchy.masters)
  const placeholders = hierarchy.placeholders.map(placeholder => {
    if (placeholder.layer) return placeholder
    changed = true
    return {
      ...placeholder,
      layer: placeholder.partPath.includes('/slideLayouts/')
        ? 'layout' as const
        : placeholder.partPath.includes('/slideMasters/')
          ? 'master' as const
          : 'slide' as const,
    }
  })
  if (!changed) return sourcePackage
  return {
    ...sourcePackage,
    hierarchy: { ...hierarchy, layouts, masters, placeholders },
  }
}

export const sanitizeSlide = (slide: Slide): Slide => {
  const diff: Record<string, unknown> = {}

  const elements = sanitizeElements(slide.elements ?? [])
  if (elements !== slide.elements) diff.elements = elements
  if (typeof slide.remark === 'string') {
    const remark = patchString(slide.remark, sanitizeRichHtml)
    if (remark.changed) diff.remark = remark.value
  }
  if (slide.background?.image && typeof slide.background.image.src === 'string') {
    const src = patchString(slide.background.image.src, sanitizeMediaUrl)
    if (src.changed) diff.background = { ...slide.background, image: { ...slide.background.image, src: src.value } }
  }

  return Object.keys(diff).length === 0 ? slide : { ...slide, ...diff }
}

export const sanitizeSlides = (slides: Slide[]): Slide[] => {
  const next = slides.map(sanitizeSlide)
  return next.some((slide, index) => slide !== slides[index]) ? next : slides
}
