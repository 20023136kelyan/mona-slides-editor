import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Table2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useEditorPanelSearch } from '@/features/editor/panel/editor-panel-search'
import {
  PanelBackHeader,
  PanelBody,
  PanelChrome,
  PanelHeader,
  PanelNoResults,
  PanelSectionHeader,
} from '@/features/editor/panel/EditorPanelPrimitives'
import {
  ALL_CHART_PRESETS,
  CHART_CATEGORIES,
  getChartCategory,
  searchChartPresets,
  type ChartCategoryId,
  type ChartPreset,
} from '@/features/editor/editor-chart-catalog'
import type { CreateChartElementOptions } from '@/features/editor/editor-chart'

const PREVIEW_COLORS = ['#6366f1', '#a855f7', '#eab308'] as const

type ChartsView =
  | { kind: 'home' }
  | { kind: 'category'; categoryId: ChartCategoryId }
  | { kind: 'search'; query: string }

function ChartPreviewGlyph({ preset }: { preset: ChartPreset }) {
  const series = preset.seriesCount ?? 1
  const stacked = Boolean(preset.options?.stack)
  const smooth = Boolean(preset.options?.lineSmooth)
  const type = preset.chartType

  if (type === 'pie' || type === 'ring') {
    const hole = type === 'ring' ? (preset.options?.holeSize ?? 50) : 0
    const inner = 18 * (hole / 100)
    return (
      <svg aria-hidden="true" className="size-14" viewBox="0 0 56 56">
        <circle cx="28" cy="28" fill={PREVIEW_COLORS[0]} r="18" />
        <path d="M28 10 A18 18 0 0 1 46 28 L28 28 Z" fill={PREVIEW_COLORS[1]} />
        <path d="M46 28 A18 18 0 0 1 20 44 L28 28 Z" fill={PREVIEW_COLORS[2]} />
        {inner > 0 ? <circle cx="28" cy="28" fill="var(--background, #fff)" r={inner} /> : null}
      </svg>
    )
  }

  if (type === 'radar') {
    return (
      <svg aria-hidden="true" className="size-14" viewBox="0 0 56 56">
        <polygon fill="none" points="28,12 42,22 37,40 19,40 14,22" stroke="#d4d4d8" strokeWidth="1" />
        <polygon
          fill={`${PREVIEW_COLORS[0]}33`}
          points={series > 1 ? '28,16 38,24 34,36 22,36 18,24' : '28,14 40,23 35,38 21,38 16,23'}
          stroke={PREVIEW_COLORS[0]}
          strokeWidth="1.5"
        />
        {series > 1 ? (
          <polygon fill={`${PREVIEW_COLORS[1]}33`} points="28,20 36,26 33,34 23,34 20,26" stroke={PREVIEW_COLORS[1]} strokeWidth="1.5" />
        ) : null}
      </svg>
    )
  }

  if (type === 'scatter') {
    return (
      <svg aria-hidden="true" className="size-14" viewBox="0 0 56 56">
        <line stroke="#e4e4e7" strokeWidth="1" x1="10" x2="46" y1="42" y2="42" />
        <line stroke="#e4e4e7" strokeWidth="1" x1="10" x2="10" y1="12" y2="42" />
        {[[16, 34], [22, 24], [28, 30], [34, 18], [40, 26]].map(([x, y], index) => (
          <circle cx={x} cy={y} fill={PREVIEW_COLORS[index % 2]} key={`${x}-${y}`} r="2.5" />
        ))}
      </svg>
    )
  }

  if (type === 'line' || type === 'area') {
    const paths = series > 1
      ? ['M10 36 L20 28 L30 32 L40 18 L46 22', 'M10 40 L20 34 L30 36 L40 28 L46 30']
      : ['M10 34 L20 26 L30 30 L40 16 L46 20']
    return (
      <svg aria-hidden="true" className="size-14" viewBox="0 0 56 56">
        <line stroke="#e4e4e7" strokeWidth="1" x1="10" x2="46" y1="42" y2="42" />
        <line stroke="#e4e4e7" strokeWidth="1" x1="10" x2="10" y1="12" y2="42" />
        {paths.map((d, index) => (
          <g key={d}>
            {type === 'area' ? <path d={`${d} L46 42 L10 42 Z`} fill={`${PREVIEW_COLORS[index]}44`} /> : null}
            <path
              d={d}
              fill="none"
              stroke={PREVIEW_COLORS[index]}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              style={smooth ? undefined : undefined}
            />
          </g>
        ))}
      </svg>
    )
  }

  // bar (vertical) or column (horizontal)
  const vertical = type === 'bar'
  if (vertical) {
    const groups = [[34, 24], [28, 18], [32, 22], [20, 14]]
    return (
      <svg aria-hidden="true" className="size-14" viewBox="0 0 56 56">
        <line stroke="#e4e4e7" strokeWidth="1" x1="10" x2="46" y1="42" y2="42" />
        {groups.map((heights, index) => {
          const x = 14 + index * 8
          if (stacked && series > 1) {
            const bottom = heights[0]! / 2
            const top = heights[1]! / 2
            return (
              <g key={x}>
                <rect fill={PREVIEW_COLORS[0]} height={bottom} rx="1" width="5" x={x} y={42 - bottom} />
                <rect fill={PREVIEW_COLORS[1]} height={top} rx="1" width="5" x={x} y={42 - bottom - top} />
              </g>
            )
          }
          if (series > 1) {
            return (
              <g key={x}>
                <rect fill={PREVIEW_COLORS[0]} height={heights[0]! * 0.55} rx="1" width="2.5" x={x} y={42 - heights[0]! * 0.55} />
                <rect fill={PREVIEW_COLORS[1]} height={heights[1]! * 0.55} rx="1" width="2.5" x={x + 3} y={42 - heights[1]! * 0.55} />
              </g>
            )
          }
          return <rect fill={PREVIEW_COLORS[0]} height={heights[0]} key={x} rx="1" width="5" x={x} y={42 - heights[0]!} />
        })}
      </svg>
    )
  }

  const rows = [[28, 18], [22, 14], [30, 20]]
  return (
    <svg aria-hidden="true" className="size-14" viewBox="0 0 56 56">
      <line stroke="#e4e4e7" strokeWidth="1" x1="12" x2="12" y1="12" y2="44" />
      {rows.map((widths, index) => {
        const y = 16 + index * 10
        if (stacked && series > 1) {
          return (
            <g key={y}>
              <rect fill={PREVIEW_COLORS[0]} height="5" rx="1" width={widths[0]! / 2} x="12" y={y} />
              <rect fill={PREVIEW_COLORS[1]} height="5" rx="1" width={widths[1]! / 2} x={12 + widths[0]! / 2} y={y} />
            </g>
          )
        }
        if (series > 1) {
          return (
            <g key={y}>
              <rect fill={PREVIEW_COLORS[0]} height="2.5" rx="1" width={widths[0]! * 0.7} x="12" y={y} />
              <rect fill={PREVIEW_COLORS[1]} height="2.5" rx="1" width={widths[1]! * 0.7} x="12" y={y + 3} />
            </g>
          )
        }
        return <rect fill={PREVIEW_COLORS[0]} height="5" key={y} rx="1" width={widths[0]} x="12" y={y} />
      })}
    </svg>
  )
}

