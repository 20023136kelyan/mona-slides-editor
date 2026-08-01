import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser'
import JSZip from 'jszip'

import type {
  PowerPointPackageManifest,
} from '@mona/presentation-core'

import type {
  PowerPointConnectorPatch,
  PowerPointPatchOperation,
  PowerPointShapeStylePatch,
  PowerPointTextPatch,
  PowerPointTransformPatch,
  PowerPointWritebackIssue,
} from './types'
import { PowerPointWritebackError } from './types'
import {
  parseAuthoredText,
  type AuthoredTextParagraph,
  type AuthoredTextRun,
  type AuthoredTextStyle,
} from './authored-text'

type OrderedXmlNode = Record<string, unknown>

const drawingObjectTags = new Set([
  'contentPart',
  'cxnSp',
  'graphicFrame',
  'grpSp',
  'pic',
  'sp',
])

const xmlParser = new XMLParser({
  attributeNamePrefix: '',
  ignoreAttributes: false,
  ignoreDeclaration: false,
  parseAttributeValue: false,
  parseTagValue: false,
  preserveOrder: true,
  processEntities: false,
  removeNSPrefix: false,
  trimValues: false,
})

const xmlBuilder = new XMLBuilder({
  attributeNamePrefix: '',
  format: false,
  ignoreAttributes: false,
  preserveOrder: true,
  processEntities: false,
  suppressEmptyNode: false,
})

const localName = (name: string): string => name.slice(name.lastIndexOf(':') + 1)

const nodeEntries = (node: OrderedXmlNode): Array<[string, OrderedXmlNode[]]> => (
  Object.entries(node).flatMap(([tag, value]) => (
    tag === ':@' || !Array.isArray(value) ? [] : [[tag, value as OrderedXmlNode[]]]
  ))
)

const nodeAttributes = (node: OrderedXmlNode): Record<string, string> => {
  const value = node[':@']
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const attributes: Record<string, string> = {}
    node[':@'] = attributes
    return attributes
  }
  return value as Record<string, string>
}

const parseXml = (value: string, partPath: string): OrderedXmlNode[] => {
  if (/<!DOCTYPE\b/i.test(value)) {
    throw new Error(`PowerPoint XML part contains a prohibited DOCTYPE: ${partPath}`)
  }
  const validation = XMLValidator.validate(value, { allowBooleanAttributes: false })
  if (validation !== true) {
    throw new Error(`Invalid PowerPoint XML part: ${partPath} (${validation.err.msg})`)
  }
  const parsed: unknown = xmlParser.parse(value)
  if (!Array.isArray(parsed)) throw new Error(`Invalid PowerPoint XML tree: ${partPath}`)
  return parsed as OrderedXmlNode[]
}

const findNode = (
  nodes: readonly OrderedXmlNode[],
  expected: string,
): OrderedXmlNode | undefined => {
  for (const node of nodes) {
    for (const [tag, children] of nodeEntries(node)) {
      if (localName(tag) === expected) return node
      const nested = findNode(children, expected)
      if (nested) return nested
    }
  }
  return undefined
}

const findOwnTransform = (
  nodes: readonly OrderedXmlNode[],
): OrderedXmlNode | undefined => {
  for (const node of nodes) {
    for (const [tag, children] of nodeEntries(node)) {
      const name = localName(tag)
      if (name === 'xfrm') return node
      if (drawingObjectTags.has(name)) continue
      const nested = findOwnTransform(children)
      if (nested) return nested
    }
  }
  return undefined
}

const nonVisualId = (children: readonly OrderedXmlNode[]): string | undefined => {
  const nonVisual = findNode(children, 'cNvPr')
  const value = nonVisual ? nodeAttributes(nonVisual).id : undefined
  return value || undefined
}

const numericAttribute = (
  node: OrderedXmlNode | undefined,
  name: string,
): number | undefined => {
  const value = node ? Number(nodeAttributes(node)[name]) : Number.NaN
  return Number.isFinite(value) ? value : undefined
}

const ownChildren = (node: OrderedXmlNode): OrderedXmlNode[] => (
  nodeEntries(node)[0]?.[1] ?? []
)

const nodeTag = (node: OrderedXmlNode): string | undefined => (
  nodeEntries(node)[0]?.[0]
)

const directNode = (
  nodes: readonly OrderedXmlNode[],
  expected: string,
): OrderedXmlNode | undefined => nodes.find(node => {
  const tag = nodeTag(node)
  return tag !== undefined && localName(tag) === expected
})

const directNodes = (
  nodes: readonly OrderedXmlNode[],
  expected: string,
): OrderedXmlNode[] => nodes.filter(node => {
  const tag = nodeTag(node)
  return tag !== undefined && localName(tag) === expected
})

const xmlNode = (
  tag: string,
  children: OrderedXmlNode[] = [],
  attributes?: Record<string, string>,
): OrderedXmlNode => ({
  [tag]: children,
  ...(attributes && Object.keys(attributes).length ? { ':@': attributes } : {}),
})

const removeDirectNodes = (
  nodes: OrderedXmlNode[],
  names: ReadonlySet<string>,
): void => {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const tag = nodeTag(nodes[index]!)
    if (tag && names.has(localName(tag))) nodes.splice(index, 1)
  }
}

const ensureDirectNode = (
  nodes: OrderedXmlNode[],
  expected: string,
  tag: string,
  index = nodes.length,
): OrderedXmlNode => {
  const existing = directNode(nodes, expected)
  if (existing) return existing
  const created = xmlNode(tag)
  nodes.splice(index, 0, created)
  return created
}

const escapeXmlText = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

const parseCssNumber = (value: string | undefined): number | undefined => {
  if (!value) return undefined
  const result = Number.parseFloat(value)
  return Number.isFinite(result) ? result : undefined
}

const normalizeFontFamily = (value: string | undefined): string | undefined => {
  const family = value?.split(',')[0]?.trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2')
  return family || undefined
}

