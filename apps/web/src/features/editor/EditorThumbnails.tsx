/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/control-has-associated-label, jsx-a11y/interactive-supports-focus, jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/no-static-element-interactions, jsx-a11y/prefer-tag-over-role, jsx-a11y/role-supports-aria-props -- PPTist's thumbnail, section, and menu DOM is preserved for parity; named outer surfaces remain exposed. */
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import Sortable from 'sortablejs'

import DownIcon from '~icons/icon-park-outline/down'
import PlusIcon from '~icons/icon-park-outline/plus'
import { editorActions } from '@mona/editor-state'
import type { Slide, SlideTheme, SlideType } from '@mona/presentation-core/model'
import { Popover as PopoverPrimitive } from 'radix-ui'

import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { navigateWithSlideTransition } from '@/features/editor/editor-view-transition'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { ScaledSlide } from '@/features/presentation-renderer/ScaledSlide'

interface ThumbnailMenuItem {
  action?: string
  disabled?: boolean
  divider?: boolean
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
  const menuHeight = menu.items.filter(item => !item.divider).length * 30 + menu.items.filter(item => item.divider).length * 11 + 10
  const left = document.body.clientWidth <= menu.x + 180 ? menu.x - 180 : menu.x
  const top = document.body.clientHeight <= menu.y + menuHeight ? menu.y - menuHeight : menu.y
  return createPortal((
    <>
      <div
        className="mona-editor-context-menu-mask"
        onContextMenu={event => {
          event.preventDefault(); event.stopPropagation(); onDismiss() 
        }}
        onMouseDown={event => {
          if (event.button === 0) onDismiss() 
        }}
        onPointerDown={event => event.stopPropagation()}
      />
      <div
        aria-label={menu.label}
        className="mona-editor-context-menu mona-thumbnail-context-menu"
        onContextMenu={event => {
          event.preventDefault(); event.stopPropagation() 
        }}
        onPointerDown={event => event.stopPropagation()}
        role="menu"
        style={{ left, top }}
      >
        <ul className="mona-context-menu-content" role="menu">
          {menu.items.map((item, index) => item.divider ? (
            <li className="mona-context-menu-entry is-divider" key={`divider-${index}`} role="separator" />
          ) : (
            <li
              aria-disabled={item.disabled || undefined}
              className={`mona-context-menu-entry${item.disabled ? ' is-disabled' : ''}`}
              data-action={item.action}
              key={item.action}
              onClick={event => {
                event.stopPropagation()
                if (!item.disabled && item.action) onAction(item.action)
              }}
              role="menuitem"
            >
              <div className="mona-context-menu-item-content">
                <span className="mona-context-menu-label">{item.label}</span>
                {item.shortcut ? <span className="mona-context-menu-shortcut">{item.shortcut}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  ), document.body)
}

interface TemplatePayload {
  slides: Slide[]
  theme?: Partial<SlideTheme>
}

const TEMPLATE_TYPES: readonly SlideType[] = ['cover', 'contents', 'transition', 'content', 'end']

function TemplatePanel({ onInsertAll, onInsertOne, templates, theme }: {
  onInsertAll: (payload: TemplatePayload) => void
  onInsertOne: (slide: Slide) => void
  templates: readonly { id: string }[]
  theme?: SlideTheme
}) {
  const { t } = useTranslation()
  const [activeCatalog, setActiveCatalog] = useState(templates[0]?.id ?? '')
  const [activeType, setActiveType] = useState<'all' | SlideType>('all')
  const [payload, setPayload] = useState<TemplatePayload>({ slides: [] })
  const [loading, setLoading] = useState(true)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!activeCatalog) return undefined
    const controller = new AbortController()
    fetch(`/mocks/${activeCatalog}.json`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`Template request failed: ${response.status}`)
        return response.json() as Promise<TemplatePayload>
      })
      .then(data => {
        setPayload(data)
        setLoading(false)
        listRef.current?.scrollTo(0, 0)
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setLoading(false)
      })
    return () => controller.abort()
  }, [activeCatalog])

  return (
    <div className="mona-templates">
      <div className="mona-template-catalogs">
        {templates.map(template => (
          <div
            className={`mona-template-catalog${activeCatalog === template.id ? ' is-active' : ''}`}
            key={template.id}
            onClick={() => {
              if (template.id === activeCatalog) return
              setLoading(true)
              setActiveCatalog(template.id)
            }}
          >{t(`foundation.editor.templates.catalog.${template.id}`)}</div>
        ))}
      </div>
      <div className="mona-template-content">
        <div className="mona-template-header">
          <div className="mona-template-types">
            {(['all', ...TEMPLATE_TYPES] as const).map(type => (
              <div className={`mona-template-type${activeType === type ? ' is-active' : ''}`} key={type} onClick={() => setActiveType(type)}>
                {t(`foundation.editor.templates.${type}`)}
              </div>
            ))}
          </div>
          <div className="mona-template-insert-all" onClick={() => onInsertAll(payload)}>{t('foundation.editor.templates.insertAll')}</div>
        </div>
        <div className="mona-template-list" ref={listRef}>
          {payload.slides.filter(slide => activeType === 'all' || slide.type === activeType).map(slide => (
            <div className="mona-template-slide-item" key={slide.id}>
              <ScaledSlide fixedWidth={180} slide={slide} theme={{ ...theme!, ...payload.theme }} thumbnail viewportRatio={0.5625} viewportSize={1000} />
              <div className="mona-template-slide-buttons">
                <button onClick={() => onInsertOne(slide)} type="button">{t('foundation.editor.templates.insertTemplate')}</button>
              </div>
            </div>
          ))}
        </div>
        {loading ? (
          <div
            className="mona-template-loading has-text"
            style={{ '--mona-template-loading-text': `"${t('foundation.editor.templates.loading')}"` } as CSSProperties}
          />
        ) : null}
      </div>
    </div>
  )
}

