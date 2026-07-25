import type { RefObject } from 'react'

import { editorActions, selectCurrentSlide, selectPresentation, selectSession } from '@mona/editor-state'
import type { PPTElement, PPTTableElement } from '@mona/presentation-core/model'
import { createPresentationId } from '@mona/presentation-core'

import { EMPTY_EDITOR_SLIDE } from '@/features/editor/editor-canvas-preview'
import {
  alignElementsToCanvas,
  groupElements,
  orderElement,
  ungroupElements,
} from '@/features/editor/editor-geometry'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import {
  deleteTableColumn,
  deleteTableRow,
  insertTableColumn,
  insertTableRow,
  mergeTableCells,
  splitTableCell,
  tableCellKey,
} from '@/features/editor/editor-table'
import type { ContextMenuState } from '@/features/editor/use-canvas-context-menu'
import { writeClipboard } from '@/features/editor/use-canvas-hotkeys'

export interface CanvasMenuActionContext {
  closeMenu: () => void
  commitElementLockChange: (input: {
    action: 'lock' | 'unlock'
    elements: readonly PPTElement[]
    selectedIds: readonly string[]
    targetElementId?: string
  }) => void
  deleteCurrentSelection: () => void
  gridLineSize: number
  menu: ContextMenuState | null
  openLinkEditorFor: (element: PPTElement) => void
  runtime: EditorRuntime
  showRuler: boolean
  stageRef: RefObject<HTMLElement | null>
  startPresentation: (options: { fromStart: boolean }) => void
}

/**
 * Dispatches a canvas context-menu action. Every branch re-reads live store
 * state rather than trusting the render that opened the menu, because the
 * menu can outlive edits made while it is open.
 *
 * This is a plain function, not a hook: it holds no state, so its
 * collaborators are passed in explicitly instead of captured from a closure.
 */
