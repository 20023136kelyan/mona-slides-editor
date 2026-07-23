/* oxlint-disable jsx-a11y/prefer-tag-over-role -- the shadcn Sidebar primitives render divs; landmark roles are applied explicitly on them. */
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { LayoutTemplate, X } from 'lucide-react'

import ChartIcon from '~icons/icon-park-outline/chart-proportion'
import ChartHistogramIcon from '~icons/icon-park-outline/chart-histogram'
import ChartHistogramOneIcon from '~icons/icon-park-outline/chart-histogram-one'
import ChartLineIcon from '~icons/icon-park-outline/chart-line'
import ChartLineAreaIcon from '~icons/icon-park-outline/chart-line-area'
import ChartPieIcon from '~icons/icon-park-outline/chart-pie'
import ChartRingIcon from '~icons/icon-park-outline/chart-ring'
import ChartScatterIcon from '~icons/icon-park-outline/chart-scatter'
import ConnectionIcon from '~icons/icon-park-outline/connection'
import FormulaIcon from '~icons/icon-park-outline/formula'
import LeftChevronIcon from '~icons/icon-park-outline/left'
import GraphicDesignIcon from '~icons/icon-park-outline/graphic-design'
import InsertTableIcon from '~icons/icon-park-outline/insert-table'
import PictureIcon from '~icons/icon-park-outline/picture'
import RadarChartIcon from '~icons/icon-park-outline/radar-chart'
import SymbolIcon from '~icons/icon-park-outline/symbol'
import TextRotationDownIcon from '~icons/icon-park-outline/text-rotation-down'
import TextRotationNoneIcon from '~icons/icon-park-outline/text-rotation-none'
import UploadIcon from '~icons/icon-park-outline/upload'
import WritingIcon from '~icons/icon-park-outline/writing-fluently'
import { LINE_LIST, SHAPE_LIST, type LinePoolItem, type ShapePoolItem } from '@mona/presentation-core'
import { SYMBOL_LIST } from '@mona/presentation-core/symbol-presets'
import type { ChartType, Slide, SlideTheme } from '@mona/presentation-core/model'

import { Button } from '@/components/ui/button'
import { Sidebar, SidebarContent, SidebarHeader } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { LinePointMarker } from '@/features/editor/ElementStyleCommons'
import { EditorImageLibrary } from '@/features/editor/EditorImageLibrary'
import { EditorMediaInput } from '@/features/editor/EditorMediaInput'
import { EditorTableGenerator } from '@/features/editor/EditorTableGenerator'
import { CHART_TYPES } from '@/features/editor/editor-chart'
import type { EditorCreateTool } from '@/features/editor/editor-create-tool'
import type { EditorTaskPanelRoute } from '@/features/editor/shell/editor-shell'
import { useEdgeFade } from '@/features/editor/use-edge-fade'
import { ScaledSlide } from '@/features/presentation-renderer/ScaledSlide'

export type EditorRailPanel = EditorTaskPanelRoute

const EMOJI_TYPES = ['face', 'gesture', 'nature', 'food', 'travel', 'activity', 'object', 'symbol'] as const

function ShapeThumbnail({ category, index, onSelect, shape }: {
  category: string
  index: number
  onSelect: () => void
  shape: ShapePoolItem
}) {
  return (
    <Button aria-label={shape.title || `${category} shape ${index + 1}`} className="mona-canvas-shape-item" onClick={onSelect} size="editor-icon" type="button" variant="ghost">
      <svg height="18" overflow="visible" width="18">
        <g transform={`scale(${18 / shape.viewBox[0]}, ${18 / shape.viewBox[1]}) translate(0,0) matrix(1,0,0,1,0,0)`}>
          <path
            className={shape.outlined ? 'is-outlined' : ''}
            d={shape.path}
            fill={shape.outlined ? '#999' : 'transparent'}
            stroke={shape.outlined ? 'transparent' : '#999'}
            strokeLinecap="butt"
            strokeMiterlimit="8"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </svg>
    </Button>
  )
}

