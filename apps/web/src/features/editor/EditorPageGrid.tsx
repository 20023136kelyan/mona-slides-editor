/* oxlint-disable jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/prefer-tag-over-role -- page cards are rich sortable listbox options; a native option cannot contain slide previews and metadata. */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyPlus, Eye, EyeOff, ListChecks, Plus, Trash2, X } from 'lucide-react'
import Sortable from 'sortablejs'

import { editorActions, selectPresentation, selectSession } from '@mona/editor-state'

import { Button } from '@/components/ui/button'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { ScaledSlide } from '@/features/presentation-renderer/ScaledSlide'
import { cn } from '@/lib/utils'

// `mona-page-grid-item` stays: sortablejs and several querySelector calls
// target it. Drop indicator uses the data-drop-side attribute the DnD sets.
const PAGE_GRID_ITEM = 'mona-page-grid-item group/page relative min-w-0 cursor-pointer outline-none transition-[opacity,transform] '
  + '[&.is-drag-chosen]:opacity-72 [&.is-dragging]:cursor-grabbing [&.is-dragging]:opacity-92 [&.is-drag-ghost]:opacity-30 '
  + '[&.is-drop-target]:before:absolute [&.is-drop-target]:before:top-0 [&.is-drop-target]:before:bottom-5.5 [&.is-drop-target]:before:z-[8] '
  + '[&.is-drop-target]:before:w-1 [&.is-drop-target]:before:rounded-pill [&.is-drop-target]:before:bg-editor-selection-strong '
  + '[&.is-drop-target]:before:shadow-[0_0_0_2px_#fff] [&.is-drop-target]:before:content-[""] '
  + '[&.is-drop-target[data-drop-side=before]]:before:-left-3 [&.is-drop-target[data-drop-side=after]]:before:-right-3'

