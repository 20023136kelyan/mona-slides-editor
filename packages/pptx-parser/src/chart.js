import { eachElement, getTextByPathList } from './utils'
import { applyTint } from './color'

function extractChartColors(serNode, warpObj) {
  if (!serNode) return []

  if (serNode.constructor !== Array) serNode = [serNode]
  const schemeClrs = []
  for (const node of serNode) {
    let schemeClr = getTextByPathList(node, ['c:spPr', 'a:solidFill', 'a:schemeClr'])
    if (!schemeClr) schemeClr = getTextByPathList(node, ['c:spPr', 'a:ln', 'a:solidFill', 'a:schemeClr'])
    if (!schemeClr) schemeClr = getTextByPathList(node, ['c:marker', 'c:spPr', 'a:ln', 'a:solidFill', 'a:schemeClr'])

    let clr = getTextByPathList(schemeClr, ['attrs', 'val'])
    if (clr) {
      clr = getTextByPathList(warpObj['themeContent'], ['a:theme', 'a:themeElements', 'a:clrScheme', `a:${clr}`, 'a:srgbClr', 'attrs', 'val'])
      const tint = getTextByPathList(schemeClr, ['a:tint', 'attrs', 'val']) / 100000
      if (clr && !isNaN(tint)) {
        clr = applyTint(clr, tint)
      }
    }
    else clr = getTextByPathList(node, ['c:spPr', 'a:solidFill', 'a:srgbClr', 'attrs', 'val'])

    if (clr) clr = '#' + clr
    schemeClrs.push(clr)
  }
  return schemeClrs
}

function extractChartData(serNode) {
  const dataMat = []
  if (!serNode) return dataMat

  eachElement(serNode, (innerNode, index) => {
    const dataRow = []
    const colName = getTextByPathList(innerNode, ['c:tx', 'c:strRef', 'c:strCache', 'c:pt', 'c:v'])
      || getTextByPathList(innerNode, ['c:tx', 'c:v'])
      || index

    const rowNames = {}
    if (getTextByPathList(innerNode, ['c:cat', 'c:multiLvlStrRef', 'c:multiLvlStrCache', 'c:lvl'])) {
      // A grouped category axis stores one c:lvl per tier, innermost first.
      // PowerPoint stacks the tiers under the axis, so joining them by line
      // keeps every tier's label instead of dropping all but one.
      const levelNode = innerNode['c:cat']['c:multiLvlStrRef']['c:multiLvlStrCache']['c:lvl']
      const levels = levelNode.constructor === Array ? levelNode : [levelNode]
      for (const level of levels) {
        if (!level || !level['c:pt']) continue
        eachElement(level['c:pt'], pointNode => {
          const index = pointNode['attrs']['idx']
          const value = pointNode['c:v']
          if (value === undefined || value === null) return ''
          rowNames[index] = rowNames[index] === undefined ? value : `${rowNames[index]}\n${value}`
          return ''
        })
      }
    }
    else if (getTextByPathList(innerNode, ['c:cat', 'c:strRef', 'c:strCache', 'c:pt'])) {
      eachElement(innerNode['c:cat']['c:strRef']['c:strCache']['c:pt'], innerNode => {
        rowNames[innerNode['attrs']['idx']] = innerNode['c:v']
        return ''
      })
    }
    else if (getTextByPathList(innerNode, ['c:cat', 'c:numRef', 'c:numCache', 'c:pt'])) {
      eachElement(innerNode['c:cat']['c:numRef']['c:numCache']['c:pt'], innerNode => {
        rowNames[innerNode['attrs']['idx']] = innerNode['c:v']
        return ''
      })
    }
    else if (getTextByPathList(innerNode, ['c:cat', 'c:strLit', 'c:pt'])) {
      eachElement(innerNode['c:cat']['c:strLit']['c:pt'], innerNode => {
        rowNames[innerNode['attrs']['idx']] = innerNode['c:v']
        return ''
      })
    }
    else if (getTextByPathList(innerNode, ['c:cat', 'c:numLit', 'c:pt'])) {
      eachElement(innerNode['c:cat']['c:numLit']['c:pt'], innerNode => {
        rowNames[innerNode['attrs']['idx']] = innerNode['c:v']
        return ''
      })
    }

    if (getTextByPathList(innerNode, ['c:val', 'c:numRef', 'c:numCache', 'c:pt'])) {
      eachElement(innerNode['c:val']['c:numRef']['c:numCache']['c:pt'], innerNode => {
        dataRow.push({
          x: innerNode['attrs']['idx'],
          y: parseFloat(innerNode['c:v']),
        })
        return ''
      })
    }
    else if (getTextByPathList(innerNode, ['c:val', 'c:numLit', 'c:pt'])) {
      eachElement(innerNode['c:val']['c:numLit']['c:pt'], innerNode => {
        dataRow.push({
          x: innerNode['attrs']['idx'],
          y: parseFloat(innerNode['c:v']),
        })
        return ''
      })
    }

    dataMat.push({
      key: colName,
      values: dataRow,
      xlabels: rowNames,
    })
    return ''
  })

  return dataMat
}