function ShapePool({ onSelect }: { onSelect: (shape: ShapePoolItem) => void }) {
  const { t } = useTranslation()
  return (
    <div className="mona-canvas-shape-pool">
      {SHAPE_LIST.map(category => (
        <section className="mona-canvas-pool-category" key={category.type}>
          <div className="mona-canvas-pool-category-name">{t(`foundation.editor.canvasTool.shapeGroups.${category.type}`)}</div>
          <div className="mona-canvas-shape-list">
            {category.children.map((shape, index) => (
              <ShapeThumbnail category={category.type} index={index} key={`${category.type}-${index}`} onSelect={() => onSelect(shape)} shape={shape} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function LinePool({ onSelect }: { onSelect: (line: LinePoolItem) => void }) {
  const { t } = useTranslation()
  return (
    <div className="mona-canvas-line-pool">
      {LINE_LIST.map((category, categoryIndex) => (
        <section className="mona-canvas-pool-category" key={category.type}>
          <div className="mona-canvas-pool-category-name">{t(`foundation.editor.canvasTool.lineGroups.${category.type}`)}</div>
          <div className="mona-canvas-line-list">
            {category.children.map((line, index) => {
              const id = `mona-create-line-${categoryIndex}-${index}`
              return (
                <Button aria-label={`${category.type} line ${index + 1}`} className="mona-canvas-line-item" key={id} onClick={() => onSelect(line)} size="editor-icon" type="button" variant="ghost">
                  <svg height="20" overflow="visible" width="20">
                    <defs>
                      {line.points[0] ? <LinePointMarker baseSize={2} color="currentColor" id={id} position="start" preview type={line.points[0]} /> : null}
                      {line.points[1] ? <LinePointMarker baseSize={2} color="currentColor" id={id} position="end" preview type={line.points[1]} /> : null}
                    </defs>
                    <path
                      d={line.path}
                      fill="none"
                      markerEnd={line.points[1] ? `url(#${id}-${line.points[1]}-end)` : undefined}
                      markerStart={line.points[0] ? `url(#${id}-${line.points[0]}-start)` : undefined}
                      stroke="currentColor"
                      strokeDasharray={line.style === 'solid' ? '0, 0' : '4, 1'}
                      strokeWidth="2"
                    />
                  </svg>
                </Button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

function ChartPool({ onSelect }: { onSelect: (chart: ChartType) => void }) {
  const { t } = useTranslation()
  const icon = (type: ChartType) => {
    if (type === 'line') return <ChartLineIcon />
    if (type === 'bar') return <ChartHistogramIcon />
    if (type === 'pie') return <ChartPieIcon />
    if (type === 'column') return <ChartHistogramOneIcon />
    if (type === 'area') return <ChartLineAreaIcon />
    if (type === 'ring') return <ChartRingIcon />
    if (type === 'scatter') return <ChartScatterIcon />
    return <RadarChartIcon />
  }
  return (
    <ul className="mona-chart-pool">
      {CHART_TYPES.map(type => (
        <li className="mona-chart-pool-item" key={type}>
          <Button className="mona-chart-pool-content" onClick={() => onSelect(type)} size="editor" type="button" variant="ghost">
            <span className="mona-chart-pool-icon">{icon(type)}</span>
            <span className="mona-chart-pool-name">{t(`foundation.editor.chartTypes.${type}`)}</span>
          </Button>
        </li>
      ))}
    </ul>
  )
}

function SymbolPool({ onSelect }: { onSelect: (value: string) => void }) {
  const { t } = useTranslation()
  const [selectedSymbolKey, setSelectedSymbolKey] = useState(SYMBOL_LIST[0]!.key)
  const [selectedEmojiTypeIndex, setSelectedEmojiTypeIndex] = useState(0)
  const poolRef = useRef<HTMLDivElement>(null)
  const selectedSymbol = SYMBOL_LIST.find(item => item.key === selectedSymbolKey) || SYMBOL_LIST[0]!
  const symbolPool: readonly (readonly string[])[] = selectedSymbol.key === 'emoji'
    ? [selectedSymbol.children[selectedEmojiTypeIndex] || []]
    : selectedSymbol.children

  useEffect(() => {
    poolRef.current?.scrollTo(0, 0)
  }, [selectedEmojiTypeIndex, selectedSymbolKey])

  return (
    <div className="mona-drawer-symbols">
      <ToggleGroup className="mona-symbol-tabs" onValueChange={value => {
        if (value) setSelectedSymbolKey(value)
      }} spacing={0} type="single" value={selectedSymbolKey}>
        {SYMBOL_LIST.map(item => <ToggleGroupItem key={item.key} value={item.key}>{t('foundation.editor.symbolPanel.tabs.' + item.key)}</ToggleGroupItem>)}
      </ToggleGroup>
      {selectedSymbolKey === 'emoji' ? (
        <ToggleGroup className="mona-symbol-emoji-types" onValueChange={value => {
          if (value) setSelectedEmojiTypeIndex(Number(value))
        }} spacing={1} type="single" value={String(selectedEmojiTypeIndex)}>
          {EMOJI_TYPES.map((type, index) => <ToggleGroupItem key={type} value={String(index)}>{t('foundation.editor.symbolPanel.categories.' + type)}</ToggleGroupItem>)}
        </ToggleGroup>
      ) : null}
      <div className="mona-symbol-pool" ref={poolRef}>
        {symbolPool.map((group, groupIndex) => (
          <div className="mona-symbol-group" key={groupIndex}>
            {group.map((item, index) => (
              <Button
                className="mona-symbol-item"
                key={item + '-' + index}
                onClick={() => onSelect(item)}
                onMouseDown={event => event.preventDefault()}
                size="editor-icon"
                type="button"
                variant="ghost"
              >
                <span>{item}</span>
              </Button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

interface TemplatePayload {
  slides: Slide[]
  theme?: Partial<SlideTheme>
}

// One fetch per catalog for the whole session: the cover cards and the
// detail view share the same cached payload.
const templatePayloadCache = new Map<string, Promise<TemplatePayload>>()
function loadTemplatePayload(id: string) {
  let cached = templatePayloadCache.get(id)
  if (!cached) {
    cached = fetch(`/mocks/${id}.json`).then(async response => {
      if (!response.ok) throw new Error(`Template request failed: ${response.status}`)
      return response.json() as Promise<TemplatePayload>
    })
    cached.catch(() => templatePayloadCache.delete(id))
    templatePayloadCache.set(id, cached)
  }
  return cached
}

function useTemplatePayload(id: string) {
  const [payload, setPayload] = useState<TemplatePayload | null>(null)
  useEffect(() => {
    let active = true
    loadTemplatePayload(id)
      .then(data => {
        if (active) setPayload(data)
      })
      .catch(() => {
        if (active) setPayload({ slides: [] })
      })
    return () => {
      active = false
    }
  }, [id])
  return payload
}

function TemplateCoverCard({ id, name, onOpen, theme }: {
  id: string
  name: string
  onOpen: () => void
  theme?: SlideTheme
}) {
  const payload = useTemplatePayload(id)
  // Always lead with the template's cover page (first page as fallback).
  const cover = payload?.slides.find(slide => slide.type === 'cover') ?? payload?.slides[0]
  return (
    <Button aria-label={name} className="mona-template-card" onClick={onOpen} size="editor" title={name} type="button" variant="ghost">
      {cover ? (
        <ScaledSlide fixedWidth={128} slide={cover} theme={{ ...theme!, ...payload?.theme }} thumbnail viewportRatio={0.5625} viewportSize={1000} />
      ) : (
        <Skeleton className="mona-template-card-skeleton" />
      )}
    </Button>
  )
}

function TemplateDetail({ id, name, onBack, onInsertAll, onInsertOne, theme }: {
  id: string
  name: string
  onBack: () => void
  onInsertAll: (payload: TemplatePayload) => void
  onInsertOne: (slide: Slide) => void
  theme?: SlideTheme
}) {
  const { t } = useTranslation()
  const payload = useTemplatePayload(id)
  return (
    <div className="mona-template-detail">
      <div className="mona-template-detail-head">
        <Button aria-label={t('foundation.editor.templates.back')} className="mona-template-back" onClick={onBack} size="editor-icon" type="button" variant="ghost"><LeftChevronIcon /></Button>
      </div>
      <div className="mona-template-detail-title">{name}</div>
      <div className="mona-template-detail-meta">{t('foundation.editor.templates.meta', { count: payload?.slides.length ?? 0 })}</div>
      {payload ? (
        <>
          <Button className="mona-template-apply" onClick={() => onInsertAll(payload)} size="sm" type="button" variant="outline">
            {t('foundation.editor.templates.applyAll', { count: payload.slides.length })}
          </Button>
          <div className="mona-template-pages">
            {payload.slides.map((slide, index) => (
              <Button aria-label={`${t('foundation.editor.templates.insertTemplate')} ${index + 1}`} className="mona-template-page" key={slide.id} onClick={() => onInsertOne(slide)} size="editor" type="button" variant="ghost">
                <ScaledSlide fixedWidth={128} slide={slide} theme={{ ...theme!, ...payload.theme }} thumbnail viewportRatio={0.5625} viewportSize={1000} />
              </Button>
            ))}
          </div>
        </>
      ) : (
        <Skeleton className="mona-template-card-skeleton" />
      )}
    </div>
  )
}

function TemplatePanel({ onInsertAll, onInsertOne, templates, theme }: {
  onInsertAll: (payload: TemplatePayload) => void
  onInsertOne: (slide: Slide) => void
  templates: readonly { id: string }[]
  theme?: SlideTheme
}) {
  const { t } = useTranslation()
  const [openCatalog, setOpenCatalog] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const filteredTemplates = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return templates
    return templates.filter(template => t(`foundation.editor.templates.catalog.${template.id}`).toLocaleLowerCase().includes(normalized))
  }, [query, t, templates])

  if (openCatalog) {
    return (
      <TemplateDetail
        id={openCatalog}
        name={t(`foundation.editor.templates.catalog.${openCatalog}`)}
        onBack={() => setOpenCatalog(null)}
        onInsertAll={onInsertAll}
        onInsertOne={onInsertOne}
        theme={theme}
      />
    )
  }

  return (
    <div className="mona-templates">
      <div className="mona-template-toolbar">
        <div className="mona-template-searchbox">
          <LayoutTemplate aria-hidden="true" />
          <input
            aria-label={t('foundation.editor.templates.searchPlaceholder')}
            className="mona-template-search-input"
            onChange={event => setQuery(event.target.value)}
            placeholder={t('foundation.editor.templates.searchPlaceholder')}
            type="search"
            value={query}
          />
        </div>
      </div>
      <div className="mona-template-grid">
        {filteredTemplates.map(template => (
          <TemplateCoverCard
            id={template.id}
            key={template.id}
            name={t(`foundation.editor.templates.catalog.${template.id}`)}
            onOpen={() => setOpenCatalog(template.id)}
            theme={theme}
          />
        ))}
        {!filteredTemplates.length ? <p className="mona-template-empty">{t('foundation.editor.templates.noResults')}</p> : null}
      </div>
    </div>
  )
}

function DrawerAction({ children, icon, onClick }: { children: ReactNode; icon: ReactNode; onClick: () => void }) {
  return (
    <Button
      className="mona-drawer-action h-[34px] w-full justify-start gap-2 px-2.5 text-[13px]"
      onClick={onClick}
      size="editor"
      type="button"
      variant="outline"
    >
      <span className="mona-drawer-action-icon flex text-base [&_svg]:size-[1em]">{icon}</span>
      <span className="mona-drawer-action-label">{children}</span>
    </Button>
  )
}

const drawerStackClassName = 'mona-drawer-stack flex flex-col gap-2'
const drawerHintClassName = 'mona-drawer-hint mx-0.5 mt-0.5 text-xs leading-normal text-muted-foreground'
const drawerActionGridClassName = 'mona-drawer-action-grid grid grid-cols-2 gap-2 [&_.mona-drawer-action]:min-w-0 [&_.mona-drawer-action]:justify-start'
const contextualDrawerHeaderClassName = 'mona-contextual-drawer-header flex min-h-10 shrink-0 items-center gap-1.5 border-b border-border pr-2 [&_.mona-inspector-tabs-header]:min-w-0 [&_.mona-inspector-tabs-header]:flex-1 [&_.mona-inspector-tabs-header]:border-b-0'

export function EditorRailDrawer({
  activePanel,
  children,
  contextualHeader,
  contextualOpen,
  onClose,
  onCreateToolChange,
  onDrawCustomShape,
  onInsertAudio,
  onInsertChart,
  onInsertImage,
  onInsertImageSource,
  onInsertSymbol,
  onInsertTable,
  onInsertTemplateAll,
  onInsertTemplateOne,
  onInsertVideo,
  onOpenLatexEditor,
  onOpenPathEditor,
  panelTitle,
  secondaryContent,
  templates,
  theme,
}: {
  activePanel: EditorRailPanel | null
  children: ReactNode
  contextualHeader: ReactNode
  contextualOpen: boolean
  onClose: () => void
  onCreateToolChange: (tool: EditorCreateTool | null) => void
  onDrawCustomShape: () => void
  onInsertAudio: (payload: { ext?: string; src: string }) => void
  onInsertChart: (type: ChartType) => void
  onInsertImage: (file: File) => void
  onInsertImageSource: (src: string) => void
  onInsertSymbol: (value: string) => void
  onInsertTable: (rows: number, columns: number) => void
  onInsertTemplateAll: (slides: Slide[], theme: Partial<SlideTheme>) => void
  onInsertTemplateOne: (slide: Slide) => void
  onInsertVideo: (payload: { ext?: string; src: string }) => void
  onOpenLatexEditor: () => void
  onOpenPathEditor: () => void
  panelTitle: string
  secondaryContent: ReactNode
  templates: readonly { id: string }[]
  theme: SlideTheme
}) {
  const { t } = useTranslation()
  const imageInputRef = useRef<HTMLInputElement>(null)
  const poolScrollRef = useRef<HTMLDivElement>(null)
  const [elementCategory, setElementCategory] = useState<'charts' | 'equations' | 'lines' | 'shapes' | 'symbols' | 'tables'>('shapes')
  const [uploadState, setUploadState] = useState<{
    route: EditorRailPanel | null
    view: 'library' | 'main'
  }>({ route: null, view: 'main' })
  const uploadView = uploadState.route === activePanel ? uploadState.view : 'main'
  // Fade the top/bottom edge wherever pool content is cut off.
  useEdgeFade(poolScrollRef, 'y', activePanel)

  const selectImageFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) onInsertImage(file)
  }

  if (!activePanel && !contextualOpen) return null

  return (
    <Sidebar
      aria-label={activePanel && panelTitle ? panelTitle : t('foundation.editor.inspector')}
      className="mona-editor-drawer w-72 shrink-0 overflow-hidden border-r border-sidebar-border"
      collapsible="none"
      onKeyDown={event => {
        if (event.key !== 'Escape' || event.defaultPrevented) return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      role="complementary"
      side="left"
    >
      {activePanel ? (
        <>
          {/* Extension header, from the block: title + close, border-b px-4. */}
          <SidebarHeader className="flex flex-row items-center justify-between border-b border-sidebar-border px-4">
            <h3 className="font-medium">{panelTitle}</h3>
            <Button aria-label={t('foundation.editor.rail.collapse')} className="size-6 rounded-md hover:bg-sidebar-accent" onClick={onClose} size="icon-xs" type="button" variant="ghost">
              <X className="h-4 w-4" />
            </Button>
          </SidebarHeader>
          <SidebarContent
            className="mona-inspector-content mona-drawer-content block min-h-0 has-[.mona-image-library-panel]:flex has-[.mona-image-library-panel]:overflow-hidden has-[.mona-image-library-panel]:p-0"
            ref={poolScrollRef}
          >
            {activePanel === 'design' ? (
              <TemplatePanel
                onInsertAll={payload => onInsertTemplateAll(payload.slides, payload.theme ?? {})}
                onInsertOne={onInsertTemplateOne}
                templates={templates}
                theme={theme}
              />
            ) : null}
            {activePanel === 'text' ? (
              <div className={drawerStackClassName}>
                <DrawerAction icon={<TextRotationNoneIcon />} onClick={() => onCreateToolChange({ type: 'text', key: 'text', vertical: false })}>{t('foundation.editor.canvasTool.horizontalText')}</DrawerAction>
                <DrawerAction icon={<TextRotationDownIcon />} onClick={() => onCreateToolChange({ type: 'text', key: 'text', vertical: true })}>{t('foundation.editor.canvasTool.verticalText')}</DrawerAction>
                <p className={drawerHintClassName}>{t('foundation.editor.canvasTool.textHint')}</p>
              </div>
            ) : null}
            {activePanel === 'elements' ? (
              <div className={drawerStackClassName}>
                <ToggleGroup
                  aria-label={t('foundation.editor.rail.elementCategories')}
                  className="mona-element-category-tabs"
                  onValueChange={value => {
                    if (value) setElementCategory(value as typeof elementCategory)
                  }}
                  spacing={1}
                  type="single"
                  value={elementCategory}
                >
                  <ToggleGroupItem aria-label={t('foundation.editor.canvasTool.shape')} value="shapes"><GraphicDesignIcon />{t('foundation.editor.canvasTool.shape')}</ToggleGroupItem>
                  <ToggleGroupItem aria-label={t('foundation.editor.canvasTool.line')} value="lines"><ConnectionIcon />{t('foundation.editor.canvasTool.line')}</ToggleGroupItem>
                  <ToggleGroupItem aria-label={t('foundation.editor.canvasTool.chart')} value="charts"><ChartIcon />{t('foundation.editor.canvasTool.chart')}</ToggleGroupItem>
                  <ToggleGroupItem aria-label={t('foundation.editor.canvasTool.table')} value="tables"><InsertTableIcon />{t('foundation.editor.canvasTool.table')}</ToggleGroupItem>
                  <ToggleGroupItem aria-label={t('foundation.editor.canvasTool.symbol')} value="symbols"><SymbolIcon />{t('foundation.editor.canvasTool.symbol')}</ToggleGroupItem>
                  <ToggleGroupItem aria-label={t('foundation.editor.canvasTool.equation')} value="equations"><FormulaIcon />{t('foundation.editor.canvasTool.equation')}</ToggleGroupItem>
                </ToggleGroup>
                {elementCategory === 'shapes' ? (
                  <>
                    <div className={drawerActionGridClassName}>
                      <DrawerAction icon={<ConnectionIcon />} onClick={onOpenPathEditor}>{t('foundation.editor.canvasTool.drawPath')}</DrawerAction>
                      <DrawerAction icon={<WritingIcon />} onClick={onDrawCustomShape}>{t('foundation.editor.canvasTool.freehandShape')}</DrawerAction>
                    </div>
                    <ShapePool onSelect={shape => onCreateToolChange({ type: 'shape', key: 'shape', data: shape })} />
                  </>
                ) : null}
                {elementCategory === 'lines' ? <LinePool onSelect={line => onCreateToolChange({ type: 'line', key: 'line', data: line })} /> : null}
                {elementCategory === 'charts' ? <ChartPool onSelect={onInsertChart} /> : null}
                {elementCategory === 'tables' ? <EditorTableGenerator onInsert={onInsertTable} /> : null}
                {elementCategory === 'symbols' ? <SymbolPool onSelect={onInsertSymbol} /> : null}
                {elementCategory === 'equations' ? <DrawerAction icon={<FormulaIcon />} onClick={onOpenLatexEditor}>{t('foundation.editor.canvasTool.insertEquation')}</DrawerAction> : null}
              </div>
            ) : null}
            {activePanel === 'uploads' ? (
              uploadView === 'library'
                ? <EditorImageLibrary onBack={() => setUploadState({ route: 'uploads', view: 'main' })} onInsert={onInsertImageSource} />
                : (
                    <div className={drawerStackClassName}>
                      <input accept="image/*" aria-hidden="true" hidden onChange={selectImageFile} ref={imageInputRef} tabIndex={-1} type="file" />
                      <DrawerAction icon={<UploadIcon />} onClick={() => imageInputRef.current?.click()}>{t('foundation.editor.canvasTool.uploadImage')}</DrawerAction>
                      <DrawerAction icon={<PictureIcon />} onClick={() => setUploadState({ route: 'uploads', view: 'library' })}>{t('foundation.editor.canvasTool.onlineImages')}</DrawerAction>
                      <EditorMediaInput onInsertAudio={onInsertAudio} onInsertVideo={onInsertVideo} />
                    </div>
                  )
            ) : null}
            {secondaryContent}
          </SidebarContent>
        </>
      ) : (
        <>
          <div className={contextualDrawerHeaderClassName}>
            {contextualHeader}
            <Button aria-label={t('foundation.editor.rail.collapse')} className="mona-drawer-close size-6 shrink-0 rounded-md hover:bg-sidebar-accent" onClick={onClose} size="icon-xs" type="button" variant="ghost">
              <X className="h-4 w-4" />
            </Button>
          </div>
          {children}
        </>
      )}
    </Sidebar>
  )
}
