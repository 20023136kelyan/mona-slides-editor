import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'

import type { ComponentType } from 'react'

import {
  ApplicationSidebar,
} from '@/features/application-shell/ApplicationSidebar'
import {
  applicationSidebarIconHidden as railIconHidden,
  applicationSidebarIconLabel as railIconLabel,
  applicationSidebarIconRow as railIconRow,
  applicationSidebarIconRowInner as railIconRowInner,
  applicationSidebarIconSize as railIconSize,
} from '@/features/application-shell/application-sidebar-styles'
import { CATEGORY_ICONS } from '@/features/editor/icons/category-icons'
import { useEditorApplication } from '@/features/editor/services/editor-application'
import { isMacChrome } from '@/lib/mona-bridge'
import { useEditorShell } from '@/features/editor/shell/editor-shell'
import { cn } from '@/lib/utils'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from '@/components/ui/sidebar'
import type { EditorCreateTool } from '@/features/editor/editor-create-tool'
import type { EditorElementCategory, EditorTaskPanelRoute } from '@/features/editor/shell/editor-shell'
import { useEdgeFade } from '@/features/editor/use-edge-fade'

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
  const { openDocumentLibrary } = useEditorApplication()
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
          <div className={cn('flex min-w-0 flex-1 items-center', railIconRowInner)}>
            {/* Larger while collapsed on macOS: the rail is 88px there to clear
                the traffic lights, and a 16px glyph looks lost in it. */}
            <Icon className={cn('mona-rail-shift shrink-0 transition-[width,height] duration-200 ease-out', railIconSize(macChrome))} />
            <span className={cn('truncate', railIconLabel)}>{item.label}</span>
          </div>
          {item.hasPanel ? (
            <ChevronRight
              className={cn(
                'ml-auto h-4 w-4 shrink-0',
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
    <ApplicationSidebar
      ariaLabel={t('foundation.editor.rail.tools')}
      collapsed={collapsed}
      contentClassName="mona-editor-rail-content"
      contentRef={railScrollRef}
      onCollapsedChange={setCollapsed}
      onOpenLibrary={() => { void openDocumentLibrary() }}
    >
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
    </ApplicationSidebar>
  )
}
