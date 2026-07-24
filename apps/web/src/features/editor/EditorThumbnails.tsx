/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/control-has-associated-label, jsx-a11y/interactive-supports-focus, jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/no-static-element-interactions, jsx-a11y/prefer-tag-over-role, jsx-a11y/role-supports-aria-props -- sortable thumbnails and editable section labels are composite direct-manipulation surfaces with named outer controls. */
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import Sortable from 'sortablejs'
import {
  BetweenHorizontalEnd,
  ClipboardPaste,
  Clock3,
  Copy,
  CopyPlus,
  EyeOff,
  FilePlus2,
  FolderMinus,
  FolderPlus,
  FolderX,
  MonitorPlay,
  Pencil,
  Scissors,
  SquareDashedMousePointer,
  Trash2,
  type LucideIcon,
} from 'lucide-react'

import PlusIcon from '~icons/icon-park-outline/plus'
import { editorActions } from '@mona/editor-state'
import type { PowerPointPackageReference } from '@mona/presentation-core'
import type { Slide, SlideTheme } from '@mona/presentation-core/model'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEdgeFade } from '@/features/editor/use-edge-fade'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { useEditorApplication } from '@/features/editor/services/editor-application'
import { ScaledSlide } from '@/features/presentation-renderer/ScaledSlide'

interface ThumbnailMenuItem {
  action?: string
  disabled?: boolean
  divider?: boolean
  icon?: LucideIcon
  label?: string
  shortcut?: string
}

type ThumbnailMenu = {
  items: ThumbnailMenuItem[]
  label: string
  x: number
  y: number
}

