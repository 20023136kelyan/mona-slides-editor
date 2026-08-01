import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser'
import JSZip from 'jszip'

import type { PowerPointChartFamily, PowerPointChartSeries } from '@mona/presentation-core'

import type {
  PowerPointChartPatch,
  PowerPointWritebackIssue,
} from './types'

type OrderedXmlNode = Record<string, unknown>

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

const nodeTag = (node: OrderedXmlNode): string | undefined => nodeEntries(node)[0]?.[0]

const ownChildren = (node: OrderedXmlNode): OrderedXmlNode[] => nodeEntries(node)[0]?.[1] ?? []

const attributes = (node: OrderedXmlNode): Record<string, string> => {
  const current = node[':@']
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    return current as Record<string, string>
  }
  const created: Record<string, string> = {}
  node[':@'] = created
  return created
}

const directNode = (nodes: readonly OrderedXmlNode[], name: string): OrderedXmlNode | undefined => (
  nodes.find(node => localName(nodeTag(node) ?? '') === name)
)

const directNodes = (nodes: readonly OrderedXmlNode[], name: string): OrderedXmlNode[] => (
  nodes.filter(node => localName(nodeTag(node) ?? '') === name)
)

const findNode = (nodes: readonly OrderedXmlNode[], name: string): OrderedXmlNode | undefined => {
  for (const node of nodes) {
    if (localName(nodeTag(node) ?? '') === name) return node
    const nested = findNode(ownChildren(node), name)
    if (nested) return nested
  }
  return undefined
}

const xmlNode = (
  tag: string,
  children: OrderedXmlNode[] = [],
  nodeAttributes?: Record<string, string>,
): OrderedXmlNode => ({
  [tag]: children,
  ...(nodeAttributes && Object.keys(nodeAttributes).length ? { ':@': nodeAttributes } : {}),
})

const parseXml = (xml: string, partPath: string): OrderedXmlNode[] => {
  if (/<!DOCTYPE\b/i.test(xml)) throw new Error(`PowerPoint XML contains a prohibited DOCTYPE: ${partPath}`)
  const validation = XMLValidator.validate(xml, { allowBooleanAttributes: false })
  if (validation !== true) throw new Error(`Invalid PowerPoint XML: ${partPath} (${validation.err.msg})`)
  const result: unknown = xmlParser.parse(xml)
  if (!Array.isArray(result)) throw new Error(`Invalid PowerPoint XML tree: ${partPath}`)
  return result as OrderedXmlNode[]
}

const buildXml = (nodes: OrderedXmlNode[], partPath: string): string => {
  const xml = xmlBuilder.build(nodes) as string
  const validation = XMLValidator.validate(xml, { allowBooleanAttributes: false })
  if (validation !== true) throw new Error(`Chart writeback produced invalid XML: ${partPath} (${validation.err.msg})`)
  return xml
}

const removeDirect = (nodes: OrderedXmlNode[], names: ReadonlySet<string>): void => {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    if (names.has(localName(nodeTag(nodes[index]!) ?? ''))) nodes.splice(index, 1)
  }
}

const ensureDirect = (
  nodes: OrderedXmlNode[],
  name: string,
  tag: string,
  index = nodes.length,
): OrderedXmlNode => {
  const current = directNode(nodes, name)
  if (current) return current
  const created = xmlNode(tag)
  nodes.splice(index, 0, created)
  return created
}

const escapeXmlText = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

const setTextValue = (node: OrderedXmlNode, value: string): void => {
  const children = ownChildren(node)
  const current = children.find(child => '#text' in child)
  if (current) current['#text'] = escapeXmlText(value)
  else children.push({ '#text': escapeXmlText(value) })
}

const setVal = (nodes: OrderedXmlNode[], name: string, value: string | number | boolean): OrderedXmlNode => {
  const node = ensureDirect(nodes, name, `c:${name}`)
  attributes(node).val = typeof value === 'boolean' ? (value ? '1' : '0') : String(value)
  return node
}

const setOptionalVal = (
  nodes: OrderedXmlNode[],
  name: string,
  value: string | number | boolean | undefined,
): void => {
  if (value === undefined) return
  setVal(nodes, name, value)
}

const changed = (before: unknown, after: unknown): boolean => JSON.stringify(before) !== JSON.stringify(after)

interface CellAddress {
  column: number
  row: number
}

interface RangeAddress {
  end: CellAddress
  sheet: string
  start: CellAddress
}

const CELL_PATTERN = /^([A-Z]+)(\d+)$/

const columnIndex = (name: string): number => {
  let result = 0
  for (const character of name) result = result * 26 + character.charCodeAt(0) - 64
  return result - 1
}

