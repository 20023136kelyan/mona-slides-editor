import type { PointerEvent as ReactPointerEvent } from 'react'

const DRAG_THRESHOLD = 4

// Only one pointer drag can be live at a time, so a single module-level
// cancel hook is enough to abort a drag when a new one starts (or when the
// owning panel unmounts mid-drag).
let activeCancel: (() => void) | null = null

export function cancelListReorder() {
  activeCancel?.()
}

/**
 * Pointer-drag loop shared by inspector lists that reorder rows by dragging
 * (theme colors, animation sequence). Tracks the pointer against the vertical
 * midpoints of `getRows()` and reports the drop index via `onReorder`.
 */
export function startListReorder(event: ReactPointerEvent<HTMLElement>, from: number, {
  getRows,
  onDragEnd,
  onDragStart,
  onReorder,
}: {
  getRows: () => Iterable<HTMLElement>
  onDragEnd?: (moved: boolean) => void
  onDragStart?: (index: number) => void
  onReorder: (from: number, to: number) => void
}) {
  if (event.button !== 0) return
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('button, input, select, .mona-panel-select')) return
  activeCancel?.()
  const startY = event.clientY
  let to = from
  let moved = false
  const move = (pointer: PointerEvent) => {
    if (!moved && Math.abs(pointer.clientY - startY) < DRAG_THRESHOLD) return
    if (!moved) onDragStart?.(from)
    moved = true
    const rows = [...getRows()]
    const firstAfterPointer = rows.findIndex(row => pointer.clientY <= row.getBoundingClientRect().top + (row.getBoundingClientRect().height / 2))
    to = firstAfterPointer === -1 ? Math.max(rows.length - 1, 0) : firstAfterPointer
  }
  const cleanup = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
    activeCancel = null
  }
  const stop = () => {
    cleanup()
    onDragEnd?.(moved)
    if (moved && to !== from) onReorder(from, to)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop, { once: true })
  window.addEventListener('pointercancel', stop, { once: true })
  activeCancel = cleanup
}