function PresetCard({
  onSelect,
  preset,
}: {
  onSelect: (preset: ChartPreset) => void
  preset: ChartPreset
}) {
  const { t } = useTranslation()
  return (
    <Button
      className="flex h-auto w-[4.75rem] shrink-0 flex-col items-center gap-1 rounded-control p-1 text-center"
      onClick={() => onSelect(preset)}
      type="button"
      variant="ghost"
    >
      <span className="grid size-16 place-items-center rounded-control border border-border/70 bg-background">
        <ChartPreviewGlyph preset={preset} />
      </span>
      <span className="line-clamp-2 w-full text-tiny leading-tight text-muted-foreground">
        {t(`foundation.editor.charts.presets.${preset.id}`)}
      </span>
    </Button>
  )
}

function PresetStrip({
  onSelect,
  presets,
}: {
  onSelect: (preset: ChartPreset) => void
  presets: readonly ChartPreset[]
}) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-1 [scrollbar-width:thin]">
      {presets.map(preset => (
        <PresetCard key={preset.id} onSelect={onSelect} preset={preset} />
      ))}
    </div>
  )
}

function PresetGrid({
  onSelect,
  presets,
}: {
  onSelect: (preset: ChartPreset) => void
  presets: readonly ChartPreset[]
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {presets.map(preset => (
        <PresetCard key={preset.id} onSelect={onSelect} preset={preset} />
      ))}
    </div>
  )
}

