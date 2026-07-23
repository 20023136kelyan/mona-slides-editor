import { useEffect, useRef } from 'react'
import tinycolor from 'tinycolor2'

import { BarChart, LineChart, PieChart, RadarChart, ScatterChart } from 'echarts/charts'
import { GridComponent, LegendComponent, RadarComponent, TitleComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'

import type { PPTChartElement } from '@mona/presentation-core/model'

import { getChartOption } from '@/features/presentation-renderer/chart-options'
import { ElementOutline } from '@/features/presentation-renderer/elements/ElementOutline'

echarts.use([
  BarChart,
  GridComponent,
  LegendComponent,
  LineChart,
  PieChart,
  RadarChart,
  RadarComponent,
  ScatterChart,
  SVGRenderer,
  TitleComponent,
  TooltipComponent,
])

function getThemeColors(colors: string[]): string[] {
  if (!colors.length) return ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272']
  if (colors.length >= 10) return colors
  if (colors.length === 1) return tinycolor(colors[0]).analogous(10).map(color => color.toRgbString())
  const supplement = tinycolor(colors[colors.length - 1]).analogous(11 - colors.length).map(color => color.toRgbString())
  return [...colors.slice(0, colors.length - 1), ...supplement]
}

function ChartCanvas({ element }: { element: PPTChartElement }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined
    const chart = echarts.init(container, null, { renderer: 'svg' })
    chartRef.current = chart
    const resizeObserver = new ResizeObserver(() => chart.resize())
    resizeObserver.observe(container)
    return () => {
      resizeObserver.disconnect()
      chartRef.current = null
      chart.dispose()
    }
  }, [])

  const chartType = element.chartType
  const data = element.data
  const themeColors = element.themeColors
  const textColor = element.textColor
  const lineColor = element.lineColor
  const options = element.options
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const option = getChartOption({
      type: chartType,
      data,
      themeColors: getThemeColors(themeColors),
      textColor,
      lineColor,
      options,
    })
    if (option) chart.setOption({ ...option, animation: false }, true)
  }, [chartType, data, themeColors, textColor, lineColor, options])

  return <div className="mona-chart" data-chart-ready ref={containerRef} />
}

export function ChartElement({ element, thumbnail = false }: { element: PPTChartElement; thumbnail?: boolean }) {
  return (
    <div
      className={`mona-element mona-chart-element${thumbnail ? ' is-thumbnail' : ''}`}
      data-element-id={element.id}
      data-element-type="chart"
      style={{ top: element.top, left: element.left, width: element.width, height: element.height }}
    >
      <div className="mona-rotate-wrapper" style={{ transform: `rotate(${element.rotate}deg)` }}>
        <div className="mona-chart-content" style={{ backgroundColor: element.fill }}>
          <ElementOutline height={element.height} outline={element.outline} width={element.width} />
          <ChartCanvas element={element} />
        </div>
      </div>
    </div>
  )
}
