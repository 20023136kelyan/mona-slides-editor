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
})