export function EditorChartsPanel({
  onInsertChart,
}: {
  onInsertChart: (spec: CreateChartElementOptions & { openDataEditor?: boolean }) => void
}) {
  const { t } = useTranslation()
  const [browseView, setBrowseView] = useState<ChartsView>({ kind: 'home' })
  const search = useEditorPanelSearch()

  // The committed term *is* the search view rather than something copied into
  // local state after the fact — derive it and the two cannot disagree.
  const submitted = search.submitted.trim()
  // useMemo, not a bare ternary: a fresh object every render would defeat the
  // memoised result lists downstream.
  const view = useMemo<ChartsView>(() => (submitted ? { kind: 'search', query: submitted } : browseView), [browseView, submitted])

  const categoryLabel = (id: ChartCategoryId) => t(`foundation.editor.charts.categories.${id}`)
  const selectPreset = (preset: ChartPreset) => {
    onInsertChart({
      chartType: preset.chartType,
      options: preset.options,
      seriesCount: preset.seriesCount,
    })
  }

  const searchResults = useMemo(() => {
    if (view.kind !== 'search') return []
    const byId = searchChartPresets(view.query)
    // Also match translated labels.
    const needle = view.query.trim().toLowerCase()
    if (!needle) return [...ALL_CHART_PRESETS]
    const labeled = ALL_CHART_PRESETS.filter(preset =>
      t(`foundation.editor.charts.presets.${preset.id}`).toLowerCase().includes(needle)
      || categoryLabel(
        CHART_CATEGORIES.find(category => category.presets.some(item => item.id === preset.id))?.id ?? 'bar',
      ).toLowerCase().includes(needle))
    const ids = new Set(byId.map(preset => preset.id))
    return [...byId, ...labeled.filter(preset => !ids.has(preset.id))]
  }, [t, view])

  if (view.kind === 'category' || view.kind === 'search') {
    const title = view.kind === 'search'
      ? view.query
      : categoryLabel(view.categoryId)
    const presets = view.kind === 'search'
      ? searchResults
      : (getChartCategory(view.categoryId)?.presets ?? [])

    return (
      <PanelChrome className="mona-charts-panel">
        <PanelBackHeader
          label={t('foundation.editor.charts.back')}
          onBack={() => {
            setBrowseView({ kind: 'home' })
            search.clear()
          }}
          title={title}
        />
        <PanelBody>
          {presets.length ? (
            <PresetGrid onSelect={selectPreset} presets={presets} />
          ) : (
            <PanelNoResults onClear={search.clear} query={view.kind === 'search' ? view.query : ''} />
          )}
        </PanelBody>
      </PanelChrome>
    )
  }

  return (
    <PanelChrome className="mona-charts-panel">
      <PanelHeader>
        <Button
          className="h-9 w-full justify-start gap-2 rounded-action"
          onClick={() => onInsertChart({ chartType: 'bar', seriesCount: 2, openDataEditor: true })}
          type="button"
          variant="outline"
        >
          <Table2 className="size-4" />
          {t('foundation.editor.charts.startWithData')}
        </Button>
      </PanelHeader>

      <PanelBody className="space-y-5 overflow-x-hidden">
        {CHART_CATEGORIES.map(category => (
          <section className="shrink-0" key={category.id}>
            <PanelSectionHeader
              onSeeAll={category.presets.length > 3 ? () => setBrowseView({ kind: 'category', categoryId: category.id }) : undefined}
              title={categoryLabel(category.id)}
            />
            <PresetStrip onSelect={selectPreset} presets={category.presets} />
          </section>
        ))}
      </PanelBody>
    </PanelChrome>
  )
}