const normalizeColor = (value: string | undefined): string | undefined => {
  if (!value || value === 'transparent') return undefined
  const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1]
  if (hex) {
    const expanded = hex.length === 3
      ? [...hex].map(entry => `${entry}${entry}`).join('')
      : hex.slice(0, 6)
    return expanded.toUpperCase()
  }
  const rgb = value.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)/i)
  if (!rgb) return undefined
  return rgb.slice(1, 4).map(entry => (
    Math.max(0, Math.min(255, Math.round(Number(entry)))).toString(16).padStart(2, '0')
  )).join('').toUpperCase()
}

const styleValue = (style: AuthoredTextStyle, property: string): string | undefined => (
  style[property]?.trim().toLowerCase()
)

const styleChanged = (
  before: AuthoredTextStyle,
  after: AuthoredTextStyle,
  property: string,
): boolean => styleValue(before, property) !== styleValue(after, property)

const setBooleanAttribute = (
  attributes: Record<string, string>,
  name: string,
  value: boolean,
): void => {
  attributes[name] = value ? '1' : '0'
}

const insertBeforeHyperlinks = (
  children: OrderedXmlNode[],
  node: OrderedXmlNode,
): void => {
  const index = children.findIndex(child => {
    const tag = nodeTag(child)
    return tag && ['hlinkClick', 'hlinkMouseOver', 'rtl', 'extLst'].includes(localName(tag))
  })
  children.splice(index < 0 ? children.length : index, 0, node)
}

const replaceSolidColor = (
  children: OrderedXmlNode[],
  color: string | undefined,
  fillNames: ReadonlySet<string>,
): void => {
  removeDirectNodes(children, fillNames)
  if (!color) return
  children.unshift(xmlNode('a:solidFill', [
    xmlNode('a:srgbClr', [], { val: color }),
  ]))
}

const patchRunProperties = ({
  after,
  before,
  forceColor,
  forceFont,
  forceSpacing,
  node,
  scale,
}: {
  after: AuthoredTextStyle
  before: AuthoredTextStyle
  forceColor?: string
  forceFont?: string
  forceSpacing?: number
  node: OrderedXmlNode
  scale: number
}): void => {
  const runChildren = ownChildren(node)
  const rPr = ensureDirectNode(runChildren, 'rPr', 'a:rPr', 0)
  const attributes = nodeAttributes(rPr)
  const rPrChildren = ownChildren(rPr)
  if (styleChanged(before, after, 'font-weight')) {
    const weight = styleValue(after, 'font-weight')
    setBooleanAttribute(attributes, 'b', weight === 'bold' || Number.parseInt(weight ?? '0', 10) >= 600)
  }
  if (styleChanged(before, after, 'font-style')) {
    setBooleanAttribute(attributes, 'i', styleValue(after, 'font-style') === 'italic')
  }
  if (styleChanged(before, after, 'text-decoration-line')) {
    const decoration = styleValue(after, 'text-decoration-line') ?? ''
    attributes.u = decoration.includes('underline') ? 'sng' : 'none'
    attributes.strike = decoration.includes('line-through') ? 'sngStrike' : 'noStrike'
  }
  if (styleChanged(before, after, 'vertical-align')) {
    const value = styleValue(after, 'vertical-align')
    attributes.baseline = value === 'super' ? '30000' : value === 'sub' ? '-25000' : '0'
  }
  if (styleChanged(before, after, 'text-transform')) {
    attributes.cap = styleValue(after, 'text-transform') === 'uppercase' ? 'all' : 'none'
  }
  if (styleChanged(before, after, 'font-variant-caps')) {
    attributes.cap = styleValue(after, 'font-variant-caps') === 'small-caps' ? 'small' : 'none'
  }
  if (styleChanged(before, after, 'font-size')) {
    const size = parseCssNumber(after['font-size'])
    if (size !== undefined) attributes.sz = String(Math.max(100, Math.round(size / scale * 100)))
    else delete attributes.sz
  }
  if (forceSpacing !== undefined || styleChanged(before, after, 'letter-spacing')) {
    const spacing = forceSpacing ?? parseCssNumber(after['letter-spacing'])
    if (spacing !== undefined) attributes.spc = String(Math.round(spacing / scale * 100))
    else delete attributes.spc
  }
  const fontChanged = forceFont !== undefined || styleChanged(before, after, 'font-family')
  if (fontChanged) {
    const font = forceFont || normalizeFontFamily(after['font-family'])
    removeDirectNodes(rPrChildren, new Set(['latin', 'ea', 'cs']))
    if (font) {
      for (const tag of ['a:latin', 'a:ea', 'a:cs']) {
        insertBeforeHyperlinks(rPrChildren, xmlNode(tag, [], { typeface: font }))
      }
    }
  }
  const colorChanged = forceColor !== undefined || styleChanged(before, after, 'color')
  if (colorChanged) {
    replaceSolidColor(
      rPrChildren,
      normalizeColor(forceColor ?? after.color),
      new Set(['gradFill', 'noFill', 'pattFill', 'solidFill']),
    )
  }
}

const setTextNode = (run: OrderedXmlNode, value: string): void => {
  const children = ownChildren(run)
  let text = directNode(children, 't')
  if (!text) {
    text = xmlNode('a:t')
    children.push(text)
  }
  const textChildren = ownChildren(text)
  const textValue = textChildren.find(child => '#text' in child)
  if (textValue) textValue['#text'] = escapeXmlText(value)
  else textChildren.push({ '#text': escapeXmlText(value) })
  const attributes = nodeAttributes(text)
  if (/^\s|\s$/.test(value)) attributes['xml:space'] = 'preserve'
  else delete attributes['xml:space']
}

const runKind = (node: OrderedXmlNode): AuthoredTextRun['kind'] => {
  const tag = localName(nodeTag(node) ?? '')
  return tag === 'br' ? 'break' : tag === 'tab' ? 'tab' : tag === 'fld' ? 'field' : 'text'
}

