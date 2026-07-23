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
      className="mona-editor-contextbar absolute top-5 right-0 left-0 z-30 flex min-w-0 items-center gap-2.5 bg-transparent px-3 pointer-events-none"
      data-contextual-mode={capabilities.mode}
      data-selection-kind={capabilities.selectionKind}
      onKeyDown={moveToolbarFocus}
      ref={toolbarRef}
      role="toolbar"
      tabIndex={-1}
    >
      <div className="mona-contextual-command-lane flex min-w-0 flex-1 items-center justify-start overflow-visible">
        <div className="mona-contextual-toolbar-group pointer-events-auto mx-auto flex h-10 w-max max-w-full flex-none items-center overflow-x-auto rounded-[var(--radius-overlay)] bg-white px-1.5 shadow-[0_0_0_0.5px_rgb(64_79_109/7%),0_2px_5px_0_rgb(21_30_130/12%),0_6px_12px_0_rgb(21_30_130/6%)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <ContextualPrimaryControls context={context} />
          <ContextualDeepActions capabilities={capabilities} onOpenInspector={onOpenInspector} />
        </div>
      </div>
    </div>
  )
}
