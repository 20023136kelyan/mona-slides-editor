import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react'

import type { PointerPosition } from '@mona/editor-interactions'
import { editorActions, selectCurrentSlide, selectSession } from '@mona/editor-state'
import type { PPTElement, PPTTableElement } from '@mona/presentation-core/model'

import { EMPTY_EDITOR_SLIDE } from '@/features/editor/editor-canvas-preview'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { tableCellKey } from '@/features/editor/editor-table'

export interface ContextMenuState {
  readonly cell?: { column: number; row: number }
  readonly elementId?: string
  readonly position: PointerPosition
  readonly surface: 'canvas' | 'element' | 'table-cell'
}

/**
 * Canvas context-menu placement and lifecycle. Opening a menu first settles
 * selection (right-clicking an unselected element selects it, the way the
 * source editor behaves), so the actions the menu offers match what the click
 * targeted. `selectElement` is injected because that logic stays on the canvas
 * alongside the rest of the selection rules.
 */
export function useCanvasContextMenu({
  runtime,
  selectElement,
}: {
  runtime: EditorRuntime
  selectElement: (event: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>, element: PPTElement) => void
}) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const closeMenu = () => setMenu(null)

  // A scroll or resize invalidates the anchor point, so the menu closes
  // rather than floating away from whatever it was opened on.
  useEffect(() => {
    if (!menu) return undefined
    const close = () => setMenu(null)
    document.body.addEventListener('scroll', close)
    window.addEventListener('resize', close)
    return () => {
      document.body.removeEventListener('scroll', close)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  const openCanvasMenu = (position: PointerPosition) => setMenu({ position, surface: 'canvas' })

  const openElementMenu = (event: ReactMouseEvent<HTMLElement>, element: PPTElement) => {
    event.preventDefault()
    event.stopPropagation()
    const liveState = runtime.store.getState()
    const liveSession = selectSession(liveState)
    const liveSlide = selectCurrentSlide(liveState) ?? EMPTY_EDITOR_SLIDE
    const liveElement = liveSlide.elements.find(item => item.id === element.id) ?? element
    if (!liveElement.lock) {
      if (!liveSession.activeElementIds.includes(liveElement.id)) selectElement(event.nativeEvent, liveElement)
      else if (event.ctrlKey || event.metaKey || event.shiftKey) selectElement(event.nativeEvent, liveElement)
      else if (liveSession.handleElementId !== liveElement.id) {
        runtime.store.dispatch(editorActions.handleElementChanged(liveElement.id))
      }
    }
    setMenu({
      elementId: liveElement.id,
      position: { x: event.clientX, y: event.clientY },
      surface: 'element',
    })
  }

  const openTableCellMenu = (
    event: ReactMouseEvent<HTMLElement>,
    element: PPTTableElement,
    row: number,
    column: number,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    if (!selectSession(runtime.store.getState()).activeElementIds.includes(element.id)) {
      runtime.store.dispatch(editorActions.selectionChanged([element.id]))
    }
    runtime.store.dispatch(editorActions.handleElementChanged(element.id))
    const selected = selectSession(runtime.store.getState()).selectedTableCells
    const key = tableCellKey(row, column)
    if (!selected.includes(key)) runtime.store.dispatch(editorActions.selectedTableCellsChanged([key]))
    setMenu({
      cell: { row, column },
      elementId: element.id,
      position: { x: event.clientX, y: event.clientY },
      surface: 'table-cell',
    })
  }

  return { closeMenu, menu, openCanvasMenu, openElementMenu, openTableCellMenu }
}
