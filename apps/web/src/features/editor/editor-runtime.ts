import { createInteractionController } from '@mona/editor-interactions'
import { createEditorStore, editorActions, type EditorStore } from '@mona/editor-state'
import {
  createPresentationId,
  createPresentationTransaction,
  type PresentationCommand,
  type PresentationState,
} from '@mona/presentation-core'
import type { Gradient, PPTElement, PPTElementOutline, PPTElementShadow, PPTShapeElement, Slide, SlideTheme } from '@mona/presentation-core/model'

import { parseEditorClipboard, serializeEditorClipboard } from '@/features/editor/editor-clipboard'
import { getPptistActionElementBounds } from '@/features/editor/editor-geometry'
import {
  createEditorRichTextRuntime,
  type EditorRichTextRuntime,
} from '@/features/editor/editor-rich-text-runtime'

export const MONA_CLIPBOARD_MIME = 'application/x-mona-presentation-elements+json'

export interface CommitOptions {
  historyKey?: string
  recordHistory?: boolean
}

export interface EditorRuntime {
  readonly interaction: ReturnType<typeof createInteractionController>
  readonly richText: EditorRichTextRuntime
  readonly store: EditorStore
  readonly shapeFormatPainter: {
    apply: (element: PPTShapeElement) => boolean
    getSnapshot: () => ShapeFormatPainter | null
    subscribe: (listener: () => void) => () => void
    toggle: (element: PPTShapeElement, keep?: boolean) => void
  }
  canRedo: () => boolean
  canUndo: () => boolean
  commit: (label: string, commands: PresentationCommand[], options?: CommitOptions) => boolean
  copySelection: () => string | undefined
  copySlides: () => string | undefined
  createSection: () => string | null
  createSlide: () => boolean
  createSlideFromTemplate: (slide: Slide) => string | null
  cutSelection: () => string | undefined
  cutSlides: () => string | undefined
  deleteSlides: () => boolean
  duplicateSlides: () => string[]
  deleteSelection: () => boolean
  focusSlide: (index: number) => void
  getClipboardText: () => string | undefined
  getHistorySnapshot: () => string
  getHistoryState: () => { cursor: number; length: number }
  insertTemplateSlides: (slides: readonly Slide[], theme: Partial<SlideTheme>) => string[]
  insertImportedSlides: (slides: readonly Slide[]) => string[]
  paste: (serialized?: string) => string[]
  pasteSlides: (serialized?: string) => string[]
  removeAllSections: () => boolean
  removeSection: (sectionId: string) => boolean
  removeSectionSlides: (sectionId: string) => boolean
  recordHistorySnapshot: (historyKey?: string) => void
  reorderSlide: (oldIndex: number, newIndex: number) => boolean
  redo: () => boolean
  selectAll: () => void
  selectAllSlides: () => void
  subscribeHistory: (listener: () => void) => () => void
  undo: () => boolean
  updateSectionTitle: (sectionId: string, title: string) => boolean
}

export interface ShapeFormatPainter {
  keep: boolean
  fill?: string
  gradient?: Gradient
  outline?: PPTElementOutline
  opacity?: number
  shadow?: PPTElementShadow
}

const serializeClipboard = (elements: PPTElement[]): string => serializeEditorClipboard({
  data: elements,
  type: 'elements',
})

const parseClipboard = (serialized: string): PPTElement[] | undefined => {
  const payload = parseEditorClipboard(serialized)
  if (typeof payload === 'string' || payload.type !== 'elements') return undefined
  return payload.data
}