const plainRunFrom = (
  template: OrderedXmlNode | undefined,
  kind: AuthoredTextRun['kind'],
): OrderedXmlNode => {
  if (kind === 'break') return xmlNode('a:br')
  if (kind === 'tab') return xmlNode('a:tab')
  const templateRPr = template ? directNode(ownChildren(template), 'rPr') : undefined
  const clonedRPr = templateRPr ? structuredClone(templateRPr) : undefined
  if (clonedRPr) {
    removeDirectNodes(ownChildren(clonedRPr), new Set(['hlinkClick', 'hlinkMouseOver']))
  }
  const children = clonedRPr ? [clonedRPr] : []
  children.push(xmlNode('a:t'))
  return xmlNode('a:r', children)
}

interface RunTemplate {
  node: OrderedXmlNode
  run: AuthoredTextRun | undefined
}

interface ParagraphTemplate {
  node: OrderedXmlNode
  paragraph: AuthoredTextParagraph | undefined
  runs: Map<string, RunTemplate>
}

const xmlRunNodes = (paragraph: OrderedXmlNode): OrderedXmlNode[] => ownChildren(paragraph).filter(node => (
  ['br', 'fld', 'r', 'tab'].includes(localName(nodeTag(node) ?? ''))
))

const sourceText = (node: OrderedXmlNode): string => {
  const text = directNode(ownChildren(node), 't')
  if (!text) return ''
  const value = ownChildren(text).find(child => '#text' in child)?.['#text']
  return typeof value === 'string' ? decodeXmlText(value) : ''
}

const decodeXmlText = (value: string): string => value
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&')

const expandedRunCount = (node: OrderedXmlNode): number => {
  if (runKind(node) !== 'text' || !sourceText(node).includes('\t')) return 1
  const parts = sourceText(node).split('\t')
  return parts.filter(Boolean).length + parts.length - 1
}

const buildTemplates = (
  textBody: OrderedXmlNode,
  before: PowerPointTextPatch['before'],
): {
  bySource: Map<string, ParagraphTemplate>
  fallback?: ParagraphTemplate
  ordered: ParagraphTemplate[]
} => {
  const authored = parseAuthoredText(before.content)
  const structured = before.structuredText?.paragraphs ?? []
  const ordered = directNodes(ownChildren(textBody), 'p').map((node, paragraphIndex) => {
    const paragraph = authored[paragraphIndex]
    const structuredParagraph = structured[paragraphIndex]
    const runs = new Map<string, RunTemplate>()
    const authoredRuns = paragraph?.runs ?? []
    const structuredRuns = structuredParagraph?.runs ?? []
    let logicalIndex = 0
    for (const runNode of xmlRunNodes(node)) {
      const count = expandedRunCount(runNode)
      for (let offset = 0; offset < count; offset += 1) {
        const sourceId = structuredRuns[logicalIndex]?.sourceId ?? authoredRuns[logicalIndex]?.sourceId
        if (sourceId) runs.set(sourceId, { node: runNode, run: authoredRuns[logicalIndex] })
        logicalIndex += 1
      }
    }
    return {
      node,
      paragraph,
      runs,
    }
  })
  const bySource = new Map<string, ParagraphTemplate>()
  for (let index = 0; index < ordered.length; index += 1) {
    const sourceId = structured[index]?.sourceId ?? authored[index]?.sourceId
    if (sourceId) bySource.set(sourceId, ordered[index]!)
  }
  return { bySource, fallback: ordered[0], ordered }
}

const patchSpacing = (
  pPrChildren: OrderedXmlNode[],
  name: 'lnSpc' | 'spcAft' | 'spcBef',
  value: number,
  unit: 'percent' | 'points',
): void => {
  removeDirectNodes(pPrChildren, new Set([name]))
  pPrChildren.unshift(xmlNode(`a:${name}`, [
    unit === 'percent'
      ? xmlNode('a:spcPct', [], { val: String(Math.round(value * 100_000)) })
      : xmlNode('a:spcPts', [], { val: String(Math.round(value * 100)) }),
  ]))
}

const patchParagraphProperties = ({
  after,
  before,
  node,
  scale,
}: {
  after: AuthoredTextParagraph
  before: AuthoredTextParagraph | undefined
  node: OrderedXmlNode
  scale: number
}): void => {
  const children = ownChildren(node)
  const pPr = ensureDirectNode(children, 'pPr', 'a:pPr', 0)
  const attributes = nodeAttributes(pPr)
  const pPrChildren = ownChildren(pPr)
  if (after.level) attributes.lvl = String(Math.max(0, Math.min(8, after.level)))
  else delete attributes.lvl
  if (styleChanged(before?.style ?? {}, after.style, 'text-align')) {
    const align = styleValue(after.style, 'text-align')
    const mapped = align === 'center' ? 'ctr' : align === 'justify' ? 'just' : align === 'right' ? 'r' : 'l'
    attributes.algn = mapped
  }
  if (styleChanged(before?.style ?? {}, after.style, 'direction')) {
    setBooleanAttribute(attributes, 'rtl', styleValue(after.style, 'direction') === 'rtl')
  }
  if (styleChanged(before?.style ?? {}, after.style, 'padding-left')) {
    const value = parseCssNumber(after.style['padding-left'])
    if (value !== undefined) attributes.marL = String(Math.round(value / scale * 12_700))
    else delete attributes.marL
  }
  if (styleChanged(before?.style ?? {}, after.style, 'text-indent')) {
    const value = parseCssNumber(after.style['text-indent'])
    if (value !== undefined) attributes.indent = String(Math.round(value / scale * 12_700))
    else delete attributes.indent
  }
  if (styleChanged(before?.style ?? {}, after.style, 'line-height')) {
    const value = parseCssNumber(after.style['line-height'])
    if (value !== undefined) patchSpacing(pPrChildren, 'lnSpc', value, 'percent')
  }
  if (styleChanged(before?.style ?? {}, after.style, 'margin-top')) {
    const value = parseCssNumber(after.style['margin-top'])
    if (value !== undefined) patchSpacing(pPrChildren, 'spcBef', value / scale, 'points')
  }
  if (styleChanged(before?.style ?? {}, after.style, 'margin-bottom')) {
    const value = parseCssNumber(after.style['margin-bottom'])
    if (value !== undefined) patchSpacing(pPrChildren, 'spcAft', value / scale, 'points')
  }
  if (JSON.stringify(before?.list) !== JSON.stringify(after.list)) {
    removeDirectNodes(pPrChildren, new Set(['buAutoNum', 'buBlip', 'buChar', 'buNone']))
    if (!after.list) pPrChildren.push(xmlNode('a:buNone'))
    else if (after.list.type === 'number') {
      pPrChildren.push(xmlNode('a:buAutoNum', [], {
        ...(after.list.startAt ? { startAt: String(after.list.startAt) } : {}),
        type: 'arabicPeriod',
      }))
    }
    else pPrChildren.push(xmlNode('a:buChar', [], { char: '•' }))
  }
}