export function runCanvasMenuAction(action: string, context: CanvasMenuActionContext) {
  const {
    closeMenu, commitElementLockChange, deleteCurrentSelection, gridLineSize,
    menu, openLinkEditorFor, runtime, showRuler, stageRef, startPresentation,
  } = context
  closeMenu()
  stageRef.current?.focus()
  const liveRootState = runtime.store.getState()
  const livePresentation = selectPresentation(liveRootState)
  const liveSession = selectSession(liveRootState)
  const liveCurrentSlide = selectCurrentSlide(liveRootState) ?? EMPTY_EDITOR_SLIDE
  const liveActiveElementIds = liveSession.activeElementIds
  const liveMenuElement = menu?.elementId
    ? liveCurrentSlide.elements.find(element => element.id === menu.elementId)
    : undefined

  if (action.startsWith('table-') && liveMenuElement?.type === 'table' && menu?.cell) {
    const selected = liveSession.selectedTableCells.length
      ? liveSession.selectedTableCells
      : [tableCellKey(menu.cell.row, menu.cell.column)]
    let next: PPTTableElement | null = null
    if (action === 'table-insert-column-left') next = insertTableColumn(liveMenuElement, menu.cell.column)
    else if (action === 'table-insert-column-right') next = insertTableColumn(liveMenuElement, menu.cell.column + 1)
    else if (action === 'table-insert-row-above') next = insertTableRow(liveMenuElement, menu.cell.row)
    else if (action === 'table-insert-row-below') next = insertTableRow(liveMenuElement, menu.cell.row + 1)
    else if (action === 'table-delete-column') next = deleteTableColumn(liveMenuElement, menu.cell.column)
    else if (action === 'table-delete-row') next = deleteTableRow(liveMenuElement, menu.cell.row)
    else if (action === 'table-merge') {
      next = mergeTableCells(liveMenuElement, selected)
      runtime.store.dispatch(editorActions.selectedTableCellsChanged([]))
    }
    else if (action === 'table-split') {
      next = splitTableCell(liveMenuElement, menu.cell.row, menu.cell.column)
      runtime.store.dispatch(editorActions.selectedTableCellsChanged([]))
    }
    else if (action === 'table-select-column') {
      runtime.store.dispatch(editorActions.selectedTableCellsChanged(liveMenuElement.data.map((_row, row) => tableCellKey(row, menu.cell!.column))))
    }
    else if (action === 'table-select-row') {
      runtime.store.dispatch(editorActions.selectedTableCellsChanged(liveMenuElement.data[menu.cell.row]!.map((_cell, column) => tableCellKey(menu.cell!.row, column))))
    }
    else if (action === 'table-select-all') {
      runtime.store.dispatch(editorActions.selectedTableCellsChanged(liveMenuElement.data.flatMap((row, rowIndex) => row.map((_cell, column) => tableCellKey(rowIndex, column)))))
    }
    if (next && next !== liveMenuElement) {
      runtime.commit('Edit table', [{
        type: 'element.update',
        payload: { id: next.id, props: { data: next.data, width: next.width, colWidths: next.colWidths } },
      }])
    }
    return
  }

  if (action === 'copy') void writeClipboard(runtime.copySelection())
  else if (action === 'cut') void writeClipboard(runtime.cutSelection())
  else if (action === 'paste') {
    if (!runtime.paste().length && navigator.clipboard) {
      void navigator.clipboard.readText().then(serialized => runtime.paste(serialized)).catch(() => undefined)
    }
  }
  else if (action === 'delete') deleteCurrentSelection()
  else if (action === 'select-all') runtime.selectAll()
  else if (action === 'ruler') runtime.store.dispatch(editorActions.rulerVisibilityChanged(!showRuler))
  else if (action === 'grid-toggle') runtime.store.dispatch(editorActions.gridLineSizeChanged(gridLineSize ? 0 : 50))
  else if (action.startsWith('grid-')) runtime.store.dispatch(editorActions.gridLineSizeChanged(Number(action.slice(5))))
  else if (action === 'reset-slide') {
    const elementIds = liveCurrentSlide.elements.map(element => element.id)
    if (elementIds.length && runtime.commit('Reset slide', [{ type: 'element.delete', elementIds }])) {
      runtime.store.dispatch(editorActions.selectionChanged([]))
    }
  }
  else if (action === 'slideshow') {
    startPresentation({ fromStart: true })
  }
  else if (action.startsWith('align-')) {
    const command = action.slice('align-'.length) as Parameters<typeof alignElementsToCanvas>[0]['command']
    const elements = alignElementsToCanvas({
      command,
      elements: liveCurrentSlide.elements,
      selectedIds: new Set(liveActiveElementIds),
      viewportHeight: livePresentation.viewportSize * livePresentation.viewportRatio,
      viewportWidth: livePresentation.viewportSize,
    })
    runtime.commit('Align elements to slide', [{ type: 'slide.update', props: { elements } }])
  }
  else if (['bring-front', 'bring-forward', 'send-back', 'send-backward'].includes(action)) {
    const orderTarget = liveMenuElement ?? liveCurrentSlide.elements.find(element => element.id === liveSession.handleElementId)
    if (!orderTarget) return
    const command = ({
      'bring-front': 'top',
      'bring-forward': 'up',
      'send-back': 'bottom',
      'send-backward': 'down',
    } as const)[action as 'bring-front' | 'bring-forward' | 'send-back' | 'send-backward']
    const elements = orderElement(liveCurrentSlide.elements, orderTarget.id, command)
    if (elements) runtime.commit('Reorder elements', [{ type: 'slide.update', props: { elements } }])
  }
  else if (action === 'group') {
    const selected = new Set(liveActiveElementIds)
    const elements = groupElements(liveCurrentSlide.elements, selected, createPresentationId(10))
    runtime.commit('Group elements', [{ type: 'slide.update', props: { elements } }])
  }
  else if (action === 'ungroup') {
    const elements = ungroupElements(liveCurrentSlide.elements, new Set(liveActiveElementIds))
    if (!elements) return
    const changed = runtime.commit('Ungroup elements', [{ type: 'slide.update', props: { elements } }])
    const selectedId = liveMenuElement?.id ?? liveSession.handleElementId ?? liveActiveElementIds[0]
    if (changed && selectedId) runtime.store.dispatch(editorActions.selectionChanged([selectedId]))
  }
  else if (action === 'lock' || action === 'unlock') {
    commitElementLockChange({
      action,
      elements: liveCurrentSlide.elements,
      selectedIds: liveActiveElementIds,
      targetElementId: liveMenuElement?.id,
    })
  }
  else if (action === 'set-link' && liveMenuElement) {
    openLinkEditorFor(liveMenuElement)
  }
}