const columnName = (index: number): string => {
  let value = index + 1
  let result = ''
  while (value > 0) {
    value -= 1
    result = String.fromCharCode(65 + value % 26) + result
    value = Math.floor(value / 26)
  }
  return result
}

const parseRange = (formula: string | undefined): RangeAddress | undefined => {
  if (!formula) return undefined
  const separator = formula.lastIndexOf('!')
  if (separator < 0) return undefined
  let sheet = formula.slice(0, separator)
  if (sheet.startsWith("'") && sheet.endsWith("'")) sheet = sheet.slice(1, -1).replace(/''/g, "'")
  const [startValue, endValue = startValue] = formula.slice(separator + 1).replace(/\$/g, '').split(':')
  const start = CELL_PATTERN.exec(startValue ?? '')
  const end = CELL_PATTERN.exec(endValue ?? '')
  if (!start || !end) return undefined
  return {
    end: { column: columnIndex(end[1]!), row: Number(end[2]) - 1 },
    sheet,
    start: { column: columnIndex(start[1]!), row: Number(start[2]) - 1 },
  }
}

const quoteSheet = (sheet: string): string => (
  /^[A-Za-z_][A-Za-z0-9_.]*$/.test(sheet) ? sheet : `'${sheet.replace(/'/g, "''")}'`
)

const formulaFor = (sheet: string, start: CellAddress, end: CellAddress = start): string => {
  const cell = (address: CellAddress) => `$${columnName(address.column)}$${address.row + 1}`
  return `${quoteSheet(sheet)}!${cell(start)}${start.column === end.column && start.row === end.row ? '' : `:${cell(end)}`}`
}

interface WorkbookLayout {
  categoryColumn: number
  dataStartRow: number
  headerRow: number
  seriesStartColumn: number
  sheet: string
}

const flattenedSeries = (families: readonly PowerPointChartFamily[] | undefined): PowerPointChartSeries[] => (
  families?.flatMap(family => family.series) ?? []
)

const inferWorkbookLayout = (operation: PowerPointChartPatch): WorkbookLayout | undefined => {
  const series = flattenedSeries(operation.before.chartSpace?.plotArea.families)
  const first = series[0]
  const category = parseRange(first?.references?.categories?.formula)
  const value = parseRange(first?.references?.values?.formula ?? first?.references?.yValues?.formula)
  const name = parseRange(first?.references?.name?.formula)
  if (!category || !value) return undefined
  return {
    categoryColumn: category.start.column,
    dataStartRow: value.start.row,
    headerRow: name?.start.row ?? Math.max(0, value.start.row - 1),
    seriesStartColumn: value.start.column,
    sheet: value.sheet,
  }
}

const setFormula = (container: OrderedXmlNode, formula: string | undefined): void => {
  if (!formula) return
  const children = ownChildren(container)
  const node = ensureDirect(children, 'f', 'c:f', 0)
  setTextValue(node, formula)
}

const cacheContainer = (reference: OrderedXmlNode): OrderedXmlNode | undefined => {
  const tag = localName(nodeTag(reference) ?? '')
  if (tag === 'numLit' || tag === 'strLit') return reference
  return ownChildren(reference).find(node => ['multiLvlStrCache', 'numCache', 'strCache'].includes(
    localName(nodeTag(node) ?? ''),
  ))
}

const patchFlatCache = (
  reference: OrderedXmlNode,
  values: readonly (number | string | undefined)[],
): void => {
  const cache = cacheContainer(reference)
  if (!cache) return
  const children = ownChildren(cache)
  removeDirect(children, new Set(['pt', 'ptCount']))
  const pointCount = xmlNode('c:ptCount', [], { val: String(values.length) })
  const formatIndex = children.findIndex(child => localName(nodeTag(child) ?? '') === 'formatCode')
  children.splice(formatIndex < 0 ? 0 : formatIndex + 1, 0, pointCount)
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === undefined) continue
    const text = xmlNode('c:v')
    setTextValue(text, String(value))
    children.push(xmlNode('c:pt', [text], { idx: String(index) }))
  }
}