const patchBodyProperties = (
  textBody: OrderedXmlNode,
  operation: PowerPointTextPatch,
  scale: number,
): void => {
  const bodyChildren = ownChildren(textBody)
  const bodyPr = ensureDirectNode(bodyChildren, 'bodyPr', 'a:bodyPr', 0)
  const attributes = nodeAttributes(bodyPr)
  if (JSON.stringify(operation.before.inset) !== JSON.stringify(operation.after.inset)) {
    const [top, right, bottom, left] = operation.after.inset ?? [0, 0, 0, 0]
    attributes.tIns = String(Math.round(top / scale * 12_700))
    attributes.rIns = String(Math.round(right / scale * 12_700))
    attributes.bIns = String(Math.round(bottom / scale * 12_700))
    attributes.lIns = String(Math.round(left / scale * 12_700))
  }
  if (operation.before.columns !== operation.after.columns) {
    if (operation.after.columns && operation.after.columns > 1) {
      attributes.numCol = String(Math.max(1, Math.round(operation.after.columns)))
    }
    else delete attributes.numCol
  }
  if (operation.before.columnGap !== operation.after.columnGap) {
    if (operation.after.columnGap !== undefined) {
      attributes.spcCol = String(Math.round(operation.after.columnGap / scale * 12_700))
    }
    else delete attributes.spcCol
  }
  if (operation.before.vAlign !== operation.after.vAlign) {
    attributes.anchor = operation.after.vAlign === 'middle'
      ? 'ctr'
      : operation.after.vAlign === 'bottom'
        ? 'b'
        : 't'
  }
  if (operation.before.fixedHeight !== operation.after.fixedHeight) {
    const children = ownChildren(bodyPr)
    removeDirectNodes(children, new Set(['noAutofit', 'normAutofit', 'spAutoFit']))
    children.push(xmlNode(operation.after.fixedHeight ? 'a:noAutofit' : 'a:spAutoFit'))
  }
}

const sourceScale = (
  xfrm: OrderedXmlNode | undefined,
  beforeWidth: number,
  retainedScale: number | undefined,
): number | undefined => {
  if (retainedScale && retainedScale > 0) return retainedScale
  const ext = xfrm ? findNode(ownChildren(xfrm), 'ext') : undefined
  const cx = numericAttribute(ext, 'cx')
  if (!cx || beforeWidth <= 0) return undefined
  return beforeWidth * 12_700 / cx
}

