import { getTextByPathList } from './utils'

/**
 * Parses a chart part into the structure it actually declares.
 *
 * A chart part is a chart *space*: a plot area holding one or more chart
 * families, each with its own series and its own axis references. Reducing
 * that to a single type plus one array of numbers loses every case the shape
 * exists for — a combo chart, a series plotted on a secondary axis, per-point
 * formatting, a number format that decides how a label reads.
 *
 * This retains the structure without interpreting it. Rendering and the
 * cached-data provenance are separate concerns.
 */

const asArray = value => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value])

const first = value => (Array.isArray(value) ? value[0] : value)

const attribute = (node, name) => getTextByPathList(node, ['attrs', name])

/** OOXML writes most booleans as an optional element with a `val` attribute. */
const flag = (node, name) => {
  const value = getTextByPathList(node, [name, 'attrs', 'val'])
  if (value === undefined) return undefined
  return value !== '0' && value !== 'false'
}

const numberValue = (node, name) => {
  const value = getTextByPathList(node, [name, 'attrs', 'val'])
  if (value === undefined || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const textValue = node => {
  if (!node || typeof node !== 'object') return undefined
  const parts = []
  const visit = value => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (key === 'a:t' || key === 'c:v') {
        if (typeof child === 'string') parts.push(child)
        else if (typeof child?.value === 'string') parts.push(child.value)
        else asArray(child).forEach(item => {
          if (typeof item === 'string') parts.push(item)
          else if (typeof item?.value === 'string') parts.push(item.value)
        })
      }
      else if (Array.isArray(child)) child.forEach(visit)
      else visit(child)
    }
  }
  visit(node)
  const text = parts.join('')
  return text || undefined
}

const numberFormat = node => {
  const format = getTextByPathList(node, ['c:numFmt', 'attrs'])
  if (!format?.formatCode) return undefined
  return {
    formatCode: format.formatCode,
    ...(format.sourceLinked !== undefined ? { sourceLinked: format.sourceLinked !== '0' } : {}),
  }
}

const dataLabels = node => {
  const labels = first(node?.['c:dLbls'])
  if (!labels) return undefined
  const settings = {
    ...(flag(labels, 'c:showBubbleSize') !== undefined ? { showBubbleSize: flag(labels, 'c:showBubbleSize') } : {}),
    ...(flag(labels, 'c:showCatName') !== undefined ? { showCategoryName: flag(labels, 'c:showCatName') } : {}),
    ...(flag(labels, 'c:showLegendKey') !== undefined ? { showLegendKey: flag(labels, 'c:showLegendKey') } : {}),
    ...(flag(labels, 'c:showPercent') !== undefined ? { showPercent: flag(labels, 'c:showPercent') } : {}),
    ...(flag(labels, 'c:showSerName') !== undefined ? { showSeriesName: flag(labels, 'c:showSerName') } : {}),
    ...(flag(labels, 'c:showVal') !== undefined ? { showValue: flag(labels, 'c:showVal') } : {}),
  }
  const position = getTextByPathList(labels, ['c:dLblPos', 'attrs', 'val'])
  if (position) settings.position = position
  const format = numberFormat(labels)
  if (format) settings.numberFormat = format
  return Object.keys(settings).length ? settings : undefined
}

const REFERENCE_KINDS = {
  'c:multiLvlStrRef': { cache: 'c:multiLvlStrCache', kind: 'multiLevelString' },
  'c:numLit': { kind: 'numberLiteral' },
  'c:numRef': { cache: 'c:numCache', kind: 'number' },
  'c:strLit': { kind: 'stringLiteral' },
  'c:strRef': { cache: 'c:strCache', kind: 'string' },
}

/**
 * Records where a series got its data.
 *
 * The points a chart draws are a *cache* of a range in the embedded workbook.
 * Keeping only the cache loses which cells produced it, so an edit has nowhere
 * to write back and an export cannot tell a stale cache from a fresh one. The
 * formula, the declared point count, and the cache's own format code are the
 * provenance that makes the numbers meaningful.
 */
const referenceFrom = node => {
  if (!node) return undefined
  for (const [key, descriptor] of Object.entries(REFERENCE_KINDS)) {
    const container = first(node[key])
    if (!container) continue
    const cache = descriptor.cache ? first(container[descriptor.cache]) : container
    const reference = { kind: descriptor.kind }
    const formula = container['c:f']
    const formulaText = typeof formula === 'string' ? formula : formula?.value
    if (formulaText) reference.formula = formulaText
    const pointCount = numberValue(cache, 'c:ptCount')
    if (pointCount !== undefined) reference.pointCount = pointCount
    const formatCode = cache?.['c:formatCode']
    const formatText = typeof formatCode === 'string' ? formatCode : formatCode?.value
    if (formatText) reference.formatCode = formatText
    return reference
  }
  return undefined
}

