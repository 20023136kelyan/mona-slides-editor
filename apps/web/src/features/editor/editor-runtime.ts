import { createInteractionController } from '@mona/editor-interactions'
import { createEditorStore, editorActions, type EditorStore } from '@mona/editor-state'
import {
  applyPresentationTransaction,
  copyElementTreeWithPowerPointOrigins,
  createPresentationId,
  createPresentationTransaction,
  flattenElementTree,
  remapElementTreeIds,
  retainElementTreeCopyOrigins,
  resolveSlideRenderState,
  validateImportedSlides,
  type PresentationCommand,
  type PresentationState,
  type PresentationTransaction,
  type PresentationTransactionOrigin,
  type PresentationTransactionResult,
} from '@mona/presentation-core'
import type { Gradient, PPTElement, PPTElementOutline, PPTElementShadow, PPTShapeElement, Slide, SlideTheme } from '@mona/presentation-core/model'

import { parseEditorClipboard, serializeEditorClipboard } from '@/features/editor/editor-clipboard'
import { getActionElementBounds } from '@/features/editor/editor-geometry'
import { PowerPointPackageBackingStore } from '@/features/editor/editor-pptx-backing-store'
import { sanitizeElements, sanitizeSlides } from '@/lib/deck-sanitizer'
import {
  createEditorRichTextRuntime,
  type EditorRichTextRuntime,
} from '@/features/editor/editor-rich-text-runtime'

export const MONA_CLIPBOARD_MIME = 'application/x-mona-presentation-elements+json'

export interface CommitOptions {
  historyKey?: string
  origin?: PresentationTransactionOrigin
  recordHistory?: boolean
}

export interface EditorRuntime {
  readonly interaction: ReturnType<typeof createInteractionController>
  readonly pptxBackingStore: PowerPointPackageBackingStore
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
  commitTransaction: (transaction: PresentationTransaction, options?: Omit<CommitOptions, 'origin'>) => PresentationTransactionResult
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
  insertImportedSlides: (slides: readonly Slide[], setupCommands?: readonly PresentationCommand[]) => string[]
  paste: (serialized?: string) => string[]
  pasteSlides: (serialized?: string) => string[]
  previewTransaction: (transaction: PresentationTransaction) => PresentationTransactionResult
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
  // Clipboard payloads can come from any page via the system clipboard, so
  // they pass the same structural + markup gates as imported files.
  const candidates = Array.isArray(payload.data) ? payload.data : []
  if (!validateImportedSlides([{ id: 'clipboard', elements: candidates }]).valid) return undefined
  return sanitizeElements(candidates)
}

