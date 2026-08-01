import { describe, expect, test } from 'vitest'

import { getChartOption } from '@/features/presentation-renderer/chart-options'

const data = {
  labels: ['Q1', 'Q2'],
  legends: ['Actual', 'Plan'],
  series: [[12, 18], [14, 20]],
}

describe('chart options', () => {
  test('keeps multi-series legends and chart orientation', () => {
    const column = getChartOption({ data, themeColors: ['#123'], type: 'column' })
    expect(column).toMatchObject({
      legend: { top: 'bottom' },
      xAxis: { type: 'value' },
      yAxis: { type: 'category', data: ['Q1', 'Q2'] },
      series: [
        { type: 'bar', name: 'Actual', data: [12, 18] },
        { type: 'bar', name: 'Plan', data: [14, 20] },
      ],
    })
  })

  test.each(['bar', 'column', 'line', 'area', 'pie', 'ring', 'radar', 'scatter'] as const)(
    'returns a renderable option for %s charts',
    (type) => expect(getChartOption({ data, themeColors: ['#123', '#456'], type })).not.toBeNull(),
  )

  test('renders combo-series and secondary value axes without collapsing their assignments', () => {
    const option = getChartOption({
      data,
      options: {
        seriesAxisIndexes: [0, 1],
        seriesTypes: ['column', 'line'],
        valueAxes: [
          { maximumValue: 100, minimumValue: 0, position: 'l', title: 'Revenue' },
          { maximumValue: 1, minimumValue: 0, position: 'r', title: 'Rate' },
        ],
      },
      themeColors: ['#123', '#456'],
      type: 'column',
    }) as {
      series: Array<{ type: string; yAxisIndex: number }>
      yAxis: Array<{ max: number; min: number; name: string; position: string }>
    }

    expect(option.yAxis).toMatchObject([
      { max: 100, min: 0, name: 'Revenue', position: 'left' },
      { max: 1, min: 0, name: 'Rate', position: 'right' },
    ])
    expect(option.series).toMatchObject([
      { type: 'bar', yAxisIndex: 0 },
      { type: 'line', yAxisIndex: 1 },
    ])
  })

  test('maps horizontal value-axis positions to the top and bottom ECharts axes', () => {
    const option = getChartOption({
      data,
      options: {
        seriesAxisIndexes: [0, 1],
        valueAxes: [
          { position: 'b', title: 'Bottom' },
          { position: 't', title: 'Top' },
        ],
      },
      themeColors: ['#123', '#456'],
      type: 'column',
    }) as { xAxis: Array<{ name: string; position: string }> }

    expect(option.xAxis).toMatchObject([
      { name: 'Bottom', position: 'bottom' },
      { name: 'Top', position: 'top' },
    ])
  })
})