function ThumbnailContextMenu({ menu, onAction, onDismiss }: {
  menu: ThumbnailMenu
  onAction: (action: string) => void
  onDismiss: () => void
}) {
  // Portal to <body>: the filmstrip's frosted bottom bar uses backdrop-filter,
  // which makes the fixed anchor span resolve against the bar instead of the
  // viewport and flings the menu off-screen. Rendering at the document root
  // restores viewport-relative fixed positioning at the cursor.
  return createPortal(
    <DropdownMenu onOpenChange={open => {
      if (!open) onDismiss()
    }} open>
      <DropdownMenuTrigger asChild>
        <span aria-hidden="true" className="pointer-events-none fixed" style={{ left: menu.x, top: menu.y }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent aria-label={menu.label} align="start" className="w-auto min-w-52" onContextMenu={event => event.preventDefault()} side="bottom" sideOffset={0}>
        {menu.items.map((item, index) => {
          if (item.divider) return <DropdownMenuSeparator key={`divider-${index}`} />
          const Icon = item.icon
          return (
            <DropdownMenuItem className="gap-2.5 py-1.5" disabled={item.disabled} key={item.action} onSelect={() => {
              if (item.action) onAction(item.action)
            }}>
              {Icon ? <Icon className="size-5" /> : null}
              {item.label}
              {item.shortcut ? <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>,
    document.body,
  )
}

// Only the expensive miniature render trails canvas edits at background
// priority; the filmstrip's structure around it stays live.
const FilmstripThumbnailPreview = memo(function FilmstripThumbnailPreview({
  slide,
  sourcePackages,
  theme,
  viewportRatio,
  viewportSize,
  visible,
}: {
  slide: Slide
  sourcePackages?: readonly PowerPointPackageReference[]
  theme: SlideTheme
  viewportRatio: number
  viewportSize: number
  visible: boolean
}) {
  const deferredSlide = useDeferredValue(slide)
  const deferredTheme = useDeferredValue(theme)
  return <ScaledSlide fixedWidth={128} slide={deferredSlide} sourcePackages={sourcePackages} theme={deferredTheme} thumbnail viewportRatio={viewportRatio} viewportSize={viewportSize} visible={visible} />
})

export const EditorThumbnails = memo(function EditorThumbnails({ runtime, onOpenNotes, onOpenTransition, onStartSlideshow }: {
  runtime: EditorRuntime
  onOpenNotes: () => void
  onOpenTransition: (slideIndex: number) => void
  onStartSlideshow: (fromCurrent: boolean) => void
}) {
  const { t } = useTranslation()
  const { subscribeToPresentationStart } = useEditorApplication()
  const state = runtime.store.getState()
  // Filmstrip STRUCTURE (slide ids, order, counts, selection) always renders
  // live — click and Sortable handlers map indexes onto the live deck, so a
  // stale structural render could select or reorder the wrong slide. Only
  // each thumbnail's expensive miniature defers (FilmstripThumbnailPreview).
  const presentation = useEditorSelector(runtime.store, current => current.presentation)
  const selectedSlideIndexes = useEditorSelector(runtime.store, current => current.session.selectedSlideIndexes)
  const thumbnailsFocus = useEditorSelector(runtime.store, current => current.session.thumbnailsFocus)
  const [editingSectionId, setEditingSectionId] = useState('')
  const [menu, setMenu] = useState<ThumbnailMenu | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const announcementRef = useRef<HTMLSpanElement>(null)
  const announce = useCallback((message: string) => {
    setAnnouncement(message)
    if (announcementRef.current) announcementRef.current.textContent = message
  }, [])

  // Transient portaled UI escapes the editor's hidden <Activity> wrapper
  // (portals render into document.body), so it must close when a slideshow
  // starts or it would float over the show.
  useEffect(() => {
    return subscribeToPresentationStart(() => setMenu(null))
  }, [subscribeToPresentationStart])
  const [slidesLoadLimit, setSlidesLoadLimit] = useState(() => state.presentation.slides.length <= 50 ? 9999 : 50)
  const listRef = useRef<HTMLDivElement>(null)
  // Fade whichever edge has slides cut off behind it.
  useEdgeFade(listRef, 'x', presentation.slides.length)
  const sortableRef = useRef<Sortable | null>(null)
  const dragCancelledRef = useRef(false)
  const dragMovedRef = useRef(false)
  const dragOriginOrderRef = useRef<string[]>([])
  const sectionInputRef = useRef<HTMLInputElement>(null)
  const menuReturnFocusRef = useRef<HTMLElement | null>(null)
  const previousSlideIndexRef = useRef(state.presentation.slideIndex)

  const selectedIndexes = useMemo(() => Array.from(new Set([...selectedSlideIndexes, presentation.slideIndex])), [presentation.slideIndex, selectedSlideIndexes])
  const hasSection = presentation.slides.some(slide => slide.sectionTag)
  const reorderThumbnail = useCallback((oldIndex: number, newIndex: number) => {
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
    if (presentation.slides.length <= slidesLoadLimit) return undefined
    const timer = window.setTimeout(() => setSlidesLoadLimit(current => {
      const next = current + 20
      return presentation.slides.length <= next ? 9999 : next
    }), 600)
    return () => window.clearTimeout(timer)
  }, [presentation.slides.length, slidesLoadLimit])

  useEffect(() => {
    const list = listRef.current
    if (!list) return undefined
    const clearDropTarget = () => {
      const target = list.querySelector<HTMLElement>('.is-drop-target')
      target?.classList.remove('is-drop-target')
      target?.removeAttribute('data-drop-side')
    }
    let pendingDropTimer = 0
    const finishDrag = () => {
      clearDropTarget()
      list.classList.remove('is-dragging', 'is-drag-cancelled')
      dragCancelledRef.current = false
      dragMovedRef.current = false
      dragOriginOrderRef.current = []
    }
    const sortable = Sortable.create(list, {
      animation: 200,
      chosenClass: 'is-drag-chosen',
      dataIdAttr: 'data-id',
      disabled: '' as unknown as boolean,
      // The trailing add tile lives inside the list but is not a slide:
      // scoping draggables keeps it fixed and out of reorder indexes.
      draggable: '.mona-thumbnail-container',
      dragClass: 'is-dragging',
      ghostClass: 'is-drag-ghost',
      scroll: true,
      scrollSensitivity: 50,
      onStart: event => {
        dragCancelledRef.current = false
        dragMovedRef.current = false
        dragOriginOrderRef.current = runtime.store.getState().presentation.slides.map(slide => slide.id)
        list.classList.add('is-dragging')
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
        if (event.related.matches('.mona-thumbnail-container')) {
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
            else reorderThumbnail(oldIndex, newIndex)
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
      if (event.key !== 'Escape' || !list.classList.contains('is-dragging')) return
      event.preventDefault()
      event.stopPropagation()
      dragCancelledRef.current = true
      clearDropTarget()
      sortable.sort(dragOriginOrderRef.current, true)
      list.classList.add('is-drag-cancelled')
      announce(t('foundation.editor.thumbnails.moveCancelled'))
    }
    const detectNativeCancellation = (event: DragEvent) => {
      if (!list.classList.contains('is-dragging') || event.dataTransfer?.dropEffect !== 'none') return
      dragCancelledRef.current = true
      announce(t('foundation.editor.thumbnails.moveCancelled'))
    }
    document.addEventListener('keydown', cancelDrag, true)
    list.addEventListener('dragend', detectNativeCancellation, true)
    sortableRef.current = sortable
    return () => {
      window.clearTimeout(pendingDropTimer)
      document.removeEventListener('keydown', cancelDrag, true)
      list.removeEventListener('dragend', detectNativeCancellation, true)
      sortableRef.current = null
      sortable.destroy()
    }
  }, [announce, reorderThumbnail, runtime, t])

  useEffect(() => {
    sortableRef.current?.option('disabled', editingSectionId as unknown as boolean)
  }, [editingSectionId])

  useEffect(() => {
    if (!editingSectionId) return
    sectionInputRef.current?.focus()
    sectionInputRef.current?.select()
  }, [editingSectionId])

  useEffect(() => {
    const list = listRef.current
    const active = list?.querySelector<HTMLElement>('.mona-thumbnail-item.is-active')
    if (!list || !active) return
    const listRect = list.getBoundingClientRect()
    const activeRect = active.getBoundingClientRect()
    if (activeRect.left >= listRect.left && activeRect.right <= listRect.right) return
    const timer = setTimeout(() => active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }), 100)
    return () => clearTimeout(timer)
  }, [presentation.slideIndex])

  useEffect(() => {
    if (previousSlideIndexRef.current === presentation.slideIndex) return
    previousSlideIndexRef.current = presentation.slideIndex
    const selected = runtime.store.getState().session.selectedSlideIndexes
    if (selected.length && !selected.includes(presentation.slideIndex)) {
      runtime.store.dispatch(editorActions.selectedSlideIndexesChanged([]))
    }
  }, [presentation.slideIndex, runtime])

  const setThumbnailFocus = (focus: boolean) => {
    if (thumbnailsFocus === focus) return
    runtime.store.dispatch(editorActions.thumbnailsFocusChanged(focus))
    if (focus) runtime.store.dispatch(editorActions.canvasFocusChanged(false))
  }

  // Deliberately NO View Transition anywhere in the filmstrip: selection
  // happens on mousedown, and an active VT overlay intercepts hit-testing for
  // its duration — the same gesture's contextmenu (right-click menu) or
  // mousemove stream (SortableJS drag-reorder) would target the overlay and
  // die. The slide-switch crossfade remains on canvas keyboard/wheel
  // navigation, where no same-gesture follow-up exists.
  const focusSlide = (index: number) => {
    runtime.store.dispatch(editorActions.selectionChanged([]))
    runtime.focusSlide(index)
  }

  const showContextMenu = (
    kind: 'rail' | 'section' | 'slide',
    target: HTMLElement,
    x: number,
    y: number,
    sectionId = '',
  ) => {
    menuReturnFocusRef.current = target
    const common = {
      x,
      y,
      label: t(kind === 'section' ? 'foundation.editor.thumbnails.sectionMenu' : 'foundation.editor.thumbnails.menu'),
    }
    if (kind === 'section') {
      setMenu({ ...common, items: [
        { action: `section-remove:${sectionId}`, icon: FolderMinus, label: t('foundation.editor.thumbnails.deleteSection') },
        { action: `section-delete:${sectionId}`, icon: FolderX, label: t('foundation.editor.thumbnails.deleteSectionAndSlides') },
        { action: 'section-remove-all', icon: Trash2, label: t('foundation.editor.thumbnails.deleteAllSections') },
        { action: `section-rename:${sectionId}`, icon: Pencil, label: t('foundation.editor.thumbnails.renameSection') },
      ] })
      return
    }
    const base = [
      { action: 'paste', icon: ClipboardPaste, label: t('foundation.editor.action.paste'), shortcut: 'Ctrl + V' },
      { action: 'select-all', icon: SquareDashedMousePointer, label: t('foundation.editor.action.selectAll'), shortcut: 'Ctrl + A' },
      { action: 'new-slide', icon: FilePlus2, label: t('foundation.editor.thumbnails.newSlide'), shortcut: 'Enter' },
    ]
    setMenu({ ...common, items: kind === 'rail' ? [
      ...base,
      { action: 'slideshow-start', icon: MonitorPlay, label: t('foundation.editor.thumbnails.slideshow'), shortcut: 'F5' },
    ] : [
      { action: 'cut', icon: Scissors, label: t('foundation.editor.action.cut'), shortcut: 'Ctrl + X' },
      { action: 'copy', icon: Copy, label: t('foundation.editor.action.copy'), shortcut: 'Ctrl + C' },
      ...base.slice(0, 2),
      { divider: true },
      ...base.slice(2),
      { action: 'duplicate', icon: CopyPlus, label: t('foundation.editor.thumbnails.duplicateSlide'), shortcut: 'Ctrl + D' },
      { action: 'delete', icon: Trash2, label: t('foundation.editor.thumbnails.deleteSlide'), shortcut: 'Delete' },
      { action: 'section-create', icon: FolderPlus, disabled: !!presentation.slides[presentation.slideIndex]?.sectionTag, label: t('foundation.editor.thumbnails.addSection') },
      { divider: true },
      { action: 'slideshow-current', icon: MonitorPlay, label: t('foundation.editor.thumbnails.fromCurrent'), shortcut: 'Shift + F5' },
    ] })
  }

  const openKeyboardContextMenu = (
    event: KeyboardEvent<HTMLElement>,
    kind: 'section' | 'slide',
    sectionId = '',
  ) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return false
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    showContextMenu(kind, event.currentTarget, rect.left + 12, rect.top + 12, sectionId)
    return true
  }

  const selectThumbnail = (
    event: Pick<MouseEvent | KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'> & { button: number },
    index: number,
  ) => {
    if (editingSectionId) return
    // Selection math always reads live store state so the filmstrip's deferred
    // render can never feed it a stale snapshot.
    const liveState = runtime.store.getState()
    const liveSlideIndex = liveState.presentation.slideIndex
    const liveSelected = [...new Set([...liveState.session.selectedSlideIndexes, liveSlideIndex])]
    const multiSelected = liveSelected.length > 1
    if (multiSelected && liveSelected.includes(index) && event.button !== 0) return
    const ctrl = event.ctrlKey || event.metaKey
    if (ctrl) {
      if (liveSlideIndex === index) {
        if (!multiSelected) return
        const next = liveSelected.filter(item => item !== index)
        runtime.store.dispatch(editorActions.selectedSlideIndexesChanged(next))
        focusSlide(next[0]!)
      }
      else if (liveSelected.includes(index)) {
        runtime.store.dispatch(editorActions.selectedSlideIndexesChanged(liveSelected.filter(item => item !== index)))
      }
      else runtime.store.dispatch(editorActions.selectedSlideIndexesChanged([...liveSelected, index]))
    }
    else if (event.shiftKey) {
      if (liveSlideIndex === index && !multiSelected) return
      let minIndex = Math.min(...liveSelected)
      let maxIndex = index
      if (index < minIndex) {
        maxIndex = Math.max(...liveSelected)
        minIndex = index
      }
      runtime.store.dispatch(editorActions.selectedSlideIndexesChanged(Array.from({ length: maxIndex - minIndex + 1 }, (_, offset) => minIndex + offset)))
    }
    else {
      runtime.store.dispatch(editorActions.selectedSlideIndexesChanged([]))
      focusSlide(index)
    }
  }
  const handleThumbnailKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.target !== event.currentTarget) return
    if (openKeyboardContextMenu(event, 'slide')) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      selectThumbnail({ button: 0, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey }, index)
      return
    }
    let target = index
    if (event.key === 'ArrowLeft') target = index - 1
    else if (event.key === 'ArrowRight') target = index + 1
    else if (event.key === 'Home') target = 0
    else if (event.key === 'End') target = presentation.slides.length - 1
    else return
    event.preventDefault()
    event.stopPropagation()
    target = Math.max(0, Math.min(target, presentation.slides.length - 1))
    if (event.altKey) {
      if (reorderThumbnail(index, target)) {
        requestAnimationFrame(() => {
          listRef.current?.querySelectorAll<HTMLElement>('.mona-thumbnail-item')[target]?.focus()
        })
      }
      return
    }
    selectThumbnail({ button: 0, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey }, target)
    requestAnimationFrame(() => {
      listRef.current?.querySelectorAll<HTMLElement>('.mona-thumbnail-item')[target]?.focus()
    })
  }

  const startSectionEdit = (sectionId: string) => {
    setEditingSectionId(sectionId || 'default')
    runtime.store.dispatch(editorActions.hotkeysDisabledChanged(true))
  }

  const saveSection = (value: string) => {
    if (!editingSectionId) return
    runtime.updateSectionTitle(editingSectionId, value)
    setEditingSectionId('')
    runtime.store.dispatch(editorActions.hotkeysDisabledChanged(false))
  }

  const cancelSectionEdit = () => {
    setEditingSectionId('')
    runtime.store.dispatch(editorActions.hotkeysDisabledChanged(false))
  }

  const writeClipboard = async (serialized: string | undefined) => {
    if (!serialized) return
    try {
      await navigator.clipboard.writeText(serialized)
    }
    catch { /* the source editor also keeps its internal copied value when OS clipboard access is unavailable. */ }
    setThumbnailFocus(true)
  }

  const pasteSlides = async () => {
    try {
      runtime.pasteSlides(await navigator.clipboard.readText())
    }
    catch {
      runtime.pasteSlides()
    }
  }

  const dismissMenu = () => {
    setMenu(null)
    requestAnimationFrame(() => {
      if (menuReturnFocusRef.current?.isConnected) menuReturnFocusRef.current.focus()
    })
  }

  const openContextMenu = (event: MouseEvent, kind: 'rail' | 'section' | 'slide', sectionId = '') => {
    event.preventDefault()
    event.stopPropagation()
    if (event.currentTarget instanceof HTMLElement) {
      showContextMenu(kind, event.currentTarget, event.clientX, event.clientY, sectionId)
    }
  }

  const executeMenuAction = (action: string) => {
    dismissMenu()
    if (action === 'paste') void pasteSlides()
    else if (action === 'select-all') runtime.selectAllSlides()
    else if (action === 'new-slide') runtime.createSlide()
    else if (action === 'slideshow-start') onStartSlideshow(false)
    else if (action === 'slideshow-current') onStartSlideshow(true)
    else if (action === 'copy') void writeClipboard(runtime.copySlides())
    else if (action === 'cut') void writeClipboard(runtime.cutSlides())
    else if (action === 'duplicate') runtime.duplicateSlides()
    else if (action === 'delete') runtime.deleteSlides()
    else if (action === 'section-create') runtime.createSection()
    else if (action === 'section-remove-all') runtime.removeAllSections()
    else if (action.startsWith('section-remove:')) runtime.removeSection(action.slice('section-remove:'.length))
    else if (action.startsWith('section-delete:')) runtime.removeSectionSlides(action.slice('section-delete:'.length))
    else if (action.startsWith('section-rename:')) startSectionEdit(action.slice('section-rename:'.length))
  }

  return (
    <section
      aria-label={t('foundation.editor.slides')}
      className="mona-thumbnail-rail mona-editor-filmstrip relative flex min-h-0 min-w-0 flex-none items-end justify-center px-2 pb-1"
      onContextMenu={event => openContextMenu(event, 'rail')}
      onFocus={() => setThumbnailFocus(true)}
      onMouseDown={() => setThumbnailFocus(true)}
    >
      <span aria-live="polite" className="sr-only" ref={announcementRef}>{announcement}</span>
      {/* Pill hugs the filmstrip's content width; its ::before is the blur
          layer (kept behind the tiles so soft edges never fade them). */}
      <div className="mona-filmstrip-pill">
      <div className="mona-thumbnail-list" ref={listRef}>
        {presentation.slides.map((slide, index) => {
          const sectionId = slide.sectionTag?.id ?? ''
          const editing = !!editingSectionId && (editingSectionId === sectionId || (index === 0 && editingSectionId === 'default'))
          return (
            <div
              className="mona-thumbnail-container group/tile"
              data-id={slide.id}
              key={slide.id}
            >
              {slide.sectionTag || (hasSection && index === 0) ? (
                <div
                  className="mona-section-title"
                  data-section-id={sectionId}
                >
                  {editing ? (
                    <input
                      aria-label={t('foundation.editor.thumbnails.sectionNamePlaceholder')}
                      defaultValue={slide.sectionTag?.title ?? ''}
                      onBlur={event => saveSection(event.currentTarget.value)}
                      onKeyDown={event => {
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          event.stopPropagation()
                          cancelSectionEdit()
                          return
                        }
                        if (event.key !== 'Enter') return
                        event.preventDefault()
                        event.stopPropagation()
                        saveSection(event.currentTarget.value)
                      }}
                      placeholder={t('foundation.editor.thumbnails.sectionNamePlaceholder')}
                      ref={sectionInputRef}
                    />
                  ) : (
                    <Button
                      aria-label={t('foundation.editor.thumbnails.editSection', {
                        name: slide.sectionTag ? slide.sectionTag.title || t('foundation.editor.thumbnails.untitledSection') : t('foundation.editor.thumbnails.defaultSection'),
                      })}
                      className="mona-section-title-text"
                      onContextMenu={event => openContextMenu(event, 'section', sectionId)}
                      onDoubleClick={() => startSectionEdit(sectionId)}
                      onKeyDown={event => {
                        if (openKeyboardContextMenu(event, 'section', sectionId)) return
                        if (event.key !== 'Enter' && event.key !== 'F2') return
                        event.preventDefault()
                        startSectionEdit(sectionId)
                      }}
                      size={null}
                      type="button"
                      variant={null}
                    ><span>{slide.sectionTag ? slide.sectionTag.title || t('foundation.editor.thumbnails.untitledSection') : t('foundation.editor.thumbnails.defaultSection')}</span></Button>
                  )}
                </div>
              ) : null}
              <div className="mona-thumbnail-visual has-[.mona-thumbnail-item.is-selected]:[&_.mona-thumbnail-note-flag]:bg-[var(--editor-selection)]">
                <Button
                  aria-label={`${t('foundation.editor.showSlide', { number: index + 1 })}${slide.title ? `: ${slide.title}` : ''}`}
                  aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Shift+F10"
                  aria-pressed={selectedIndexes.includes(index)}
                  className={`mona-thumbnail-item relative flex cursor-grab flex-col items-start border-0 bg-transparent p-0 active:cursor-grabbing${index === presentation.slideIndex ? ' is-active' : ''}${selectedIndexes.includes(index) ? ' is-selected' : ''}${slide.hidden ? ' is-hidden' : ''} [&_.mona-scaled-slide]:overflow-hidden [&_.mona-scaled-slide]:rounded-[var(--radius-surface)] [&_.mona-scaled-slide]:shadow-[0_0_0_1px_rgb(16_18_25/7%)] [&_.mona-scaled-slide]:transition-[box-shadow] [&_.mona-scaled-slide]:duration-120 hover:[&_.mona-scaled-slide]:shadow-[0_0_0_1.5px_rgb(16_18_25/25%)] [&.is-active_.mona-scaled-slide]:shadow-[0_0_0_2px_#fff,0_0_0_4px_rgb(16_18_25/85%)] [&.is-selected_.mona-scaled-slide]:shadow-[0_0_0_2px_#fff,0_0_0_4px_rgb(16_18_25/85%)] [&.is-active_.mona-thumbnail-label]:text-[rgb(16_18_25)] [&.is-hidden_.mona-scaled-slide]:opacity-55 [&.is-hidden_.mona-scaled-slide]:grayscale-[0.25]`}
                  onContextMenu={event => openContextMenu(event, 'slide')}
                  onDoubleClick={() => onStartSlideshow(true)}
                  onKeyDown={event => handleThumbnailKeyDown(event, index)}
                  onMouseDown={event => selectThumbnail(event, index)}
                  size={null}
                  tabIndex={index === presentation.slideIndex ? 0 : -1}
                  type="button"
                  variant={null}
                >
                  <FilmstripThumbnailPreview slide={slide} sourcePackages={presentation.sourcePackages} theme={presentation.theme} viewportRatio={presentation.viewportRatio} viewportSize={presentation.viewportSize} visible={index < slidesLoadLimit} />
                  <div className="mona-thumbnail-label absolute bottom-1 left-1 z-[1] cursor-grab rounded-[var(--radius-control)] bg-white px-[5px] text-[10px] font-semibold leading-4 text-[rgb(16_18_25/80%)] shadow-[0_0_0_0.5px_rgb(16_18_25/10%),0_1px_2px_rgb(16_18_25/8%)] active:cursor-grabbing">{index + 1}</div>
                  {slide.hidden ? <div aria-label={t('foundation.editor.statusBar.hidden')} className="mona-thumbnail-hidden-flag absolute top-1 left-1 z-[2] inline-flex h-[18px] items-center gap-0.5 rounded-[var(--radius-control)] bg-white/92 px-1.5 text-[9px] font-semibold text-[rgb(16_18_25/70%)] shadow-[0_0_0_0.5px_rgb(16_18_25/10%)] [&_svg]:size-[11px]"><EyeOff /></div> : null}
                  {slide.durationMs ? <div aria-label={t('foundation.editor.statusBar.duration')} className="mona-thumbnail-duration-flag absolute top-1 right-1 z-[2] inline-flex h-[18px] items-center gap-0.5 rounded-[var(--radius-control)] bg-white/92 px-1.5 text-[9px] font-semibold text-[rgb(16_18_25/70%)] shadow-[0_0_0_0.5px_rgb(16_18_25/10%)] [&_svg]:size-[11px]"><Clock3 />{slide.durationMs / 1000}s</div> : null}
                </Button>
                {slide.notes?.length ? (
                  <Button
                    aria-label={`${t('foundation.editor.thumbnails.notes')}: ${t('foundation.editor.showSlide', { number: index + 1 })}${slide.title ? `, ${slide.title}` : ''}`}
                    className="mona-thumbnail-note-flag absolute top-1 right-1 z-[3] h-3 min-h-3 w-4 min-w-4 rounded-[var(--radius-detail)] bg-[var(--editor-selection-strong)] p-0 text-center text-[8px] font-semibold leading-3 text-white hover:bg-[var(--editor-selection)] hover:text-white focus-visible:bg-[var(--editor-selection)]"
                    onClick={event => {
                      event.stopPropagation()
                      focusSlide(index)
                      onOpenNotes()
                    }}
                    type="button"
                    variant="ghost"
                  >{slide.notes.length}</Button>
                ) : null}
              </div>
              {index < presentation.slides.length - 1 ? (
                <div className="mona-page-boundary-actions absolute top-1/2 right-0 z-[6] flex w-[26px] translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--radius-action)] border border-[rgb(16_18_25/12%)] bg-white opacity-0 shadow-[0_1px_4px_rgb(16_18_25/18%)] transition-opacity duration-120 group-hover/tile:z-[7] group-hover/tile:opacity-100 focus-within:z-[7] focus-within:opacity-100" role="group">
                  <Button
                    aria-label={t('foundation.editor.statusBar.transitionBoundary', { from: index + 1, to: index + 2 })}
                    className="inline-flex size-[26px] flex-none rounded-none border-0 bg-transparent text-[rgb(16_18_25/80%)] shadow-none hover:bg-[rgb(16_18_25/4%)] hover:text-[rgb(16_18_25)] [&_svg]:size-3.5"
                    onClick={event => {
                      event.stopPropagation()
                      onOpenTransition(index + 1)
                    }}
                    size="icon-xs"
                    title={t('foundation.editor.statusBar.transition')}
                    type="button"
                    variant="ghost"
                  ><BetweenHorizontalEnd /></Button>
                  <Button
                    aria-label={t('foundation.editor.statusBar.insertAfter', { number: index + 1 })}
                    className="inline-flex size-[26px] flex-none rounded-none border-0 border-t border-[rgb(16_18_25/12%)] bg-transparent text-[rgb(16_18_25/80%)] shadow-none hover:bg-[rgb(16_18_25/4%)] hover:text-[rgb(16_18_25)] [&_svg]:size-3.5"
                    onClick={event => {
                      event.stopPropagation()
                      runtime.focusSlide(index)
                      runtime.createSlide()
                    }}
                    size="icon-xs"
                    title={t('foundation.editor.thumbnails.addSlide')}
                    type="button"
                    variant="ghost"
                  ><PlusIcon /></Button>
                </div>
              ) : null}
            </div>
          )
        })}
        <Button
          aria-label={t('foundation.editor.thumbnails.addSlide')}
          className="mona-filmstrip-add m-[5px_0_5px_5px] flex-none rounded-[var(--radius-surface)] border-0 bg-[#e7e9ee] text-[15px] text-[rgb(16_18_25/70%)] hover:bg-[#dde0e6] hover:text-[rgb(16_18_25)]"
          onClick={() => runtime.createSlide()}
          size="editor-icon"
          style={{ height: Math.round(128 * presentation.viewportRatio), width: 128 }}
          title={t('foundation.editor.thumbnails.addSlide')}
          type="button"
          variant="outline"
        ><PlusIcon /></Button>
      </div>
      </div>
      {menu ? <ThumbnailContextMenu menu={menu} onAction={executeMenuAction} onDismiss={dismissMenu} /> : null}
    </section>
  )
})
