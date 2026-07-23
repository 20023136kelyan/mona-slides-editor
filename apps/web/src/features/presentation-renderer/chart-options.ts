import type {
  GridComponentOption,
  LegendComponentOption,
  RadarComponentOption,
  TitleComponentOption,
  TooltipComponentOption,
} from 'echarts/components'
import type {
  BarSeriesOption,
  LineSeriesOption,
  PieSeriesOption,
  RadarSeriesOption,
  ScatterSeriesOption,
} from 'echarts/charts'
import type { ComposeOption } from 'echarts/core'

import type { ChartData, ChartOptions, ChartType } from '@mona/presentation-core/model'

type ChartOption = ComposeOption<
  | BarSeriesOption
  | GridComponentOption
  | LegendComponentOption
  | LineSeriesOption
  | PieSeriesOption
  | RadarComponentOption
  | RadarSeriesOption
  | ScatterSeriesOption
  | TitleComponentOption
  | TooltipComponentOption
>

const radarSplits = [4, 5, 6]

function getRadarNiceMax(max: number, splitNumber: number): number {
  if (max <= 0) return 0
  const rawInterval = max / splitNumber
  const exponent = Math.floor(Math.log10(rawInterval))
  const exp10 = 10 ** exponent
  const ratio = rawInterval / exp10
  const niceRatio = ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 3 ? 3 : ratio <= 5 ? 5 : 10
  return niceRatio * exp10 * splitNumber
}

function getRadarScale(max: number) {
  if (max <= 0) return { max: 0, splitNumber: 5 }
  return radarSplits
    .map(splitNumber => ({ max: getRadarNiceMax(max, splitNumber), splitNumber }))
    .reduce((best, item) => {
      const bestOverflow = best.max - max
      const overflow = item.max - max
      if (overflow < bestOverflow) return item
      if (overflow === bestOverflow && Math.abs(item.splitNumber - 5) < Math.abs(best.splitNumber - 5)) return item
      return best
    })
}

export interface ChartOptionInput {
  data: ChartData
  lineColor?: string
  options?: ChartOptions
  textColor?: string
  themeColors: string[]
  type: ChartType
}

