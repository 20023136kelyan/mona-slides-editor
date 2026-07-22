import { useEffect, useRef } from 'react'
import tinycolor from 'tinycolor2'

import { BarChart, LineChart, PieChart, RadarChart, ScatterChart } from 'echarts/charts'
import { LegendComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'

import type { PPTChartElement } from '@mona/presentation-core/model'

import { getChartOption } from '@/features/presentation-renderer/chart-options'
import { ElementOutline } from '@/features/presentation-renderer/elements/ElementOutline'

echarts.use([BarChart, LineChart, PieChart, RadarChart, ScatterChart, LegendComponent, SVGRenderer])

function getThemeColors(colors: string[]): string[] {
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

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const option = getChartOption({
      type: element.chartType,
      data: element.data,
      themeColors: getThemeColors(element.themeColors),
      textColor: element.textColor,
      lineColor: element.lineColor,
      lineSmooth: element.options?.lineSmooth || false,
      stack: element.options?.stack || false,
    })
    if (option) chart.setOption(option, true)
  }, [element])

  return <div className="mona-chart" data-chart-ready ref={containerRef} />
}

export function ChartElement({ element }: { element: PPTChartElement }) {
  return (
    <div
      className="mona-element mona-chart-element"
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
