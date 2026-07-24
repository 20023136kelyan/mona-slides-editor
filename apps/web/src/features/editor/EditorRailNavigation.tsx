/* oxlint-disable jsx-a11y/prefer-tag-over-role -- the shadcn Sidebar primitive renders a div; the navigation landmark is applied explicitly. */
import { useTranslation } from 'react-i18next'
import {
  BarChart3,
  Briefcase,
  ChevronRight,
  Folder,
  Image,
  LayoutGrid,
  LayoutTemplate,
  PencilLine,
  Shapes,
  Sparkles,
  Type,
  Upload,
} from 'lucide-react'

import type { ComponentType } from 'react'

import { cn } from '@/lib/utils'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from '@/components/ui/sidebar'
import type { EditorCreateTool } from '@/features/editor/editor-create-tool'
import { prefetchDrawingWorkspace } from '@/features/editor/drawing/load-drawing-workspace'
import type { EditorTaskPanelRoute } from '@/features/editor/shell/editor-shell'

type RailItem = {
  active: boolean
  hasPanel: boolean
  icon: ComponentType<{ className?: string }>
  key: string
  label: string
  onClick: (trigger: HTMLElement) => void
  onFocus?: () => void
  onPointerEnter?: () => void
  stub?: boolean
}

// Persistent creation rail built on shadcn SidebarMenu composition.
// Wired items open task panels / drawing; stub items reserve Canva-like
// categories for upcoming reorganization without opening surfaces yet.
export function EditorRail({
  activePanel,
  activeTool,
  customShapeActive,
  drawingActive,
  onCreateToolChange,
  onPanelChange,
  onToggleDrawing,
}: {
  activePanel: EditorTaskPanelRoute | null
  activeTool: EditorCreateTool | null
  customShapeActive: boolean
  drawingActive: boolean
  onCreateToolChange: (tool: EditorCreateTool | null) => void
  onPanelChange: (panel: EditorTaskPanelRoute | null, trigger?: HTMLElement | null) => void
  onToggleDrawing: () => void
}) {
  const { t } = useTranslation()

  const togglePanel = (panel: EditorTaskPanelRoute, trigger: HTMLElement) => {
    // A previously armed text tool must not outlive its panel: switching to
    // another pool would otherwise leave two rail items lit at once.
    if (activePanel !== panel && activeTool?.type === 'text') onCreateToolChange(null)
    onPanelChange(activePanel === panel ? null : panel, trigger)
  }
  const toggleTextPanel = (trigger: HTMLElement) => {
    if (activePanel === 'text') {
      onPanelChange(null, trigger)
      if (activeTool?.type === 'text') onCreateToolChange(null)
      return
    }
    onPanelChange('text', trigger)
    onCreateToolChange({ type: 'text', key: 'text', vertical: false })
  }
  const stubClick = () => {}

  const primaryItems: RailItem[] = [
    { key: 'templates', hasPanel: true, icon: LayoutTemplate, label: t('foundation.editor.rail.templates'), active: activePanel === 'design', onClick: trigger => togglePanel('design', trigger) },
    { key: 'elements', hasPanel: true, icon: Shapes, label: t('foundation.editor.rail.elements'), active: activePanel === 'elements' || activeTool?.type === 'shape' || activeTool?.type === 'line', onClick: trigger => togglePanel('elements', trigger) },
    { key: 'text', hasPanel: true, icon: Type, label: t('foundation.editor.rail.text'), active: activePanel === 'text' || activeTool?.type === 'text', onClick: toggleTextPanel },
    { key: 'brand', hasPanel: false, stub: true, icon: Briefcase, label: t('foundation.editor.rail.brand'), active: false, onClick: stubClick },
    { key: 'uploads', hasPanel: true, icon: Upload, label: t('foundation.editor.rail.uploads'), active: activePanel === 'uploads', onClick: trigger => togglePanel('uploads', trigger) },
    { key: 'tools', hasPanel: false, icon: PencilLine, label: t('foundation.editor.rail.toolsItem'), active: drawingActive || customShapeActive, onClick: onToggleDrawing, onFocus: prefetchDrawingWorkspace, onPointerEnter: prefetchDrawingWorkspace },
    { key: 'projects', hasPanel: false, stub: true, icon: Folder, label: t('foundation.editor.rail.projects'), active: false, onClick: stubClick },
    { key: 'apps', hasPanel: false, stub: true, icon: LayoutGrid, label: t('foundation.editor.rail.apps'), active: false, onClick: stubClick },
  ]

  const mediaItems: RailItem[] = [
    { key: 'magic-media', hasPanel: false, stub: true, icon: Sparkles, label: t('foundation.editor.rail.magicMedia'), active: false, onClick: stubClick },
    { key: 'photos', hasPanel: true, icon: Image, label: t('foundation.editor.rail.photos'), active: activePanel === 'photos', onClick: trigger => togglePanel('photos', trigger) },
    { key: 'charts', hasPanel: true, icon: BarChart3, label: t('foundation.editor.rail.charts'), active: activePanel === 'charts', onClick: trigger => togglePanel('charts', trigger) },
  ]

  const renderItem = (item: RailItem) => {
    const Icon = item.icon
    return (
      <SidebarMenuItem key={item.key}>
        <SidebarMenuButton
          aria-label={item.label}
          aria-pressed={item.active}
          className={cn(
            'h-10 w-full px-3 max-snug:justify-center max-snug:px-0',
            item.stub && 'text-muted-foreground',
          )}
          data-task-panel-route={item.hasPanel ? (item.key === 'templates' ? 'design' : item.key) : undefined}
          isActive={item.active}
          onClick={event => item.onClick(event.currentTarget)}
          onFocus={item.onFocus}
          onPointerEnter={item.onPointerEnter}
        >
          <div className="flex min-w-0 flex-1 items-center gap-3 max-snug:flex-none">
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate max-snug:hidden">{item.label}</span>
          </div>
          {item.hasPanel ? (
            <ChevronRight
              className={cn(
                'ml-auto h-4 w-4 shrink-0 transition-transform max-snug:hidden',
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
      className="mona-editor-rail w-56 shrink-0 border-r border-sidebar-border max-snug:w-[3.25rem]"
      collapsible="none"
      role="navigation"
      side="left"
    >
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {primaryItems.map(renderItem)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarSeparator className="mx-3" />
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {mediaItems.map(renderItem)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
