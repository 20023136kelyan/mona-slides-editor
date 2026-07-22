import type {
  BarSeriesOption,
  LineSeriesOption,
  PieSeriesOption,
  RadarSeriesOption,
  ScatterSeriesOption,
} from 'echarts/charts'
import type { ComposeOption } from 'echarts/core'

import type { ChartData, ChartType } from '@mona/presentation-core/model'

type ChartOption = ComposeOption<BarSeriesOption | LineSeriesOption | PieSeriesOption | RadarSeriesOption | ScatterSeriesOption>

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
  lineSmooth?: boolean
  stack?: boolean
  textColor?: string
  themeColors: string[]
  type: ChartType
}

export function getChartOption({
  data,
  lineColor,
  lineSmooth,
  stack,
  textColor,
  themeColors,
  type,
}: ChartOptionInput): ChartOption | null {
  const textStyle = textColor ? { color: textColor } : {}
  const axisLine = textColor ? { lineStyle: { color: textColor } } : undefined
  const axisLabel = textColor ? { color: textColor } : undefined
  const splitLine = lineColor ? { lineStyle: { color: lineColor } } : {}
  const legend = data.series.length > 1 ? { top: 'bottom' as const, textStyle } : undefined

  if (type === 'bar' || type === 'column') {
    const categoricalAxis = { type: 'category' as const, data: data.labels, axisLine, axisLabel }
    const valueAxis = { type: 'value' as const, axisLine, axisLabel, splitLine }
    return {
      color: themeColors,
      textStyle,
      legend,
      xAxis: type === 'bar' ? categoricalAxis : valueAxis,
      yAxis: type === 'bar' ? valueAxis : categoricalAxis,
      series: data.series.map((values, index) => {
        const series: BarSeriesOption = {
          data: values,
          name: data.legends[index],
          type: 'bar',
          label: { show: true },
          itemStyle: { borderRadius: type === 'bar' ? [2, 2, 0, 0] : [0, 2, 2, 0] },
        }
        if (stack) series.stack = 'A'
        return series
      }),
    }
  }

  if (type === 'line') {
    return {
      color: themeColors,
      textStyle,
      legend,
      xAxis: { type: 'category', data: data.labels, axisLine, axisLabel },
      yAxis: { type: 'value', axisLine, axisLabel, splitLine },
      series: data.series.map((values, index) => {
        const series: LineSeriesOption = {
          data: values,
          name: data.legends[index],
          type: 'line',
          smooth: lineSmooth,
          label: { show: true },
        }
        if (stack) series.stack = 'A'
        return series
      }),
    }
  }

  if (type === 'area') {
    return {
      color: themeColors,
      textStyle,
      legend,
      xAxis: { type: 'category', boundaryGap: false, data: data.labels, axisLine, axisLabel },
      yAxis: { type: 'value', axisLine, axisLabel, splitLine },
      series: data.series.map((values, index) => {
        const series: LineSeriesOption = {
          data: values,
          name: data.legends[index],
          type: 'line',
          areaStyle: {},
          label: { show: true },
        }
        if (stack) series.stack = 'A'
        return series
      }),
    }
  }

  if (type === 'pie' || type === 'ring') {
    const series: PieSeriesOption = {
      data: (data.series[0] || []).map((value, index) => ({ value, name: data.labels[index] })),
      label: textColor ? { color: textColor } : {},
      type: 'pie',
      radius: type === 'ring' ? ['40%', '70%'] : '70%',
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
      legend: { top: 'bottom', textStyle },
      series: [series],
    }
  }

  if (type === 'radar') {
    const { max, splitNumber } = getRadarScale(Math.max(...data.series.flat()))
    return {
      color: themeColors,
      textStyle,
      legend,
      radar: {
        splitNumber,
        indicator: data.labels.map(name => ({ name, max })),
        splitLine,
        axisLine: lineColor ? { lineStyle: { color: lineColor } } : undefined,
      },
      series: [{ data: data.series.map((value, index) => ({ value, name: data.legends[index] })), type: 'radar' }],
    }
  }

  if (type === 'scatter') {
    const xData = data.series[0] || []
    const ySeries = data.series.length > 1 ? data.series.slice(1) : [xData]
    return {
      color: themeColors,
      textStyle,
      legend: data.series.length > 2 ? { top: 'bottom', textStyle } : undefined,
      xAxis: { axisLine, axisLabel, splitLine },
      yAxis: { axisLine, axisLabel, splitLine },
      series: ySeries.map((values, index): ScatterSeriesOption => ({
        symbolSize: 12,
        data: xData.map((x, valueIndex) => [x, values[valueIndex]]),
        name: data.legends[index + 1],
        type: 'scatter',
      })),
    }
  }

  return null
}