function extractScatterChartData(serNode) {
  const dataMat = []
  if (!serNode) return dataMat

  const serNodes = serNode.constructor === Array ? serNode : [serNode]
  const firstSerNode = serNodes[0]
  const xData = []

  eachElement(firstSerNode['c:xVal']['c:numRef']['c:numCache']['c:pt'], innerNode => {
    xData.push(parseFloat(innerNode['c:v']))
    return ''
  })
  dataMat.push(xData)

  for (const node of serNodes) {
    const yData = []
    eachElement(node['c:yVal']['c:numRef']['c:numCache']['c:pt'], innerNode => {
      yData.push(parseFloat(innerNode['c:v']))
      return ''
    })
    dataMat.push(yData)
  }

  return dataMat
}

function chartText(node) {
  if (!node) return ''
  const values = []
  const visit = value => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if ((key === 'a:t' || key === 'c:v') && typeof child === 'string') values.push(child)
      else if ((key === 'a:t' || key === 'c:v') && child && typeof child.value === 'string') values.push(child.value)
      else if (Array.isArray(child)) child.forEach(visit)
      else visit(child)
    }
  }
  visit(node)
  return values.join('')
}

function dataLabelSettings(chartNode) {
  const labels = getTextByPathList(chartNode, ['c:dLbls'])
  if (!labels) {
    return {
      showCategoryName: false,
      showDataLabels: false,
      showSeriesName: false,
      showValue: false,
    }
  }
  const enabled = name => {
    const value = getTextByPathList(labels, [name, 'attrs', 'val'])
    return value !== undefined && value !== '0'
  }
  return {
    showCategoryName: enabled('c:showCatName'),
    showDataLabels: true,
    showSeriesName: enabled('c:showSerName'),
    showValue: enabled('c:showVal'),
  }
}

export function getChartMetadata(chartContent) {
  const chart = getTextByPathList(chartContent, ['c:chartSpace', 'c:chart'])
  const plotArea = getTextByPathList(chart, ['c:plotArea'])
  const legend = getTextByPathList(chart, ['c:legend'])
  const categoryAxis = getTextByPathList(plotArea, ['c:catAx'])
    || getTextByPathList(plotArea, ['c:dateAx'])
  const valueAxis = getTextByPathList(plotArea, ['c:valAx'])
  const scaling = getTextByPathList(valueAxis, ['c:scaling'])
  return {
    categoryAxisTitle: chartText(getTextByPathList(categoryAxis, ['c:title'])),
    legendPosition: getTextByPathList(legend, ['c:legendPos', 'attrs', 'val']),
    maximumValue: Number.parseFloat(getTextByPathList(scaling, ['c:max', 'attrs', 'val'])),
    minimumValue: Number.parseFloat(getTextByPathList(scaling, ['c:min', 'attrs', 'val'])),
    showLegend: Boolean(legend),
    showMajorGridlines: Boolean(getTextByPathList(valueAxis, ['c:majorGridlines'])),
    title: chartText(getTextByPathList(chart, ['c:title'])),
    valueAxisTitle: chartText(getTextByPathList(valueAxis, ['c:title'])),
  }
}

