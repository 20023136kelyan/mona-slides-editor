import type { ChartOptions, ChartType } from '@mona/presentation-core/model'

export type ChartCategoryId = 'area' | 'bar' | 'line' | 'pie' | 'radar' | 'scatter'

export interface ChartPreset {
  /** Stable id used for i18n: foundation.editor.charts.presets.<id> */
  id: string
  chartType: ChartType
  options?: ChartOptions
  /** How many series to seed when creating this preset. */
  seriesCount?: 1 | 2 | 3
}

export interface ChartCategory {
  id: ChartCategoryId
  presets: readonly ChartPreset[]
}

/**
 * Canva-style catalog: the same 8 Mona chart engines, presented as browsable
 * visual presets (stack / series count / smooth / hole).
 */
export const CHART_CATEGORIES: readonly ChartCategory[] = [
  {
    id: 'bar',
    presets: [
      { id: 'column', chartType: 'bar', seriesCount: 1 },
      { id: 'row', chartType: 'column', seriesCount: 1 },
      { id: 'categorical-column', chartType: 'bar', seriesCount: 2 },
      { id: 'categorical-row', chartType: 'column', seriesCount: 2 },
      { id: 'stacked-column', chartType: 'bar', seriesCount: 2, options: { stack: true } },
      { id: 'stacked-row', chartType: 'column', seriesCount: 2, options: { stack: true } },
    ],
  },
  {
    id: 'line',
    presets: [
      { id: 'line', chartType: 'line', seriesCount: 1 },
      { id: 'multi-line', chartType: 'line', seriesCount: 2 },
      { id: 'smooth-line', chartType: 'line', seriesCount: 1, options: { lineSmooth: true } },
      { id: 'smooth-multi-line', chartType: 'line', seriesCount: 2, options: { lineSmooth: true } },
    ],
  },
  {
    id: 'pie',
    presets: [
      { id: 'pie', chartType: 'pie', seriesCount: 1 },
      { id: 'donut', chartType: 'ring', seriesCount: 1, options: { holeSize: 50 } },
    ],
  },
  {
    id: 'area',
    presets: [
      { id: 'area', chartType: 'area', seriesCount: 1 },
      { id: 'multi-area', chartType: 'area', seriesCount: 2 },
      { id: 'stacked-area', chartType: 'area', seriesCount: 2, options: { stack: true } },
    ],
  },
  {
    id: 'scatter',
    presets: [
      { id: 'scatter', chartType: 'scatter', seriesCount: 2 },
    ],
  },
  {
    id: 'radar',
    presets: [
      { id: 'radar', chartType: 'radar', seriesCount: 1 },
      { id: 'multi-radar', chartType: 'radar', seriesCount: 2 },
    ],
  },
]

export const ALL_CHART_PRESETS: readonly ChartPreset[] = CHART_CATEGORIES.flatMap(category => category.presets)

export const searchChartPresets = (query: string): ChartPreset[] => {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...ALL_CHART_PRESETS]
  return ALL_CHART_PRESETS.filter(preset => {
    const haystack = [
      preset.id,
      preset.chartType,
      ...Object.keys(preset.options ?? {}),
    ].join(' ').toLowerCase()
    return haystack.includes(needle) || preset.id.replaceAll('-', ' ').includes(needle)
  })
}

export const getChartCategory = (id: ChartCategoryId): ChartCategory | undefined =>
  CHART_CATEGORIES.find(category => category.id === id)
