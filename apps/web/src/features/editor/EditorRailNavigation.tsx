/* oxlint-disable jsx-a11y/prefer-tag-over-role -- the shadcn Sidebar primitive renders a div; the navigation landmark is applied explicitly. */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronRight,
  Languages,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from 'lucide-react'

import type { ComponentType } from 'react'

import { CATEGORY_ICONS } from '@/features/editor/icons/category-icons'
import { isMacChrome } from '@/lib/mona-bridge'
import { useEditorShell } from '@/features/editor/shell/editor-shell'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from '@/components/ui/sidebar'
import type { EditorCreateTool } from '@/features/editor/editor-create-tool'
import { InspectorSelect } from '@/features/editor/EditorInspectorPrimitives'
import type { EditorElementCategory, EditorTaskPanelRoute } from '@/features/editor/shell/editor-shell'
import { useEdgeFade } from '@/features/editor/use-edge-fade'
import { LOCALES, isSupportedLocale, setLocale, type SupportedLocale } from '@/i18n'

const ELEMENT_POOLS: ReadonlyArray<{
  category: EditorElementCategory
  icon: ComponentType<{ className?: string }>
  key: string
  labelKey: string
}> = [
  { category: 'shapes', icon: CATEGORY_ICONS.shapes, key: 'shapes', labelKey: 'foundation.editor.canvasTool.shape' },
  { category: 'lines', icon: CATEGORY_ICONS.lines, key: 'lines', labelKey: 'foundation.editor.canvasTool.line' },
  { category: 'tables', icon: CATEGORY_ICONS.tables, key: 'tables', labelKey: 'foundation.editor.canvasTool.table' },
  { category: 'symbols', icon: CATEGORY_ICONS.symbols, key: 'symbols', labelKey: 'foundation.editor.canvasTool.symbol' },
  { category: 'equations', icon: CATEGORY_ICONS.equations, key: 'equations', labelKey: 'foundation.editor.canvasTool.equation' },
]

type RailItem = {
  active: boolean
  hasPanel: boolean
  /** Task-panel route this item opens; defaults to `key` when they match. */
  route?: EditorTaskPanelRoute
  icon: ComponentType<{ className?: string }>
  key: string
  label: string
  onClick: (trigger: HTMLElement) => void
  onFocus?: () => void
  onPointerEnter?: () => void
  /**
   * Whether this item carries `data-task-panel-route`, which the shell focuses
   * when a closing panel has lost its trigger. Several items can share a route,
   * but the attribute has to be unique or that lookup takes the first match
   * regardless of which item actually opened the panel. Defaults to true.
   */
  routeAnchor?: boolean
  stub?: boolean
}

// The rail drops to icons two ways: automatically below the `snug` breakpoint,
// and manually via the header toggle. Both have to hide exactly the same parts,
// so each pairing lives here instead of being spelled out at every element —
// missing one twin is what leaves a stray label in a 52px rail.
const railIconRow = 'max-snug:justify-center max-snug:px-0 group-data-[collapsed=true]/rail:justify-center group-data-[collapsed=true]/rail:px-0'
const railIconRowInner = 'max-snug:flex-none group-data-[collapsed=true]/rail:flex-none'
const railIconHidden = 'max-snug:hidden group-data-[collapsed=true]/rail:hidden'