/** Reads the cached points of a category/value reference, in index order. */
const cachedPoints = node => {
  if (!node) return undefined
  const container = first(node['c:numRef'])?.['c:numCache']
    ?? first(node['c:strRef'])?.['c:strCache']
    ?? first(node['c:multiLvlStrRef'])?.['c:multiLvlStrCache']
    ?? first(node['c:numLit'])
    ?? first(node['c:strLit'])
  if (!container) return undefined
  const levels = container['c:lvl'] ? asArray(container['c:lvl']) : [container]
  const byIndex = new Map()
  for (const level of levels) {
    for (const point of asArray(level?.['c:pt'])) {
      const index = Number(attribute(point, 'idx'))
      if (!Number.isFinite(index)) continue
      const value = typeof point['c:v'] === 'string' ? point['c:v'] : point['c:v']?.value
      if (value === undefined) continue
      byIndex.set(index, byIndex.has(index) ? `${byIndex.get(index)}\n${value}` : value)
    }
  }
  if (!byIndex.size) return undefined
  const count = Math.max(...byIndex.keys()) + 1
  return Array.from({ length: count }, (_unused, index) => byIndex.get(index))
}

const numericPoints = node => {
  const points = cachedPoints(node)
  if (!points) return undefined
  return points.map(value => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  })
}

const seriesFrom = node => {
  const series = {
    index: numberValue(node, 'c:idx') ?? 0,
    order: numberValue(node, 'c:order') ?? 0,
  }
  const name = textValue(first(node['c:tx']))
  if (name) series.name = name
  const categories = cachedPoints(first(node['c:cat']))
  if (categories) series.categories = categories
  const values = numericPoints(first(node['c:val']))
  if (values) series.values = values
  const xValues = numericPoints(first(node['c:xVal']))
  if (xValues) series.xValues = xValues
  const yValues = numericPoints(first(node['c:yVal']))
  if (yValues) series.yValues = yValues
  const bubbleSizes = numericPoints(first(node['c:bubbleSize']))
  if (bubbleSizes) series.bubbleSizes = bubbleSizes
  const references = {
    bubbleSizes: referenceFrom(first(node['c:bubbleSize'])),
    categories: referenceFrom(first(node['c:cat'])),
    name: referenceFrom(first(node['c:tx'])),
    values: referenceFrom(first(node['c:val'])),
    xValues: referenceFrom(first(node['c:xVal'])),
    yValues: referenceFrom(first(node['c:yVal'])),
  }
  for (const [key, value] of Object.entries(references)) {
    if (!value) delete references[key]
  }
  if (Object.keys(references).length) series.references = references
  const smooth = flag(node, 'c:smooth')
  if (smooth !== undefined) series.smooth = smooth
  const labels = dataLabels(node)
  if (labels) series.dataLabels = labels
  const marker = getTextByPathList(node, ['c:marker', 'c:symbol', 'attrs', 'val'])
  if (marker) series.markerSymbol = marker
  return series
}

const FAMILY_KEYS = new Set([
  'c:area3DChart', 'c:areaChart', 'c:bar3DChart', 'c:barChart', 'c:bubbleChart',
  'c:doughnutChart', 'c:line3DChart', 'c:lineChart', 'c:ofPieChart', 'c:pie3DChart',
  'c:pieChart', 'c:radarChart', 'c:scatterChart', 'c:stockChart', 'c:surface3DChart',
  'c:surfaceChart',
])

const familyFrom = (key, node) => {
  const family = {
    axisIds: asArray(node['c:axId']).map(axis => attribute(axis, 'val')).filter(Boolean),
    kind: key.replace(/^c:/, ''),
    series: asArray(node['c:ser']).map(seriesFrom).sort((left, right) => left.order - right.order),
  }
  const barDirection = getTextByPathList(node, ['c:barDir', 'attrs', 'val'])
  if (barDirection) family.barDirection = barDirection
  const grouping = getTextByPathList(node, ['c:grouping', 'attrs', 'val'])
  if (grouping) family.grouping = grouping
  const style = getTextByPathList(node, ['c:scatterStyle', 'attrs', 'val'])
    ?? getTextByPathList(node, ['c:radarStyle', 'attrs', 'val'])
  if (style) family.style = style
  const gapWidth = numberValue(node, 'c:gapWidth')
  if (gapWidth !== undefined) family.gapWidth = gapWidth
  const overlap = numberValue(node, 'c:overlap')
  if (overlap !== undefined) family.overlap = overlap
  const holeSize = numberValue(node, 'c:holeSize')
  if (holeSize !== undefined) family.holeSize = holeSize
  const varyColors = flag(node, 'c:varyColors')
  if (varyColors !== undefined) family.varyColors = varyColors
  const marker = flag(node, 'c:marker')
  if (marker !== undefined) family.marker = marker
  const labels = dataLabels(node)
  if (labels) family.dataLabels = labels
  return family
}

const AXIS_KINDS = {
  'c:catAx': 'category',
  'c:dateAx': 'date',
  'c:serAx': 'series',
  'c:valAx': 'value',
}