export const EditorThumbnails = memo(function EditorThumbnails({ runtime, onOpenNotes, onStartSlideshow }: {
  runtime: EditorRuntime
  onOpenNotes: () => void
  onStartSlideshow: (fromCurrent: boolean) => void
}) {
  const { t } = useTranslation()
  const state = runtime.store.getState()
  // Deliberately NOT useDeferredValue: the rail's click/Shift-click selection
  // math reads this snapshot, and the gate-6 contracts require it to be in
  // lockstep with the store like Vue's rail (deferral produced stale ranges).
  const presentation = useEditorSelector(runtime.store, current => current.presentation)
  const selectedSlideIndexes = useEditorSelector(runtime.store, current => current.session.selectedSlideIndexes)
  const thumbnailsFocus = useEditorSelector(runtime.store, current => current.session.thumbnailsFocus)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [editingSectionId, setEditingSectionId] = useState('')
  const [menu, setMenu] = useState<ThumbnailMenu | null>(null)
  const [slidesLoadLimit, setSlidesLoadLimit] = useState(() => state.presentation.slides.length <= 50 ? 9999 : 50)
  const listRef = useRef<HTMLDivElement>(null)
  const sortableRef = useRef<Sortable | null>(null)
  const sectionInputRef = useRef<HTMLInputElement>(null)
  const previousSlideIndexRef = useRef(state.presentation.slideIndex)

  const selectedIndexes = useMemo(() => Array.from(new Set([...selectedSlideIndexes, presentation.slideIndex])), [presentation.slideIndex, selectedSlideIndexes])
  const hasSection = presentation.slides.some(slide => slide.sectionTag)

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
    const sortable = Sortable.create(list, {
      animation: 200,
      disabled: '' as unknown as boolean,
      scroll: true,
      scrollSensitivity: 50,
      onEnd: event => {
        if (event.oldIndex === undefined || event.newIndex === undefined || event.oldIndex === event.newIndex) return
        runtime.reorderSlide(event.oldIndex, event.newIndex)
      },
    })
    sortableRef.current = sortable
    return () => {
      sortableRef.current = null
      sortable.destroy()
    }
  }, [runtime])

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
    if (activeRect.top >= listRect.top && activeRect.bottom <= listRect.bottom) return
    const timer = setTimeout(() => active.scrollIntoView({ behavior: 'smooth' }), 100)
    return () => clearTimeout(timer)
  }, [presentation.slideIndex])

  useEffect(() => {
    if (previousSlideIndexRef.current === presentation.slideIndex) return
    previousSlideIndexRef.current = presentation.slideIndex
    if (runtime.store.getState().session.selectedSlideIndexes.length) {
      runtime.store.dispatch(editorActions.selectedSlideIndexesChanged([]))
    }
  }, [presentation.slideIndex, runtime])

  const setThumbnailFocus = (focus: boolean) => {
    if (thumbnailsFocus === focus) return
    runtime.store.dispatch(editorActions.thumbnailsFocusChanged(focus))
    if (focus) runtime.store.dispatch(editorActions.canvasFocusChanged(false))
  }

  const focusSlide = (index: number) => {
    navigateWithSlideTransition(() => {
      runtime.store.dispatch(editorActions.selectionChanged([]))
      runtime.focusSlide(index)
    })
  }

  const selectThumbnail = (event: MouseEvent, index: number) => {
    if (editingSectionId) return
    const multiSelected = selectedIndexes.length > 1
    if (multiSelected && selectedIndexes.includes(index) && event.button !== 0) return
    const ctrl = event.ctrlKey || event.metaKey
    if (ctrl) {
      if (presentation.slideIndex === index) {
        if (!multiSelected) return
        const next = selectedIndexes.filter(item => item !== index)
        runtime.store.dispatch(editorActions.selectedSlideIndexesChanged(next))
        focusSlide(next[0]!)
      }
      else if (selectedIndexes.includes(index)) {
        runtime.store.dispatch(editorActions.selectedSlideIndexesChanged(selectedIndexes.filter(item => item !== index)))
      }
      else runtime.store.dispatch(editorActions.selectedSlideIndexesChanged([...selectedIndexes, index]))
    }
    else if (event.shiftKey) {
      if (presentation.slideIndex === index && !multiSelected) return
      let minIndex = Math.min(...selectedIndexes)
      let maxIndex = index
      if (index < minIndex) {
        maxIndex = Math.max(...selectedIndexes)
        minIndex = index
      }
      runtime.store.dispatch(editorActions.selectedSlideIndexesChanged(Array.from({ length: maxIndex - minIndex + 1 }, (_, offset) => minIndex + offset)))
    }
    else {
      runtime.store.dispatch(editorActions.selectedSlideIndexesChanged([]))
      focusSlide(index)
    }
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

  const writeClipboard = async (serialized: string | undefined) => {
    if (!serialized) return
    try {
      await navigator.clipboard.writeText(serialized) 
    }
    catch { /* PPTist also keeps its internal copied value when OS clipboard access is unavailable. */ }
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

  const openContextMenu = (event: MouseEvent, kind: 'rail' | 'section' | 'slide', sectionId = '') => {
    event.preventDefault()
    event.stopPropagation()
    const common = {
      x: event.clientX,
      y: event.clientY,
      label: t(kind === 'section' ? 'foundation.editor.thumbnails.sectionMenu' : 'foundation.editor.thumbnails.menu'),
    }
    if (kind === 'section') {
      setMenu({ ...common, items: [
        { action: `section-remove:${sectionId}`, label: t('foundation.editor.thumbnails.deleteSection') },
        { action: `section-delete:${sectionId}`, label: t('foundation.editor.thumbnails.deleteSectionAndSlides') },
        { action: 'section-remove-all', label: t('foundation.editor.thumbnails.deleteAllSections') },
        { action: `section-rename:${sectionId}`, label: t('foundation.editor.thumbnails.renameSection') },
      ] })
      return
    }
    const base = [
      { action: 'paste', label: t('foundation.editor.action.paste'), shortcut: 'Ctrl + V' },
      { action: 'select-all', label: t('foundation.editor.action.selectAll'), shortcut: 'Ctrl + A' },
      { action: 'new-slide', label: t('foundation.editor.thumbnails.newSlide'), shortcut: 'Enter' },
    ]
    setMenu({ ...common, items: kind === 'rail' ? [
      ...base,
      { action: 'slideshow-start', label: t('foundation.editor.thumbnails.slideshow'), shortcut: 'F5' },
    ] : [
      { action: 'cut', label: t('foundation.editor.action.cut'), shortcut: 'Ctrl + X' },
      { action: 'copy', label: t('foundation.editor.action.copy'), shortcut: 'Ctrl + C' },
      ...base.slice(0, 2),
      { divider: true },
      ...base.slice(2),
      { action: 'duplicate', label: t('foundation.editor.thumbnails.duplicateSlide'), shortcut: 'Ctrl + D' },
      { action: 'delete', label: t('foundation.editor.thumbnails.deleteSlide'), shortcut: 'Delete' },
      { action: 'section-create', disabled: !!presentation.slides[presentation.slideIndex]?.sectionTag, label: t('foundation.editor.thumbnails.addSection') },
      { divider: true },
      { action: 'slideshow-current', label: t('foundation.editor.thumbnails.fromCurrent'), shortcut: 'Shift + F5' },
    ] })
  }

  const executeMenuAction = (action: string) => {
    setMenu(null)
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

  const templateTheme: SlideTheme = presentation.theme

  return (
    <aside
      aria-label={t('foundation.editor.slides')}
      className="mona-thumbnail-rail mona-editor-thumbnails"
      onContextMenu={event => openContextMenu(event, 'rail')}
      onFocus={() => setThumbnailFocus(true)}
      onMouseDown={() => setThumbnailFocus(true)}
    >
      <div className="mona-add-slide">
        <div className="mona-add-slide-button" onClick={() => runtime.createSlide()}><PlusIcon className="mona-add-slide-icon" />{t('foundation.editor.thumbnails.addSlide')}</div>
        <PopoverPrimitive.Root onOpenChange={setTemplateOpen} open={templateOpen}>
          <PopoverPrimitive.Trigger asChild>
            <div aria-label="Templates" className="mona-add-slide-select" role="button" tabIndex={0}><DownIcon /></div>
          </PopoverPrimitive.Trigger>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content align="start" className="mona-thumbnail-template-popover" side="bottom" sideOffset={8}>
              <TemplatePanel
                onInsertAll={payload => {
                  runtime.insertTemplateSlides(payload.slides, payload.theme ?? {})
                  setTemplateOpen(false)
                }}
                onInsertOne={slide => {
                  runtime.createSlideFromTemplate(slide)
                  setTemplateOpen(false)
                }}
                templates={presentation.templates}
                theme={presentation.theme}
              />
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
      </div>
      <div className="mona-thumbnail-list" ref={listRef}>
        {presentation.slides.map((slide, index) => {
          const sectionId = slide.sectionTag?.id ?? ''
          const editing = !!editingSectionId && (editingSectionId === sectionId || (index === 0 && editingSectionId === 'default'))
          return (
            <div
              className="mona-thumbnail-container"
              key={slide.id}
            >
              {slide.sectionTag || (hasSection && index === 0) ? (
                <div
                  className="mona-section-title"
                  data-section-id={sectionId}
                  onContextMenu={event => openContextMenu(event, 'section', sectionId)}
                  onDoubleClick={() => startSectionEdit(sectionId)}
                >
                  {editing ? (
                    <input
                      defaultValue={slide.sectionTag?.title ?? ''}
                      onBlur={event => saveSection(event.currentTarget.value)}
                      onKeyDown={event => {
                        if (event.key !== 'Enter') return
                        event.stopPropagation()
                        saveSection(event.currentTarget.value)
                      }}
                      placeholder={t('foundation.editor.thumbnails.sectionNamePlaceholder')}
                      ref={sectionInputRef}
                    />
                  ) : (
                    <span className="mona-section-title-text"><span>{slide.sectionTag ? slide.sectionTag.title || t('foundation.editor.thumbnails.untitledSection') : t('foundation.editor.thumbnails.defaultSection')}</span></span>
                  )}
                </div>
              ) : null}
              <div
                aria-label={t('foundation.editor.showSlide', { number: index + 1 })}
                aria-pressed={selectedIndexes.includes(index)}
                className={`mona-thumbnail-item${index === presentation.slideIndex ? ' is-active' : ''}${selectedIndexes.includes(index) ? ' is-selected' : ''}`}
                onContextMenu={event => openContextMenu(event, 'slide')}
                onDoubleClick={() => onStartSlideshow(true)}
                onMouseDown={event => selectThumbnail(event, index)}
                role="button"
                tabIndex={0}
              >
                <div className={`mona-thumbnail-label${index >= 99 ? ' is-offset' : ''}`}>{String(index + 1).padStart(2, '0')}</div>
                <ScaledSlide fixedWidth={120} slide={slide} theme={templateTheme} thumbnail viewportRatio={presentation.viewportRatio} viewportSize={presentation.viewportSize} visible={index < slidesLoadLimit} />
                {slide.notes?.length ? (
                  <div aria-label={t('foundation.editor.thumbnails.notes')} className="mona-thumbnail-note-flag" onClick={onOpenNotes}>{slide.notes.length}</div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mona-thumbnail-page-number">{t('foundation.editor.thumbnails.slideCount', { current: presentation.slideIndex + 1, total: presentation.slides.length })}</div>
      {menu ? <ThumbnailContextMenu menu={menu} onAction={executeMenuAction} onDismiss={() => setMenu(null)} /> : null}
    </aside>
  )
})
