/* oxlint-disable jsx-a11y/prefer-tag-over-role -- the shadcn Sidebar primitive renders a div; the navigation landmark is applied explicitly. */
import { useTranslation } from 'react-i18next'
import { ChevronRight, LayoutTemplate, PencilLine, Shapes, Type, Upload } from 'lucide-react'

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
} from '@/components/ui/sidebar'
import type { EditorCreateTool } from '@/features/editor/editor-create-tool'
import { prefetchDrawingWorkspace } from '@/features/editor/drawing/load-drawing-workspace'
import type { EditorTaskPanelRoute } from '@/features/editor/shell/editor-shell'

// Persistent creation rail built on shadcn SidebarMenu /
// SidebarMenuItem / SidebarMenuButton composition, the same inner row and the
// same chevron-that-rotates-open indicator — only the data is ours (the editor
// tools instead of the demo nav). `hasPanel` items open the extension panel.
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

  const railItems: Array<{
    active: boolean
    hasPanel: boolean
    icon: ComponentType<{ className?: string }>
    key: string
    label: string
    onClick: (trigger: HTMLElement) => void
  }> = [
    { key: 'design', hasPanel: true, icon: LayoutTemplate, label: t('foundation.editor.rail.design'), active: activePanel === 'design', onClick: trigger => togglePanel('design', trigger) },
    { key: 'elements', hasPanel: true, icon: Shapes, label: t('foundation.editor.rail.elements'), active: activePanel === 'elements' || activeTool?.type === 'shape' || activeTool?.type === 'line', onClick: trigger => togglePanel('elements', trigger) },
    { key: 'text', hasPanel: true, icon: Type, label: t('foundation.editor.rail.text'), active: activePanel === 'text' || activeTool?.type === 'text', onClick: toggleTextPanel },
    { key: 'uploads', hasPanel: true, icon: Upload, label: t('foundation.editor.rail.uploads'), active: activePanel === 'uploads', onClick: trigger => togglePanel('uploads', trigger) },
    { key: 'draw', hasPanel: false, icon: PencilLine, label: t('foundation.editor.rail.draw'), active: drawingActive || customShapeActive, onClick: onToggleDrawing },
  ]

  return (
    <Sidebar
      aria-label={t('foundation.editor.rail.tools')}
      className="mona-editor-rail w-56 shrink-0 border-r border-sidebar-border max-[1100px]:w-[3.25rem]"
      collapsible="none"
      role="navigation"
      side="left"
    >
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {railItems.map(item => {
                const Icon = item.icon
                const isActive = item.active

                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton
                      aria-label={item.label}
                      aria-pressed={isActive}
                      className="h-10 w-full px-3 max-[1100px]:justify-center max-[1100px]:px-0"
                      data-task-panel-route={item.hasPanel ? item.key : undefined}
                      isActive={isActive}
                      onClick={event => item.onClick(event.currentTarget)}
                      onFocus={item.key === 'draw' ? prefetchDrawingWorkspace : undefined}
                      onPointerEnter={item.key === 'draw' ? prefetchDrawingWorkspace : undefined}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3 max-[1100px]:flex-none">
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="truncate max-[1100px]:hidden">{item.label}</span>
                      </div>
                      {item.hasPanel ? (
                        <ChevronRight
                          className={cn(
                            'ml-auto h-4 w-4 shrink-0 transition-transform max-[1100px]:hidden',
                            isActive && 'rotate-90'
                          )}
                        />
                      ) : null}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
