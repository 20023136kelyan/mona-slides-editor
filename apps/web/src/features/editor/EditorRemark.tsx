import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import BoldIcon from '~icons/icon-park-outline/text-bold'
import ItalicIcon from '~icons/icon-park-outline/text-italic'
import UnderlineIcon from '~icons/icon-park-outline/text-underline'
import StrikethroughIcon from '~icons/icon-park-outline/strikethrough'
import TextIcon from '~icons/icon-park-outline/text'
import HighlightIcon from '~icons/icon-park-outline/high-light'
import ListIcon from '~icons/icon-park-outline/list'
import OrderedListIcon from '~icons/icon-park-outline/ordered-list'
import FormatIcon from '~icons/icon-park-outline/format'
import { createDocument, executeRichTextActions, getTextAttrs, initProsemirrorEditor, type RichTextAction, type RichTextAttrs } from '@mona/rich-text'
import { editorActions, selectCurrentSlide, selectPresentation } from '@mona/editor-state'

import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorSelector } from '@/features/editor/use-editor-selector'

export function EditorRemark({ runtime }: { runtime: EditorRuntime }) {
  const { t } = useTranslation()
  const currentSlide = useEditorSelector(runtime.store, selectCurrentSlide)!
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const mountRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<ReturnType<typeof initProsemirrorEditor> | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [attrs, setAttrs] = useState<RichTextAttrs | null>(null)
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null)
  const latestSlideRef = useRef(currentSlide)

  useLayoutEffect(() => {
    latestSlideRef.current = currentSlide
  }, [currentSlide])

  const scheduleUpdate = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      const editor = editorRef.current
      if (!editor) return
      const slideId = latestSlideRef.current.id
      runtime.commit('Edit speaker notes', [{
        type: 'slide.update',
        slideId,
        props: { remark: editor.dom.innerHTML },
      }], { historyKey: `speaker-notes-${slideId}` })
    }, 300)
  }, [runtime])

  useLayoutEffect(() => {
    if (!mountRef.current) return undefined
    // The editor is recreated when the locale changes (placeholder text), so
    // it must initialize from the CURRENT slide's remark — a mount-time
    // snapshot would resurface another slide's old notes and the next
    // keystroke would commit them into the current slide.
    const initialRemark = selectCurrentSlide(runtime.store.getState())?.remark ?? ''
    const editor = initProsemirrorEditor(mountRef.current, initialRemark, {
      handleDOMEvents: {
        blur: () => {
          runtime.store.dispatch(editorActions.hotkeysDisabledChanged(false)); return false 
        },
        focus: () => {
          runtime.store.dispatch(editorActions.hotkeysDisabledChanged(true)); return false 
        },
        input: () => {
          scheduleUpdate(); return false 
        },
        keydown: () => {
          setMenuPosition(null); return false 
        },
        mousedown: () => {
          window.getSelection()?.removeAllRanges(); setMenuPosition(null); return false 
        },
        mouseup: () => {
          const selection = window.getSelection()
          if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode || selection.type === 'Caret' || selection.type === 'None') return false
          const range = selection.getRangeAt(0)
          if (!editor.dom.contains(range.commonAncestorContainer)) return false
          const rect = range.getBoundingClientRect()
          setAttrs(getTextAttrs(editor))
          setMenuPosition({ left: rect.left, top: rect.top - 46 })
          return false
        },
      },
    }, { placeholder: t('foundation.editor.runtime.speakerNotesPlaceholder') })
    editorRef.current = editor
    return () => {
      if (timerRef.current) {
        // Flush instead of dropping a pending debounced edit when the editor
        // is recreated (locale switch) or the panel closes.
        clearTimeout(timerRef.current)
        timerRef.current = null
        const slideId = latestSlideRef.current.id
        runtime.commit('Edit speaker notes', [{
          type: 'slide.update',
          slideId,
          props: { remark: editor.dom.innerHTML },
        }], { historyKey: `speaker-notes-${slideId}` })
      }
      editorRef.current = null
      editor.destroy()
    }
  }, [runtime, scheduleUpdate, t])

  useLayoutEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const nextSlide = selectCurrentSlide(runtime.store.getState())
    const { doc, tr } = editor.state
    editor.dispatch(tr.replaceRangeWith(0, doc.content.size, createDocument(nextSlide?.remark ?? '')))
    setMenuPosition(null)
  }, [currentSlide.id, runtime])

  useEffect(() => {
    const dismiss = (event: globalThis.MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      setMenuPosition(null)
    }
    document.addEventListener('mousedown', dismiss)
    return () => document.removeEventListener('mousedown', dismiss)
  }, [])

  const execute = (action: RichTextAction) => {
    const editor = editorRef.current
    if (!editor) return
    executeRichTextActions(editor, action, attrs ?? getTextAttrs(editor))
    setAttrs(getTextAttrs(editor))
    scheduleUpdate()
  }
  const menu = menuPosition ? createPortal((
    <div className="mona-remark-menu" ref={menuRef} style={menuPosition}>
      <Toggle aria-label={t('common.bold')} onPressedChange={() => execute({ command: 'bold' })} pressed={attrs?.bold}><BoldIcon /></Toggle>
      <Toggle aria-label={t('common.italic')} onPressedChange={() => execute({ command: 'em' })} pressed={attrs?.em}><ItalicIcon /></Toggle>
      <Toggle aria-label={t('common.underline')} onPressedChange={() => execute({ command: 'underline' })} pressed={attrs?.underline}><UnderlineIcon /></Toggle>
      <Toggle aria-label={t('common.strikethrough')} onPressedChange={() => execute({ command: 'strikethrough' })} pressed={attrs?.strikethrough}><StrikethroughIcon /></Toggle>
      <label><TextIcon /><input onChange={event => execute({ command: 'color', value: event.target.value })} type="color" value={attrs?.color || '#000000'} /></label>
      <label><HighlightIcon /><input onChange={event => execute({ command: 'backcolor', value: event.target.value })} type="color" value={attrs?.backcolor || '#ffffff'} /></label>
      <Toggle aria-label={t('common.bullets')} onPressedChange={() => execute({ command: 'bulletList' })} pressed={attrs?.bulletList}><ListIcon /></Toggle>
      <Toggle aria-label={t('common.numbering')} onPressedChange={() => execute({ command: 'orderedList' })} pressed={attrs?.orderedList}><OrderedListIcon /></Toggle>
      <Button aria-label={t('common.clearFormatting')} onClick={() => execute({ command: 'clear' })} size="icon" type="button" variant="ghost"><FormatIcon /></Button>
    </div>
  ), document.body) : null

  return (
    <div aria-label="Speaker notes" className="mona-editor-remark">
      <div className="mona-remark-slide-label">
        {t('foundation.editor.thumbnails.slideCount', { current: presentation.slideIndex + 1, total: presentation.slides.length })}
      </div>
      <div className="mona-remark-editor" ref={mountRef} />
      {menu}
    </div>
  )
}
