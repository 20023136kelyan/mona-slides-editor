import { useEffect, useRef, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { EditorSessionState, EditorToolbarState } from '@mona/editor-state'
import type { PresentationState } from '@mona/presentation-core'
import type { Slide } from '@mona/presentation-core/model'

import {
  ContextualDeepActions,
  ContextualPrimaryControls,
} from '@/features/editor/contextual/contextual-control-registry'
import {
  resolveSelectionCapabilities,
  type ContextualMode,
} from '@/features/editor/contextual/resolve-selection-capabilities'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

export function EditorContextToolbar({
  activeMode,
  currentSlide,
  onEditChart,
  onEditLatex,
  onOpenInspector,
  presentation,
  runtime,
  session,
}: {
  activeMode: Exclude<ContextualMode, 'crop' | 'text-edit'>
  currentSlide: Slide
  onEditChart: (id: string) => void
  onEditLatex: (id: string) => void
  onOpenInspector: (state: EditorToolbarState) => void
  presentation: PresentationState
  runtime: EditorRuntime
  session: EditorSessionState
}) {
  const { t } = useTranslation()
  const toolbarRef = useRef<HTMLDivElement>(null)
  const capabilities = resolveSelectionCapabilities({
    activeElementIds: session.activeElementIds,
    activeGroupElementId: session.activeGroupElementId,
    activeMode,
    cropElementId: session.cropElementId,
    editingTextElementId: session.editingTextElementId,
    elements: currentSlide.elements,
    handleElementId: session.handleElementId,
    pageSelected: session.pageSelected,
  })

  useEffect(() => {
    const focusToolbar = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'F1' || (!event.ctrlKey && !event.metaKey)) return
      const first = toolbarRef.current?.querySelector<HTMLElement>(
        'button:not(:disabled), [role="button"]:not([aria-disabled="true"]), input:not(:disabled)',
      )
      if (!first) return
      event.preventDefault()
      first.focus()
    }
    document.addEventListener('keydown', focusToolbar)
    return () => document.removeEventListener('keydown', focusToolbar)
  }, [])

  const moveToolbarFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const target = event.target as HTMLElement
    if (target.matches('input, textarea, select, [role="slider"], [contenteditable="true"]')) return
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [role="button"]:not([aria-disabled="true"]), input:not(:disabled)',
    )).filter(control => control.offsetParent !== null)
    const index = controls.indexOf(target.closest<HTMLElement>('button, [role="button"], input') ?? target)
    if (index === -1 || !controls.length) return
    event.preventDefault()
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? controls.length - 1
        : event.key === 'ArrowRight'
          ? (index + 1) % controls.length
          : (index - 1 + controls.length) % controls.length
    controls[next]?.focus()
  }

  if (capabilities.selectionKind === 'empty') return null
  const context = {
    capabilities,
    currentSlide,
    onEditChart,
    onEditLatex,
    onOpenInspector,
    presentation,
    runtime,
    selectedCells: session.selectedTableCells,
  }

  return (
    <div
      aria-label={t('foundation.editor.inspector')}
      aria-keyshortcuts="Control+F1 Meta+F1"
      className="mona-editor-contextbar"
      data-contextual-mode={capabilities.mode}
      data-selection-kind={capabilities.selectionKind}
      onKeyDown={moveToolbarFocus}
      ref={toolbarRef}
      role="toolbar"
      tabIndex={-1}
    >
      <div className="mona-contextual-command-lane">
        <div className="mona-contextual-toolbar-group">
          <ContextualPrimaryControls context={context} />
          <ContextualDeepActions capabilities={capabilities} onOpenInspector={onOpenInspector} />
        </div>
      </div>
    </div>
  )
}
