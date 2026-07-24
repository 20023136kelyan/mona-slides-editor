/* oxlint-disable jsx-a11y/prefer-tag-over-role -- the shadcn Sidebar primitives render divs; landmark roles are applied explicitly on them. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'

import ConnectionIcon from '~icons/icon-park-outline/connection'
import FormulaIcon from '~icons/icon-park-outline/formula'
import GraphicDesignIcon from '~icons/icon-park-outline/graphic-design'
import InsertTableIcon from '~icons/icon-park-outline/insert-table'
import SymbolIcon from '~icons/icon-park-outline/symbol'
import TextRotationDownIcon from '~icons/icon-park-outline/text-rotation-down'
import TextRotationNoneIcon from '~icons/icon-park-outline/text-rotation-none'
import WritingIcon from '~icons/icon-park-outline/writing-fluently'
import { LINE_LIST, SHAPE_LIST, type LinePoolItem, type ShapePoolItem } from '@mona/presentation-core'
import { SYMBOL_LIST } from '@mona/presentation-core/symbol-presets'
import type { Slide, SlideTheme } from '@mona/presentation-core/model'

import { Button } from '@/components/ui/button'
import { Sidebar, SidebarContent } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { LinePointMarker } from '@/features/editor/ElementStyleCommons'
import { EditorChartsPanel } from '@/features/editor/EditorChartsPanel'
import { EditorTableGenerator } from '@/features/editor/EditorTableGenerator'
import { EditorPhotosPanel } from '@/features/editor/EditorPhotosPanel'
import { EditorUploadsPanel } from '@/features/editor/EditorUploadsPanel'
import type { EditorCreateTool } from '@/features/editor/editor-create-tool'
import type { CreateChartElementOptions } from '@/features/editor/editor-chart'
import { PanelBackHeader, PanelSearchField } from '@/features/editor/panel/EditorPanelPrimitives'
import type { EditorTaskPanelRoute } from '@/features/editor/shell/editor-shell'
import { useEdgeFade } from '@/features/editor/use-edge-fade'
import { ScaledSlide } from '@/features/presentation-renderer/ScaledSlide'

export type EditorRailPanel = EditorTaskPanelRoute

const EMOJI_TYPES = ['face', 'gesture', 'nature', 'food', 'travel', 'activity', 'object', 'symbol'] as const

const poolCategoryLabelClassName = 'mb-2 w-full box-border px-0 py-0.5 text-xs font-semibold text-foreground/70'
const shapeItemClassName = 'relative mb-[calc(8%/7)] flex h-0 w-[11.5%] flex-[0_0_11.5%] items-center justify-center border-0 bg-transparent p-0 pb-[11.5%] [&:not(:nth-child(8n))]:mr-[calc(8%/7)] [&>svg]:absolute [&>svg]:top-1/2 [&>svg]:left-1/2 [&>svg]:-translate-x-1/2 [&>svg]:-translate-y-1/2 hover:[&_path:not(.is-outlined)]:stroke-[var(--editor-selection)] hover:[&_path.is-outlined]:fill-[var(--editor-selection)]'
const lineItemClassName = 'relative mb-[calc(5%/4)] flex h-0 w-[19%] flex-[0_0_19%] items-center justify-center border-0 bg-transparent p-0 pb-[19%] text-[#999] [&:not(:nth-child(5n))]:mr-[calc(5%/4)] [&>svg]:absolute [&>svg]:top-1/2 [&>svg]:left-1/2 [&>svg]:-translate-x-1/2 [&>svg]:-translate-y-1/2 hover:text-[var(--editor-selection)]'
const elementCategoryTabsClassName = 'mona-element-category-tabs mb-2.5 grid h-auto w-full grid-cols-3 gap-1 rounded-none bg-transparent p-0 [&_button]:flex [&_button]:h-[50px] [&_button]:min-w-0 [&_button]:flex-col [&_button]:gap-1 [&_button]:rounded-[var(--radius-action)] [&_button]:border-0 [&_button]:text-[10px] [&_button]:text-foreground/70 [&_button]:hover:bg-foreground/[0.06] [&_button]:hover:text-foreground [&_button]:data-[state=on]:bg-foreground/[0.08] [&_button]:data-[state=on]:font-semibold [&_button]:data-[state=on]:text-foreground [&_button_svg]:size-[17px]'

function ShapeThumbnail({ category, index, onSelect, shape }: {
  category: string
  index: number
  onSelect: () => void
  shape: ShapePoolItem
}) {
  return (
    <Button aria-label={shape.title || `${category} shape ${index + 1}`} className={shapeItemClassName} onClick={onSelect} size="editor-icon" type="button" variant="ghost">
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
    <div className="mt-3 w-full">
      {SHAPE_LIST.map(category => (
        <section key={category.type}>
          <div className={poolCategoryLabelClassName}>{t(`foundation.editor.canvasTool.shapeGroups.${category.type}`)}</div>
          <div className="mb-2.5 flex flex-wrap content-start">
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
    <div className="w-full">
      {LINE_LIST.map((category, categoryIndex) => (
        <section key={category.type}>
          <div className={poolCategoryLabelClassName}>{t(`foundation.editor.canvasTool.lineGroups.${category.type}`)}</div>
          <div className="mb-2.5 flex flex-wrap content-start">
            {category.children.map((line, index) => {
              const id = `mona-create-line-${categoryIndex}-${index}`
              return (
                <Button aria-label={`${category.type} line ${index + 1}`} className={lineItemClassName} key={id} onClick={() => onSelect(line)} size="editor-icon" type="button" variant="ghost">
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
    <div className="flex h-full min-h-0 flex-col text-foreground">
      <Tabs className="mb-2 w-full shrink-0 select-none" onValueChange={setSelectedSymbolKey} value={selectedSymbolKey}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-0 rounded-none bg-transparent p-0" variant="line">
          {SYMBOL_LIST.map(item => (
            <TabsTrigger className="flex-none rounded-none px-2.5 py-1.5 text-xs" key={item.key} value={item.key}>
              {t('foundation.editor.symbolPanel.tabs.' + item.key)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {selectedSymbolKey === 'emoji' ? (
        <ToggleGroup className="mb-[3px] items-center text-xs" onValueChange={value => {
          if (value) setSelectedEmojiTypeIndex(Number(value))
        }} spacing={1} type="single" value={String(selectedEmojiTypeIndex)}>
          {EMOJI_TYPES.map((type, index) => <ToggleGroupItem className="h-auto min-w-0 px-1 py-0.5 font-normal data-[state=on]:bg-[var(--editor-selection-subtle)] data-[state=on]:font-bold data-[state=on]:text-[var(--editor-selection)]" key={type} value={String(index)}>{t('foundation.editor.symbolPanel.categories.' + type)}</ToggleGroupItem>)}
        </ToggleGroup>
      ) : null}
      <div className="mx-[-12px] flex-1 overflow-auto px-3 pt-[5px] text-[18px] select-none" ref={poolRef}>
        {symbolPool.map((group, groupIndex) => (
          <div className="flex flex-wrap content-start [&:not(:first-child)]:mt-2 [&:not(:first-child)]:border-t [&:not(:first-child)]:pt-2.5" key={groupIndex}>
            {group.map((item, index) => (
              <Button
                className="relative mb-[calc(4%/7)] h-[38px] w-[12%] rounded-none border p-0 transition-colors hover:border-foreground hover:text-foreground [&:not(:nth-child(8n))]:mr-[calc(4%/7)]"
                key={item + '-' + index}
                onClick={() => onSelect(item)}
                onMouseDown={event => event.preventDefault()}
                size="editor-icon"
                type="button"
                variant="ghost"
              >
                <span className="absolute inset-0 flex items-center justify-center bg-background">{item}</span>
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
    <Button aria-label={name} className="flex h-auto flex-col items-stretch rounded-[var(--radius-surface)] p-0 hover:bg-transparent [&_.mona-scaled-slide]:overflow-hidden [&_.mona-scaled-slide]:rounded-[var(--radius-surface)] [&_.mona-scaled-slide]:ring-1 [&_.mona-scaled-slide]:ring-foreground/[0.07] [&_.mona-scaled-slide]:transition-shadow hover:[&_.mona-scaled-slide]:ring-2 hover:[&_.mona-scaled-slide]:ring-foreground/30" onClick={onOpen} size="editor" title={name} type="button" variant="ghost">
      {cover ? (
        <ScaledSlide fixedWidth={128} slide={cover} theme={{ ...theme!, ...payload?.theme }} thumbnail viewportRatio={0.5625} viewportSize={1000} />
      ) : (
        <Skeleton className="aspect-video w-full rounded-[var(--radius-surface)]" />
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
    <div className="select-none">
      <PanelBackHeader
        className="mb-1 ml-[-4px] p-0"
        label={t('foundation.editor.templates.back')}
        onBack={onBack}
        title={name}
      />
      <div className="mx-0.5 mb-3 text-xs text-foreground/55">{t('foundation.editor.templates.meta', { count: payload?.slides.length ?? 0 })}</div>
      {payload ? (
        <>
          <Button className="mb-3 w-full rounded-[var(--radius-action)] font-semibold" onClick={() => onInsertAll(payload)} size="sm" type="button" variant="outline">
            {t('foundation.editor.templates.applyAll', { count: payload.slides.length })}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            {payload.slides.map((slide, index) => (
              <Button aria-label={`${t('foundation.editor.templates.insertTemplate')} ${index + 1}`} className="flex h-auto flex-col items-stretch rounded-[var(--radius-surface)] p-0 hover:bg-transparent [&_.mona-scaled-slide]:overflow-hidden [&_.mona-scaled-slide]:rounded-[var(--radius-surface)] [&_.mona-scaled-slide]:ring-1 [&_.mona-scaled-slide]:ring-foreground/[0.07] [&_.mona-scaled-slide]:transition-shadow hover:[&_.mona-scaled-slide]:ring-2 hover:[&_.mona-scaled-slide]:ring-foreground/30" key={slide.id} onClick={() => onInsertOne(slide)} size="editor" type="button" variant="ghost">
                <ScaledSlide fixedWidth={128} slide={slide} theme={{ ...theme!, ...payload.theme }} thumbnail viewportRatio={0.5625} viewportSize={1000} />
              </Button>
            ))}
          </div>
        </>
      ) : (
        <Skeleton className="aspect-video w-full rounded-[var(--radius-surface)]" />
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
    <div className="select-none">
      <div className="mb-[14px]">
        <PanelSearchField
          label={t('foundation.editor.templates.searchPlaceholder')}
          onChange={setQuery}
          placeholder={t('foundation.editor.templates.searchPlaceholder')}
          value={query}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {filteredTemplates.map(template => (
          <TemplateCoverCard
            id={template.id}
            key={template.id}
            name={t(`foundation.editor.templates.catalog.${template.id}`)}
            onOpen={() => setOpenCatalog(template.id)}
            theme={theme}
          />
        ))}
        {!filteredTemplates.length ? <p className="col-span-full my-6 text-center text-xs text-muted-foreground">{t('foundation.editor.templates.noResults')}</p> : null}
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

function DrawerCollapseButton({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Button
      aria-label={t('foundation.editor.rail.collapse')}
      className="mona-drawer-close absolute top-1/2 right-0 z-30 h-12! w-5! min-w-0 -translate-y-1/2 translate-x-1/2 rounded-[var(--radius-pill)] border border-border/70 bg-background p-0 text-foreground shadow-[0_1px_3px_rgba(15,23,42,0.12)] hover:bg-background hover:text-foreground [&_svg]:size-3.5!"
      onClick={onClose}
      size="icon-xs"
      type="button"
      variant="outline"
    >
      <ChevronLeft className="size-3.5" strokeWidth={2.5} />
    </Button>
  )
}

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
  onInsertChart: (spec: CreateChartElementOptions & { openDataEditor?: boolean }) => void
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
  const poolScrollRef = useRef<HTMLDivElement>(null)
  const [elementCategory, setElementCategory] = useState<'equations' | 'lines' | 'shapes' | 'symbols' | 'tables'>('shapes')
  // Fade the top/bottom edge wherever pool content is cut off.
  useEdgeFade(poolScrollRef, 'y', activePanel)

  if (!activePanel && !contextualOpen) return null

  return (
    <Sidebar
      aria-label={activePanel && panelTitle ? panelTitle : t('foundation.editor.inspector')}
      className="mona-editor-drawer relative w-[22rem] shrink-0 overflow-visible border-r border-sidebar-border"
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
      <DrawerCollapseButton onClose={onClose} />
      {activePanel ? (
        <>
          <SidebarContent
            className="mona-inspector-content mona-drawer-content block min-h-0 has-[.mona-uploads-panel,.mona-photos-panel,.mona-charts-panel]:flex has-[.mona-uploads-panel,.mona-photos-panel,.mona-charts-panel]:overflow-hidden has-[.mona-uploads-panel,.mona-photos-panel,.mona-charts-panel]:p-0"
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
                  className={elementCategoryTabsClassName}
                  onValueChange={value => {
                    if (value) setElementCategory(value as typeof elementCategory)
                  }}
                  spacing={1}
                  type="single"
                  value={elementCategory}
                >
                  <ToggleGroupItem aria-label={t('foundation.editor.canvasTool.shape')} value="shapes"><GraphicDesignIcon />{t('foundation.editor.canvasTool.shape')}</ToggleGroupItem>
                  <ToggleGroupItem aria-label={t('foundation.editor.canvasTool.line')} value="lines"><ConnectionIcon />{t('foundation.editor.canvasTool.line')}</ToggleGroupItem>
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
                {elementCategory === 'tables' ? <EditorTableGenerator onInsert={onInsertTable} /> : null}
                {elementCategory === 'symbols' ? <SymbolPool onSelect={onInsertSymbol} /> : null}
                {elementCategory === 'equations' ? <DrawerAction icon={<FormulaIcon />} onClick={onOpenLatexEditor}>{t('foundation.editor.canvasTool.insertEquation')}</DrawerAction> : null}
              </div>
            ) : null}
            {activePanel === 'uploads' ? (
              <EditorUploadsPanel
                onInsertAudio={onInsertAudio}
                onInsertImageSource={onInsertImageSource}
                onInsertVideo={onInsertVideo}
              />
            ) : null}
            {activePanel === 'photos' ? (
              <EditorPhotosPanel onInsertImageSource={onInsertImageSource} />
            ) : null}
            {activePanel === 'charts' ? (
              <EditorChartsPanel onInsertChart={onInsertChart} />
            ) : null}
            {secondaryContent}
          </SidebarContent>
        </>
      ) : (
        <>
          <div className={contextualDrawerHeaderClassName}>
            {contextualHeader}
          </div>
          {children}
        </>
      )}
    </Sidebar>
  )
}