export const EditorPageGrid = memo(function EditorPageGrid({
  runtime,
}: {
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const session = useEditorSelector(runtime.store, selectSession)
  const gridRef = useRef<HTMLDivElement>(null)
  const dragCancelledRef = useRef(false)
  const dragMovedRef = useRef(false)
  const dragOriginOrderRef = useRef<string[]>([])
  const selectionAnchorRef = useRef(presentation.slideIndex)
  const [announcement, setAnnouncement] = useState('')
  const announcementRef = useRef<HTMLSpanElement>(null)
  const announce = useCallback((message: string) => {
    setAnnouncement(message)
    if (announcementRef.current) announcementRef.current.textContent = message
  }, [])
  const selectedIndexes = useMemo(
    () => Array.from(new Set([...session.selectedSlideIndexes, presentation.slideIndex])).sort((a, b) => a - b),
    [presentation.slideIndex, session.selectedSlideIndexes],
  )

  useEffect(() => {
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>('.mona-page-grid-item.is-active')?.focus())
  }, [])
  const reorderPage = useCallback((oldIndex: number, newIndex: number) => {
    const current = runtime.store.getState().presentation
    const slide = current.slides[oldIndex]
    if (!slide || oldIndex === newIndex || !runtime.reorderSlide(oldIndex, newIndex)) return false
    announce(t('foundation.editor.thumbnails.movedSlide', {
      position: newIndex + 1,
      title: slide.title || t('foundation.editor.statusBar.untitledPage'),
      total: current.slides.length,
    }))
    return true
  }, [announce, runtime, t])

  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return undefined
    const clearDropTarget = () => {
      const target = grid.querySelector<HTMLElement>('.is-drop-target')
      target?.classList.remove('is-drop-target')
      target?.removeAttribute('data-drop-side')
    }
    let pendingDropTimer = 0
    const finishDrag = () => {
      clearDropTarget()
      grid.classList.remove('is-dragging', 'is-drag-cancelled')
      dragCancelledRef.current = false
      dragMovedRef.current = false
      dragOriginOrderRef.current = []
    }
    const sortable = Sortable.create(grid, {
      animation: 180,
      chosenClass: 'is-drag-chosen',
      dataIdAttr: 'data-id',
      draggable: '.mona-page-grid-item',
      dragClass: 'is-dragging',
      ghostClass: 'is-drag-ghost',
      scroll: true,
      scrollSensitivity: 60,
      onStart: event => {
        dragCancelledRef.current = false
        dragMovedRef.current = false
        dragOriginOrderRef.current = runtime.store.getState().presentation.slides.map(slide => slide.id)
        grid.classList.add('is-dragging')
        const oldIndex = event.oldDraggableIndex ?? event.oldIndex ?? 0
        const slide = runtime.store.getState().presentation.slides[oldIndex]
        if (slide) {
          announce(t('foundation.editor.thumbnails.movingSlide', {
            title: slide.title || t('foundation.editor.statusBar.untitledPage'),
          }))
        }
      },
      onMove: event => {
        clearDropTarget()
        if (dragCancelledRef.current) return false
        if (event.related.matches('.mona-page-grid-item')) {
          dragMovedRef.current = true
          event.related.classList.add('is-drop-target')
          event.related.setAttribute('data-drop-side', event.willInsertAfter ? 'after' : 'before')
        }
        return true
      },
      onEnd: event => {
        const cancelled = dragCancelledRef.current
        const oldIndex = event.oldDraggableIndex ?? event.oldIndex
        const newIndex = event.newDraggableIndex ?? event.newIndex
        clearDropTarget()
        if (cancelled) {
          sortable.sort(dragOriginOrderRef.current, true)
          finishDrag()
        }
        else if (oldIndex !== undefined && newIndex !== undefined && oldIndex !== newIndex) {
          pendingDropTimer = window.setTimeout(() => {
            if (dragCancelledRef.current) sortable.sort(dragOriginOrderRef.current, true)
            else reorderPage(oldIndex, newIndex)
            finishDrag()
          }, 50)
        }
        else {
          if (dragMovedRef.current) announce(t('foundation.editor.thumbnails.moveCancelled'))
          finishDrag()
        }
      },
    })
    const cancelDrag = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || !grid.classList.contains('is-dragging')) return
      event.preventDefault()
      event.stopPropagation()
      dragCancelledRef.current = true
      clearDropTarget()
      sortable.sort(dragOriginOrderRef.current, true)
      grid.classList.add('is-drag-cancelled')
      announce(t('foundation.editor.thumbnails.moveCancelled'))
    }
    const detectNativeCancellation = (event: DragEvent) => {
      if (!grid.classList.contains('is-dragging') || event.dataTransfer?.dropEffect !== 'none') return
      dragCancelledRef.current = true
      announce(t('foundation.editor.thumbnails.moveCancelled'))
    }
    document.addEventListener('keydown', cancelDrag, true)
    grid.addEventListener('dragend', detectNativeCancellation, true)
    return () => {
      window.clearTimeout(pendingDropTimer)
      document.removeEventListener('keydown', cancelDrag, true)
      grid.removeEventListener('dragend', detectNativeCancellation, true)
      sortable.destroy()
    }
  }, [announce, reorderPage, runtime, t])

  const selectPage = (
    event: Pick<MouseEvent | KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>,
    index: number,
  ) => {
    const live = runtime.store.getState()
    const current = live.presentation.slideIndex
    const selected = Array.from(new Set([...live.session.selectedSlideIndexes, current]))
    if (event.shiftKey) {
      const anchor = Math.max(0, Math.min(selectionAnchorRef.current, live.presentation.slides.length - 1))
      const lower = Math.min(anchor, index)
      const upper = Math.max(anchor, index)
      runtime.focusSlide(index)
      runtime.store.dispatch(editorActions.selectedSlideIndexesChanged(Array.from(
        { length: upper - lower + 1 },
        (_, offset) => lower + offset,
      )))
      return
    }
    if (event.metaKey || event.ctrlKey) {
      if (index === current && selected.length === 1) return
      if (selected.includes(index)) {
        const next = selected.filter(item => item !== index)
        runtime.store.dispatch(editorActions.selectedSlideIndexesChanged(next))
        if (index === current && next[0] !== undefined) runtime.focusSlide(next[0])
      }
      else runtime.store.dispatch(editorActions.selectedSlideIndexesChanged([...selected, index]))
      return
    }
    selectionAnchorRef.current = index
    runtime.store.dispatch(editorActions.selectedSlideIndexesChanged([]))
    runtime.focusSlide(index)
  }
  const focusGridPage = (
    event: KeyboardEvent<HTMLElement>,
    index: number,
  ) => {
    const cards = Array.from(gridRef.current?.querySelectorAll<HTMLElement>('.mona-page-grid-item') ?? [])
    let target = index
    if (event.key === 'ArrowLeft') target = index - 1
    else if (event.key === 'ArrowRight') target = index + 1
    else if (event.key === 'Home') target = 0
    else if (event.key === 'End') target = cards.length - 1
    else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const cardWidth = cards[0]?.getBoundingClientRect().width ?? 240
      const gridWidth = gridRef.current?.getBoundingClientRect().width ?? cardWidth
      const styles = gridRef.current ? getComputedStyle(gridRef.current) : null
      const gap = Number.parseFloat(styles?.columnGap || styles?.gap || '0')
      const columns = Math.max(1, Math.floor((gridWidth + gap) / (cardWidth + gap)))
      target = index + (event.key === 'ArrowUp' ? -columns : columns)
    }
    else return
    event.preventDefault()
    target = Math.max(0, Math.min(target, cards.length - 1))
    if (event.altKey) {
      if (target !== index) {
        if (reorderPage(index, target)) {
          selectionAnchorRef.current = target
          requestAnimationFrame(() => {
            const reordered = Array.from(gridRef.current?.querySelectorAll<HTMLElement>('.mona-page-grid-item') ?? [])
            reordered[target]?.focus()
          })
        }
      }
      return
    }
    selectPage(event, target)
    requestAnimationFrame(() => cards[target]?.focus())
  }
  const updateSelected = (hidden: boolean) => {
    const slides = runtime.store.getState().presentation.slides
    runtime.commit(hidden ? 'Hide selected pages' : 'Show selected pages', selectedIndexes.map(index => ({
      type: 'slide.update' as const,
      slideId: slides[index]!.id,
      props: { hidden },
    })), { historyKey: 'page-grid-visibility' })
  }
  const returnToCanvas = (focus: 'canvas' | 'trigger' = 'trigger') => {
    runtime.store.dispatch(editorActions.workspaceModeChanged('canvas'))
    runtime.store.dispatch(editorActions.filmstripVisibilityChanged(true))
    requestAnimationFrame(() => {
      const target = focus === 'canvas'
        ? document.getElementById('mona-editor-canvas')
        : document.querySelector<HTMLElement>('[data-grid-view-trigger]')
      target?.focus()
    })
  }

  return (
    <section aria-label={t('foundation.editor.statusBar.gridView')} className="mona-page-grid-workspace flex min-h-0 flex-1 flex-col overflow-hidden bg-[#f3f4f7] px-5.5 pt-4.5">
      <span aria-live="polite" className="sr-only" ref={announcementRef}>{announcement}</span>
      <header className="flex flex-none items-center justify-between gap-5 pb-4 [&>div:first-child]:min-w-0 [&_h2]:m-0 [&_h2]:text-lg [&_h2]:font-[650] [&>div>span]:text-tiny [&>div>span]:text-muted-foreground">
        <div>
          <h2>{t('foundation.editor.statusBar.gridView')}</h2>
          <span>{t('foundation.editor.statusBar.selectedPages', { count: selectedIndexes.length })}</span>
        </div>
        <div className="flex min-w-0 items-center justify-end gap-1 overflow-x-auto [overscroll-behavior-inline:contain] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Button onClick={() => runtime.selectAllSlides()} size="sm" type="button" variant="ghost"><ListChecks />{t('foundation.editor.action.selectAll')}</Button>
          <Button onClick={() => runtime.createSlide()} size="sm" type="button" variant="ghost"><Plus />{t('foundation.editor.thumbnails.addSlide')}</Button>
          <Button onClick={() => updateSelected(false)} size="sm" type="button" variant="ghost"><Eye />{t('foundation.editor.statusBar.showPages')}</Button>
          <Button onClick={() => updateSelected(true)} size="sm" type="button" variant="ghost"><EyeOff />{t('foundation.editor.statusBar.hidePages')}</Button>
          <Button onClick={() => runtime.duplicateSlides()} size="sm" type="button" variant="ghost"><CopyPlus />{t('foundation.editor.thumbnails.duplicateSlide')}</Button>
          <Button onClick={() => runtime.deleteSlides()} size="sm" type="button" variant="ghost"><Trash2 />{t('foundation.editor.thumbnails.deleteSlide')}</Button>
          <Button aria-label={t('foundation.editor.statusBar.closeGrid')} onClick={() => returnToCanvas('trigger')} size="icon-sm" type="button" variant="ghost"><X /></Button>
        </div>
      </header>
      <div
        aria-label={t('foundation.editor.statusBar.gridView')}
        aria-multiselectable="true"
        className="grid min-h-0 grid-cols-[repeat(auto-fill,minmax(240px,1fr))] content-start gap-5.5 overflow-y-auto px-1.5 pt-1 pb-7"
        ref={gridRef}
        role="listbox"
      >
        {presentation.slides.map((slide, index) => (
          <article
            aria-label={`${t('foundation.editor.showSlide', { number: index + 1 })}${slide.title ? `: ${slide.title}` : ''}`}
            aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown"
            aria-selected={selectedIndexes.includes(index)}
            className={cn(
              PAGE_GRID_ITEM,
              index === presentation.slideIndex && 'is-active',
              selectedIndexes.includes(index) && 'is-selected',
              slide.hidden && 'is-hidden [&_[data-grid-preview]]:opacity-55',
            )}
            data-id={slide.id}
            key={slide.id}
            onDoubleClick={() => returnToCanvas('canvas')}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                selectPage(event, index)
                returnToCanvas('canvas')
              }
              else if (event.key === ' ') {
                event.preventDefault()
                selectPage(event, index)
              }
              else focusGridPage(event, index)
            }}
            onMouseDown={event => selectPage(event, index)}
            role="option"
            tabIndex={index === presentation.slideIndex ? 0 : -1}
          >
            <div className="relative w-fit max-w-full rounded-surface shadow-[0_0_0_1px_rgb(16_18_25/9%)] transition-[box-shadow,opacity] duration-[120ms] group-hover/page:shadow-[0_0_0_2px_rgb(16_18_25/24%)] [.is-active_&]:shadow-[0_0_0_2px_#fff,0_0_0_5px_rgb(16_18_25/82%)] [.is-selected_&]:shadow-[0_0_0_2px_#fff,0_0_0_5px_rgb(16_18_25/82%)] [&_.mona-scaled-slide]:overflow-hidden [&_.mona-scaled-slide]:rounded-[inherit]" data-grid-preview>
              <ScaledSlide
                fixedWidth={240}
                slide={slide}
                sourcePackages={presentation.sourcePackages}
                theme={presentation.theme}
                thumbnail
                viewportRatio={presentation.viewportRatio}
                viewportSize={presentation.viewportSize}
                visible
              />
              <span className="absolute bottom-1.5 left-1.5 min-w-5 rounded-control bg-white px-1.5 py-0.5 text-center text-mini font-[650] shadow-[0_1px_3px_rgb(16_18_25/15%)]">{index + 1}</span>
              {slide.hidden ? <span className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 rounded-control bg-white/92 px-1.5 py-0.75 text-micro font-[650] text-ink/70 [&_svg]:size-3"><EyeOff />{t('foundation.editor.statusBar.hidden')}</span> : null}
            </div>
            <div className="flex min-w-0 items-center justify-between gap-2 px-0.5 pt-2.5 [&_strong]:overflow-hidden [&_strong]:text-xs [&_strong]:text-ellipsis [&_strong]:whitespace-nowrap [&>span]:flex-none [&>span]:text-mini [&>span]:text-muted-foreground">
              <strong>{slide.title || t('foundation.editor.statusBar.untitledPage')}</strong>
              <span>{slide.durationMs ? `${slide.durationMs / 1000}s` : t('foundation.editor.statusBar.manual')}</span>
            </div>
          </article>
        ))}
        <Button className="flex min-h-42.5 flex-col gap-2 rounded-surface border-0 bg-[#e7e9ee] text-ink/70 hover:bg-[#dde0e6] hover:text-ink" onClick={() => runtime.createSlide()} type="button" variant="outline">
          <Plus />
          <span>{t('foundation.editor.thumbnails.addSlide')}</span>
        </Button>
      </div>
    </section>
  )
})
