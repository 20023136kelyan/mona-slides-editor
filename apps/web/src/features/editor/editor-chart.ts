import type { ChartData, ChartType, PPTChartElement, SlideTheme } from '@mona/presentation-core/model'
import { createPresentationId } from '@mona/presentation-core'

export const CHART_TYPES: readonly ChartType[] = ['bar', 'column', 'line', 'area', 'scatter', 'pie', 'ring', 'radar']

export const CHART_PRESET_THEMES: readonly (readonly string[])[] = [
  ['#d87c7c', '#919e8b', '#d7ab82', '#6e7074', '#61a0a8', '#efa18d'],
  ['#dd6b66', '#759aa0', '#e69d87', '#8dc1a9', '#ea7e53', '#eedd78'],
  ['#516b91', '#59c4e6', '#edafda', '#93b7e3', '#a5e7f0', '#cbb0e3'],
  ['#893448', '#d95850', '#eb8146', '#ffb248', '#f2d643', '#ebdba4'],
  ['#4ea397', '#22c3aa', '#7bd9a5', '#d0648a', '#f58db2', '#f2b3c9'],
  ['#3fb1e3', '#6be6c1', '#626c91', '#a0a7e6', '#c4ebad', '#96dee8'],
  ['#fc97af', '#87f7cf', '#f7f494', '#72ccff', '#f7c5a0', '#d4a4eb'],
  ['#c1232b', '#27727b', '#fcce10', '#e87c25', '#b5c334', '#fe8463'],
  ['#2ec7c9', '#b6a2de', '#5ab1ef', '#ffb980', '#d87a80', '#8d98b3'],
  ['#e01f54', '#001852', '#f5e8c8', '#b8d2c7', '#c6b38e', '#a4d8c2'],
  ['#c12e34', '#e6b600', '#0098d9', '#2b821d', '#005eaa', '#339ca8'],
  ['#8a7ca8', '#e098c7', '#8fd3e8', '#71669e', '#cc70af', '#7cb4cc'],
]

export interface ChartDataTranslations {
  category: (number: number) => string
  coordinate: (number: number) => string
  series: (number: number) => string
  value: string
}

export function getChartDefaultData(type: ChartType, translations: ChartDataTranslations): ChartData {
  const label = type === 'scatter' ? translations.coordinate : translations.category
  const labels = Array.from({ length: 5 }, (_, index) => label(index + 1))
  const singleSeries = type === 'pie' || type === 'ring'
  return {
    labels,
    legends: singleSeries
      ? [translations.value]
      : [translations.series(1), translations.series(2)],
    series: singleSeries
      ? [[12, 19, 5, 2, 18]]
      : [[12, 19, 5, 2, 18], [7, 11, 13, 21, 9]],
  }
}

export function createChartElement(type: ChartType, theme: SlideTheme, translations: ChartDataTranslations): PPTChartElement {
  return {
    type: 'chart',
    id: createPresentationId(10),
    chartType: type,
    left: 300,
    top: 81.25,
    width: 400,
    height: 400,
    rotate: 0,
    themeColors: [...theme.themeColors],
    textColor: theme.fontColor,
    data: getChartDefaultData(type, translations),
  }
}