// Bottom slot of the creation rail. It holds application settings today and is
// the designated home for the account control, so it stays visually separated
// from the creation items above rather than joining that menu.
function RailSettingsMenu() {
  const { i18n, t } = useTranslation()
  const [open, setOpen] = useState(false)
  const resolvedLanguage = i18n.resolvedLanguage ?? ''
  const activeLocale: SupportedLocale = isSupportedLocale(resolvedLanguage) ? resolvedLanguage : 'en-US'

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <SidebarMenuButton
          aria-label={t('header.settings')}
          className={cn('mona-editor-rail-settings h-10 w-full px-3', railIconRow)}
          isActive={open}
          title={t('header.settings')}
        >
          <div className={cn('flex min-w-0 flex-1 items-center gap-3', railIconRowInner)}>
            <CATEGORY_ICONS.settings className="h-4 w-4 shrink-0" />
            <span className={cn('truncate', railIconHidden)}>{t('header.settings')}</span>
          </div>
        </SidebarMenuButton>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={t('header.settings')}
        className="w-68 rounded-overlay p-1 text-xs shadow-[0_10px_30px_rgb(15_23_42_/_13%),0_2px_8px_rgb(15_23_42_/_8%)]"
        // Anchored to the last rail item, so the panel sits flush against the
        // viewport floor without a gutter; keep one as it grows into account content.
        collisionPadding={12}
        side="right"
        sideOffset={8}
      >
        <div className="flex items-center gap-2 border-b border-border px-0.5 pt-0.5 pb-2 text-sm font-semibold"><Settings className="size-3.5" /><span>{t('header.settings')}</span></div>
        <div className="flex items-center gap-4 pt-2.5">
          <span className="flex-1 text-muted-foreground">{t('locale.language')}</span>
          <InspectorSelect
            ariaLabel={t('locale.language')}
            className="mona-rail-locale-select h-7 w-35 flex-none border-transparent hover:bg-muted"
            icon={<Languages />}
            onChange={locale => {
              if (isSupportedLocale(locale)) void setLocale(locale)
            }}
            options={LOCALES.map(locale => ({ label: t(locale.labelKey), value: locale.code }))}
            value={activeLocale}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Persistent creation rail built on shadcn SidebarMenu composition.
// Wired items open task panels / drawing; stub items reserve Canva-like
// categories for upcoming reorganization without opening surfaces yet.
export function EditorRail({
  activePanel,
  activeTool,
  elementCategory,
  onCreateToolChange,
  onElementCategoryChange,
  onPanelChange,
}: {
  activePanel: EditorTaskPanelRoute | null
  activeTool: EditorCreateTool | null
  elementCategory: EditorElementCategory
  onElementCategoryChange: (category: EditorElementCategory) => void
  onCreateToolChange: (tool: EditorCreateTool | null) => void
  onPanelChange: (panel: EditorTaskPanelRoute | null, trigger?: HTMLElement | null) => void
}) {
  const { t } = useTranslation()
  const { railCollapsed: collapsed, setRailCollapsed: setCollapsed } = useEditorShell()
  const macChrome = isMacChrome()
  const railScrollRef = useRef<HTMLDivElement>(null)
  // The media group falls below the fold on short viewports, and Photos and
  // Charts are wired features hiding down there among the stubs. Fade the
  // clipped edge so the list reads as scrollable rather than finished.
  useEdgeFade(railScrollRef, 'y')

  // Every rail entry changes panels through here. A previously armed text tool
  // must not outlive its panel: opening another pool would otherwise leave that
  // pool and Text lit at once, and the next canvas click would drop a text box
  // instead of the shape the user just picked. Holding the rule at the single
  // choke point is what stops a new rail entry from reintroducing that.
  const routePanel = (panel: EditorTaskPanelRoute | null, trigger: HTMLElement) => {
    if (panel && panel !== 'text' && activeTool?.type === 'text') onCreateToolChange(null)
    onPanelChange(panel, trigger)
  }
  const togglePanel = (panel: EditorTaskPanelRoute, trigger: HTMLElement) => {
    routePanel(activePanel === panel ? null : panel, trigger)
  }
  const toggleTextPanel = (trigger: HTMLElement) => {
    if (activePanel === 'text') {
      routePanel(null, trigger)
      if (activeTool?.type === 'text') onCreateToolChange(null)
      return
    }
    routePanel('text', trigger)
    onCreateToolChange({ type: 'text', key: 'text', vertical: false })
  }
  const stubClick = () => {}

  const primaryItems: RailItem[] = [
    { key: 'templates', hasPanel: true, route: 'design', icon: CATEGORY_ICONS.templates, label: t('foundation.editor.rail.templates'), active: activePanel === 'design', onClick: trigger => togglePanel('design', trigger) },
    ...ELEMENT_POOLS.map(pool => ({
      key: pool.key,
      hasPanel: true,
      route: 'elements' as const,
      icon: pool.icon,
      label: t(pool.labelKey),
      // Each pool is its own rail entry, so the rail alone tells the user where
      // everything lives — no nested picker inside the panel.
      active: activePanel === 'elements' && elementCategory === pool.category,
      // All five pools open `elements`, so only the selected one anchors the
      // route; otherwise focus restoration always lands on Shape.
      routeAnchor: elementCategory === pool.category,
      onClick: (trigger: HTMLElement) => {
        onElementCategoryChange(pool.category)
        if (activePanel === 'elements' && elementCategory === pool.category) routePanel(null, trigger)
        else routePanel('elements', trigger)
      },
    })),
    { key: 'graphics', hasPanel: false, stub: true, icon: CATEGORY_ICONS.graphics, label: t('foundation.editor.rail.graphics'), active: false, onClick: stubClick },
    { key: 'frames', hasPanel: false, stub: true, icon: CATEGORY_ICONS.frames, label: t('foundation.editor.rail.frames'), active: false, onClick: stubClick },
    { key: 'grids', hasPanel: false, stub: true, icon: CATEGORY_ICONS.grids, label: t('foundation.editor.rail.grids'), active: false, onClick: stubClick },
    { key: 'text', hasPanel: true, icon: CATEGORY_ICONS.text, label: t('foundation.editor.rail.text'), active: activePanel === 'text' || activeTool?.type === 'text', onClick: toggleTextPanel },
    { key: 'brand', hasPanel: false, stub: true, icon: CATEGORY_ICONS.brand, label: t('foundation.editor.rail.brand'), active: false, onClick: stubClick },
    { key: 'uploads', hasPanel: true, icon: CATEGORY_ICONS.uploads, label: t('foundation.editor.rail.uploads'), active: activePanel === 'uploads', onClick: trigger => togglePanel('uploads', trigger) },
    { key: 'videos', hasPanel: true, icon: CATEGORY_ICONS.videos, label: t('foundation.editor.rail.videos'), active: activePanel === 'videos', onClick: trigger => togglePanel('videos', trigger) },
    { key: 'audio', hasPanel: false, stub: true, icon: CATEGORY_ICONS.audio, label: t('foundation.editor.rail.audio'), active: false, onClick: stubClick },
    { key: 'projects', hasPanel: false, stub: true, icon: CATEGORY_ICONS.projects, label: t('foundation.editor.rail.projects'), active: false, onClick: stubClick },
    { key: 'apps', hasPanel: false, stub: true, icon: CATEGORY_ICONS.apps, label: t('foundation.editor.rail.apps'), active: false, onClick: stubClick },
  ]

  const mediaItems: RailItem[] = [
    { key: 'magic-media', hasPanel: false, stub: true, icon: CATEGORY_ICONS.magicMedia, label: t('foundation.editor.rail.magicMedia'), active: false, onClick: stubClick },
    { key: 'photos', hasPanel: true, icon: CATEGORY_ICONS.photos, label: t('foundation.editor.rail.photos'), active: activePanel === 'photos', onClick: trigger => togglePanel('photos', trigger) },
    { key: 'charts', hasPanel: true, icon: CATEGORY_ICONS.charts, label: t('foundation.editor.rail.charts'), active: activePanel === 'charts', onClick: trigger => togglePanel('charts', trigger) },
    { key: 'sheets', hasPanel: false, stub: true, icon: CATEGORY_ICONS.sheets, label: t('foundation.editor.rail.sheets'), active: false, onClick: stubClick },
    { key: 'forms', hasPanel: false, stub: true, icon: CATEGORY_ICONS.forms, label: t('foundation.editor.rail.forms'), active: false, onClick: stubClick },
    { key: 'threeD', hasPanel: false, stub: true, icon: CATEGORY_ICONS.threeD, label: t('foundation.editor.rail.threeD'), active: false, onClick: stubClick },
    { key: 'mockups', hasPanel: false, stub: true, icon: CATEGORY_ICONS.mockups, label: t('foundation.editor.rail.mockups'), active: false, onClick: stubClick },
  ]

  const renderItem = (item: RailItem) => {
    const Icon = item.icon
    return (
      <SidebarMenuItem key={item.key}>
        <SidebarMenuButton
          aria-label={item.label}
          aria-pressed={item.active}
          className={cn(
            'h-10 w-full px-3',
            railIconRow,
            item.stub && 'text-muted-foreground',
          )}
          data-task-panel-route={item.hasPanel && item.routeAnchor !== false ? item.route ?? item.key : undefined}
          isActive={item.active}
          onClick={event => item.onClick(event.currentTarget)}
          onFocus={item.onFocus}
          onPointerEnter={item.onPointerEnter}
        >
          <div className={cn('flex min-w-0 flex-1 items-center gap-3', railIconRowInner)}>
            {/* Larger while collapsed on macOS: the rail is 88px there to clear
                the traffic lights, and a 16px glyph looks lost in it. */}
            <Icon className={cn('shrink-0', macChrome ? 'size-4 group-data-[collapsed=true]/rail:size-5 max-snug:size-5' : 'size-4')} />
            <span className={cn('truncate', railIconHidden)}>{item.label}</span>
          </div>
          {item.hasPanel ? (
            <ChevronRight
              className={cn(
                'ml-auto h-4 w-4 shrink-0 transition-transform',
                railIconHidden,
                item.active && 'rotate-90',
              )}
            />
          ) : null}
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }

  return (
    <Sidebar
      aria-label={t('foundation.editor.rail.tools')}
      className={cn(
        'mona-editor-rail group/rail w-56 shrink-0 border-r border-sidebar-border transition-[width] duration-200 max-snug:w-[3.25rem] data-[collapsed=true]:w-[3.25rem]',
        // The traffic lights start 18px in and span 52px, so 18px on the other
        // side centres them in an 88px rail. Narrower and the border would cut
        // through the green button.
        macChrome && 'max-snug:w-(--mona-rail-collapsed-mac) data-[collapsed=true]:w-(--mona-rail-collapsed-mac)',
      )}
      collapsible="none"
      data-collapsed={collapsed}
      role="navigation"
      side="left"
    >
      {/* No rule under the header: the content's own top fade marks the seam,
          and only while something is actually scrolled beneath it.
          Three states share this row — expanded shows mark, wordmark and the
          toggle; manually collapsed drops the mark so the toggle (the only way
          back) owns the 52px; below `snug` the rail is forced narrow, so the
          toggle has nothing to offer and the mark keeps the slot. */}
      {/* On macOS the traffic lights float over this row, so the brand shifts right
          to sit beside them rather than under them - the toggle stays on the same
          line as the header's own controls, which is where the eye expects it.
          Collapsed, the rail is only as wide as the lights need and the toggle
          moves to the header; the row itself becomes somewhere to grab the window. */}
      <SidebarHeader
        className={cn(
          'h-11 flex-none flex-row items-center gap-1 px-3',
          railIconRow,
          macChrome && 'mona-editor-rail-titlebar',
          macChrome && !collapsed && 'ps-(--mona-traffic-clear)',
        )}
      >
        <div
          aria-label="Mona"
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold tracking-tight text-foreground',
            railIconRowInner,
            'group-data-[collapsed=true]/rail:hidden',
          )}
        >
          <img alt="" aria-hidden="true" className="size-4 flex-none" src="/favicon.svg" />
          {/* The mark alone on macOS: the traffic lights already take the left of
              this row, and the wordmark beside them crowds it. */}
          {macChrome ? null : <span className={cn('truncate', railIconHidden)}>Mona</span>}
        </div>
        {/* Hidden here when the rail is collapsed on macOS: the header carries it
            then, because this row has room for the traffic lights and nothing else. */}
        <Button
          aria-label={collapsed ? t('foundation.editor.rail.expandSidebar') : t('foundation.editor.rail.collapseSidebar')}
          aria-pressed={collapsed}
          className={cn('mona-editor-rail-toggle shrink-0 text-foreground/70 hover:text-foreground max-snug:hidden', macChrome && collapsed && 'hidden')}
          onClick={() => setCollapsed(!collapsed)}
          size="icon-xs"
          title={collapsed ? t('foundation.editor.rail.expandSidebar') : t('foundation.editor.rail.collapseSidebar')}
          type="button"
          variant="ghost"
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </Button>
      </SidebarHeader>
      <SidebarContent className="mona-editor-rail-content" ref={railScrollRef}>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {primaryItems.map(renderItem)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {/* w-auto must be variant-prefixed to beat the Separator primitive's
            own `data-horizontal:w-full`; unprefixed it loses the cascade, the
            rule stays full-width, and mx-3 then adds 24px the rail cannot
            hold — which is what made the rail scroll sideways. */}
        <SidebarSeparator className="mx-3 data-horizontal:w-auto" />
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {mediaItems.map(renderItem)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {/* Unruled to match the header — the content's bottom fade carries the
          seam, so the divider only appears when there is something under it. */}
      <SidebarFooter className="p-0">
        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <RailSettingsMenu />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarFooter>
    </Sidebar>
  )
}