export const createEditorRuntime = (presentation: PresentationState): EditorRuntime => {
  const store = createEditorStore({ presentation })
  const interaction = createInteractionController()
  const pptxBackingStore = new PowerPointPackageBackingStore(presentation.sourcePackages)
  const richText = createEditorRichTextRuntime()
  // Snapshots hold REFERENCES into the store's immer-produced state, not
  // clones: RTK state is immutable (reducers copy-on-write, and immer freezes
  // it in development), so complete-document history retains structural
  // sharing while still restoring title, theme, viewport, templates, slides,
  // and every future serializable presentation field atomically.
  type HistorySnapshot = PresentationState
  const snapshots: HistorySnapshot[] = [store.getState().presentation]
  let snapshotCursor = 0
  const historyTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const historyListeners = new Set<() => void>()
  const notifyHistoryListeners = () => {
    for (const listener of historyListeners) listener()
  }
  const getVirtualHistoryState = () => {
    const hasPendingSnapshot = historyTimers.size > 0
    return {
      cursor: snapshotCursor + (hasPendingSnapshot ? 1 : 0),
      length: snapshots.length + (hasPendingSnapshot ? 1 : 0),
    }
  }
  let clipboardText: string | undefined
  let shapeFormatPainter: ShapeFormatPainter | null = null
  const shapeFormatPainterListeners = new Set<() => void>()
  const notifyShapeFormatPainter = () => {
    for (const listener of shapeFormatPainterListeners) listener()
  }

  const addHistorySnapshot = () => {
    const current = store.getState().presentation
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
    notifyHistoryListeners()
  }

  const scheduleHistorySnapshot = (historyKey = 'manual') => {
    const pending = historyTimers.get(historyKey)
    if (pending !== undefined) clearTimeout(pending)
    const hadPendingSnapshot = historyTimers.size > 0
    historyTimers.set(historyKey, setTimeout(() => {
      historyTimers.delete(historyKey)
      addHistorySnapshot()
    }, 300))
    // Undo must become available as soon as a real document mutation lands,
    // not 300 ms later when the coalescing timer settles. The virtual history
    // state represents the pending boundary without forcing high-frequency
    // slider/text updates to allocate a snapshot per event.
    if (!hadPendingSnapshot) notifyHistoryListeners()
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
    // The complete snapshot re-enters the store by reference; immer treats it
    // as a frozen base and copies only changed branches on the next write.
    store.dispatch(editorActions.historyRestored(snapshot))
    store.dispatch(editorActions.selectionChanged([]))
    store.dispatch(editorActions.pageSelectionChanged(true))
    for (const listener of historyListeners) listener()
  }

  const previewTransaction: EditorRuntime['previewTransaction'] = transaction => (
    applyPresentationTransaction(store.getState().presentation, transaction)
  )

  const commitTransaction: EditorRuntime['commitTransaction'] = (transaction, options = {}) => {
    const before = store.getState().presentation
    const preview = applyPresentationTransaction(before, transaction)
    if (!preview.ok) return preview

    const recordHistory = options.recordHistory ?? true
    const historyKey = options.historyKey ?? transaction.label
    // A different user action is a real undo boundary even when it follows the
    // previous action inside the 300 ms coalescing window. Settle the previous
    // action before applying the next one; repeated updates from the same
    // slider/text source continue to coalesce.
    if (recordHistory && historyTimers.size && !historyTimers.has(historyKey)) {
      flushPendingHistorySnapshots()
    }
    store.dispatch(editorActions.transactionCommitted(transaction))
    const after = store.getState().presentation
    if (after !== before && recordHistory) {
      scheduleHistorySnapshot(historyKey)
    }
    return preview
  }

  const commit: EditorRuntime['commit'] = (label, commands, options = {}) => {
    if (!commands.length) return false
    const transaction = createPresentationTransaction({
      label,
      origin: options.origin ?? 'user',
      commands,
    })
    const before = store.getState().presentation
    const result = commitTransaction(transaction, options)
    return result.ok && store.getState().presentation !== before
  }

  const selectedElements = () => {
    const state = store.getState()
    const selected = new Set(state.session.activeElementIds)
    return state.presentation.slides[state.presentation.slideIndex]?.elements.filter(element => selected.has(element.id)) ?? []
  }

  const copySelection = () => {
    const elements = selectedElements()
    if (!elements.length) return undefined
    clipboardText = serializeClipboard(elements)
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
    clipboardText = serializeEditorClipboard({ data: slides, type: 'slides' })
    return clipboardText
  }

  const remapSlides = (
    source: readonly Slide[],
    options: { preserveSource?: boolean } = {},
  ) => {
    const preserveSource = options.preserveSource ?? false
    const presentation = store.getState().presentation
    const slideIdMap = new Map(source.map(slide => [slide.id, createPresentationId()]))
    return source.map(sourceSlide => {
      const slide = structuredClone(sourceSlide)
      const canCloneNativeSlide = Boolean(
        !preserveSource
        && sourceSlide.source
        && presentation.sourcePackages?.some(sourcePackage => (
          sourcePackage.packageId === sourceSlide.source?.packageId
        )),
      )
      const renderState = !preserveSource && sourceSlide.source && !canCloneNativeSlide
        ? resolveSlideRenderState(sourceSlide, presentation.sourcePackages ?? [])
        : undefined
      const elements = renderState
        ? [
            ...sourceSlide.elements,
            ...renderState.nodes
              .filter(node => node.layer !== 'slide')
              .map(node => node.element),
          ]
        : slide.elements
      const remapped = preserveSource
        ? remapElementTreeIds(elements, createPresentationId)
        : copyElementTreeWithPowerPointOrigins(elements, createPresentationId, 'copy')
      slide.elements = remapped.elements
      if (!preserveSource) {
        if (canCloneNativeSlide && sourceSlide.source) {
          slide.source = {
            ...sourceSlide.source,
            copyOnWrite: {
              packageId: sourceSlide.source.packageId,
              sourceSlidePart: sourceSlide.source.slidePart,
            },
          }
        }
        else {
          delete slide.source
          if (renderState?.background) slide.background = structuredClone(renderState.background)
        }
      }
      const groupIdMap = new Map<string, string>()
      for (const element of flattenElementTree(slide.elements)) {
        if (element.groupId && !groupIdMap.has(element.groupId)) groupIdMap.set(element.groupId, createPresentationId())
      }
      for (const element of flattenElementTree(slide.elements)) {
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
          animation.elId = remapped.idMap.get(animation.elId) ?? animation.elId
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
      store.dispatch(editorActions.pageSelectionChanged(true))
    }
    return changed
  }

  const pasteSlides = (serialized = clipboardText) => {
    if (!serialized) return []
    const payload = parseEditorClipboard(serialized)
    if (typeof payload === 'string' || payload.type !== 'slides' || !payload.data.length) return []
    if (!validateImportedSlides(payload.data).valid) return []
    const slides = remapSlides(sanitizeSlides(payload.data))
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
    const groupMap = new Map<string, string>()
    const state = store.getState()
    const currentSlide = state.presentation.slides[state.presentation.slideIndex]
    const additions = copyElementTreeWithPowerPointOrigins(
      source,
      createPresentationId,
      'copy',
      currentSlide?.source
        ? {
            packageId: currentSlide.source.packageId,
            slidePart: currentSlide.source.slidePart,
          }
        : undefined,
    ).elements
    for (const element of flattenElementTree(additions)) {
      if (element.groupId && !groupMap.has(element.groupId)) groupMap.set(element.groupId, createPresentationId())
    }
    const currentElements = state.presentation.slides[state.presentation.slideIndex]?.elements ?? []
    const firstElement = source[0]!
    let offset = 0
    let collision: PPTElement | undefined
    do {
      collision = currentElements.find(element => {
        if (element.type !== firstElement.type) return false
        const existing = getActionElementBounds(element)
        const candidate = getActionElementBounds({
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
    for (const element of flattenElementTree(additions)) {
      if (element.groupId) element.groupId = groupMap.get(element.groupId)
    }
    for (const element of additions) {
      element.left += offset
      element.top += offset
    }
    if (!commit('Paste elements', [{ type: 'element.add', elements: additions }], { historyKey: 'clipboard-data' })) return []
    const ids = additions.map(element => element.id)
    store.dispatch(editorActions.selectionChanged(ids))
    clipboardText = serializeClipboard(structuredClone(additions))
    return ids
  }

  return {
    interaction,
    pptxBackingStore,
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
    canUndo: () => getVirtualHistoryState().cursor > 0,
    canRedo: () => !historyTimers.size && snapshotCursor < snapshots.length - 1,
    commit,
    commitTransaction,
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
      if (changed) {
        store.dispatch(editorActions.selectionChanged([]))
        store.dispatch(editorActions.pageSelectionChanged(true))
      }
      return changed
    },
    createSlideFromTemplate: source => {
      // Templates used to be bundled assets, so they skipped the sanitizer the
      // paste and import paths run. They are fetched from a provider's origin
      // now, which makes their slide HTML content from outside this session —
      // the same category as a pasted deck, and sanitized on the same terms.
      const slide = remapSlides(sanitizeSlides([source]))[0]!
      const changed = commit('Create slide from template', [{ type: 'slide.add', slides: slide }], { historyKey: 'slide-handler' })
      if (!changed) return null
      store.dispatch(editorActions.selectionChanged([]))
      store.dispatch(editorActions.pageSelectionChanged(true))
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
      const selectedIndexes = Array.from(new Set([
        ...state.session.selectedSlideIndexes,
        state.presentation.slideIndex,
      ])).sort((a, b) => a - b)
      const sources = selectedIndexes.map(index => state.presentation.slides[index]).filter((slide): slide is Slide => Boolean(slide))
      if (!sources.length) return []
      const slides = remapSlides(sources)
      const insertionIndex = selectedIndexes.at(-1)!
      if (!commit('Duplicate slides', [
        { type: 'slide.focus', index: insertionIndex },
        { type: 'slide.add', slides },
      ], { historyKey: 'duplicate-slide' })) return []
      const firstDuplicateIndex = insertionIndex + 1
      store.dispatch(editorActions.selectedSlideIndexesChanged(
        slides.map((_, offset) => firstDuplicateIndex + offset),
      ))
      store.dispatch(editorActions.selectionChanged([]))
      store.dispatch(editorActions.pageSelectionChanged(true))
      return slides.map(slide => slide.id)
    },
    deleteSelection,
    focusSlide: index => {
      const state = store.getState()
      if (index !== state.presentation.slideIndex) {
        commit('Focus slide', [{ type: 'slide.focus', index }], { recordHistory: false })
      }
      store.dispatch(editorActions.selectionChanged([]))
      store.dispatch(editorActions.cropElementChanged(null))
      store.dispatch(editorActions.pageSelectionChanged(true))
    },
    getClipboardText: () => clipboardText,
    getHistorySnapshot: () => {
      const { cursor, length } = getVirtualHistoryState()
      return `${cursor}:${length}`
    },
    getHistoryState: getVirtualHistoryState,
    insertTemplateSlides: (source, theme) => {
      if (!source.length) return []
      const state = store.getState().presentation
      // Sanitized once, up front, so both branches below are covered: template
      // payloads now arrive over the network from a provider, which puts their
      // slide HTML in the same trust category as an imported or pasted deck.
      const safe = sanitizeSlides([...source])
      const isEmptySlide = state.slides.length === 1 && state.slides[0]?.elements.length === 0
      if (isEmptySlide) {
        const slides = structuredClone(safe)
        for (const slide of slides) {
          delete slide.source
          retainElementTreeCopyOrigins(slide.elements, 'copy')
        }
        if (!commit('Replace empty deck with template', [{ type: 'presentation.slides.replace', slides, theme }], { historyKey: 'add-slides-or-elements' })) return []
        return slides.map(slide => slide.id)
      }
      const slides = remapSlides(safe)
      if (!commit('Insert template slides', [{ type: 'slide.add', slides }], { historyKey: 'add-slides-or-elements' })) return []
      return slides.map(slide => slide.id)
    },
    insertImportedSlides: (source, setupCommands = []) => {
      if (!source.length) return []
      const slides = remapSlides(source, { preserveSource: true })
      if (!commit('Import slides', [...setupCommands, { type: 'slide.add', slides }], { recordHistory: false })) return []
      store.dispatch(editorActions.selectedSlideIndexesChanged([]))
      store.dispatch(editorActions.selectionChanged([]))
      store.dispatch(editorActions.cropElementChanged(null))
      store.dispatch(editorActions.pageSelectionChanged(true))
      scheduleHistorySnapshot('add-slides-or-elements')
      return slides.map(slide => slide.id)
    },
    paste,
    pasteSlides,
    previewTransaction,
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
      const rootState = store.getState()
      const state = rootState.presentation
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
      const changed = commit('Reorder slide', [
        { type: 'presentation.slides.replace', slides },
        { type: 'slide.focus', index: newIndex },
      ], { historyKey: `slide-reorder-${createPresentationId(8)}` })
      if (!changed) return false
      const remapIndex = (index: number) => {
        if (index === oldIndex) return newIndex
        if (oldIndex < newIndex && index > oldIndex && index <= newIndex) return index - 1
        if (newIndex < oldIndex && index >= newIndex && index < oldIndex) return index + 1
        return index
      }
      store.dispatch(editorActions.selectedSlideIndexesChanged(
        rootState.session.selectedSlideIndexes.map(remapIndex),
      ))
      return true
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
