import { RATIO_EMUs_Points } from './constants'
import { getTextByPathList } from './utils'

const first = value => Array.isArray(value) ? value[0] : value

const attributes = node => first(node)?.attrs || {}

const booleanAttribute = value => {
  if (value === undefined || value === null || value === '') return undefined
  return value === true || value === '1' || value === 'true'
}

const numberAttribute = value => {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const emuToPoints = value => {
  const parsed = numberAttribute(value)
  return parsed === undefined ? undefined : parsed * RATIO_EMUs_Points
}

const textValue = node => {
  const value = first(node)
  if (typeof value === 'string') return value
  return typeof value?.value === 'string' ? value.value : undefined
}

const parseColor = node => {
  const solidFill = first(node?.['a:solidFill'])
  if (!solidFill) return undefined
  for (const [tag, type] of [
    ['a:srgbClr', 'srgb'],
    ['a:schemeClr', 'scheme'],
    ['a:sysClr', 'system'],
    ['a:prstClr', 'preset'],
  ]) {
    const colorNode = first(solidFill[tag])
    if (!colorNode) continue
    const values = attributes(colorNode)
    const value = type === 'system' ? values.lastClr || values.val : values.val || values.lastClr
    if (!value) continue
    const alpha = numberAttribute(getTextByPathList(colorNode, ['a:alpha', 'attrs', 'val']))
    return {
      ...(alpha !== undefined ? { alpha: alpha / 1000 } : {}),
      type,
      value,
    }
  }
  return undefined
}

const parseRunProperties = node => {
  const runNode = first(node)
  if (!runNode) return undefined
  const values = attributes(runNode)
  const fontFamily = getTextByPathList(runNode, ['a:latin', 'attrs', 'typeface'])
  const eastAsianFontFamily = getTextByPathList(runNode, ['a:ea', 'attrs', 'typeface'])
  const complexScriptFontFamily = getTextByPathList(runNode, ['a:cs', 'attrs', 'typeface'])
  const fontSize = numberAttribute(values.sz)
  const spacing = numberAttribute(values.spc)
  const baseline = numberAttribute(values.baseline)
  const bold = booleanAttribute(values.b)
  const italic = booleanAttribute(values.i)
  const normalizeHeight = booleanAttribute(values.normalizeH)
  const color = parseColor(runNode)
  const properties = {
    ...(values.altLang ? { alternativeLanguage: values.altLang } : {}),
    ...(baseline !== undefined ? { baseline: baseline / 1000 } : {}),
    ...(bold !== undefined ? { bold } : {}),
    ...(values.cap ? { capitalization: values.cap } : {}),
    ...(color ? { color } : {}),
    ...(complexScriptFontFamily ? { complexScriptFontFamily } : {}),
    ...(eastAsianFontFamily ? { eastAsianFontFamily } : {}),
    ...(fontFamily ? { fontFamily } : {}),
    ...(fontSize !== undefined ? { fontSize: fontSize / 100 } : {}),
    ...(italic !== undefined ? { italic } : {}),
    ...(values.lang ? { language: values.lang } : {}),
    ...(normalizeHeight !== undefined ? { normalizeHeight } : {}),
    ...(spacing !== undefined ? { spacing: spacing / 100 } : {}),
    ...(values.strike ? { strike: values.strike } : {}),
    ...(values.u ? { underline: values.u } : {}),
  }
  return Object.keys(properties).length ? properties : undefined
}

const parseSpacing = node => {
  const spacingNode = first(node)
  if (!spacingNode) return undefined
  const percent = numberAttribute(getTextByPathList(spacingNode, ['a:spcPct', 'attrs', 'val']))
  if (percent !== undefined) return { unit: 'percent', value: percent / 1000 }
  const points = numberAttribute(getTextByPathList(spacingNode, ['a:spcPts', 'attrs', 'val']))
  if (points !== undefined) return { unit: 'points', value: points / 100 }
  return undefined
}

const parseBullet = node => {
  const paragraphNode = first(node)
  if (!paragraphNode) return undefined
  if (paragraphNode['a:buNone']) return { type: 'none' }
  const character = getTextByPathList(paragraphNode, ['a:buChar', 'attrs', 'char'])
  const autoNumber = first(paragraphNode['a:buAutoNum'])
  const picture = first(paragraphNode['a:buBlip'])
  if (!character && !autoNumber && !picture) return undefined
  const autoValues = attributes(autoNumber)
  const colorNode = first(paragraphNode['a:buClr'])
  const color = colorNode ? parseColor({ 'a:solidFill': colorNode }) : undefined
  const fontFamily = getTextByPathList(paragraphNode, ['a:buFont', 'attrs', 'typeface'])
  const sizePercent = numberAttribute(getTextByPathList(paragraphNode, ['a:buSzPct', 'attrs', 'val']))
  const sizePoints = numberAttribute(getTextByPathList(paragraphNode, ['a:buSzPts', 'attrs', 'val']))
  const size = sizePercent !== undefined
    ? { unit: 'percent', value: sizePercent / 1000 }
    : sizePoints !== undefined
      ? { unit: 'points', value: sizePoints / 100 }
      : undefined
  const startAt = numberAttribute(autoValues.startAt)
  return {
    ...(character ? { character } : {}),
    ...(color ? { color } : {}),
    ...(fontFamily ? { fontFamily } : {}),
    ...(autoValues.type ? { numberingScheme: autoValues.type } : {}),
    ...(size ? { size } : {}),
    ...(startAt !== undefined ? { startAt } : {}),
    type: autoNumber ? 'auto-number' : picture ? 'picture' : 'character',
  }
}

const parseTabs = node => {
  const tabNodes = first(node)?.['a:tab']
  if (!tabNodes) return undefined
  const values = (Array.isArray(tabNodes) ? tabNodes : [tabNodes]).flatMap(tab => {
    const tabValues = attributes(tab)
    const position = emuToPoints(tabValues.pos)
    return position === undefined
      ? []
      : [{
          ...(tabValues.algn ? { alignment: tabValues.algn } : {}),
          position,
        }]
  })
  return values.length ? values : undefined
}

const parseParagraphProperties = node => {
  const paragraphNode = first(node)
  if (!paragraphNode) return undefined
  const values = attributes(paragraphNode)
  const marginLeft = emuToPoints(values.marL)
  const indent = emuToPoints(values.indent)
  const defaultTabSize = emuToPoints(values.defTabSz)
  const rightToLeft = booleanAttribute(values.rtl)
  const eastAsianLineBreak = booleanAttribute(values.eaLnBrk)
  const latinLineBreak = booleanAttribute(values.latinLnBrk)
  const hangingPunctuation = booleanAttribute(values.hangingPunct)
  const bullet = parseBullet(paragraphNode)
  const defaultRun = parseRunProperties(paragraphNode['a:defRPr'])
  const lineSpacing = parseSpacing(paragraphNode['a:lnSpc'])
  const spaceBefore = parseSpacing(paragraphNode['a:spcBef'])
  const spaceAfter = parseSpacing(paragraphNode['a:spcAft'])
  const tabs = parseTabs(paragraphNode['a:tabLst'])
  const properties = {
    ...(values.algn ? { alignment: values.algn } : {}),
    ...(bullet ? { bullet } : {}),
    ...(defaultRun ? { defaultRun } : {}),
    ...(defaultTabSize !== undefined ? { defaultTabSize } : {}),
    ...(eastAsianLineBreak !== undefined ? { eastAsianLineBreak } : {}),
    ...(values.fontAlgn ? { fontAlignment: values.fontAlgn } : {}),
    ...(hangingPunctuation !== undefined ? { hangingPunctuation } : {}),
    ...(indent !== undefined ? { indent } : {}),
    ...(latinLineBreak !== undefined ? { latinLineBreak } : {}),
    ...(lineSpacing ? { lineSpacing } : {}),
    ...(marginLeft !== undefined ? { marginLeft } : {}),
    ...(rightToLeft !== undefined ? { rightToLeft } : {}),
    ...(spaceAfter ? { spaceAfter } : {}),
    ...(spaceBefore ? { spaceBefore } : {}),
    ...(tabs ? { tabs } : {}),
  }
  return Object.keys(properties).length ? properties : undefined
}

const parseBodyProperties = textBodyNode => {
  const bodyNode = first(textBodyNode?.['a:bodyPr'])
  if (!bodyNode) return undefined
  const values = attributes(bodyNode)
  const left = emuToPoints(values.lIns)
  const top = emuToPoints(values.tIns)
  const right = emuToPoints(values.rIns)
  const bottom = emuToPoints(values.bIns)
  const columnCount = numberAttribute(values.numCol)
  const columnSpacing = emuToPoints(values.spcCol)
  const rightToLeftColumns = booleanAttribute(values.rtlCol)
  const anchorCenter = booleanAttribute(values.anchorCtr)
  const rotation = numberAttribute(values.rot)
  const warpNode = first(bodyNode['a:prstTxWarp'])
  const warpPreset = attributes(warpNode).prst
  const warpAdjustments = {}
  const warpGuides = first(warpNode?.['a:avLst'])?.['a:gd']
  for (const guide of warpGuides ? (Array.isArray(warpGuides) ? warpGuides : [warpGuides]) : []) {
    const guideValues = attributes(guide)
    const value = typeof guideValues.fmla === 'string' && guideValues.fmla.startsWith('val ')
      ? Number(guideValues.fmla.slice(4))
      : Number.NaN
    if (guideValues.name && Number.isFinite(value)) warpAdjustments[guideValues.name] = value
  }
  let autoFit
  if (bodyNode['a:noAutofit']) autoFit = { type: 'none' }
  else if (bodyNode['a:spAutoFit']) autoFit = { type: 'shape' }
  else if (bodyNode['a:normAutofit']) {
    const autoValues = attributes(bodyNode['a:normAutofit'])
    const fontScale = numberAttribute(autoValues.fontScale)
    const lineSpacingReduction = numberAttribute(autoValues.lnSpcReduction)
    autoFit = {
      ...(fontScale !== undefined ? { fontScale: fontScale / 1000 } : {}),
      ...(lineSpacingReduction !== undefined ? { lineSpacingReduction: lineSpacingReduction / 1000 } : {}),
      type: 'normal',
    }
  }
  const properties = {
    ...(values.anchor ? { anchor: values.anchor } : {}),
    ...(anchorCenter !== undefined ? { anchorCenter } : {}),
    ...(autoFit ? { autoFit } : {}),
    ...(columnCount !== undefined ? { columnCount } : {}),
    ...(columnSpacing !== undefined ? { columnSpacing } : {}),
    ...(left !== undefined || top !== undefined || right !== undefined || bottom !== undefined
      // ECMA-376 bodyPr defaults are 0.05in vertically and 0.1in
      // horizontally. A body may author only one side, so zero is not a
      // correct fallback for the other three sides.
      ? { insets: [top ?? 3.6, right ?? 7.2, bottom ?? 3.6, left ?? 7.2] }
      : {}),
    ...(rightToLeftColumns !== undefined ? { rightToLeftColumns } : {}),
    ...(rotation !== undefined ? { rotation: rotation / 60_000 } : {}),
    ...(warpPreset ? { textWarp: { adjustments: warpAdjustments, preset: warpPreset } } : {}),
    ...(values.vert ? { verticalMode: values.vert } : {}),
    ...(values.wrap ? { wrap: values.wrap } : {}),
  }
  return Object.keys(properties).length ? properties : undefined
}

const parseListStyle = textBodyNode => {
  const listStyle = first(textBodyNode?.['a:lstStyle'])
  if (!listStyle) return { defaultParagraph: undefined, listStyle: [] }
  const levels = []
  for (let level = 0; level < 9; level += 1) {
    const paragraph = parseParagraphProperties(listStyle[`a:lvl${level + 1}pPr`])
    if (paragraph) levels.push({ level, paragraph })
  }
  return {
    defaultParagraph: parseParagraphProperties(listStyle['a:defPPr']),
    listStyle: levels,
  }
}

const sourceOrderedRuns = paragraphNode => {
  const entries = []
  let fallbackOrder = 0
  for (const [tag, kind] of [
    ['a:r', 'text'],
    ['a:fld', 'field'],
    ['a:br', 'break'],
    ['a:tab', 'tab'],
  ]) {
    const nodes = paragraphNode?.[tag]
    for (const node of nodes ? (Array.isArray(nodes) ? nodes : [nodes]) : []) {
      const order = numberAttribute(attributes(node).order)
      entries.push({ fallbackOrder: fallbackOrder++, kind, node, order })
    }
  }
  return entries.sort((left, right) => (
    (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER)
    || left.fallbackOrder - right.fallbackOrder
  ))
}

const splitTabs = (run, nextSourceId) => {
  if (!run.text?.includes('\t')) return [{ ...run, sourceId: nextSourceId() }]
  const parts = run.text.split('\t')
  return parts.flatMap((part, index) => [
    ...(part ? [{ ...run, sourceId: nextSourceId(), text: part }] : []),
    ...(index < parts.length - 1
      ? [{ kind: 'tab', properties: run.properties, sourceId: nextSourceId() }]
      : []),
  ])
}

const parseParagraphRuns = (paragraphNode, paragraphIndex, warpObj) => {
  let runIndex = 0
  const nextSourceId = () => `p${paragraphIndex}.r${runIndex++}`
  const entries = sourceOrderedRuns(paragraphNode)
  if (!entries.length) {
    const directText = textValue(paragraphNode?.['a:t'])
    return directText === undefined ? [] : [{ kind: 'text', sourceId: nextSourceId(), text: directText }]
  }
  return entries.flatMap(entry => {
    const runValues = attributes(entry.node)
    const runProperties = parseRunProperties(entry.node?.['a:rPr'])
    const hyperlinkAttrs = getTextByPathList(entry.node, ['a:rPr', 'a:hlinkClick', 'attrs'])
    const linkId = hyperlinkAttrs?.['r:id']
    const linkResource = linkId && warpObj?.slideResObj?.[linkId]
    const hyperlink = hyperlinkAttrs?.action && hyperlinkAttrs.action !== 'ppaction://hlinksldjump'
      ? `pptx-action:${hyperlinkAttrs.action}`
      : linkResource?.type === 'slide' || hyperlinkAttrs?.action === 'ppaction://hlinksldjump'
        ? (linkResource?.target ? `pptx-slide:${linkResource.target}` : undefined)
        : linkResource?.target
    const text = textValue(entry.node?.['a:t']) ?? textValue(getTextByPathList(entry.node, ['a:fld', 'a:t']))
    const run = {
      ...(entry.kind === 'field' && runValues.id ? { fieldId: runValues.id } : {}),
      ...(entry.kind === 'field' && runValues.type ? { fieldType: runValues.type } : {}),
      ...(hyperlink ? { hyperlink } : {}),
      kind: entry.kind,
      ...(runProperties ? { properties: runProperties } : {}),
      ...(text !== undefined ? { text } : {}),
    }
    return splitTabs(run, nextSourceId)
  })
}

export function getStructuredTextBody(textBodyNode, warpObj) {
  if (!textBodyNode) return undefined
  const paragraphValue = textBodyNode['a:p']
  const paragraphNodes = paragraphValue
    ? (Array.isArray(paragraphValue) ? paragraphValue : [paragraphValue])
    : []
  const bodyProperties = parseBodyProperties(textBodyNode)
  const { defaultParagraph, listStyle } = parseListStyle(textBodyNode)
  return {
    ...(bodyProperties ? { bodyProperties } : {}),
    ...(defaultParagraph ? { defaultParagraph } : {}),
    listStyle,
    paragraphs: paragraphNodes.map((paragraphNode, paragraphIndex) => {
      const endProperties = parseRunProperties(paragraphNode?.['a:endParaRPr'])
      const properties = parseParagraphProperties(paragraphNode?.['a:pPr'])
      return {
        ...(endProperties ? { endProperties } : {}),
        level: Math.max(0, Math.min(8, numberAttribute(getTextByPathList(paragraphNode, ['a:pPr', 'attrs', 'lvl'])) ?? 0)),
        ...(properties ? { properties } : {}),
        runs: parseParagraphRuns(paragraphNode, paragraphIndex, warpObj),
        sourceId: `p${paragraphIndex}`,
      }
    }),
    scale: 1,
    schemaVersion: 1,
  }
}
