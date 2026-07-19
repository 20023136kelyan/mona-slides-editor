import { createInteractionController } from '@mona/editor-interactions'
import { createEditorStore, editorActions, type EditorStore } from '@mona/editor-state'
import {
  createPresentationId,
  createPresentationTransaction,
  type PresentationCommand,
  type PresentationState,
} from '@mona/presentation-core'
import type { PPTElement } from '@mona/presentation-core/model'

export const MONA_CLIPBOARD_MIME = 'application/x-mona-presentation-elements+json'

interface MonaClipboardPayload {
  version: 1
  elements: PPTElement[]
}

export interface CommitOptions {
  recordHistory?: boolean
}

export interface EditorRuntime {
  readonly interaction: ReturnType<typeof createInteractionController>
  readonly store: EditorStore
  canRedo: () => boolean
  canUndo: () => boolean
  commit: (label: string, commands: PresentationCommand[], options?: CommitOptions) => boolean
  copySelection: () => string | undefined
  cutSelection: () => string | undefined
  deleteSelection: () => boolean
  focusSlide: (index: number) => void
  getClipboardText: () => string | undefined
  paste: (serialized?: string) => string[]
  redo: () => boolean
  selectAll: () => void
  undo: () => boolean
}

const serializeClipboard = (elements: PPTElement[]): string => JSON.stringify({
  version: 1,
  elements,
} satisfies MonaClipboardPayload)

const parseClipboard = (serialized: string): PPTElement[] | undefined => {
  try {
    const payload = JSON.parse(serialized) as Partial<MonaClipboardPayload>
    if (payload.version !== 1 || !Array.isArray(payload.elements)) return undefined
    return payload.elements as PPTElement[]
  }
  catch {
    return undefined
  }
}

export const createEditorRuntime = (presentation: PresentationState): EditorRuntime => {
  const store = createEditorStore({ presentation })
  const interaction = createInteractionController()
  const past: PresentationState[] = []
  const future: PresentationState[] = []
  let clipboardText: string | undefined

  const commit: EditorRuntime['commit'] = (label, commands, options = {}) => {
    if (!commands.length) return false
    const before = store.getState().presentation
    store.dispatch(editorActions.transactionCommitted(createPresentationTransaction({
      label,
      origin: 'user',
      commands,
    })))
    const after = store.getState().presentation
    if (after === before) return false
    if (options.recordHistory ?? true) {
      past.push(before)
      future.length = 0
    }
    return true
  }

  const selectedElements = () => {
    const state = store.getState()
    const selected = new Set(state.session.activeElementIds)
    return state.presentation.slides[state.presentation.slideIndex]?.elements.filter(element => selected.has(element.id)) ?? []
  }

  const copySelection = () => {
    const elements = selectedElements()
    if (!elements.length) return undefined
    clipboardText = serializeClipboard(structuredClone(elements))
    return clipboardText
  }

  const deleteSelection = () => {
    const ids = store.getState().session.activeElementIds
    if (!ids.length) return false
    const changed = commit('Delete elements', [{ type: 'element.delete', elementIds: ids }])
    if (changed) store.dispatch(editorActions.selectionChanged([]))
    return changed
  }

  const paste = (serialized = clipboardText) => {
    if (!serialized) return []
    const source = parseClipboard(serialized)
    if (!source?.length) return []
    const idMap = new Map<string, string>()
    const groupMap = new Map<string, string>()
    for (const element of source) {
      idMap.set(element.id, createPresentationId())
      if (element.groupId && !groupMap.has(element.groupId)) groupMap.set(element.groupId, createPresentationId())
    }
    const additions = structuredClone(source).map(element => ({
      ...element,
      id: idMap.get(element.id)!,
      groupId: element.groupId ? groupMap.get(element.groupId) : undefined,
      left: element.left + 20,
      top: element.top + 20,
    })) as PPTElement[]
    if (!commit('Paste elements', [{ type: 'element.add', elements: additions }])) return []
    const ids = additions.map(element => element.id)
    store.dispatch(editorActions.selectionChanged(ids))
    clipboardText = serializeClipboard(structuredClone(additions))
    return ids
  }

  return {
    interaction,
    store,
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    commit,
    copySelection,
    cutSelection: () => {
      const serialized = copySelection()
      if (serialized) deleteSelection()
      return serialized
    },
    deleteSelection,
    focusSlide: index => {
      const state = store.getState()
      if (index === state.presentation.slideIndex) return
      commit('Focus slide', [{ type: 'slide.focus', index }], { recordHistory: false })
      store.dispatch(editorActions.selectionChanged([]))
      store.dispatch(editorActions.cropElementChanged(null))
    },
    getClipboardText: () => clipboardText,
    paste,
    redo: () => {
      const next = future.pop()
      if (!next) return false
      past.push(store.getState().presentation)
      store.dispatch(editorActions.historyRestored(next))
      return true
    },
    selectAll: () => {
      const state = store.getState()
      const ids = state.presentation.slides[state.presentation.slideIndex]?.elements
        .filter(element => !element.lock && !state.session.hiddenElementIds.includes(element.id))
        .map(element => element.id) ?? []
      store.dispatch(editorActions.selectionChanged(ids))
    },
    undo: () => {
      const previous = past.pop()
      if (!previous) return false
      future.push(store.getState().presentation)
      store.dispatch(editorActions.historyRestored(previous))
      return true
    },
  }
}