const patchMultiLevelCache = (reference: OrderedXmlNode, values: readonly string[]): void => {
  const cache = cacheContainer(reference)
  if (!cache) return
  const children = ownChildren(cache)
  removeDirect(children, new Set(['lvl', 'ptCount']))
  children.unshift(xmlNode('c:ptCount', [], { val: String(values.length) }))
  const levels = Math.max(1, ...values.map(value => value.split('\n').length))
  for (let levelIndex = levels - 1; levelIndex >= 0; levelIndex -= 1) {
    const points: OrderedXmlNode[] = []
    for (let index = 0; index < values.length; index += 1) {
      const parts = values[index]!.split('\n')
      const value = parts[levelIndex] ?? ''
      const text = xmlNode('c:v')
      setTextValue(text, value)
      points.push(xmlNode('c:pt', [text], { idx: String(index) }))
    }
    children.push(xmlNode('c:lvl', points))
  }
}

const referenceNode = (
  wrapper: OrderedXmlNode,
  preferred: 'number' | 'string',
): OrderedXmlNode => {
  const children = ownChildren(wrapper)
  const current = children.find(node => [
    'multiLvlStrRef', 'numLit', 'numRef', 'strLit', 'strRef',
  ].includes(localName(nodeTag(node) ?? '')))
  if (current) return current
  const tag = preferred === 'number' ? 'c:numRef' : 'c:strRef'
  const cacheTag = preferred === 'number' ? 'c:numCache' : 'c:strCache'
  const created = xmlNode(tag, [xmlNode(cacheTag)])
  children.push(created)
  return created
}

const patchReference = (
  wrapper: OrderedXmlNode,
  values: readonly (number | string | undefined)[],
  preferred: 'number' | 'string',
  formula?: string,
): void => {
  const reference = referenceNode(wrapper, preferred)
  setFormula(reference, formula)
  if (localName(nodeTag(reference) ?? '') === 'multiLvlStrRef') {
    patchMultiLevelCache(reference, values.map(value => String(value ?? '')))
  }
  else patchFlatCache(reference, values)
}

