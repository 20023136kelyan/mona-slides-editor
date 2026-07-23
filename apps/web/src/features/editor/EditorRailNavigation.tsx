/* oxlint-disable jsx-a11y/prefer-tag-over-role -- the shadcn Sidebar primitive renders a div; the navigation landmark is applied explicitly. */
import { useTranslation } from 'react-i18next'
import { Bot, LayoutTemplate, PencilLine, Shapes, Type, Upload } from 'lucide-react'

import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Sidebar, SidebarContent } from '@/components/ui/sidebar'
import type { EditorCreateTool } from '@/features/editor/editor-create-tool'
import { prefetchDrawingWorkspace } from '@/features/editor/drawing/load-drawing-workspace'
import type { EditorTaskPanelRoute } from '@/features/editor/shell/editor-shell'

export function EditorRail({
  activePanel,
  activeTool,
  agentOpen,
  customShapeActive,
  drawingActive,
  onCreateToolChange,
  onPanelChange,
  onToggleDrawing,
  onToggleAgent,
}: {
  activePanel: EditorTaskPanelRoute | null
  activeTool: EditorCreateTool | null
  agentOpen: boolean
  customShapeActive: boolean
  drawingActive: boolean
  onCreateToolChange: (tool: EditorCreateTool | null) => void
  onPanelChange: (panel: EditorTaskPanelRoute | null, trigger?: HTMLElement | null) => void
  onToggleDrawing: () => void
  onToggleAgent: () => void
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
    icon: ReactNode
    key: string
    label: string
    onClick: (trigger: HTMLElement) => void
  }> = [
    { key: 'design', icon: <LayoutTemplate />, label: t('foundation.editor.rail.design'), active: activePanel === 'design', onClick: trigger => togglePanel('design', trigger) },
    { key: 'elements', icon: <Shapes />, label: t('foundation.editor.rail.elements'), active: activePanel === 'elements' || activeTool?.type === 'shape' || activeTool?.type === 'line', onClick: trigger => togglePanel('elements', trigger) },
    { key: 'text', icon: <Type />, label: t('foundation.editor.rail.text'), active: activePanel === 'text' || activeTool?.type === 'text', onClick: toggleTextPanel },
    { key: 'uploads', icon: <Upload />, label: t('foundation.editor.rail.uploads'), active: activePanel === 'uploads', onClick: trigger => togglePanel('uploads', trigger) },
    { key: 'draw', icon: <PencilLine />, label: t('foundation.editor.rail.draw'), active: drawingActive || customShapeActive, onClick: onToggleDrawing },
    { key: 'ai', icon: <Bot />, label: t('foundation.editor.rail.ai'), active: agentOpen, onClick: onToggleAgent },
  ]

  return (
    <Sidebar
      aria-label={t('foundation.editor.rail.tools')}
      className="mona-editor-rail border-r border-sidebar-border"
      collapsible="none"
      role="navigation"
      side="left"
    >
      <SidebarContent className="mona-editor-rail-items">
        {railItems.map(item => (
          <Button
            aria-label={item.label}
            aria-pressed={item.active}
            className={`mona-rail-item${item.active ? ' is-active' : ''}`}
            data-task-panel-route={item.key === 'ai' || item.key === 'draw' ? undefined : item.key}
            key={item.key}
            onClick={event => item.onClick(event.currentTarget)}
            onFocus={item.key === 'draw' ? prefetchDrawingWorkspace : undefined}
            onPointerEnter={item.key === 'draw' ? prefetchDrawingWorkspace : undefined}
            size="editor"
            type="button"
            variant="ghost"
          >
            <span className="mona-rail-item-icon">{item.icon}</span>
            <span className="mona-rail-item-label">{item.label}</span>
          </Button>
        ))}
      </SidebarContent>
    </Sidebar>
  )
}