export function getChartOption({
  data,
  lineColor,
  options = {},
  textColor,
  themeColors,
  type,
}: ChartOptionInput): ChartOption | null {
  const textStyle = textColor ? { color: textColor } : {}
  const axisLine = textColor ? { lineStyle: { color: textColor } } : undefined
  const axisLabel = textColor ? { color: textColor } : undefined
  const splitLine = options.showMajorGridlines === false
    ? { show: false }
    : lineColor ? { lineStyle: { color: lineColor } } : {}
  const plottedData = options.percentStacked
    ? {
        ...data,
        series: data.series.map(values => values.map((value, valueIndex) => {
          const total = data.series.reduce((sum, candidate) => sum + Math.abs(candidate[valueIndex] ?? 0), 0)
          return total ? value / total * 100 : 0
        })),
      }
    : data
  const showLegend = options.showLegend ?? plottedData.series.length > 1
  const legendPosition = options.legendPosition ?? 'bottom'
  const legend: LegendComponentOption | undefined = showLegend ? {
    ...(legendPosition === 'left' || legendPosition === 'right'
      ? { left: legendPosition, orient: 'vertical', top: 'middle' }
      : { left: 'center', top: legendPosition }),
    textStyle,
  } : undefined
  const title = options.title ? {
    left: 'center',
    text: options.title,
    textStyle,
    top: 0,
  } as TitleComponentOption : undefined
  const grid = {
    bottom: showLegend && legendPosition === 'bottom' ? 44 : 24,
    containLabel: true,
    left: showLegend && legendPosition === 'left' ? 80 : 24,
    right: showLegend && legendPosition === 'right' ? 80 : 24,
    top: options.title ? 48 : 24,
  }
  const labelParts = [
    options.showSeriesName ? '{a}' : '',
    options.showCategoryName ? '{b}' : '',
    options.showValue ? '{c}' : '',
  ].filter(Boolean)
  const showDataLabels = options.showDataLabels ?? true
  const label = {
    formatter: labelParts.length ? labelParts.join(': ') : undefined,
    show: showDataLabels,
  }
  const valueAxis = {
    axisLabel,
    axisLine,
    max: options.maximumValue,
    min: options.minimumValue,
    name: options.valueAxisTitle,
    nameLocation: 'middle' as const,
    nameGap: 45,
    splitLine,
    type: 'value' as const,
  }
  const categoryAxis = {
    axisLabel,
    axisLine,
    data: plottedData.labels,
    name: options.categoryAxisTitle,
    nameLocation: 'middle' as const,
    nameGap: 32,
    type: 'category' as const,
  }
  const seriesTypes = options.seriesTypes ?? []
  const isCartesianCombo = new Set(seriesTypes).size > 1
    && seriesTypes.every(seriesType => ['area', 'bar', 'column', 'line'].includes(seriesType))
  if (isCartesianCombo) {
    return {
      color: themeColors,
      grid,
      legend,
      textStyle,
      title,
      tooltip: {},
      xAxis: categoryAxis,
      yAxis: valueAxis,
      series: plottedData.series.map((values, index): BarSeriesOption | LineSeriesOption => {
        const seriesType = seriesTypes[index] ?? type
        if (seriesType === 'line' || seriesType === 'area') {
          const series: LineSeriesOption = {
            ...(seriesType === 'area' ? { areaStyle: {} } : {}),
            data: values,
            label,
            name: plottedData.legends[index],
            showSymbol: options.marker,
            smooth: options.lineSmooth,
            type: 'line',
          }
          if (options.stack) series.stack = 'A'
          return series
        }
        const series: BarSeriesOption = {
          barCategoryGap: options.gapWidth !== undefined ? `${options.gapWidth}%` : undefined,
          barGap: options.overlap !== undefined ? `${-options.overlap}%` : undefined,
          data: values,
          label,
          name: plottedData.legends[index],
          type: 'bar',
        }
        if (options.stack) series.stack = 'A'
        return series
      }),
    }
  }

  if (type === 'bar' || type === 'column') {
    return {
      color: themeColors,
      grid,
      textStyle,
      legend,
      title,
      tooltip: {},
      xAxis: type === 'bar' ? categoryAxis : valueAxis,
      yAxis: type === 'bar' ? valueAxis : categoryAxis,
      series: plottedData.series.map((values, index) => {
        const series: BarSeriesOption = {
          barCategoryGap: options.gapWidth !== undefined ? `${options.gapWidth}%` : undefined,
          barGap: options.overlap !== undefined ? `${-options.overlap}%` : undefined,
          data: values,
          name: plottedData.legends[index],
          type: 'bar',
          label,
          itemStyle: { borderRadius: type === 'bar' ? [2, 2, 0, 0] : [0, 2, 2, 0] },
        }
        if (options.stack) series.stack = 'A'
        return series
      }),
    }
  }

  if (type === 'line') {
    return {
      color: themeColors,
      grid,
      textStyle,
      legend,
      title,
      tooltip: {},
      xAxis: categoryAxis,
      yAxis: valueAxis,
      series: plottedData.series.map((values, index) => {
        const series: LineSeriesOption = {
          data: values,
          name: plottedData.legends[index],
          type: 'line',
          smooth: options.lineSmooth,
          showSymbol: options.marker,
          label,
        }
        if (options.stack) series.stack = 'A'
        return series
      }),
    }
  }

  if (type === 'area') {
    return {
      color: themeColors,
      grid,
      textStyle,
      legend,
      title,
      tooltip: {},
      xAxis: { ...categoryAxis, boundaryGap: false },
      yAxis: valueAxis,
      series: plottedData.series.map((values, index) => {
        const series: LineSeriesOption = {
          data: values,
          name: plottedData.legends[index],
          type: 'line',
          areaStyle: {},
          label,
        }
        if (options.stack) series.stack = 'A'
        return series
      }),
    }
  }

  if (type === 'pie' || type === 'ring') {
    const series: PieSeriesOption = {
      data: (plottedData.series[0] || []).map((value, index) => ({ value, name: plottedData.labels[index] })),
      label: { ...label, ...(textColor ? { color: textColor } : {}) },
      type: 'pie',
      radius: type === 'ring' ? [`${options.holeSize ?? 40}%`, '70%'] : '70%',
      emphasis: type === 'pie'
        ? {
          itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.5)' },
          label: { show: true, fontSize: 14, fontWeight: 'bold' },
        }
        : { label: { show: true, fontSize: 14, fontWeight: 'bold' } },
    }
    if (type === 'ring') {
      series.padAngle = 1
      series.avoidLabelOverlap = false
      series.itemStyle = { borderRadius: 4 }
    }
    return {
      color: themeColors,
      textStyle,
      legend,
      title,
      tooltip: {},
      series: [series],
    }
  }

  if (type === 'radar') {
    const { max, splitNumber } = getRadarScale(Math.max(...plottedData.series.flat()))
    return {
      color: themeColors,
      textStyle,
      legend,
      title,
      tooltip: {},
      radar: {
        splitNumber,
        indicator: plottedData.labels.map(name => ({ name, max })),
        splitLine,
        axisLine: lineColor ? { lineStyle: { color: lineColor } } : undefined,
      },
      series: [{ data: plottedData.series.map((value, index) => ({ value, name: plottedData.legends[index] })), type: 'radar' }],
    }
  }

  if (type === 'scatter') {
    const xData = plottedData.series[0] || []
    const ySeries = plottedData.series.length > 1 ? plottedData.series.slice(1) : [xData]
    return {
      color: themeColors,
      textStyle,
      grid,
      legend,
      title,
      tooltip: {},
      xAxis: { ...valueAxis, name: options.categoryAxisTitle },
      yAxis: valueAxis,
      series: ySeries.map((values, index): ScatterSeriesOption => ({
        symbolSize: 12,
        data: xData.map((x, valueIndex) => [x, values[valueIndex]]),
        name: plottedData.legends[index + 1],
        type: 'scatter',
      })),
    }
  }

  return null
}