export const createEditorRuntime = (presentation: PresentationState): EditorRuntime => {
  const store = createEditorStore({ presentation })
  const interaction = createInteractionController()
  const richText = createEditorRichTextRuntime()
  interface HistorySnapshot {
    slideIndex: number
    slides: PresentationState['slides']
  }
  const toSnapshot = (state: PresentationState): HistorySnapshot => ({
    slideIndex: state.slideIndex,
    slides: structuredClone(state.slides),
  })
  const snapshots: HistorySnapshot[] = [toSnapshot(presentation)]
  let snapshotCursor = 0
  const historyTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const historyListeners = new Set<() => void>()
  let clipboardText: string | undefined
  let shapeFormatPainter: ShapeFormatPainter | null = null
  const shapeFormatPainterListeners = new Set<() => void>()
  const notifyShapeFormatPainter = () => {
    for (const listener of shapeFormatPainterListeners) listener()
  }

  const addHistorySnapshot = () => {
    const current = toSnapshot(store.getState().presentation)
    snapshots.splice(snapshotCursor + 1)
    if (snapshots[snapshotCursor]) {
      snapshots[snapshotCursor] = {
        ...snapshots[snapshotCursor]!,
        slideIndex: current.slideIndex,
      }
    }
    snapshots.push(current)
    if (snapshots.length > 20) snapshots.shift()
    snapshotCursor = snapshots.length - 1
    for (const listener of historyListeners) listener()
  }

  const scheduleHistorySnapshot = (historyKey = 'manual') => {
    const pending = historyTimers.get(historyKey)
    if (pending !== undefined) clearTimeout(pending)
    historyTimers.set(historyKey, setTimeout(() => {
      historyTimers.delete(historyKey)
      addHistorySnapshot()
    }, 300))
  }

  // Undo/redo inside the debounce window must not skip the pending edit or
  // resurrect a stale redo branch; settle the pending snapshot first.
  const flushPendingHistorySnapshots = () => {
    if (!historyTimers.size) return
    for (const timer of historyTimers.values()) clearTimeout(timer)
    historyTimers.clear()
    addHistorySnapshot()
  }

  const restoreHistorySnapshot = (snapshot: HistorySnapshot) => {
    const current = store.getState().presentation
    store.dispatch(editorActions.historyRestored({
      ...current,
      slideIndex: Math.min(snapshot.slideIndex, Math.max(snapshot.slides.length - 1, 0)),
      slides: structuredClone(snapshot.slides),
    }))
    store.dispatch(editorActions.selectionChanged([]))
    for (const listener of historyListeners) listener()
  }

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
    if (options.recordHistory ?? true) scheduleHistorySnapshot(options.historyKey ?? label)
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

  const selectedSlides = () => {
    const state = store.getState()
    const selectedIndexes = new Set([...state.session.selectedSlideIndexes, state.presentation.slideIndex])
    return state.presentation.slides.filter((_, index) => selectedIndexes.has(index))
  }

  const copySlides = () => {
    const slides = selectedSlides()
    if (!slides.length) return undefined
    clipboardText = serializeEditorClipboard({ data: structuredClone(slides), type: 'slides' })
    return clipboardText
  }

  const remapSlides = (source: readonly Slide[]) => {
    const slideIdMap = new Map(source.map(slide => [slide.id, createPresentationId()]))
    return structuredClone(source).map(slide => {
      const elementIdMap = new Map(slide.elements.map(element => [element.id, createPresentationId()]))
      const groupIdMap = new Map<string, string>()
      for (const element of slide.elements) {
        if (element.groupId && !groupIdMap.has(element.groupId)) groupIdMap.set(element.groupId, createPresentationId())
      }
      for (const element of slide.elements) {
        element.id = elementIdMap.get(element.id)!
        if (element.groupId) element.groupId = groupIdMap.get(element.groupId)
        if (element.link?.type === 'slide') {
          const target = slideIdMap.get(element.link.target)
          if (target) element.link.target = target
          else delete element.link
        }
      }
      if (slide.animations) {
        for (const animation of slide.animations) {
          animation.id = createPresentationId()
          animation.elId = elementIdMap.get(animation.elId)!
        }
      }
      slide.id = slideIdMap.get(slide.id)!
      return slide
    })
  }

  const createEmptySlide = (): Slide => {
    const state = store.getState().presentation
    return {
      id: createPresentationId(),
      elements: [],
      background: { type: 'solid', color: state.theme.backgroundColor },
    }
  }

  const deleteSlidesByIds = (slideIds: readonly string[], historyKey = 'slide-handler') => {
    if (!slideIds.length) return false
    const state = store.getState().presentation
    const changed = slideIds.length === state.slides.length
      ? commit('Delete slides', [
        { type: 'slide.focus', index: 0 },
        { type: 'presentation.slides.replace', slides: [createEmptySlide()] },
      ], { historyKey })
      : commit('Delete slides', [{ type: 'slide.delete', slideIds: [...slideIds] }], { historyKey })
    if (changed) {
      store.dispatch(editorActions.selectedSlideIndexesChanged([]))
      store.dispatch(editorActions.selectionChanged([]))
    }
    return changed
  }

  const pasteSlides = (serialized = clipboardText) => {
    if (!serialized) return []
    const payload = parseEditorClipboard(serialized)
    if (typeof payload === 'string' || payload.type !== 'slides' || !payload.data.length) return []
    const slides = remapSlides(payload.data)
    if (!commit('Paste slides', [{ type: 'slide.add', slides }], { historyKey: 'clipboard-data' })) return []
    store.dispatch(editorActions.selectedSlideIndexesChanged([]))
    return slides.map(slide => slide.id)
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
    const state = store.getState()
    const currentElements = state.presentation.slides[state.presentation.slideIndex]?.elements ?? []
    const firstElement = source[0]!
    let offset = 0
    let collision: PPTElement | undefined
    do {
      collision = currentElements.find(element => {
        if (element.type !== firstElement.type) return false
        const existing = getPptistActionElementBounds(element)
        const candidate = getPptistActionElementBounds({
          ...firstElement,
          left: firstElement.left + offset,
          top: firstElement.top + offset,
        })
        return existing.minX === candidate.minX &&
          existing.maxX === candidate.maxX &&
          existing.minY === candidate.minY &&
          existing.maxY === candidate.maxY
      })
      if (collision) offset += 10
    } while (collision)
    const additions = structuredClone(source).map(element => ({
      ...element,
      id: idMap.get(element.id)!,
      groupId: element.groupId ? groupMap.get(element.groupId) : undefined,
      left: element.left + offset,
      top: element.top + offset,
    })) as PPTElement[]
    if (!commit('Paste elements', [{ type: 'element.add', elements: additions }], { historyKey: 'clipboard-data' })) return []
    const ids = additions.map(element => element.id)
    store.dispatch(editorActions.selectionChanged(ids))
    clipboardText = serializeClipboard(structuredClone(additions))
    return ids
  }

  return {
    interaction,
    richText,
    shapeFormatPainter: {
      apply: element => {
        if (!shapeFormatPainter) return false
        const { keep, ...props } = shapeFormatPainter
        const changed = commit('Apply shape format painter', [{
          type: 'element.update',
          payload: { id: element.id, props },
        }], { historyKey: 'shape-format-painter' })
        if (!keep) {
          shapeFormatPainter = null
          notifyShapeFormatPainter()
        }
        return changed
      },
      getSnapshot: () => shapeFormatPainter,
      subscribe: listener => {
        shapeFormatPainterListeners.add(listener)
        return () => shapeFormatPainterListeners.delete(listener)
      },
      toggle: (element, keep = false) => {
        shapeFormatPainter = shapeFormatPainter
          ? null
          : {
            keep,
            fill: element.fill,
            gradient: element.gradient,
            outline: element.outline,
            opacity: element.opacity,
            shadow: element.shadow,
          }
        notifyShapeFormatPainter()
      },
    },
    store,
    canUndo: () => snapshotCursor > 0,
    canRedo: () => snapshotCursor < snapshots.length - 1,
    commit,
    copySelection,
    copySlides,
    createSection: () => {
      const state = store.getState().presentation
      const slide = state.slides[state.slideIndex]
      if (!slide) return null
      const id = createPresentationId(6)
      if (!commit('Create section', [{ type: 'slide.update', slideId: slide.id, props: { sectionTag: { id } } }], { historyKey: 'section-handler' })) return null
      return id
    },
    createSlide: () => {
      const changed = commit('Create slide', [{ type: 'slide.add', slides: createEmptySlide() }], { historyKey: 'slide-handler' })
      if (changed) store.dispatch(editorActions.selectionChanged([]))
      return changed
    },
    createSlideFromTemplate: source => {
      const slide = structuredClone(source)
      const elementIdMap = new Map(slide.elements.map(element => [element.id, createPresentationId()]))
      const groupIdMap = new Map<string, string>()
      for (const element of slide.elements) {
        if (element.groupId && !groupIdMap.has(element.groupId)) groupIdMap.set(element.groupId, createPresentationId())
      }
      for (const element of slide.elements) {
        element.id = elementIdMap.get(element.id)!
        if (element.groupId) element.groupId = groupIdMap.get(element.groupId)
      }
      slide.id = createPresentationId()
      const changed = commit('Create slide from template', [{ type: 'slide.add', slides: slide }], { historyKey: 'slide-handler' })
      if (!changed) return null
      store.dispatch(editorActions.selectionChanged([]))
      return slide.id
    },
    cutSelection: () => {
      const serialized = copySelection()
      if (serialized) deleteSelection()
      return serialized
    },
    cutSlides: () => {
      const serialized = copySlides()
      if (serialized) {
        const state = store.getState()
        const selectedIndexes = new Set([...state.session.selectedSlideIndexes, state.presentation.slideIndex])
        const slideIds = state.presentation.slides.filter((_, index) => selectedIndexes.has(index)).map(slide => slide.id)
        if (slideIds.length === state.presentation.slides.length) {
          const slide: Slide = {
            id: createPresentationId(),
            elements: [],
            background: { type: 'solid', color: state.presentation.theme.backgroundColor },
          }
          commit('Delete slides', [
            { type: 'slide.focus', index: 0 },
            { type: 'presentation.slides.replace', slides: [slide] },
          ], { historyKey: 'slide-handler' })
        }
        else commit('Delete slides', [{ type: 'slide.delete', slideIds }], { historyKey: 'slide-handler' })
        store.dispatch(editorActions.selectedSlideIndexesChanged([]))
      }
      return serialized
    },
    deleteSlides: () => {
      const state = store.getState()
      const selectedIndexes = new Set([...state.session.selectedSlideIndexes, state.presentation.slideIndex])
      const slideIds = state.presentation.slides.filter((_, index) => selectedIndexes.has(index)).map(slide => slide.id)
      return deleteSlidesByIds(slideIds)
    },
    duplicateSlides: () => {
      const state = store.getState()
      const current = state.presentation.slides[state.presentation.slideIndex]
      if (!current) return []
      const slides = remapSlides([current])
      if (!commit('Paste slides', [{ type: 'slide.add', slides }], { historyKey: 'duplicate-slide' })) return []
      store.dispatch(editorActions.selectedSlideIndexesChanged([]))
      return slides.map(slide => slide.id)
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
    getHistorySnapshot: () => `${snapshotCursor}:${snapshots.length}`,
    getHistoryState: () => ({ cursor: snapshotCursor, length: snapshots.length }),
    insertTemplateSlides: (source, theme) => {
      if (!source.length) return []
      const state = store.getState().presentation
      const isEmptySlide = state.slides.length === 1 && state.slides[0]?.elements.length === 0
      if (isEmptySlide) {
        const slides = structuredClone([...source])
        if (!commit('Replace empty deck with template', [{ type: 'presentation.slides.replace', slides, theme }], { recordHistory: false })) return []
        return slides.map(slide => slide.id)
      }
      const slides = remapSlides(source)
      if (!commit('Insert template slides', [{ type: 'slide.add', slides }], { historyKey: 'add-slides-or-elements' })) return []
      return slides.map(slide => slide.id)
    },
    insertImportedSlides: source => {
      if (!source.length) return []
      const slides = remapSlides(source)
      if (!commit('Import slides', [{ type: 'slide.add', slides }], { recordHistory: false })) return []
      store.dispatch(editorActions.selectedSlideIndexesChanged([]))
      scheduleHistorySnapshot('add-slides-or-elements')
      return slides.map(slide => slide.id)
    },
    paste,
    pasteSlides,
    removeAllSections: () => {
      const state = store.getState().presentation
      if (!state.slides.some(slide => slide.sectionTag)) return false
      const slides = structuredClone(state.slides)
      for (const slide of slides) delete slide.sectionTag
      return commit('Remove all sections', [{ type: 'presentation.slides.replace', slides }], { historyKey: 'section-handler' })
    },
    removeSection: sectionId => {
      if (!sectionId) return false
      const slide = store.getState().presentation.slides.find(candidate => candidate.sectionTag?.id === sectionId)
      if (!slide) return false
      return commit('Remove section', [{ type: 'slide.properties.remove', payload: { id: slide.id, property: 'sectionTag' } }], { historyKey: 'section-handler' })
    },
    removeSectionSlides: sectionId => {
      const slides = store.getState().presentation.slides
      const startIndex = sectionId ? slides.findIndex(slide => slide.sectionTag?.id === sectionId) : 0
      if (startIndex < 0) return false
      const ids: string[] = []
      for (let index = startIndex; index < slides.length; index += 1) {
        const slide = slides[index]!
        if (index !== startIndex && slide.sectionTag) break
        ids.push(slide.id)
      }
      return deleteSlidesByIds(ids, 'section-delete-slides')
    },
    recordHistorySnapshot: scheduleHistorySnapshot,
    reorderSlide: (oldIndex, newIndex) => {
      const state = store.getState().presentation
      if (oldIndex === newIndex || oldIndex < 0 || newIndex < 0 || oldIndex >= state.slides.length || newIndex >= state.slides.length) return false
      const slides = structuredClone(state.slides)
      const movingSlide = slides[oldIndex]!
      const movingSection = movingSlide.sectionTag
      if (movingSection) {
        const nextSlide = slides[oldIndex + 1]
        delete movingSlide.sectionTag
        if (nextSlide && !nextSlide.sectionTag) nextSlide.sectionTag = movingSection
      }
      if (newIndex === 0) {
        const firstSection = slides[0]?.sectionTag
        if (firstSection) {
          delete slides[0]!.sectionTag
          movingSlide.sectionTag = firstSection
        }
      }
      slides.splice(oldIndex, 1)
      slides.splice(newIndex, 0, movingSlide)
      return commit('Reorder slide', [
        { type: 'presentation.slides.replace', slides },
        { type: 'slide.focus', index: newIndex },
      ], { recordHistory: false })
    },
    redo: () => {
      flushPendingHistorySnapshots()
      if (snapshotCursor >= snapshots.length - 1) return false
      snapshotCursor += 1
      restoreHistorySnapshot(snapshots[snapshotCursor]!)
      return true
    },
    selectAll: () => {
      const state = store.getState()
      const ids = state.presentation.slides[state.presentation.slideIndex]?.elements
        .filter(element => !element.lock && !state.session.hiddenElementIds.includes(element.id))
        .map(element => element.id) ?? []
      store.dispatch(editorActions.selectionChanged(ids))
    },
    selectAllSlides: () => {
      const slides = store.getState().presentation.slides
      store.dispatch(editorActions.selectionChanged([]))
      store.dispatch(editorActions.selectedSlideIndexesChanged(slides.map((_, index) => index)))
    },
    subscribeHistory: listener => {
      historyListeners.add(listener)
      return () => historyListeners.delete(listener)
    },
    undo: () => {
      flushPendingHistorySnapshots()
      if (snapshotCursor <= 0) return false
      snapshotCursor -= 1
      restoreHistorySnapshot(snapshots[snapshotCursor]!)
      return true
    },
    updateSectionTitle: (sectionId, title) => {
      if (!title) return false
      const slides = store.getState().presentation.slides
      const slide = sectionId === 'default'
        ? slides[0]
        : slides.find(candidate => candidate.sectionTag?.id === sectionId)
      if (!slide) return false
      const sectionTag = sectionId === 'default'
        ? { id: createPresentationId(6), title }
        : { ...slide.sectionTag!, title }
      return commit('Rename section', [{ type: 'slide.update', slideId: slide.id, props: { sectionTag } }], { historyKey: 'section-handler' })
    },
  }
}