const patchText = (
  children: OrderedXmlNode[],
  xfrm: OrderedXmlNode | undefined,
  operation: PowerPointTextPatch,
): PowerPointWritebackIssue[] => {
  const textBody = findNode(children, 'txBody')
  const scale = sourceScale(xfrm, operation.beforeWidth, operation.scale)
  if (!textBody || !scale) {
    return [{
      code: textBody ? 'pptx.writeback.text-scale' : 'pptx.writeback.text-body-missing',
      elementId: operation.elementId,
      message: textBody
        ? 'The retained text body has no exact canvas-to-PowerPoint scale.'
        : 'The source object has no editable PowerPoint text body.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    }]
  }
  const beforeAuthored = parseAuthoredText(operation.before.content)
  const afterAuthored = parseAuthoredText(operation.after.content)
  const baselineRuns = new Map<string, AuthoredTextRun>()
  for (let paragraphIndex = 0; paragraphIndex < beforeAuthored.length; paragraphIndex += 1) {
    const authoredParagraph = beforeAuthored[paragraphIndex]
    const retainedParagraph = operation.before.structuredText?.paragraphs[paragraphIndex]
    for (let runIndex = 0; runIndex < (retainedParagraph?.runs.length ?? 0); runIndex += 1) {
      const retainedRun = retainedParagraph!.runs[runIndex]!
      const authoredRun = authoredParagraph?.runs[runIndex]
      baselineRuns.set(retainedRun.sourceId, {
        ...(retainedRun.fieldId ? { fieldId: retainedRun.fieldId } : {}),
        ...(retainedRun.fieldType ? { fieldType: retainedRun.fieldType } : {}),
        ...(retainedRun.hyperlink ? { hyperlink: retainedRun.hyperlink } : {}),
        kind: retainedRun.kind,
        sourceId: retainedRun.sourceId,
        style: authoredRun?.style ?? authoredParagraph?.style ?? {},
        text: retainedRun.text ?? authoredRun?.text ?? '',
      })
    }
  }
  for (const paragraph of beforeAuthored) {
    for (const run of paragraph.runs) {
      if (run.sourceId && !baselineRuns.has(run.sourceId)) baselineRuns.set(run.sourceId, run)
    }
  }
  const issues: PowerPointWritebackIssue[] = []
  for (const paragraph of afterAuthored) {
    for (const run of paragraph.runs) {
      const baseline = run.sourceId ? baselineRuns.get(run.sourceId) : undefined
      if (baseline?.hyperlink !== run.hyperlink && (baseline?.hyperlink || run.hyperlink)) {
        issues.push({
          code: 'pptx.writeback.hyperlink-relationship',
          elementId: operation.elementId,
          message: 'Adding, removing, or changing a PowerPoint hyperlink requires relationship-aware writeback.',
          objectId: operation.objectId,
          partPath: operation.partPath,
          slideId: operation.slideId,
        })
      }
      if (run.kind === 'field' && !baseline) {
        issues.push({
          code: 'pptx.writeback.field',
          elementId: operation.elementId,
          message: 'Creating a PowerPoint field requires a typed field serializer.',
          objectId: operation.objectId,
          partPath: operation.partPath,
          slideId: operation.slideId,
        })
      }
      if (baseline?.kind === 'field' && (
        run.kind !== 'field'
        || run.fieldId !== baseline.fieldId
        || run.fieldType !== baseline.fieldType
        || run.text !== baseline.text
      )) {
        issues.push({
          code: 'pptx.writeback.field',
          elementId: operation.elementId,
          message: 'PowerPoint fields are preserved, but their definition or materialized value cannot be edited yet.',
          objectId: operation.objectId,
          partPath: operation.partPath,
          slideId: operation.slideId,
        })
      }
    }
  }
  if (issues.length) return issues

  patchBodyProperties(textBody, operation, scale)
  const templates = buildTemplates(textBody, operation.before)
  const bodyChildren = ownChildren(textBody)
  const oldParagraphs = directNodes(bodyChildren, 'p')
  const insertAt = oldParagraphs.length
    ? bodyChildren.indexOf(oldParagraphs[0]!)
    : bodyChildren.length
  removeDirectNodes(bodyChildren, new Set(['p']))
  const forceFont = operation.before.defaultFontName !== operation.after.defaultFontName
    ? operation.after.defaultFontName
    : undefined
  const forceColor = operation.before.defaultColor !== operation.after.defaultColor
    ? operation.after.defaultColor
    : undefined
  const forceSpacing = operation.before.wordSpace !== operation.after.wordSpace
    ? operation.after.wordSpace ?? 0
    : undefined

  const patchedParagraphs = afterAuthored.map((paragraph, paragraphIndex) => {
    const template = (paragraph.sourceId ? templates.bySource.get(paragraph.sourceId) : undefined)
      ?? templates.ordered[Math.min(paragraphIndex, templates.ordered.length - 1)]
      ?? templates.fallback
    const paragraphNode = template
      ? structuredClone(template.node)
      : xmlNode('a:p')
    patchParagraphProperties({
      after: paragraph,
      before: template?.paragraph,
      node: paragraphNode,
      scale,
    })
    const paragraphChildren = ownChildren(paragraphNode)
    const oldRuns = xmlRunNodes(paragraphNode)
    const endPropertiesIndex = paragraphChildren.findIndex(child => (
      localName(nodeTag(child) ?? '') === 'endParaRPr'
    ))
    const runInsertAt = oldRuns.length
      ? paragraphChildren.indexOf(oldRuns[0]!)
      : endPropertiesIndex < 0
        ? paragraphChildren.length
        : endPropertiesIndex
    removeDirectNodes(paragraphChildren, new Set(['br', 'fld', 'r', 'tab']))
    const newRuns = paragraph.runs.map(run => {
      const exact = run.sourceId ? template?.runs.get(run.sourceId) : undefined
      const baseline = run.sourceId ? baselineRuns.get(run.sourceId) : undefined
      let runNode = exact && runKind(exact.node) === run.kind
        ? structuredClone(exact.node)
        : plainRunFrom(exact?.node ?? xmlRunNodes(template?.node ?? xmlNode('a:p'))[0], run.kind)
      if (run.kind === 'field' && exact) runNode = structuredClone(exact.node)
      if (run.kind === 'text' || run.kind === 'field') setTextNode(runNode, run.text)
      if (run.kind !== 'tab') {
        patchRunProperties({
          after: run.style,
          before: baseline?.style ?? {},
          ...(forceColor !== undefined ? { forceColor } : {}),
          ...(forceFont !== undefined ? { forceFont } : {}),
          ...(forceSpacing !== undefined ? { forceSpacing } : {}),
          node: runNode,
          scale,
        })
      }
      return runNode
    })
    paragraphChildren.splice(runInsertAt < 0 ? paragraphChildren.length : runInsertAt, 0, ...newRuns)
    const pPr = directNode(paragraphChildren, 'pPr')
    if (pPr) {
      const pPrChildren = ownChildren(pPr)
      const defaultRun = directNode(pPrChildren, 'defRPr')
      if (defaultRun && (forceFont !== undefined || forceColor !== undefined || forceSpacing !== undefined)) {
        patchRunProperties({
          after: paragraph.style,
          before: template?.paragraph?.style ?? {},
          ...(forceColor !== undefined ? { forceColor } : {}),
          ...(forceFont !== undefined ? { forceFont } : {}),
          ...(forceSpacing !== undefined ? { forceSpacing } : {}),
          node: xmlNode('a:r', [
            xmlNode('a:rPr', ownChildren(defaultRun), nodeAttributes(defaultRun)),
          ]),
          scale,
        })
      }
    }
    const endProperties = directNode(paragraphChildren, 'endParaRPr')
    if (endProperties && (forceFont !== undefined || forceColor !== undefined || forceSpacing !== undefined)) {
      patchRunProperties({
        after: paragraph.style,
        before: template?.paragraph?.style ?? {},
        ...(forceColor !== undefined ? { forceColor } : {}),
        ...(forceFont !== undefined ? { forceFont } : {}),
        ...(forceSpacing !== undefined ? { forceSpacing } : {}),
        node: xmlNode('a:r', [
          xmlNode('a:rPr', ownChildren(endProperties), nodeAttributes(endProperties)),
        ]),
        scale,
      })
    }
    return paragraphNode
  })
  bodyChildren.splice(insertAt, 0, ...patchedParagraphs)

  if (operation.before.lineHeight !== operation.after.lineHeight) {
    for (const paragraph of patchedParagraphs) {
      const pPr = ensureDirectNode(ownChildren(paragraph), 'pPr', 'a:pPr', 0)
      patchSpacing(ownChildren(pPr), 'lnSpc', operation.after.lineHeight ?? 1, 'percent')
    }
  }
  if (operation.before.paragraphSpace !== operation.after.paragraphSpace) {
    for (const paragraph of patchedParagraphs) {
      const pPr = ensureDirectNode(ownChildren(paragraph), 'pPr', 'a:pPr', 0)
      patchSpacing(
        ownChildren(pPr),
        'spcAft',
        (operation.after.paragraphSpace ?? 0) / scale,
        'points',
      )
    }
  }
  return []
}

const patchShapeStyle = (
  children: OrderedXmlNode[],
  xfrm: OrderedXmlNode | undefined,
  operation: PowerPointShapeStylePatch,
): PowerPointWritebackIssue[] => {
  const spPr = findNode(children, 'spPr')
  const scale = sourceScale(xfrm, operation.beforeWidth, operation.scale)
  if (!spPr || !scale) {
    return [{
      code: spPr ? 'pptx.writeback.style-scale' : 'pptx.writeback.shape-properties-missing',
      elementId: operation.elementId,
      message: spPr
        ? 'The retained shape has no exact canvas-to-PowerPoint scale.'
        : 'The retained source object has no editable shape properties.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    }]
  }
  const spPrChildren = ownChildren(spPr)
  if (
    operation.before.fill !== operation.after.fill
    || operation.before.complexFill !== operation.after.complexFill
  ) {
    removeDirectNodes(spPrChildren, new Set([
      'blipFill', 'gradFill', 'grpFill', 'noFill', 'pattFill', 'solidFill',
    ]))
    const color = normalizeColor(operation.after.fill)
    const fill = color
      ? xmlNode('a:solidFill', [xmlNode('a:srgbClr', [], { val: color })])
      : xmlNode('a:noFill')
    const geometryIndex = spPrChildren.findIndex(node => (
      ['custGeom', 'prstGeom'].includes(localName(nodeTag(node) ?? ''))
    ))
    spPrChildren.splice(geometryIndex < 0 ? 0 : geometryIndex + 1, 0, fill)
  }
  if (JSON.stringify(operation.before.outline) !== JSON.stringify(operation.after.outline)) {
    const line = ensureDirectNode(spPrChildren, 'ln', 'a:ln')
    const lineAttributes = nodeAttributes(line)
    const lineChildren = ownChildren(line)
    const outline = operation.after.outline
    if (!outline || !outline.width || outline.width <= 0) {
      removeDirectNodes(lineChildren, new Set(['gradFill', 'noFill', 'pattFill', 'solidFill']))
      lineChildren.unshift(xmlNode('a:noFill'))
      delete lineAttributes.w
    }
    else {
      lineAttributes.w = String(Math.round(outline.width / scale * 12_700))
      replaceSolidColor(
        lineChildren,
        normalizeColor(outline.color),
        new Set(['gradFill', 'noFill', 'pattFill', 'solidFill']),
      )
      removeDirectNodes(lineChildren, new Set(['prstDash']))
      lineChildren.push(xmlNode('a:prstDash', [], {
        val: outline.style === 'dotted' ? 'dot' : outline.style === 'dashed' ? 'dash' : 'solid',
      }))
    }
  }
  return []
}

const connectorPoint = (
  connector: PowerPointConnectorPatch['before'],
  endpoint: 'end' | 'start',
): [number, number] => [
  connector.left + connector[endpoint][0],
  connector.top + connector[endpoint][1],
]

const connectorGeometryChanged = (operation: PowerPointConnectorPatch): boolean => (
  JSON.stringify({
    end: connectorPoint(operation.before, 'end'),
    start: connectorPoint(operation.before, 'start'),
  }) !== JSON.stringify({
    end: connectorPoint(operation.after, 'end'),
    start: connectorPoint(operation.after, 'start'),
  })
  || JSON.stringify({
    broken: operation.before.broken,
    broken2: operation.before.broken2,
    broken2Direction: operation.before.broken2Direction,
    cubic: operation.before.cubic,
    curve: operation.before.curve,
  }) !== JSON.stringify({
    broken: operation.after.broken,
    broken2: operation.after.broken2,
    broken2Direction: operation.after.broken2Direction,
    cubic: operation.after.cubic,
    curve: operation.after.curve,
  })
)

const insertLineProperty = (
  children: OrderedXmlNode[],
  node: OrderedXmlNode,
  afterNames: ReadonlySet<string>,
): void => {
  const index = children.findIndex(child => {
    const name = localName(nodeTag(child) ?? '')
    return !afterNames.has(name)
      && ['bevel', 'custDash', 'extLst', 'headEnd', 'miter', 'prstDash', 'round', 'tailEnd'].includes(name)
  })
  children.splice(index < 0 ? children.length : index, 0, node)
}

const patchConnectorMarker = (
  children: OrderedXmlNode[],
  name: 'headEnd' | 'tailEnd',
  before: PowerPointConnectorPatch['before']['points'][number],
  after: PowerPointConnectorPatch['after']['points'][number],
): void => {
  if (before === after) return
  const tag = `a:${name}`
  const node = ensureDirectNode(children, name, tag)
  const attributes = nodeAttributes(node)
  attributes.type = after === 'arrow' ? 'triangle' : after === 'dot' ? 'oval' : 'none'
  if (!after) {
    delete attributes.len
    delete attributes.w
  }
  const currentIndex = children.indexOf(node)
  if (currentIndex >= 0) children.splice(currentIndex, 1)
  const insertionIndex = children.findIndex(child => {
    const childName = localName(nodeTag(child) ?? '')
    return childName === 'extLst' || (name === 'headEnd' && childName === 'tailEnd')
  })
  children.splice(insertionIndex < 0 ? children.length : insertionIndex, 0, node)
}

const patchConnector = (
  children: OrderedXmlNode[],
  xfrm: OrderedXmlNode | undefined,
  operation: PowerPointConnectorPatch,
): PowerPointWritebackIssue[] => {
  const issues: PowerPointWritebackIssue[] = []
  const spPr = findNode(children, 'spPr')
  if (!spPr) {
    return [{
      code: 'pptx.writeback.connector-properties-missing',
      elementId: operation.elementId,
      message: 'The retained line has no editable PowerPoint shape properties.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    }]
  }
  const spPrChildren = ownChildren(spPr)
  const trailingPropertyIndex = spPrChildren.findIndex(child => (
    ['effectDag', 'effectLst', 'extLst', 'scene3d', 'sp3d'].includes(
      localName(nodeTag(child) ?? ''),
    )
  ))
  const line = ensureDirectNode(
    spPrChildren,
    'ln',
    'a:ln',
    trailingPropertyIndex < 0 ? spPrChildren.length : trailingPropertyIndex,
  )
  const lineAttributes = nodeAttributes(line)
  const lineChildren = ownChildren(line)

  if (operation.before.width !== operation.after.width) {
    if (!operation.scale || operation.scale <= 0) {
      issues.push({
        code: 'pptx.writeback.connector-scale',
        elementId: operation.elementId,
        message: 'The retained line has no exact canvas-to-PowerPoint scale for its width.',
        objectId: operation.objectId,
        partPath: operation.partPath,
        slideId: operation.slideId,
      })
    }
    else {
      lineAttributes.w = String(Math.max(0, Math.round(
        operation.after.width / operation.scale * 12_700,
      )))
    }
  }
  if (operation.before.color !== operation.after.color) {
    replaceSolidColor(
      lineChildren,
      normalizeColor(operation.after.color),
      new Set(['gradFill', 'noFill', 'pattFill', 'solidFill']),
    )
  }
  if (operation.before.style !== operation.after.style) {
    removeDirectNodes(lineChildren, new Set(['custDash', 'prstDash']))
    const dash = xmlNode('a:prstDash', [], {
      val: operation.after.style === 'dotted'
        ? 'dot'
        : operation.after.style === 'dashed'
          ? 'dash'
          : 'solid',
    })
    insertLineProperty(
      lineChildren,
      dash,
      new Set(['gradFill', 'noFill', 'pattFill', 'solidFill']),
    )
  }
  patchConnectorMarker(
    lineChildren,
    'headEnd',
    operation.before.points[0],
    operation.after.points[0],
  )
  patchConnectorMarker(
    lineChildren,
    'tailEnd',
    operation.before.points[1],
    operation.after.points[1],
  )

  if (!connectorGeometryChanged(operation)) return issues
  if (!xfrm || !operation.scale || operation.scale <= 0) {
    issues.push({
      code: xfrm ? 'pptx.writeback.connector-scale' : 'pptx.writeback.transform-missing',
      elementId: operation.elementId,
      message: xfrm
        ? 'The retained line has no exact canvas-to-PowerPoint scale for its geometry.'
        : 'The retained line has no explicit transform that Mona can patch safely.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    })
    return issues
  }
  const xfrmChildren = ownChildren(xfrm)
  const off = directNode(xfrmChildren, 'off')
  const ext = directNode(xfrmChildren, 'ext')
  if (!off || !ext) {
    issues.push({
      code: 'pptx.writeback.transform-missing',
      elementId: operation.elementId,
      message: 'The retained line transform has no explicit offset and extent.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    })
    return issues
  }
  const start = connectorPoint(operation.after, 'start')
  const end = connectorPoint(operation.after, 'end')
  const emuPerCanvasUnit = 12_700 / operation.scale
  const minX = Math.min(start[0], end[0])
  const minY = Math.min(start[1], end[1])
  const offAttributes = nodeAttributes(off)
  const extAttributes = nodeAttributes(ext)
  offAttributes.x = String(Math.round(minX * emuPerCanvasUnit))
  offAttributes.y = String(Math.round(minY * emuPerCanvasUnit))
  extAttributes.cx = String(Math.max(0, Math.round(Math.abs(end[0] - start[0]) * emuPerCanvasUnit)))
  extAttributes.cy = String(Math.max(0, Math.round(Math.abs(end[1] - start[1]) * emuPerCanvasUnit)))
  const transformAttributes = nodeAttributes(xfrm)
  delete transformAttributes.rot
  if (start[0] > end[0]) transformAttributes.flipH = '1'
  else delete transformAttributes.flipH
  if (start[1] > end[1]) transformAttributes.flipV = '1'
  else delete transformAttributes.flipV
  return issues
}

const normalizedRotation = (degrees: number): number => {
  const normalized = ((degrees % 360) + 360) % 360
  return Math.round(normalized * 60_000)
}

const patchTransform = (
  xfrm: OrderedXmlNode,
  operation: PowerPointTransformPatch,
): PowerPointWritebackIssue | undefined => {
  const children = nodeEntries(xfrm).flatMap(([, nested]) => nested)
  const off = findNode(children, 'off')
  const ext = findNode(children, 'ext')
  const x = numericAttribute(off, 'x')
  const y = numericAttribute(off, 'y')
  const cx = numericAttribute(ext, 'cx')
  const cy = numericAttribute(ext, 'cy')
  if (
    !off
    || !ext
    || x === undefined
    || y === undefined
    || cx === undefined
    || cy === undefined
    || Math.abs(operation.before.width) < 0.000_001
    || Math.abs(operation.before.height) < 0.000_001
  ) {
    return {
      code: 'pptx.writeback.transform-missing',
      elementId: operation.elementId,
      message: 'The source object has no explicit transform that Mona can patch safely.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    }
  }
  const scaleX = cx / operation.before.width
  const scaleY = cy / operation.before.height
  const offAttributes = nodeAttributes(off)
  const extAttributes = nodeAttributes(ext)
  offAttributes.x = String(Math.round(
    x + (operation.after.left - operation.before.left) * scaleX,
  ))
  offAttributes.y = String(Math.round(
    y + (operation.after.top - operation.before.top) * scaleY,
  ))
  extAttributes.cx = String(Math.max(0, Math.round(operation.after.width * scaleX)))
  extAttributes.cy = String(Math.max(0, Math.round(operation.after.height * scaleY)))
  const attributes = nodeAttributes(xfrm)
  const rotation = normalizedRotation(operation.after.rotate)
  if (rotation) attributes.rot = String(rotation)
  else delete attributes.rot
  if (operation.after.flipH) attributes.flipH = '1'
  else delete attributes.flipH
  if (operation.after.flipV) attributes.flipV = '1'
  else delete attributes.flipV
  return undefined
}

const patchPart = (
  xml: string,
  partPath: string,
  packageId: string,
  operations: readonly PowerPointPatchOperation[],
): { issues: PowerPointWritebackIssue[]; xml: string } => {
  const nodes = parseXml(xml, partPath)
  const pending = new Map<string, PowerPointPatchOperation[]>()
  for (const operation of operations) {
    const entries = pending.get(operation.objectId) ?? []
    entries.push(operation)
    pending.set(operation.objectId, entries)
  }
  const issues: PowerPointWritebackIssue[] = []
  const occurrences = new Map<string, number>()

  const visit = (siblings: OrderedXmlNode[]): void => {
    for (let index = 0; index < siblings.length; index += 1) {
      const node = siblings[index]!
      for (const [tag, children] of nodeEntries(node)) {
        const name = localName(tag)
        if (!drawingObjectTags.has(name)) {
          visit(children)
          continue
        }
        const nativeId = nonVisualId(children)
        if (!nativeId) {
          visit(children)
          continue
        }
        const occurrence = occurrences.get(nativeId) ?? 0
        occurrences.set(nativeId, occurrence + 1)
        const objectId = `${packageId}/${partPath}#${nativeId}${occurrence ? `:${occurrence}` : ''}`
        const objectOperations = pending.get(objectId) ?? []
        const deletion = objectOperations.find(operation => operation.kind === 'delete')
        if (deletion) {
          siblings.splice(index, 1)
          index -= 1
          pending.delete(objectId)
          break
        }
        if (objectOperations.length) {
          const xfrm = findOwnTransform(children)
          for (const operation of objectOperations) {
            if (operation.kind === 'transform') {
              if (!xfrm) {
                issues.push({
                  code: 'pptx.writeback.transform-missing',
                  elementId: operation.elementId,
                  message: 'The source object has no explicit transform that Mona can patch safely.',
                  objectId,
                  partPath,
                  slideId: operation.slideId,
                })
              }
              else {
                const issue = patchTransform(xfrm, operation)
                if (issue) issues.push(issue)
              }
            }
            else if (operation.kind === 'text') {
              issues.push(...patchText(children, xfrm, operation))
            }
            else if (operation.kind === 'style') {
              issues.push(...patchShapeStyle(children, xfrm, operation))
            }
            else if (operation.kind === 'connector') {
              issues.push(...patchConnector(children, xfrm, operation))
            }
          }
          pending.delete(objectId)
        }
        visit(children)
      }
    }
  }
  visit(nodes)
  for (const remaining of pending.values()) {
    for (const operation of remaining) {
      issues.push({
        code: 'pptx.writeback.object-missing',
        elementId: operation.elementId,
        message: 'The retained package no longer contains the exact source object selected for writeback.',
        objectId: operation.objectId,
        partPath,
        slideId: operation.slideId,
      })
    }
  }
  const patchedXml = xmlBuilder.build(nodes) as string
  const validation = XMLValidator.validate(patchedXml, { allowBooleanAttributes: false })
  if (validation !== true) {
    issues.push({
      code: 'pptx.writeback.invalid-output',
      message: `A source-preserving patch produced invalid XML: ${validation.err.msg}`,
      partPath,
    })
  }
  return { issues, xml: patchedXml }
}

export const patchPowerPointPackage = async ({
  bytes,
  manifest,
  operations,
}: {
  bytes: ArrayBuffer
  manifest: PowerPointPackageManifest
  operations: readonly PowerPointPatchOperation[]
}): Promise<ArrayBuffer> => {
  if (!operations.length) return bytes.slice(0)
  const knownObjects = new Set(manifest.objects.map(object => object.stableId))
  const unknown = operations.filter(operation => !knownObjects.has(operation.objectId))
  if (unknown.length) {
    throw new PowerPointWritebackError(unknown.map(operation => ({
      code: 'pptx.writeback.object-not-in-manifest',
      elementId: operation.elementId,
      message: 'The edit target is absent from the retained source-package manifest.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    })))
  }
  const zip = await JSZip.loadAsync(bytes)
  const byPart = new Map<string, PowerPointPatchOperation[]>()
  for (const operation of operations) {
    const group = byPart.get(operation.partPath) ?? []
    group.push(operation)
    byPart.set(operation.partPath, group)
  }
  const issues: PowerPointWritebackIssue[] = []
  for (const [partPath, partOperations] of byPart) {
    const entry = zip.file(partPath)
    if (!entry) {
      issues.push({
        code: 'pptx.writeback.part-missing',
        message: 'The retained package no longer contains a dirty source part.',
        partPath,
      })
      continue
    }
    const patched = patchPart(
      await entry.async('text'),
      partPath,
      manifest.packageId,
      partOperations,
    )
    issues.push(...patched.issues)
    if (!patched.issues.length) zip.file(partPath, patched.xml)
  }
  if (issues.length) throw new PowerPointWritebackError(issues)
  return zip.generateAsync({
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'DOS',
    type: 'arraybuffer',
  })
}