const axisFrom = (key, node) => {
  const axis = {
    id: attribute(first(node['c:axId']), 'val') ?? '',
    kind: AXIS_KINDS[key],
  }
  const position = getTextByPathList(node, ['c:axPos', 'attrs', 'val'])
  if (position) axis.position = position
  const crossAxis = attribute(first(node['c:crossAx']), 'val')
  if (crossAxis) axis.crossAxisId = crossAxis
  const deleted = flag(node, 'c:delete')
  if (deleted !== undefined) axis.deleted = deleted
  const title = textValue(first(node['c:title']))
  if (title) axis.title = title
  if (node['c:majorGridlines']) axis.majorGridlines = true
  if (node['c:minorGridlines']) axis.minorGridlines = true
  const format = numberFormat(node)
  if (format) axis.numberFormat = format
  const majorTick = getTextByPathList(node, ['c:majorTickMark', 'attrs', 'val'])
  if (majorTick) axis.majorTickMark = majorTick
  const minorTick = getTextByPathList(node, ['c:minorTickMark', 'attrs', 'val'])
  if (minorTick) axis.minorTickMark = minorTick
  const tickLabels = getTextByPathList(node, ['c:tickLblPos', 'attrs', 'val'])
  if (tickLabels) axis.tickLabelPosition = tickLabels
  const baseTimeUnit = getTextByPathList(node, ['c:baseTimeUnit', 'attrs', 'val'])
  if (baseTimeUnit) axis.baseTimeUnit = baseTimeUnit
  const majorUnit = numberValue(node, 'c:majorUnit')
  if (majorUnit !== undefined) axis.majorUnit = majorUnit
  const minorUnit = numberValue(node, 'c:minorUnit')
  if (minorUnit !== undefined) axis.minorUnit = minorUnit
  const scaling = first(node['c:scaling'])
  if (scaling) {
    const values = {}
    const max = numberValue(scaling, 'c:max')
    if (max !== undefined) values.max = max
    const min = numberValue(scaling, 'c:min')
    if (min !== undefined) values.min = min
    const logBase = numberValue(scaling, 'c:logBase')
    if (logBase !== undefined) values.logBase = logBase
    const orientation = getTextByPathList(scaling, ['c:orientation', 'attrs', 'val'])
    if (orientation) values.orientation = orientation
    if (Object.keys(values).length) axis.scaling = values
  }
  return axis
}

export function getChartSpace(chartContent) {
  const chartSpace = getTextByPathList(chartContent, ['c:chartSpace'])
  const chart = first(getTextByPathList(chartSpace, ['c:chart']))
  const plotAreaNode = first(getTextByPathList(chart, ['c:plotArea']))
  if (!plotAreaNode) return undefined

  const families = []
  const axes = []
  for (const [key, value] of Object.entries(plotAreaNode)) {
    if (FAMILY_KEYS.has(key)) {
      for (const node of asArray(value)) families.push(familyFrom(key, node))
    }
    else if (AXIS_KINDS[key]) {
      for (const node of asArray(value)) axes.push(axisFrom(key, node))
    }
  }
  if (!families.length) return undefined

  const space = {
    plotArea: { axes, families },
    schemaVersion: 1,
  }
  const title = textValue(first(chart['c:title']))
  if (title) space.title = { text: title }
  const titleOverlay = flag(first(chart['c:title']), 'c:overlay')
  if (titleOverlay !== undefined) space.title = { ...space.title, overlay: titleOverlay }
  const autoTitleDeleted = flag(chart, 'c:autoTitleDeleted')
  if (autoTitleDeleted !== undefined) space.autoTitleDeleted = autoTitleDeleted

  const legendNode = first(chart['c:legend'])
  if (legendNode) {
    space.legend = {}
    const position = getTextByPathList(legendNode, ['c:legendPos', 'attrs', 'val'])
    if (position) space.legend.position = position
    const overlay = flag(legendNode, 'c:overlay')
    if (overlay !== undefined) space.legend.overlay = overlay
  }
  const plotVisibleOnly = flag(chart, 'c:plotVisOnly')
  if (plotVisibleOnly !== undefined) space.plotVisibleOnly = plotVisibleOnly
  const displayBlanksAs = getTextByPathList(chart, ['c:dispBlanksAs', 'attrs', 'val'])
  if (displayBlanksAs) space.displayBlanksAs = displayBlanksAs

  // The relationship that ties the chart's formulas to a workbook part.
  const externalData = first(chartSpace['c:externalData'])
  if (externalData) {
    const relationshipId = attribute(externalData, 'r:id')
    space.externalData = {
      ...(relationshipId ? { relationshipId } : {}),
      ...(flag(externalData, 'c:autoUpdate') !== undefined
        ? { autoUpdate: flag(externalData, 'c:autoUpdate') }
        : {}),
    }
  }
  return space
}
