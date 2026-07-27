import { useEffect, useEffectEvent, useLayoutEffect, useRef, useSyncExternalStore } from 'react'

import {
  createDocument,
  executeRichTextActions,
  getTextAttrs,
  initProsemirrorEditor,
  isHistoryTransaction,
} from '@mona/rich-text'
import { editorActions } from '@mona/editor-state'
import type { PPTShapeElement, PPTTextElement } from '@mona/presentation-core/model'

import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorApplication } from '@/features/editor/services/editor-application'
import { sanitizeNavigationUrl } from '@/lib/deck-sanitizer'
import { i18n } from '@/i18n'

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

const withoutStructuredText = (text: PPTShapeElement['text']): PPTShapeElement['text'] => {
  if (!text) return text
  const detached = { ...text }
  delete detached.structuredText
  return detached
}

export function EditorRichText({
  element,
  fallbackColor,
  fallbackFontName,
  editing,
  isHandleElement,
  modifierPressed,
  onMouseDown,
  runtime,
}: {
  element: RichTextHostElement
  fallbackColor?: string
  fallbackFontName?: string
  editing: boolean
  isHandleElement: boolean
  modifierPressed: () => boolean
  onMouseDown: (event: MouseEvent) => void
  runtime: EditorRuntime
}) {
  const { notifications } = useEditorApplication()
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
  // One effect event hands every long-lived ProseMirror closure the latest
  // render's props, replacing the manual latestRef mirroring pattern.
  const readLatest = useEffectEvent(() => ({
    element,
    fallbackColor: resolvedFallbackColor,
    fallbackFontName: resolvedFallbackFontName,
    modifierPressed,
    notifications,
    onMouseDown,
    runtime,
  }))
  const formatPainterActive = useSyncExternalStore(
    runtime.richText.subscribe,
    runtime.richText.getFormatPainterSnapshot,
    runtime.richText.getFormatPainterSnapshot,
  )

  useLayoutEffect(() => {
    const mount = mountRef.current
    if (!mount) return undefined
    const stateAtMount = readLatest().runtime.store.getState()
    const slideAtMount = stateAtMount.presentation.slides[stateAtMount.presentation.slideIndex]
    const liveElementAtMount = slideAtMount?.elements.find(candidate => candidate.id === readLatest().element.id)
    const authoredBaseline = liveElementAtMount?.type === 'text' && liveElementAtMount.structuredText
      ? {
          content: liveElementAtMount.content,
          structuredText: liveElementAtMount.structuredText,
        }
      : liveElementAtMount?.type === 'shape' && liveElementAtMount.text?.structuredText
        ? {
            content: liveElementAtMount.text.content,
            structuredText: liveElementAtMount.text.structuredText,
          }
        : undefined
    let pendingInput: { historyKey?: string; ignoreHistory: boolean } | null = null
    // Whether the most recent change to the document came from prosemirror's
    // own undo/redo. Read at commit time rather than decided at keydown time,
    // because the keystroke is handled before the command it triggers has
    // produced a transaction.
    let lastChangeWasHistory = false
    let structuredBaselineDom: string | null = null
    // Serialized-DOM baseline since mount/last commit. The keydown scheduler
    // also arms on no-op keys (a lone Shift before a multi-select click), and
    // ProseMirror re-serializes unchanged content differently from the stored
    // markup — without this gate, the flush would "commit" that
    // re-serialization and alter the stored document markup.
    let lastCommittedDom: string | null = null
    const commitInput = (ignoreHistory: boolean, historyKey?: string) => {
      const view = editorRef.current
      const current = readLatest()
      if (!view) return
      if (view.dom.innerHTML === lastCommittedDom) return
      lastCommittedDom = view.dom.innerHTML
      const state = current.runtime.store.getState()
      const slide = state.presentation.slides[state.presentation.slideIndex]
      const liveElement = slide?.elements.find(candidate => candidate.id === current.element.id)
      if (!liveElement || (liveElement.type !== 'text' && liveElement.type !== 'shape')) return
      const value = view.dom.innerHTML
      const currentText = hostText(liveElement, current.fallbackColor, current.fallbackFontName)
      const restoreAuthoredBaseline = Boolean(
        authoredBaseline
        && structuredBaselineDom !== null
        && normalizedEditorHtml(value) === normalizedEditorHtml(structuredBaselineDom),
      )
      if (
        normalizedEditorHtml(currentText.content) === normalizedEditorHtml(value)
        && !restoreAuthoredBaseline
      ) return
      const props = liveElement.type === 'text'
        ? restoreAuthoredBaseline
          ? {
              content: authoredBaseline!.content,
              structuredText: authoredBaseline!.structuredText,
            }
          : { content: value }
        : {
          text: {
            align: 'middle' as const,
            defaultFontName: current.fallbackFontName,
            defaultColor: current.fallbackColor,
            ...withoutStructuredText(liveElement.text),
            content: restoreAuthoredBaseline ? authoredBaseline!.content : value,
            ...(restoreAuthoredBaseline
              ? { structuredText: authoredBaseline!.structuredText }
              : {}),
          },
        }
      // An undo inside the editor must not be recorded as a fresh edit in the
      // application's own history, or undoing would push what it just undid
      // back onto the stack.
      const fromHistory = ignoreHistory || lastChangeWasHistory
      lastChangeWasHistory = false
      const changed = current.runtime.commit('Edit text', [{
        type: 'element.update',
        payload: { id: liveElement.id, props },
      }], fromHistory
        ? { recordHistory: false }
        : { historyKey: historyKey ?? `rich-text-${liveElement.id}` })
      if (changed && liveElement.type === 'shape') shapeContentChangedRef.current = true
    }
    // Pre-action baseline: called before ProseMirror applies a keydown and
    // before a toolbar action mutates the document, so the first arm since
    // the last commit always snapshots the pre-change serialization.
    const armBaseline = () => {
      lastCommittedDom ??= editorRef.current?.dom.innerHTML ?? null
    }
    const scheduleInput = (ignoreHistory: boolean, historyKey?: string) => {
      if (inputTimerRef.current) clearTimeout(inputTimerRef.current)
      pendingInput = { historyKey, ignoreHistory }
      inputTimerRef.current = setTimeout(() => {
        inputTimerRef.current = null
        const params = pendingInput
        pendingInput = null
        if (params) commitInput(params.ignoreHistory, params.historyKey)
      }, 300)
    }
    const currentAttrs = () => {
      const current = readLatest()
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
        readLatest().runtime.richText.sync(readLatest().element.id)
      }, 30)
    }
    const checkEmptyShape = () => {
      const current = readLatest()
      const state = current.runtime.store.getState()
      const slide = state.presentation.slides[state.presentation.slideIndex]
      const shape = slide?.elements.find(candidate => candidate.id === current.element.id)
      if (!shape || shape.type !== 'shape' || !shape.text || shape.text.content.replace(/<[^>]+>/g, '')) return
      current.runtime.commit('Remove empty shape text', [{
        type: 'element.properties.remove',
        payload: { id: shape.id, property: 'text' },
      }])
    }
    const initial = hostText(readLatest().element, readLatest().fallbackColor, readLatest().fallbackFontName)
    const view = initProsemirrorEditor(mount, initial.content, {
      dispatchTransaction: transaction => {
        if (transaction.docChanged) lastChangeWasHistory = isHistoryTransaction(transaction)
        view.updateState(view.state.apply(transaction))
      },
      editable: () => !readLatest().element.lock,
      handleDOMEvents: {
        blur: () => {
          readLatest().runtime.store.dispatch(editorActions.hotkeysDisabledChanged(false))
          readLatest().runtime.store.dispatch(editorActions.editingTextElementChanged(null))
          if (readLatest().element.type === 'shape') checkEmptyShape()
          return false
        },
        focus: () => {
          const state = readLatest().runtime.store.getState().session
          const modifier = state.activeElementIds.length > 1 && readLatest().modifierPressed()
          if (!modifier) {
            readLatest().runtime.store.dispatch(editorActions.hotkeysDisabledChanged(true))
            readLatest().runtime.store.dispatch(editorActions.editingTextElementChanged(readLatest().element.id))
          }
          return false
        },
        keydown: (_view, event) => {
          if (event.key === 'Escape') {
            view.dom.blur()
            readLatest().runtime.store.dispatch(editorActions.editingTextElementChanged(null))
            return true
          }
          armBaseline()
          scheduleInput(false)
          scheduleAttrs()
          return false
        },
        // Paste and drop produce no keydown, so without these a context-menu
        // paste followed by clicking away was simply lost: nothing armed the
        // baseline, nothing scheduled a commit, and blur does not commit.
        // Keyboard paste only survived incidentally, because Cmd+V is a
        // keydown.
        paste: () => {
          armBaseline()
          scheduleInput(false)
          scheduleAttrs()
          return false
        },
        drop: () => {
          armBaseline()
          scheduleInput(false)
          scheduleAttrs()
          return false
        },
        click: () => {
          scheduleAttrs()
          return false
        },
        mousedown: (_view, event) => {
          readLatest().onMouseDown(event)
          return false
        },
        mouseup: () => {
          readLatest().runtime.richText.applyFormatPainter(readLatest().element.id)
          return false
        },
      },
    }, {
      // `href` is the one thing a paste can carry that the schema's allowlist
      // does not already neutralise, since `a[href]` has a parse rule. The
      // policy is the deck sanitizer's, not a second copy of it.
      sanitizeHref: sanitizeNavigationUrl,
    })
    editorRef.current = view
    structuredBaselineDom = view.dom.innerHTML
    const unregister = readLatest().runtime.richText.register(
      readLatest().element.id,
      {
        execute: (action, historyKey) => {
          armBaseline()
          executeRichTextActions(view, action, currentAttrs(), {
            // Vue warns when the requested family has not finished loading.
            onFontUnavailable: () => readLatest().notifications.notify({
              text: i18n.t('runtime.fontLoading'),
              type: 'warning',
            }),
          })
          view.focus()
          scheduleInput(false, historyKey)
          scheduleAttrs()
        },
        getAttrs: currentAttrs,
      },
    )
    if (readLatest().runtime.store.getState().session.handleElementId === element.id) {
      readLatest().runtime.richText.sync(element.id)
    }
    return () => {
      if (inputTimerRef.current) {
        clearTimeout(inputTimerRef.current)
        inputTimerRef.current = null
        // This cleanup also runs when <Activity> hides the editor for a
        // slideshow: a pending debounced edit must commit, not vanish
        // (text typed in the last 300ms before F5 was silently lost).
        const params = pendingInput
        pendingInput = null
        if (params) commitInput(params.ignoreHistory, params.historyKey)
      }
      if (attrsTimerRef.current) clearTimeout(attrsTimerRef.current)
      if (emptyCheckTimerRef.current) clearTimeout(emptyCheckTimerRef.current)
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
    // Vue re-syncs richTextAttrs on every deep handle-element change, so the
    // toolbars refresh after an external replacement (undo/redo) too.
    const { element: latestElement, runtime: latestRuntime } = readLatest()
    if (latestRuntime.store.getState().session.handleElementId === latestElement.id) {
      latestRuntime.richText.sync(latestElement.id)
    }
  }, [elementText.content])

  useEffect(() => {
    const wasHandleElement = wasHandleElementRef.current
    wasHandleElementRef.current = isHandleElement
    if (!wasHandleElement || isHandleElement) return
    if (element.type === 'shape') {
      // Quirk retired: the source editor recorded a second, identical snapshot when an
      // edited shape lost handle focus. The edit's own debounced snapshot is
      // the single history boundary now.
      shapeContentChangedRef.current = false
      return
    }
    if (emptyCheckTimerRef.current) clearTimeout(emptyCheckTimerRef.current)
    emptyCheckTimerRef.current = setTimeout(() => {
      emptyCheckTimerRef.current = null
      const current = readLatest()
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
      className={`mona-rich-text mona-prosemirror-editor${editing ? ' is-editing' : ''}${formatPainterActive ? ' is-format-painter' : ''}`}
      onPointerDown={event => event.stopPropagation()}
      ref={mountRef}
    />
  )
}