const patchSeries = ({
  categories,
  color,
  formula,
  index,
  name,
  node,
  values,
}: {
  categories: readonly string[]
  color?: string
  formula?: { categories: string; name: string; values: string }
  index: number
  name: string
  node: OrderedXmlNode
  values: readonly number[]
}): void => {
  const children = ownChildren(node)
  setVal(children, 'idx', index)
  setVal(children, 'order', index)
  const tx = ensureDirect(children, 'tx', 'c:tx', 2)
  patchReference(tx, [name], 'string', formula?.name)
  const category = ensureDirect(children, 'cat', 'c:cat')
  patchReference(category, categories, 'string', formula?.categories)
  const value = ensureDirect(children, 'val', 'c:val')
  patchReference(value, values, 'number', formula?.values)
  if (color) {
    const normalized = color.replace(/^#/, '').slice(0, 6).toUpperCase()
    if (/^[0-9A-F]{6}$/.test(normalized)) {
      const properties = ensureDirect(children, 'spPr', 'c:spPr')
      const propertyChildren = ownChildren(properties)
      removeDirect(propertyChildren, new Set(['gradFill', 'noFill', 'pattFill', 'solidFill']))
      propertyChildren.unshift(xmlNode('a:solidFill', [
        xmlNode('a:srgbClr', [], { val: normalized }),
      ]))
      const line = directNode(propertyChildren, 'ln')
      if (line) {
        const lineChildren = ownChildren(line)
        removeDirect(lineChildren, new Set(['gradFill', 'noFill', 'pattFill', 'solidFill']))
        lineChildren.unshift(xmlNode('a:solidFill', [
          xmlNode('a:srgbClr', [], { val: normalized }),
        ]))
      }
    }
  }
}

const retag = (node: OrderedXmlNode, tag: string): void => {
  const entry = nodeEntries(node)[0]
  if (!entry || entry[0] === tag) return
  delete node[entry[0]]
  node[tag] = entry[1]
}

const kindForChartType = (type: PowerPointChartPatch['after']['chartType']): string => {
  if (type === 'bar' || type === 'column') return 'barChart'
  if (type === 'ring') return 'doughnutChart'
  if (type === 'scatter') return 'scatterChart'
  return `${type}Chart`
}

const sameAxisClass = (left: string, right: string): boolean => {
  const axisless = new Set(['doughnutChart', 'ofPieChart', 'pie3DChart', 'pieChart'])
  return axisless.has(left) === axisless.has(right)
}

const makeIssue = (
  operation: PowerPointChartPatch,
  code: string,
  message: string,
  partPath = operation.chartPart,
): PowerPointWritebackIssue => ({
  code,
  elementId: operation.elementId,
  message,
  objectId: operation.objectId,
  partPath,
  slideId: operation.slideId,
})

const insertBefore = (
  children: OrderedXmlNode[],
  node: OrderedXmlNode,
  trailingNames: readonly string[],
): void => {
  const index = children.findIndex(child => trailingNames.includes(localName(nodeTag(child) ?? '')))
  children.splice(index < 0 ? children.length : index, 0, node)
}

const patchRichTitle = (
  owner: OrderedXmlNode,
  title: string | undefined,
): void => {
  const children = ownChildren(owner)
  const current = directNode(children, 'title')
  if (!title) {
    if (current) children.splice(children.indexOf(current), 1)
    return
  }
  const titleNode = current ?? xmlNode('c:title', [
    xmlNode('c:tx', [
      xmlNode('c:rich', [
        xmlNode('a:bodyPr'),
        xmlNode('a:lstStyle'),
        xmlNode('a:p', [xmlNode('a:r', [xmlNode('a:t')])]),
      ]),
    ]),
    xmlNode('c:layout'),
    xmlNode('c:overlay', [], { val: '0' }),
  ])
  if (!current) children.unshift(titleNode)
  const text = findNode(ownChildren(titleNode), 't')
  if (text) setTextValue(text, title)
}

const patchDataLabels = (
  family: OrderedXmlNode,
  options: PowerPointChartPatch['after']['options'],
): void => {
  if (!options || ![
    'showCategoryName', 'showDataLabels', 'showSeriesName', 'showValue',
  ].some(key => key in options)) return
  const children = ownChildren(family)
  let labels = directNode(children, 'dLbls')
  if (options.showDataLabels === false) {
    if (labels) children.splice(children.indexOf(labels), 1)
    return
  }
  if (!labels) {
    labels = xmlNode('c:dLbls')
    insertBefore(children, labels, ['gapWidth', 'holeSize', 'overlap', 'axId', 'extLst'])
  }
  const labelChildren = ownChildren(labels)
  setOptionalVal(labelChildren, 'showCatName', options.showCategoryName)
  setOptionalVal(labelChildren, 'showSerName', options.showSeriesName)
  setOptionalVal(labelChildren, 'showVal', options.showValue)
}

const patchFamilyOptions = (
  family: OrderedXmlNode,
  kind: string,
  operation: PowerPointChartPatch,
  sourceFamily: PowerPointChartFamily | undefined,
): void => {
  const children = ownChildren(family)
  const options = operation.after.options
  if (kind === 'barChart') {
    setVal(children, 'barDir', operation.after.chartType === 'column' ? 'bar' : 'col')
  }
  const grouping = options?.percentStacked
    ? 'percentStacked'
    : options?.stack
      ? 'stacked'
      : sourceFamily?.grouping
  setOptionalVal(children, 'grouping', grouping)
  setOptionalVal(children, 'gapWidth', options?.gapWidth ?? sourceFamily?.gapWidth)
  setOptionalVal(children, 'overlap', options?.overlap ?? sourceFamily?.overlap)
  setOptionalVal(children, 'holeSize', options?.holeSize ?? sourceFamily?.holeSize)
  setOptionalVal(children, 'marker', options?.marker ?? sourceFamily?.marker)
  patchDataLabels(family, options)
}

const patchLegend = (chart: OrderedXmlNode, operation: PowerPointChartPatch): void => {
  const before = operation.before.options
  const after = operation.after.options
  const directSpaceChange = changed(operation.before.chartSpace?.legend, operation.after.chartSpace?.legend)
  if (!directSpaceChange && before?.showLegend === after?.showLegend && before?.legendPosition === after?.legendPosition) return
  const children = ownChildren(chart)
  let legend = directNode(children, 'legend')
  const show = after?.showLegend ?? Boolean(operation.after.chartSpace?.legend)
  if (!show) {
    if (legend) children.splice(children.indexOf(legend), 1)
    return
  }
  if (!legend) {
    legend = xmlNode('c:legend', [xmlNode('c:legendPos', [], { val: 'r' }), xmlNode('c:layout')])
    insertBefore(children, legend, ['plotVisOnly', 'dispBlanksAs', 'showDLblsOverMax', 'extLst'])
  }
  const position = after?.legendPosition
    ?? operation.after.chartSpace?.legend?.position
    ?? 'r'
  const mapped = { bottom: 'b', left: 'l', right: 'r', top: 't' }[position] ?? position
  setVal(ownChildren(legend), 'legendPos', mapped)
  setOptionalVal(ownChildren(legend), 'overlay', operation.after.chartSpace?.legend?.overlay)
}

const patchAxis = (
  axis: OrderedXmlNode,
  axisIndex: number,
  operation: PowerPointChartPatch,
): void => {
  const source = operation.after.chartSpace?.plotArea.axes[axisIndex]
  const children = ownChildren(axis)
  const isValue = localName(nodeTag(axis) ?? '') === 'valAx'
  const title = isValue ? operation.after.options?.valueAxisTitle : operation.after.options?.categoryAxisTitle
  if (title !== undefined) patchRichTitle(axis, title)
  else if (source && changed(operation.before.chartSpace?.plotArea.axes[axisIndex]?.title, source.title)) {
    patchRichTitle(axis, source.title)
  }
  if (isValue) {
    const scaling = ensureDirect(children, 'scaling', 'c:scaling', 1)
    const scalingChildren = ownChildren(scaling)
    setOptionalVal(scalingChildren, 'max', operation.after.options?.maximumValue ?? source?.scaling?.max)
    setOptionalVal(scalingChildren, 'min', operation.after.options?.minimumValue ?? source?.scaling?.min)
    if (operation.after.options?.showMajorGridlines !== undefined) {
      const grid = directNode(children, 'majorGridlines')
      if (operation.after.options.showMajorGridlines && !grid) {
        insertBefore(children, xmlNode('c:majorGridlines'), ['title', 'numFmt', 'majorTickMark'])
      }
      else if (!operation.after.options.showMajorGridlines && grid) children.splice(children.indexOf(grid), 1)
    }
  }
  if (source) {
    setOptionalVal(children, 'delete', source.deleted)
    setOptionalVal(children, 'axPos', source.position)
    setOptionalVal(children, 'majorTickMark', source.majorTickMark)
    setOptionalVal(children, 'minorTickMark', source.minorTickMark)
    setOptionalVal(children, 'tickLblPos', source.tickLabelPosition)
    setOptionalVal(children, 'majorUnit', source.majorUnit)
    setOptionalVal(children, 'minorUnit', source.minorUnit)
  }
}

const desiredFamilies = (operation: PowerPointChartPatch): PowerPointChartFamily[] | undefined => {
  if (changed(operation.before.chartSpace, operation.after.chartSpace)) {
    return operation.after.chartSpace?.plotArea.families
  }
  return operation.before.chartSpace?.plotArea.families
}

const patchChartXml = (
  xml: string,
  operation: PowerPointChartPatch,
): { issues: PowerPointWritebackIssue[]; xml: string } => {
  const nodes = parseXml(xml, operation.chartPart)
  const chart = findNode(nodes, 'chart')
  const plotArea = chart ? directNode(ownChildren(chart), 'plotArea') : undefined
  if (!chart || !plotArea) {
    return { issues: [makeIssue(operation, 'pptx.writeback.chart-structure', 'The native chart part has no chart plot area.')], xml }
  }
  const plotChildren = ownChildren(plotArea)
  const familyNodes = plotChildren.filter(node => /Chart$/.test(localName(nodeTag(node) ?? '')))
  if (!familyNodes.length) {
    return { issues: [makeIssue(operation, 'pptx.writeback.chart-family', 'The native chart part contains no editable chart family.')], xml }
  }

  const sourceFamilies = operation.before.chartSpace?.plotArea.families ?? []
  const semanticFamilies = desiredFamilies(operation)
  if (semanticFamilies && semanticFamilies.length !== familyNodes.length) {
    return {
      issues: [makeIssue(operation, 'pptx.writeback.chart-combo-structure', 'Adding or removing a chart family in a combo chart requires explicit axis allocation.')],
      xml,
    }
  }

  if (operation.before.chartType !== operation.after.chartType) {
    if (familyNodes.length !== 1) {
      return { issues: [makeIssue(operation, 'pptx.writeback.chart-type-combo', 'Changing the type of a combo chart must be done per native chart family.')], xml }
    }
    const currentKind = localName(nodeTag(familyNodes[0]!) ?? '')
    const desiredKind = kindForChartType(operation.after.chartType)
    if (!sameAxisClass(currentKind, desiredKind)) {
      return { issues: [makeIssue(operation, 'pptx.writeback.chart-axis-class', 'Changing between axis-based and axis-free chart families requires creating or removing native axes.')], xml }
    }
    retag(familyNodes[0]!, `c:${desiredKind}`)
  }

  const dataChanged = changed(operation.before.data, operation.after.data)
  const layout = inferWorkbookLayout(operation)
  let dataCursor = 0
  let order = 0
  for (let familyIndex = 0; familyIndex < familyNodes.length; familyIndex += 1) {
    const familyNode = familyNodes[familyIndex]!
    const familyChildren = ownChildren(familyNode)
    const sourceFamily = sourceFamilies[familyIndex]
    const semanticFamily = semanticFamilies?.[familyIndex]
    const existing = directNodes(familyChildren, 'ser')
    const requestedCount = dataChanged
      ? familyIndex === familyNodes.length - 1
        ? Math.max(0, operation.after.data.series.length - dataCursor)
        : Math.min(existing.length, Math.max(0, operation.after.data.series.length - dataCursor))
      : semanticFamily?.series.length ?? existing.length
    if (requestedCount > 0 && !existing.length) {
      return { issues: [makeIssue(operation, 'pptx.writeback.chart-series-template', 'The chart family has no native series template for an inserted data series.')], xml }
    }
    for (let index = existing.length - 1; index >= requestedCount; index -= 1) {
      familyChildren.splice(familyChildren.indexOf(existing[index]!), 1)
    }
    const seriesNodes = directNodes(familyChildren, 'ser')
    while (seriesNodes.length < requestedCount) {
      const template = seriesNodes.at(-1) ?? existing[0]
      if (!template) break
      const clone = structuredClone(template)
      const lastSeriesIndex = familyChildren.reduce((latest, child, index) => (
        localName(nodeTag(child) ?? '') === 'ser' ? index : latest
      ), -1)
      familyChildren.splice(lastSeriesIndex + 1, 0, clone)
      seriesNodes.push(clone)
    }

    for (let familySeriesIndex = 0; familySeriesIndex < requestedCount; familySeriesIndex += 1) {
      const semanticSeries = semanticFamily?.series[familySeriesIndex]
      const values = dataChanged
        ? operation.after.data.series[dataCursor] ?? []
        : semanticSeries?.values?.map(value => value ?? 0) ?? operation.after.data.series[dataCursor] ?? []
      const categories = dataChanged
        ? operation.after.data.labels
        : semanticSeries?.categories?.map(value => value ?? '') ?? operation.after.data.labels
      const name = dataChanged
        ? operation.after.data.legends[dataCursor] ?? `Series ${dataCursor + 1}`
        : semanticSeries?.name ?? operation.after.data.legends[dataCursor] ?? `Series ${dataCursor + 1}`
      const formulas = layout ? {
        categories: formulaFor(layout.sheet, {
          column: layout.categoryColumn,
          row: layout.dataStartRow,
        }, {
          column: layout.categoryColumn,
          row: layout.dataStartRow + Math.max(0, categories.length - 1),
        }),
        name: formulaFor(layout.sheet, {
          column: layout.seriesStartColumn + dataCursor,
          row: layout.headerRow,
        }),
        values: formulaFor(layout.sheet, {
          column: layout.seriesStartColumn + dataCursor,
          row: layout.dataStartRow,
        }, {
          column: layout.seriesStartColumn + dataCursor,
          row: layout.dataStartRow + Math.max(0, values.length - 1),
        }),
      } : undefined
      patchSeries({
        categories,
        ...(operation.after.themeColors[dataCursor]
          ? { color: operation.after.themeColors[dataCursor] }
          : {}),
        formula: formulas,
        index: order,
        name,
        node: seriesNodes[familySeriesIndex]!,
        values,
      })
      dataCursor += 1
      order += 1
    }
    patchFamilyOptions(
      familyNode,
      localName(nodeTag(familyNode) ?? ''),
      operation,
      semanticFamily ?? sourceFamily,
    )
  }

  if (dataChanged && dataCursor !== operation.after.data.series.length) {
    return { issues: [makeIssue(operation, 'pptx.writeback.chart-series-count', 'The requested chart series could not be assigned to the native chart families.')], xml }
  }

  const title = operation.after.options?.title ?? operation.after.chartSpace?.title?.text
  if (
    operation.after.options?.title !== operation.before.options?.title
    || changed(operation.before.chartSpace?.title, operation.after.chartSpace?.title)
  ) patchRichTitle(chart, title)
  patchLegend(chart, operation)
  directNodes(plotChildren, 'catAx').forEach((axis, index) => patchAxis(axis, index, operation))
  directNodes(plotChildren, 'dateAx').forEach((axis, index) => patchAxis(axis, index, operation))
  const nonValueAxes = directNodes(plotChildren, 'catAx').length + directNodes(plotChildren, 'dateAx').length
  directNodes(plotChildren, 'valAx').forEach((axis, index) => patchAxis(axis, nonValueAxes + index, operation))
  setOptionalVal(ownChildren(chart), 'plotVisOnly', operation.after.chartSpace?.plotVisibleOnly)
  setOptionalVal(ownChildren(chart), 'dispBlanksAs', operation.after.chartSpace?.displayBlanksAs)
  return { issues: [], xml: buildXml(nodes, operation.chartPart) }
}

const cellReference = (column: number, row: number): string => `${columnName(column)}${row + 1}`

const patchWorksheet = (
  xml: string,
  operation: PowerPointChartPatch,
  layout: WorkbookLayout,
): string => {
  const partPath = `embedded:${operation.workbookPart}`
  const nodes = parseXml(xml, partPath)
  const worksheet = findNode(nodes, 'worksheet')
  const sheetData = worksheet ? directNode(ownChildren(worksheet), 'sheetData') : undefined
  if (!worksheet || !sheetData) throw new Error('The embedded chart workbook has no worksheet data table.')
  const sheetChildren = ownChildren(sheetData)
  const rows = new Map<number, OrderedXmlNode>()
  for (const row of directNodes(sheetChildren, 'row')) {
    const index = Number(attributes(row).r) - 1
    if (Number.isInteger(index) && index >= 0) rows.set(index, row)
  }
  const ensureRow = (rowIndex: number): OrderedXmlNode => {
    const current = rows.get(rowIndex)
    if (current) return current
    const row = xmlNode('row', [], { r: String(rowIndex + 1) })
    const insertAt = sheetChildren.findIndex(candidate => {
      if (localName(nodeTag(candidate) ?? '') !== 'row') return false
      return Number(attributes(candidate).r) - 1 > rowIndex
    })
    sheetChildren.splice(insertAt < 0 ? sheetChildren.length : insertAt, 0, row)
    rows.set(rowIndex, row)
    return row
  }
  const setCell = (column: number, rowIndex: number, value: number | string): void => {
    const row = ensureRow(rowIndex)
    const cells = ownChildren(row)
    const reference = cellReference(column, rowIndex)
    let cell = directNodes(cells, 'c').find(candidate => attributes(candidate).r === reference)
    if (!cell) {
      cell = xmlNode('c', [], { r: reference })
      const insertAt = cells.findIndex(candidate => {
        const match = CELL_PATTERN.exec(attributes(candidate).r ?? '')
        return match ? columnIndex(match[1]!) > column : false
      })
      cells.splice(insertAt < 0 ? cells.length : insertAt, 0, cell)
    }
    const cellAttributes = attributes(cell)
    const children = ownChildren(cell)
    removeDirect(children, new Set(['f', 'is', 'v']))
    if (typeof value === 'number') {
      delete cellAttributes.t
      const node = xmlNode('v')
      setTextValue(node, String(value))
      children.push(node)
    }
    else {
      cellAttributes.t = 'inlineStr'
      const text = xmlNode('t')
      setTextValue(text, value)
      children.push(xmlNode('is', [text]))
    }
  }
  const removeCell = (column: number, rowIndex: number): void => {
    const row = rows.get(rowIndex)
    if (!row) return
    const cells = ownChildren(row)
    const reference = cellReference(column, rowIndex)
    const index = cells.findIndex(candidate => (
      localName(nodeTag(candidate) ?? '') === 'c' && attributes(candidate).r === reference
    ))
    if (index >= 0) cells.splice(index, 1)
  }

  const beforeRows = operation.before.data.labels.length
  const afterRows = operation.after.data.labels.length
  const beforeSeries = operation.before.data.series.length
  const afterSeries = operation.after.data.series.length
  const maxRows = Math.max(beforeRows, afterRows)
  const maxSeries = Math.max(beforeSeries, afterSeries)
  for (let row = 0; row < maxRows; row += 1) {
    if (row < afterRows) setCell(layout.categoryColumn, layout.dataStartRow + row, operation.after.data.labels[row] ?? '')
    else removeCell(layout.categoryColumn, layout.dataStartRow + row)
    for (let series = 0; series < maxSeries; series += 1) {
      const column = layout.seriesStartColumn + series
      if (series < afterSeries && row < afterRows) {
        setCell(column, layout.dataStartRow + row, operation.after.data.series[series]?.[row] ?? 0)
      }
      else removeCell(column, layout.dataStartRow + row)
    }
  }
  for (let series = 0; series < maxSeries; series += 1) {
    const column = layout.seriesStartColumn + series
    if (series < afterSeries) setCell(column, layout.headerRow, operation.after.data.legends[series] ?? `Series ${series + 1}`)
    else removeCell(column, layout.headerRow)
  }

  const maxColumn = Math.max(layout.categoryColumn, layout.seriesStartColumn + Math.max(0, afterSeries - 1))
  const maxRow = Math.max(layout.headerRow, layout.dataStartRow + Math.max(0, afterRows - 1))
  const dimension = directNode(ownChildren(worksheet), 'dimension')
  if (dimension) attributes(dimension).ref = `A1:${cellReference(maxColumn, maxRow)}`
  for (const [rowIndex, row] of rows) {
    const rowCells = directNodes(ownChildren(row), 'c')
    if (!rowCells.length) {
      const index = sheetChildren.indexOf(row)
      if (index >= 0) sheetChildren.splice(index, 1)
      rows.delete(rowIndex)
    }
    else {
      attributes(row).spans = `1:${Math.max(...rowCells.map(cell => {
        const match = CELL_PATTERN.exec(attributes(cell).r ?? '')
        return match ? columnIndex(match[1]!) + 1 : 1
      }))}`
    }
  }
  return buildXml(nodes, partPath)
}

const workbookSheetPath = async (
  workbook: JSZip,
  sheetName: string,
): Promise<string | undefined> => {
  const workbookEntry = workbook.file('xl/workbook.xml')
  const relationshipsEntry = workbook.file('xl/_rels/workbook.xml.rels')
  if (!workbookEntry || !relationshipsEntry) return undefined
  const workbookNodes = parseXml(await workbookEntry.async('text'), 'xl/workbook.xml')
  const relationshipNodes = parseXml(await relationshipsEntry.async('text'), 'xl/_rels/workbook.xml.rels')
  const relationships = new Map<string, string>()
  const visitRelationships = (nodes: readonly OrderedXmlNode[]): void => {
    for (const node of nodes) {
      if (localName(nodeTag(node) ?? '') === 'Relationship') {
        const values = attributes(node)
        if (values.Id && values.Target) relationships.set(values.Id, values.Target)
      }
      visitRelationships(ownChildren(node))
    }
  }
  visitRelationships(relationshipNodes)
  const sheets = findNode(workbookNodes, 'sheets')
  const candidates = sheets ? directNodes(ownChildren(sheets), 'sheet') : []
  const sheet = candidates.find(candidate => attributes(candidate).name === sheetName)
    ?? (candidates.length === 1 ? candidates[0] : undefined)
  const target = sheet ? relationships.get(attributes(sheet)['r:id'] ?? '') : undefined
  if (!target) return undefined
  const normalized = target.replace(/^\/?/, '').replace(/^\.\.\//, '')
  return normalized.startsWith('xl/') ? normalized : `xl/${normalized}`
}

const patchWorkbook = async (
  bytes: ArrayBuffer,
  operation: PowerPointChartPatch,
  layout: WorkbookLayout,
): Promise<ArrayBuffer> => {
  const workbook = await JSZip.loadAsync(bytes)
  const sheetPath = await workbookSheetPath(workbook, layout.sheet)
  if (!sheetPath) throw new Error(`The embedded workbook has no worksheet for ${layout.sheet}.`)
  const sheet = workbook.file(sheetPath)
  if (!sheet) throw new Error(`The embedded workbook worksheet is missing: ${sheetPath}.`)
  workbook.file(sheetPath, patchWorksheet(await sheet.async('text'), operation, layout))
  return workbook.generateAsync({
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'DOS',
    type: 'arraybuffer',
  })
}

export const patchNativeChart = async (
  packageZip: JSZip,
  operation: PowerPointChartPatch,
): Promise<PowerPointWritebackIssue[]> => {
  const chartEntry = packageZip.file(operation.chartPart)
  if (!chartEntry) return [makeIssue(operation, 'pptx.writeback.chart-part-missing', 'The retained native chart part is missing.')]
  const patched = patchChartXml(await chartEntry.async('text'), operation)
  if (patched.issues.length) return patched.issues
  packageZip.file(operation.chartPart, patched.xml)

  if (changed(operation.before.data, operation.after.data) && operation.workbookPart) {
    const layout = inferWorkbookLayout(operation)
    if (!layout) {
      return [makeIssue(
        operation,
        'pptx.writeback.chart-workbook-range',
        'The chart data edit has no exact workbook range layout.',
        operation.workbookPart,
      )]
    }
    const workbookEntry = packageZip.file(operation.workbookPart)
    if (!workbookEntry) {
      return [makeIssue(
        operation,
        'pptx.writeback.chart-workbook-missing',
        'The retained embedded chart workbook is missing.',
        operation.workbookPart,
      )]
    }
    try {
      packageZip.file(
        operation.workbookPart,
        await patchWorkbook(await workbookEntry.async('arraybuffer'), operation, layout),
      )
    }
    catch (error) {
      return [makeIssue(
        operation,
        'pptx.writeback.chart-workbook',
        error instanceof Error ? error.message : 'The embedded chart workbook could not be updated.',
        operation.workbookPart,
      )]
    }
  }
  return []
}