export function getChartInfo(plotArea, warpObj) {
  let chart = null
  const charts = []
  for (const key in plotArea) {
    if (!plotArea[key]['c:ser']) continue

    switch (key) {
      case 'c:lineChart':
        chart = {
          type: 'lineChart',
          data: extractChartData(plotArea[key]['c:ser']),
          colors: extractChartColors(plotArea[key]['c:ser'], warpObj),
          grouping: getTextByPathList(plotArea[key], ['c:grouping', 'attrs', 'val']),
          marker: plotArea[key]['c:marker'] ? true : false,
          ...dataLabelSettings(plotArea[key]),
        }
        break
      case 'c:line3DChart':
        chart = {
          type: 'line3DChart',
          data: extractChartData(plotArea[key]['c:ser']),
          colors: extractChartColors(plotArea[key]['c:ser'], warpObj),
          grouping: getTextByPathList(plotArea[key], ['c:grouping', 'attrs', 'val']),
          ...dataLabelSettings(plotArea[key]),
        }
        break
      case 'c:barChart':
        chart = {
          type: 'barChart',
          data: extractChartData(plotArea[key]['c:ser']),
          colors: extractChartColors(plotArea[key]['c:ser'], warpObj),
          grouping: getTextByPathList(plotArea[key], ['c:grouping', 'attrs', 'val']),
          barDir: getTextByPathList(plotArea[key], ['c:barDir', 'attrs', 'val']),
          gapWidth: getTextByPathList(plotArea[key], ['c:gapWidth', 'attrs', 'val']),
          overlap: getTextByPathList(plotArea[key], ['c:overlap', 'attrs', 'val']),
          ...dataLabelSettings(plotArea[key]),
        }
        break
      case 'c:bar3DChart':
        chart = {
          type: 'bar3DChart',
          data: extractChartData(plotArea[key]['c:ser']),
          colors: extractChartColors(plotArea[key]['c:ser'], warpObj),
          grouping: getTextByPathList(plotArea[key], ['c:grouping', 'attrs', 'val']),
          barDir: getTextByPathList(plotArea[key], ['c:barDir', 'attrs', 'val']),
          gapWidth: getTextByPathList(plotArea[key], ['c:gapWidth', 'attrs', 'val']),
          overlap: getTextByPathList(plotArea[key], ['c:overlap', 'attrs', 'val']),
          ...dataLabelSettings(plotArea[key]),
        }
        break
      case 'c:pieChart':
        chart = {
          type: 'pieChart',
          data: extractChartData(plotArea[key]['c:ser']),
          colors: extractChartColors(plotArea[key]['c:ser']['c:dPt'], warpObj),
          ...dataLabelSettings(plotArea[key]),
        }
        break
      case 'c:pie3DChart':
        chart = {
          type: 'pie3DChart',
          data: extractChartData(plotArea[key]['c:ser']),
          colors: extractChartColors(plotArea[key]['c:ser']['c:dPt'], warpObj),
          ...dataLabelSettings(plotArea[key]),
        }
        break
      case 'c:doughnutChart':
        chart = {
          type: 'doughnutChart',
          data: extractChartData(plotArea[key]['c:ser']),
          colors: extractChartColors(plotArea[key]['c:ser']['c:dPt'], warpObj),
          holeSize: getTextByPathList(plotArea[key], ['c:holeSize', 'attrs', 'val']),
          ...dataLabelSettings(plotArea[key]),
        }
        break
      case 'c:areaChart':
        chart = {
          type: 'areaChart',
          data: extractChartData(plotArea[key]['c:ser']),
          colors: extractChartColors(plotArea[key]['c:ser'], warpObj),
          grouping: getTextByPathList(plotArea[key], ['c:grouping', 'attrs', 'val']),
          ...dataLabelSettings(plotArea[key]),
        }
        break
      case 'c:area3DChart':
        chart = {
          type: 'area3DChart',
          data: extractChartData(plotArea[key]['c:ser']),
          colors: extractChartColors(plotArea[key]['c:ser'], warpObj),
          grouping: getTextByPathList(plotArea[key], ['c:grouping', 'attrs', 'val']),
          ...dataLabelSettings(plotArea[key]),
        }
        break
      case 'c:scatterChart':
        chart = {
          type: 'scatterChart',
          data: extractScatterChartData(plotArea[key]['c:ser']),
          colors: extractChartColors(plotArea[key]['c:ser'], warpObj),
          style: getTextByPathList(plotArea[key], ['c:scatterStyle', 'attrs', 'val']),
          ...dataLabelSettings(plotArea[key]),
        }
        break
      case 'c:bubbleChart':
        chart = {
          type: 'bubbleChart',
          data: extractScatterChartData(plotArea[key]['c:ser']),
          colors: extractChartColors(plotArea[key]['c:ser'], warpObj),
          ...dataLabelSettings(plotArea[key]),
        }
        break
      case 'c:radarChart':
        chart = {
          type: 'radarChart',
          data: extractChartData(plotArea[key]['c:ser']),
          colors: extractChartColors(plotArea[key]['c:ser'], warpObj),
          style: getTextByPathList(plotArea[key], ['c:radarStyle', 'attrs', 'val']),
          ...dataLabelSettings(plotArea[key]),
        }
        break
      case 'c:surfaceChart':
        chart = {
          type: 'surfaceChart',
          data: extractChartData(plotArea[key]['c:ser']),
          colors: extractChartColors(plotArea[key]['c:ser'], warpObj),
        }
        break
      case 'c:surface3DChart':
        chart = {
          type: 'surface3DChart',
          data: extractChartData(plotArea[key]['c:ser']),
          colors: extractChartColors(plotArea[key]['c:ser'], warpObj),
        }
        break
      case 'c:stockChart':
        chart = {
          type: 'stockChart',
          data: extractChartData(plotArea[key]['c:ser']),
          colors: [],
        }
        break
      default:
    }
    if (chart) {
      charts.push(chart)
      chart = null
    }
  }

  if (charts.length === 0) return null
  if (charts.length === 1) return charts[0]
  return {
    ...charts[0],
    colors: charts.flatMap(item => item.colors || []),
    data: charts.flatMap(item => item.data || []),
    seriesChartTypes: charts.flatMap(item => Array.from(
      { length: Array.isArray(item.data) ? item.data.length : 0 },
      () => item.type,
    )),
  }
}
