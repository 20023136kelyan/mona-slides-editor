import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'

import {
  createDocument,
  executeRichTextActions,
  getTextAttrs,
  initProsemirrorEditor,
} from '@mona/rich-text'
import { editorActions } from '@mona/editor-state'
import type { PPTShapeElement, PPTTextElement } from '@mona/presentation-core/model'

import type { EditorRuntime } from '@/features/editor/editor-runtime'

const normalizedEditorHtml = (value: string) => value.replace(/ style=""/g, '')

type RichTextHostElement = PPTTextElement | PPTShapeElement

const hostText = (element: RichTextHostElement, fallbackColor: string, fallbackFontName: string) => element.type === 'text'
  ? {
    content: element.content,
    defaultColor: element.defaultColor,
    defaultFontName: element.defaultFontName,
  }
  : {
    content: element.text?.content || '',
    defaultColor: element.text?.defaultColor || fallbackColor,
    defaultFontName: element.text?.defaultFontName || fallbackFontName,
  }

export function EditorRichText({
  element,
  fallbackColor,
  fallbackFontName,
  isHandleElement,
  modifierPressed,
  onMouseDown,
  runtime,
}: {
  element: RichTextHostElement
  fallbackColor?: string
  fallbackFontName?: string
  isHandleElement: boolean
  modifierPressed: () => boolean
  onMouseDown: (event: MouseEvent) => void
  runtime: EditorRuntime
}) {
  const resolvedFallbackColor = fallbackColor || (element.type === 'text' ? element.defaultColor : '#000')
  const resolvedFallbackFontName = fallbackFontName || (element.type === 'text' ? element.defaultFontName : '')
  const elementText = hostText(element, resolvedFallbackColor, resolvedFallbackFontName)
  const mountRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<ReturnType<typeof initProsemirrorEditor> | null>(null)
  const inputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attrsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const emptyCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shapeContentChangedRef = useRef(false)
  const wasHandleElementRef = useRef(isHandleElement)
  const latestRef = useRef({
    element,
    fallbackColor: resolvedFallbackColor,
    fallbackFontName: resolvedFallbackFontName,
    modifierPressed,
    onMouseDown,
    runtime,
  })
  const formatPainterActive = useSyncExternalStore(
    runtime.richText.subscribe,
    runtime.richText.getFormatPainterSnapshot,
    runtime.richText.getFormatPainterSnapshot,
  )

  useLayoutEffect(() => {
    latestRef.current = {
      element,
      fallbackColor: resolvedFallbackColor,
      fallbackFontName: resolvedFallbackFontName,
      modifierPressed,
      onMouseDown,
      runtime,
    }
  })

  useLayoutEffect(() => {
    const mount = mountRef.current
    if (!mount) return undefined
    const scheduleInput = (ignoreHistory: boolean, historyKey?: string) => {
      if (inputTimerRef.current) clearTimeout(inputTimerRef.current)
      inputTimerRef.current = setTimeout(() => {
        inputTimerRef.current = null
        const view = editorRef.current
        const current = latestRef.current
        if (!view) return
        const state = current.runtime.store.getState()
        const slide = state.presentation.slides[state.presentation.slideIndex]
        const liveElement = slide?.elements.find(candidate => candidate.id === current.element.id)
        if (!liveElement || (liveElement.type !== 'text' && liveElement.type !== 'shape')) return
        const value = view.dom.innerHTML
        const currentText = hostText(liveElement, current.fallbackColor, current.fallbackFontName)
        if (normalizedEditorHtml(currentText.content) === normalizedEditorHtml(value)) return
        const props = liveElement.type === 'text'
          ? { content: value }
          : {
            text: {
              align: 'middle' as const,
              defaultFontName: current.fallbackFontName,
              defaultColor: current.fallbackColor,
              ...liveElement.text,
              content: value,
            },
          }
        const changed = current.runtime.commit('Edit text', [{
          type: 'element.update',
          payload: { id: liveElement.id, props },
        }], ignoreHistory
          ? { recordHistory: false }
          : { historyKey: historyKey ?? `rich-text-${liveElement.id}` })
        if (changed && liveElement.type === 'shape') shapeContentChangedRef.current = true
      }, 300)
    }
    const currentAttrs = () => {
      const current = latestRef.current
      const text = hostText(current.element, current.fallbackColor, current.fallbackFontName)
      return getTextAttrs(view, {
        color: text.defaultColor,
        fontname: text.defaultFontName,
      })
    }
    const scheduleAttrs = () => {
      if (attrsTimerRef.current) clearTimeout(attrsTimerRef.current)
      attrsTimerRef.current = setTimeout(() => {
        attrsTimerRef.current = null
        latestRef.current.runtime.richText.sync(latestRef.current.element.id)
      }, 30)
    }
    const checkEmptyShape = () => {
      const current = latestRef.current
      const state = current.runtime.store.getState()
      const slide = state.presentation.slides[state.presentation.slideIndex]
      const shape = slide?.elements.find(candidate => candidate.id === current.element.id)
      if (!shape || shape.type !== 'shape' || !shape.text || shape.text.content.replace(/<[^>]+>/g, '')) return
      current.runtime.commit('Remove empty shape text', [{
        type: 'element.properties.remove',
        payload: { id: shape.id, property: 'text' },
      }])
    }
    const initial = hostText(latestRef.current.element, latestRef.current.fallbackColor, latestRef.current.fallbackFontName)
    const view = initProsemirrorEditor(mount, initial.content, {
      editable: () => !latestRef.current.element.lock,
      handleDOMEvents: {
        blur: () => {
          latestRef.current.runtime.store.dispatch(editorActions.hotkeysDisabledChanged(false))
          if (latestRef.current.element.type === 'shape') checkEmptyShape()
          return false
        },
        focus: () => {
          const state = latestRef.current.runtime.store.getState().session
          const modifier = state.activeElementIds.length > 1 && latestRef.current.modifierPressed()
          if (!modifier) latestRef.current.runtime.store.dispatch(editorActions.hotkeysDisabledChanged(true))
          return false
        },
        keydown: (_view, event) => {
          const modifier = event.ctrlKey || event.shiftKey || event.metaKey
          const key = event.key.toUpperCase()
          scheduleInput(modifier && (key === 'Z' || key === 'Y'))
          scheduleAttrs()
          return false
        },
        click: () => {
          scheduleAttrs()
          return false
        },
        mousedown: (_view, event) => {
          latestRef.current.onMouseDown(event)
          return false
        },
        mouseup: () => {
          latestRef.current.runtime.richText.applyFormatPainter(latestRef.current.element.id)
          return false
        },
      },
    })
    editorRef.current = view
    const unregister = latestRef.current.runtime.richText.register(
      latestRef.current.element.id,
      {
        execute: (action, historyKey) => {
          executeRichTextActions(view, action, currentAttrs())
          view.focus()
          scheduleInput(false, historyKey)
          scheduleAttrs()
        },
        getAttrs: currentAttrs,
      },
    )
    if (latestRef.current.runtime.store.getState().session.handleElementId === element.id) {
      latestRef.current.runtime.richText.sync(element.id)
    }
    return () => {
      if (inputTimerRef.current) clearTimeout(inputTimerRef.current)
      if (attrsTimerRef.current) clearTimeout(attrsTimerRef.current)
      if (emptyCheckTimerRef.current) clearTimeout(emptyCheckTimerRef.current)
      inputTimerRef.current = null
      attrsTimerRef.current = null
      emptyCheckTimerRef.current = null
      unregister()
      editorRef.current = null
      view.destroy()
    }
  }, [element.id])

  useLayoutEffect(() => {
    if (isHandleElement) runtime.richText.sync(element.id)
  }, [element.id, isHandleElement, runtime])

  useLayoutEffect(() => {
    const view = editorRef.current
    if (!view) return
    view.setProps({ editable: () => !element.lock })
  }, [element.lock])

  useLayoutEffect(() => {
    const view = editorRef.current
    if (!view || view.hasFocus()) return
    const { doc, tr } = view.state
    view.dispatch(tr.replaceRangeWith(0, doc.content.size, createDocument(elementText.content)))
  }, [elementText.content])

  useEffect(() => {
    const wasHandleElement = wasHandleElementRef.current
    wasHandleElementRef.current = isHandleElement
    if (!wasHandleElement || isHandleElement) return
    if (element.type === 'shape') {
      // PPTist's shape editor creates one more debounced snapshot when an
      // edited shape loses handle focus. It is intentionally allowed to be
      // identical to the edit snapshot; that boundary affects immediate
      // undo when another operation starts inside the 300 ms window.
      if (shapeContentChangedRef.current) {
        shapeContentChangedRef.current = false
        runtime.recordHistorySnapshot(`rich-text-shape-blur-${element.id}`)
      }
      return
    }
    if (emptyCheckTimerRef.current) clearTimeout(emptyCheckTimerRef.current)
    emptyCheckTimerRef.current = setTimeout(() => {
      emptyCheckTimerRef.current = null
      const current = latestRef.current
      const state = current.runtime.store.getState()
      const slide = state.presentation.slides[state.presentation.slideIndex]
      const text = slide?.elements.find(candidate => candidate.id === current.element.id)
      if (!text || text.type !== 'text' || text.content.replace(/<[^>]+>/g, '')) return
      current.runtime.commit('Delete empty text', [{
        type: 'element.delete',
        elementIds: [text.id],
      }], { recordHistory: false })
    }, 300)
  }, [element.id, element.type, isHandleElement, runtime])

  return (
    <div
      className={`mona-rich-text mona-prosemirror-editor${formatPainterActive ? ' is-format-painter' : ''}`}
      onPointerDown={event => event.stopPropagation()}
      ref={mountRef}
    />
  )
}
