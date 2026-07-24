/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- The slide canvas is an intentional composite application surface with managed keyboard interaction. */

import {
  lazy,
  Suspense,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import tinycolor from 'tinycolor2'

import type { InteractionSnapshot, PointerPosition } from '@mona/editor-interactions'
import {
  angleFromPoint,
  clientPointToSlide,
  rectToBounds,
  type ResizeHandle,
} from '@mona/editor-interactions/geometry'
import {
  editorActions,
  selectActiveElementIds,
  selectSession,
  selectCanvasFocus,
  selectCanvasPan,
  selectCanvasZoom,
  selectCropElementId,
  selectCurrentSlide,
  selectGridLineSize,
  selectPresentation,
  selectShowRuler,
} from '@mona/editor-state'
import { createPresentationId, selectFormattedCurrentSlideAnimations, type PresentationCommand } from '@mona/presentation-core'
import type { ElementLinkType, PPTElement, PPTImageElement, PPTShapeElement, PPTTableElement, PPTTextElement } from '@mona/presentation-core/model'

import { EditorContextMenu, LinkEditor } from '@/features/editor/EditorContextMenu'
import { EditorRichText } from '@/features/editor/EditorRichText'
import { EditorImageCropEditor, EditorSelectionOverlay } from '@/features/editor/EditorSelectionOverlay'
import { EditorFloatingLinkHandler } from '@/features/editor/EditorFloatingLinkHandler'
import { EditorCustomShapeCreator } from '@/features/editor/EditorCustomShapeCreator'
import { EditorSelectionActions } from '@/features/editor/contextual/EditorSelectionActions'
import { resolveSelectionCapabilities } from '@/features/editor/contextual/resolve-selection-capabilities'
import type { EditorCreateTool } from '@/features/editor/editor-create-tool'
import type { DrawingStore } from '@/features/editor/drawing/drawing-store'
import { loadDrawingWorkspace } from '@/features/editor/drawing/load-drawing-workspace'
import type { SketchAgentHandoff } from '@/features/editor/drawing/drawing-serialization'
import {
  canDeleteTableAxis,
  deleteTableColumn,
  deleteTableRow,
  insertTableColumn,
  insertTableRow,
  mergeTableCells,
  splitTableCell,
  tableCellKey,
} from '@/features/editor/editor-table'
import {
  type EditorRuntime,
} from '@/features/editor/editor-runtime'
import {
  alignElementsToCanvas,
  buildEditorGridPath,
  canResizeSelection,
  getElementBounds,
  getElementsBounds,
  getImageCropGeometry,
  getGroupRotationCenter,
  getGroupRotationReference,
  getLassoSelectionIds,
  groupElements,
  getTransformBounds,
  orderElement,
  resolveCreateGestureSelection,
  setElementLocks,
  ungroupElements,
  type CropControlHandle,
  type LineControlHandle,
} from '@/features/editor/editor-geometry'
import {
  applyElementUpdates,
  commitCropDraft,
  createElementFromGesture,
  derivePreview,
  DRAG_ACTIVATION_DISTANCE,
  duplicatePreviewElements,
  EMPTY_EDITOR_SLIDE,
  exceedsActivationDistance,
  isTextInput,
  legacyMousePoint,
  pointerModifiers,
  toCommands,
  TRANSFORM_ACTIVATION_DISTANCE,
  type CropDraft,
  type GestureContext,
} from '@/features/editor/editor-canvas-preview'
import { EditorRulers } from '@/features/editor/EditorRulers'
import { useCanvasClipboard } from '@/features/editor/use-canvas-clipboard'
import { useCanvasHotkeys, writeClipboard } from '@/features/editor/use-canvas-hotkeys'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { useEditorApplication } from '@/features/editor/services/editor-application'
import { useOptionalEditorShell } from '@/features/editor/shell/editor-shell'
import { SlideRenderer } from '@/features/presentation-renderer/SlideRenderer'

const DrawingWorkspace = lazy(() => loadDrawingWorkspace().then(module => ({
  default: module.DrawingWorkspace,
})))
const subscribeToNothing = () => () => {}
const zeroRevision = () => 0


interface ContextMenuState {
  readonly cell?: { column: number; row: number }
  readonly elementId?: string
  readonly position: PointerPosition
  readonly surface: 'canvas' | 'element' | 'table-cell'
}

interface LinkEditorState {
  readonly elementId: string
  readonly type: ElementLinkType
  readonly address: string
  readonly slideId: string
}

export function EditorCanvas({ activeCreateTool, customShapeActive, drawingStore = null, interactionProfile = 'desktop', onBuildSketch, onCreateToolChange, onCustomShapeChange, onDrawingModeChange, onEditChart, onEditLatex, onSketchVisibilityChange, runtime }: {
  activeCreateTool: EditorCreateTool | null
  customShapeActive: boolean
  drawingStore?: DrawingStore | null
  interactionProfile?: 'desktop' | 'mobile'
  onBuildSketch?: (handoff: SketchAgentHandoff) => void
  onCreateToolChange: (tool: EditorCreateTool | null) => void
  onCustomShapeChange: (active: boolean) => void
  onDrawingModeChange?: (active: boolean) => void
  onEditChart: (elementId: string) => void
  onEditLatex: (elementId: string) => void
  onSketchVisibilityChange?: (visible: boolean) => void
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const { notifications, openAgent, openExport, startPresentation, subscribeToPresentationStart } = useEditorApplication()
  const editorShell = useOptionalEditorShell()
  const toggleTaskPanel = editorShell?.toggleTaskPanel
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const selectedCurrentSlide = useEditorSelector(runtime.store, selectCurrentSlide)
  const currentSlide = selectedCurrentSlide ?? EMPTY_EDITOR_SLIDE
  const activeElementIds = useEditorSelector(runtime.store, selectActiveElementIds)
  const session = useEditorSelector(runtime.store, selectSession)
  const canvasFocus = useEditorSelector(runtime.store, selectCanvasFocus)
  const canvasPan = useEditorSelector(runtime.store, selectCanvasPan)
  const canvasZoom = useEditorSelector(runtime.store, selectCanvasZoom)
  const cropElementId = useEditorSelector(runtime.store, selectCropElementId)
  const gridLineSize = useEditorSelector(runtime.store, selectGridLineSize)
  const showRuler = useEditorSelector(runtime.store, selectShowRuler)
  useSyncExternalStore(
    drawingStore?.subscribe ?? subscribeToNothing,
    drawingStore?.getRevision ?? zeroRevision,
    drawingStore?.getRevision ?? zeroRevision,
  )
  const mobileInteraction = interactionProfile === 'mobile'
  const activeTool = activeCreateTool
  const interaction = useSyncExternalStore(
    runtime.interaction.subscribe,
    runtime.interaction.getSnapshot,
    runtime.interaction.getSnapshot,
  )
  const stageRef = useRef<HTMLElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<GestureContext | null>(null)
  const cropDraftRef = useRef<CropDraft | null>(null)
  const ctrlOrMetaPressedRef = useRef(false)
  const shiftPressedRef = useRef(false)
  const spacePressedRef = useRef(false)
  // the source editor throttles undo/redo (100ms, leading) so key auto-repeat cannot
  // burn through the snapshot stack.
  const [gestureContext, setGestureContext] = useState<GestureContext | null>(null)
  const [viewportFit, setViewportFit] = useState({ denominator: 1, dimension: 0, height: 0, width: 0 })
  const [isSpacePressed, setIsSpacePressed] = useState(false)
  const [shapeTextEditorId, setShapeTextEditorId] = useState<string | null>(null)
  const [tableEditorId, setTableEditorIdState] = useState<string | null>(null)
  const tableEditorIdRef = useRef<string | null>(null)
  const setTableEditorId = (elementId: string | null) => {
    tableEditorIdRef.current = elementId
    setTableEditorIdState(elementId)
  }
  const [cropDraft, setCropDraft] = useState<CropDraft | null>(null)
  const [linkEditor, setLinkEditor] = useState<LinkEditorState | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  // Portaled transients (context menu, link dialog) escape the hidden
  // <Activity> wrapper during slideshows; close them when screening starts.
  useEffect(() => {
    return subscribeToPresentationStart(() => {
      setMenu(null)
      setLinkEditor(null)
      runtime.store.dispatch(editorActions.hotkeysDisabledChanged(false))
    })
  }, [runtime, subscribeToPresentationStart])

  useEffect(() => {
    if (!customShapeActive) return undefined
    const id = notifications.notify({
      duration: 0,
      text: t('foundation.editor.drawShapeTip'),
      type: 'success',
    })
    return () => notifications.dismiss(id)
  }, [customShapeActive, notifications, t])

  useEffect(() => runtime.store.subscribe(() => {
    const liveSession = selectSession(runtime.store.getState())
    const handleElementId = liveSession.handleElementId
    setShapeTextEditorId(current => current && current !== handleElementId ? null : current)
    const currentTableEditorId = tableEditorIdRef.current
    if (!currentTableEditorId || currentTableEditorId === handleElementId) return
    setTableEditorId(null)
    if (liveSession.disableHotkeys) runtime.store.dispatch(editorActions.hotkeysDisabledChanged(false))
  }), [runtime])

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    const update = () => {
      const rect = stage.getBoundingClientRect()
      const widthConstrained = rect.height / rect.width > presentation.viewportRatio
      setViewportFit(widthConstrained
        ? { denominator: presentation.viewportSize, dimension: Math.max(1, rect.width), height: rect.height, width: rect.width }
        : {
          denominator: presentation.viewportSize * presentation.viewportRatio,
          dimension: Math.max(1, rect.height),
          height: rect.height,
          width: rect.width,
        })
      // The source ResizeObserver always re-centers the viewport, including a
      // viewport that had previously been dragged.
      runtime.store.dispatch(editorActions.canvasPanChanged({ x: 0, y: 0 }))
    }
    update()
    let resizeFrame = 0
    if (interactionProfile === 'mobile') {
      const observer = new ResizeObserver(() => {
        if (resizeFrame) return
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = 0
          const rect = stage.getBoundingClientRect()
          setViewportFit(current => ({ ...current, height: rect.height, width: rect.width }))
        })
      })
      observer.observe(stage)
      return () => {
        if (resizeFrame) cancelAnimationFrame(resizeFrame)
        observer.disconnect()
      }
    }
    const observer = new ResizeObserver(() => {
      if (resizeFrame) return
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0
        update()
      })
    })
    observer.observe(stage)
    return () => {
      if (resizeFrame) cancelAnimationFrame(resizeFrame)
      observer.disconnect()
    }
  }, [interactionProfile, presentation.viewportRatio, presentation.viewportSize, runtime])

  useEffect(() => {
    const resetModifierState = () => {
      ctrlOrMetaPressedRef.current = false
      shiftPressedRef.current = false
      spacePressedRef.current = false
      setIsSpacePressed(false)
    }
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey) ctrlOrMetaPressedRef.current = true
      if (event.shiftKey) shiftPressedRef.current = true
      if (
        event.key === ' ' &&
        !isTextInput(event.target) &&
        !selectSession(runtime.store.getState()).disableHotkeys
      ) {
        spacePressedRef.current = true
        setIsSpacePressed(true)
      }
      // the source editor handles Ctrl/Meta+P, F5/Shift+F5, and Ctrl+F before the
      // disableHotkeys guard, so they also work while a text editor has focus.
      if ((event.ctrlKey || event.metaKey) && event.key.toUpperCase() === 'P') {
        event.preventDefault()
        openExport('pdf')
        return
      }
      if (event.key === 'F5') {
        event.preventDefault()
        startPresentation({ fromStart: !event.shiftKey })
        return
      }
      if (event.ctrlKey && event.key.toUpperCase() === 'F') {
        event.preventDefault()
        toggleTaskPanel?.('search')
        return
      }
      // the source editor deliberately reserves only Control (not Command/Meta) for its
      // keyboard zoom shortcuts. Wheel zoom follows the shared modifier state.
      if (!event.ctrlKey) return
      const zoom = selectCanvasZoom(runtime.store.getState())
      if (event.key === '-' && zoom > 10) {
        event.preventDefault()
        runtime.store.dispatch(editorActions.canvasZoomChanged(zoom - 5))
      }
      else if (event.key === '=' && zoom < 300) {
        event.preventDefault()
        runtime.store.dispatch(editorActions.canvasZoomChanged(zoom + 5))
      }
      else if (event.key === '0') {
        event.preventDefault()
        runtime.store.dispatch(editorActions.canvasZoomChanged(90))
        runtime.store.dispatch(editorActions.canvasPanChanged({ x: 0, y: 0 }))
        runtime.store.dispatch(editorActions.canvasDraggedChanged(false))
      }
    }
    document.addEventListener('keydown', handleDocumentKeyDown)
    document.addEventListener('keyup', resetModifierState)
    window.addEventListener('blur', resetModifierState)
    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown)
      document.removeEventListener('keyup', resetModifierState)
      window.removeEventListener('blur', resetModifierState)
    }
  }, [openExport, runtime, startPresentation, toggleTaskPanel])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const textElements = new Map(currentSlide.elements
      .filter(element => element.type === 'text' && !element.fixedHeight)
      .map(element => [element.id, element]))
    if (!textElements.size) return undefined

    const pendingMeasurements = new Map<string, { measured: number; property: 'height' | 'width' }>()
    let measurementFrame = 0
    const flushMeasurements = () => {
      measurementFrame = 0
      const stateSlide = selectCurrentSlide(runtime.store.getState())
      if (!stateSlide || stateSlide.id !== currentSlide.id) {
        pendingMeasurements.clear()
        return
      }
      const commands: PresentationCommand[] = []
      for (const [elementId, { measured, property }] of pendingMeasurements) {
        const current = stateSlide.elements.find(element => element.id === elementId && element.type === 'text')
        if (!current || current.type !== 'text' || current[property] === measured) continue
        commands.push({
          type: 'element.update',
          payload: { id: current.id, props: { [property]: measured } },
        })
      }
      pendingMeasurements.clear()
      if (commands.length) runtime.commit('Measure text elements', commands, { recordHistory: false })
    }
    const observer = new ResizeObserver(entries => {
      // the source editor defers auto-size writes while a resize is active, then applies
      // the measured dimension at pointer-up. finishGesture owns that branch.
      if (gestureRef.current?.kind === 'resize') return
      const stateSlide = selectCurrentSlide(runtime.store.getState())
      if (!stateSlide || stateSlide.id !== currentSlide.id) return
      for (const entry of entries) {
        const content = entry.target as HTMLElement
        const elementRoot = content.closest<HTMLElement>('[data-element-id]')
        const elementId = elementRoot?.dataset.elementId
        const source = elementId ? textElements.get(elementId) : undefined
        const current = elementId
          ? stateSlide.elements.find(element => element.id === elementId && element.type === 'text')
          : undefined
        if (!source || !current || current.type !== 'text') continue
        // Match the established editor's two settling paths exactly. Without an explicit
        // inset, its ResizeObserver persists the fractional content box plus
        // the default inset (for example 86.5). With an explicit inset, that
        // observer update also re-triggers the established editor's inset watcher, whose final
        // write is the rounded DOM offset dimension (for example 23.2 -> 23).
        const inset = current.inset || [10, 10, 10, 10]
        const measured = current.inset
          ? current.vertical ? content.offsetWidth : content.offsetHeight
          : current.vertical
            ? entry.contentRect.width + inset[1] + inset[3]
            : entry.contentRect.height + inset[0] + inset[2]
        const property = current.vertical ? 'width' : 'height'
        if (current[property] === measured) continue
        pendingMeasurements.set(current.id, { measured, property })
      }
      if (pendingMeasurements.size && !measurementFrame) measurementFrame = requestAnimationFrame(flushMeasurements)
    })
    for (const elementId of textElements.keys()) {
      const content = canvas.querySelector<HTMLElement>(
        `[data-element-id="${CSS.escape(elementId)}"] .mona-text-content`,
      )
      if (content) observer.observe(content)
    }
    return () => {
      if (measurementFrame) cancelAnimationFrame(measurementFrame)
      pendingMeasurements.clear()
      observer.disconnect()
    }
  }, [currentSlide, runtime])

  useEffect(() => {
    if (!menu) return undefined
    const close = () => setMenu(null)
    document.body.addEventListener('scroll', close)
    window.addEventListener('resize', close)
    return () => {
      document.body.removeEventListener('scroll', close)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  useEffect(() => {
    if (!cropElementId) return undefined
    const finishWhenClickingOutside = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('.mona-image-crop-editor')) return
      commitCropDraft(runtime, cropDraftRef.current)
      cropDraftRef.current = null
      setCropDraft(null)
      runtime.store.dispatch(editorActions.cropElementChanged(null))
    }
    document.addEventListener('pointerdown', finishWhenClickingOutside, true)
    return () => document.removeEventListener('pointerdown', finishWhenClickingOutside, true)
  }, [cropElementId, runtime])

  const scale = viewportFit.dimension * (canvasZoom / 100) / viewportFit.denominator
  const preview = derivePreview(gestureContext, interaction, currentSlide, presentation.viewportSize, presentation.viewportRatio)
  const previewSlide = preview.duplicateElements
    ? (() => {
      const replacements = new Map(preview.duplicateElements.map(element => [element.id, element]))
      return {
        ...currentSlide,
        elements: currentSlide.elements.map(element => replacements.get(element.id) ?? element),
      }
    })()
    : applyElementUpdates(currentSlide, preview.updates)
  const selectedElements = previewSlide.elements.filter(element => activeElementIds.includes(element.id))
  const activeGroupElement = session.activeGroupElementId
    ? selectedElements.find(element => element.id === session.activeGroupElementId)
    : undefined
  const transformElements = activeGroupElement ? [activeGroupElement] : selectedElements
  const selectionBounds = selectedElements.length ? getElementsBounds(selectedElements) : undefined
  const menuElement = menu?.elementId ? previewSlide.elements.find(element => element.id === menu.elementId) : undefined
  const pan = preview.pan ?? canvasPan
  const cropSourceImage = cropElementId
    ? previewSlide.elements.find((element): element is PPTImageElement => element.id === cropElementId && element.type === 'image')
    : undefined
  const cropGeometry = preview.cropGeometry ?? (
    cropDraft?.element.id === cropElementId
      ? cropDraft.geometry
      : cropSourceImage ? getImageCropGeometry(cropSourceImage) : undefined
  )
  const renderedSlide = {
    ...previewSlide,
    elements: previewSlide.elements.filter(element => (
      !session.hiddenElementIds.includes(element.id) && element.id !== cropElementId
    )),
  }
  const hasSketch = drawingStore?.hasSketch(currentSlide.id) ?? false
  const showDrawingWorkspace = Boolean(drawingStore) && !mobileInteraction && (
    session.drawingMode || (session.sketchesVisible && hasSketch)
  )
  const contextualCapabilities = resolveSelectionCapabilities({
    activeElementIds,
    activeGroupElementId: session.activeGroupElementId,
    activeMode: session.drawingMode ? 'draw' : activeTool || customShapeActive ? 'create' : 'select',
    cropElementId,
    editingTextElementId: session.editingTextElementId,
    elements: previewSlide.elements,
    handleElementId: session.handleElementId,
    pageSelected: session.pageSelected,
  })
  const contextualActionElements = contextualCapabilities.selectionKind === 'group-child' && contextualCapabilities.targetElement
    ? [contextualCapabilities.targetElement]
    : contextualCapabilities.selectedElements

  const inputPoint = (event: Pick<PointerEvent, 'clientX' | 'clientY'>): PointerPosition => (
    mobileInteraction
      ? { x: event.clientX, y: event.clientY }
      : legacyMousePoint({ x: event.clientX, y: event.clientY })
  )

  const slidePoint = (event: Pick<PointerEvent, 'clientX' | 'clientY'>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect || !scale) return undefined
    // the established editor's document-level MouseEvent handlers consume integer client/page
    // coordinates. PointerEvent retains sub-pixel coordinates, and preserving
    // those here changes not only the final fraction but source branches at
    // the strict 5px adsorption boundary. Quantize before converting to slide
    // space so every mouse-driven transform follows the same input contract.
    return clientPointToSlide(inputPoint(event), rect, scale)
  }

  const rawGestureOriginRef = useRef<PointerPosition | null>(null)

  const begin = (
    event: ReactPointerEvent<HTMLElement>,
    kind: InteractionSnapshot['kind'] & {},
    point: PointerPosition,
    context: GestureContext,
  ) => {
    rawGestureOriginRef.current = inputPoint(event.nativeEvent)
    gestureRef.current = context
    setGestureContext(context)
    runtime.interaction.begin({
      gestureId: createPresentationId(),
      kind,
      pointer: point,
      modifiers: pointerModifiers(event.nativeEvent),
    })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const updateCropDraft = (draft: CropDraft | null) => {
    cropDraftRef.current = draft
    setCropDraft(draft)
  }

  const finishCropEditing = (commit: boolean) => {
    const draft = cropDraftRef.current
    if (commit) commitCropDraft(runtime, draft)
    updateCropDraft(null)
    runtime.store.dispatch(editorActions.cropElementChanged(null))
  }

  const selectElement = (event: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>, element: PPTElement) => {
    const liveState = runtime.store.getState()
    const liveSession = selectSession(liveState)
    const liveSlide = selectCurrentSlide(liveState) ?? EMPTY_EDITOR_SLIDE
    const liveElement = liveSlide.elements.find(item => item.id === element.id) ?? element
    const liveActiveElementIds = liveSession.activeElementIds
    if (liveSession.cropElementId) finishCropEditing(true)
    const modifier = event.ctrlKey || event.metaKey || event.shiftKey
    const groupMemberIds = !mobileInteraction && liveElement.groupId
      ? liveSlide.elements.filter(item => item.groupId === liveElement.groupId).map(item => item.id)
      : [liveElement.id]
    // the source editor seeds a grouped selection with the element that was actually
    // clicked, then appends the group's slide-order members and de-duplicates.
    // Selection order is observable in group operations and toolbar state.
    const groupIds = [...new Set([liveElement.id, ...groupMemberIds])]
    let next = liveActiveElementIds
    if (!liveActiveElementIds.includes(liveElement.id)) next = modifier ? [...new Set([...liveActiveElementIds, ...groupIds])] : groupIds
    else if (modifier) {
      const removed = new Set(groupIds)
      const candidate = liveActiveElementIds.filter(id => !removed.has(id))
      if (candidate.length) next = candidate
    }
    runtime.store.dispatch(editorActions.selectionChanged(next))
    runtime.store.dispatch(editorActions.handleElementChanged(liveElement.id))
    runtime.store.dispatch(editorActions.activeGroupElementChanged(null))
    return next
  }

  const handleElementPointerDown = (event: ReactPointerEvent<HTMLElement>, element: PPTElement) => {
    const liveState = runtime.store.getState()
    const liveSession = selectSession(liveState)
    const liveSlide = selectCurrentSlide(liveState) ?? EMPTY_EDITOR_SLIDE
    const liveElement = liveSlide.elements.find(item => item.id === element.id) ?? element
    const liveActiveElementIds = liveSession.activeElementIds
    if (liveSession.activeTool) return
    if (event.button !== 0) {
      if (!liveElement.lock) event.stopPropagation()
      return
    }
    // While Space is held, the source drag mask owns every pointer-down,
    // including hits directly over editable elements.
    if (spacePressedRef.current) return
    if (liveElement.lock) return
    event.stopPropagation()
    if (!mobileInteraction) {
      stageRef.current?.focus()
      runtime.store.dispatch(editorActions.canvasFocusChanged(true))
      runtime.store.dispatch(editorActions.thumbnailsFocusChanged(false))
    }
    const wasSelected = liveActiveElementIds.includes(liveElement.id)
    const modifier = !mobileInteraction && (event.ctrlKey || event.metaKey || event.shiftKey)
    const groupIds = !mobileInteraction && liveElement.groupId
      ? liveSlide.elements.filter(item => item.groupId === liveElement.groupId).map(item => item.id)
      : [liveElement.id]
    let ids = liveActiveElementIds
    let pendingToggleIds: string[] | undefined
    let pendingActiveGroupElementId: string | undefined

    if (!wasSelected) ids = selectElement(event, liveElement)
    else if (modifier) {
      const removed = new Set(groupIds)
      const candidate = liveActiveElementIds.filter(id => !removed.has(id))
      if (candidate.length) {
        if (event.ctrlKey || event.metaKey) pendingToggleIds = candidate
        else {
          ids = candidate
          runtime.store.dispatch(editorActions.selectionChanged(candidate))
          runtime.store.dispatch(editorActions.activeGroupElementChanged(null))
        }
      }
    }
    else if (liveSession.handleElementId !== liveElement.id) {
      runtime.store.dispatch(editorActions.handleElementChanged(liveElement.id))
      runtime.store.dispatch(editorActions.activeGroupElementChanged(null))
    }
    else if (liveSession.activeGroupElementId !== liveElement.id) {
      pendingActiveGroupElementId = liveElement.id
    }
    if (liveSession.cropElementId) finishCropEditing(true)

    const point = slidePoint(event.nativeEvent)
    if (!point) return
    const activeMemberDrag = liveSession.activeGroupElementId === liveElement.id
    const movingIds = activeMemberDrag ? [liveElement.id] : ids
    const elements = liveSlide.elements.filter(item => movingIds.includes(item.id))
    const duplicateElements = duplicatePreviewElements(elements, activeMemberDrag)
    const handleIndex = elements.findIndex(item => item.id === liveElement.id)
    begin(event, 'drag', point, {
      kind: 'drag',
      activationDistance: DRAG_ACTIVATION_DISTANCE / scale,
      activated: false,
      duplicateActivated: false,
      duplicateElements,
      duplicateHandleElementId: duplicateElements[handleIndex]?.id ?? duplicateElements[0]!.id,
      duplicatePreviewReady: false,
      lastPreviewUpdates: new Map(),
      sourceHandleElementId: liveElement.id,
      elements: structuredClone(elements),
      bounds: getElementsBounds(elements),
      pendingActiveGroupElementId,
      pendingToggleIds,
    })
  }

  const handleMediaPointerDown = (event: ReactPointerEvent<HTMLElement>, element: PPTElement, canMove: boolean) => {
    if (canMove) {
      handleElementPointerDown(event, element)
      return
    }
    const liveState = runtime.store.getState()
    const liveSession = selectSession(liveState)
    const liveSlide = selectCurrentSlide(liveState) ?? EMPTY_EDITOR_SLIDE
    const liveElement = liveSlide.elements.find(item => item.id === element.id) ?? element
    if (liveSession.activeTool || spacePressedRef.current || liveElement.lock) return
    if (event.button !== 0) {
      event.stopPropagation()
      return
    }
    event.stopPropagation()
    if (!mobileInteraction) {
      stageRef.current?.focus()
      runtime.store.dispatch(editorActions.canvasFocusChanged(true))
      runtime.store.dispatch(editorActions.thumbnailsFocusChanged(false))
    }
    if (!liveSession.activeElementIds.includes(liveElement.id)) selectElement(event, liveElement)
    else if (event.ctrlKey || event.metaKey || event.shiftKey) selectElement(event, liveElement)
    else if (liveSession.handleElementId !== liveElement.id) {
      runtime.store.dispatch(editorActions.handleElementChanged(liveElement.id))
      runtime.store.dispatch(editorActions.activeGroupElementChanged(null))
    }
    if (liveSession.cropElementId) finishCropEditing(true)
  }

  const handleTextEditorMouseDown = (event: MouseEvent, element: PPTTextElement | PPTShapeElement) => {
    const liveRootState = runtime.store.getState()
    const liveSlide = selectCurrentSlide(liveRootState) ?? EMPTY_EDITOR_SLIDE
    const liveElement = liveSlide.elements.find((item): item is PPTTextElement | PPTShapeElement => (
      item.id === element.id && (item.type === 'text' || item.type === 'shape')
    )) ?? element
    if (liveElement.lock) return
    event.stopPropagation()
    if (!mobileInteraction) {
      stageRef.current?.focus()
      runtime.store.dispatch(editorActions.canvasFocusChanged(true))
      runtime.store.dispatch(editorActions.thumbnailsFocusChanged(false))
    }
    if (liveRootState.session.cropElementId) finishCropEditing(true)

    const state = runtime.store.getState().session
    const selected = state.activeElementIds.includes(liveElement.id)
    const modifier = event.ctrlKey || event.metaKey || event.shiftKey

    if (!selected) selectElement(event, liveElement)
    else if (modifier) {
      const groupIds = liveElement.groupId
        ? liveSlide.elements.filter(item => item.groupId === liveElement.groupId).map(item => item.id)
        : [liveElement.id]
      const removed = new Set(groupIds)
      const candidate = state.activeElementIds.filter(id => !removed.has(id))
      if (candidate.length) {
        runtime.store.dispatch(editorActions.selectionChanged(candidate))
        runtime.store.dispatch(editorActions.activeGroupElementChanged(null))
      }
    }
    else if (state.handleElementId !== liveElement.id) {
      runtime.store.dispatch(editorActions.handleElementChanged(liveElement.id))
    }
    else if (state.activeGroupElementId !== liveElement.id) {
      const startPageX = event.pageX
      const startPageY = event.pageY
      const target = event.target as HTMLElement
      target.onmouseup = mouseUpEvent => {
        if (startPageX === mouseUpEvent.pageX && startPageY === mouseUpEvent.pageY) {
          runtime.store.dispatch(editorActions.activeGroupElementChanged(liveElement.id))
          target.onmouseup = null
        }
      }
    }
  }

  const handleElementContextMenu = (event: ReactMouseEvent<HTMLElement>, element: PPTElement) => {
    event.preventDefault()
    event.stopPropagation()
    if (interactionProfile === 'mobile') return
    const liveState = runtime.store.getState()
    const liveSession = selectSession(liveState)
    const liveSlide = selectCurrentSlide(liveState) ?? EMPTY_EDITOR_SLIDE
    const liveElement = liveSlide.elements.find(item => item.id === element.id) ?? element
    if (!liveElement.lock) {
      if (!liveSession.activeElementIds.includes(liveElement.id)) selectElement(event.nativeEvent, liveElement)
      else if (event.ctrlKey || event.metaKey || event.shiftKey) selectElement(event.nativeEvent, liveElement)
      else if (liveSession.handleElementId !== liveElement.id) {
        runtime.store.dispatch(editorActions.handleElementChanged(liveElement.id))
      }
    }
    setMenu({
      elementId: liveElement.id,
      position: { x: event.clientX, y: event.clientY },
      surface: 'element',
    })
  }

  const handleTableCellContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    element: PPTTableElement,
    row: number,
    column: number,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    if (interactionProfile === 'mobile') return
    if (!selectSession(runtime.store.getState()).activeElementIds.includes(element.id)) {
      runtime.store.dispatch(editorActions.selectionChanged([element.id]))
    }
    runtime.store.dispatch(editorActions.handleElementChanged(element.id))
    const selected = selectSession(runtime.store.getState()).selectedTableCells
    const key = tableCellKey(row, column)
    if (!selected.includes(key)) runtime.store.dispatch(editorActions.selectedTableCellsChanged([key]))
    setMenu({
      cell: { row, column },
      elementId: element.id,
      position: { x: event.clientX, y: event.clientY },
      surface: 'table-cell',
    })
  }

  const createTextAtPoint = (point: PointerPosition) => {
    const viewportRect = canvasRef.current?.getBoundingClientRect()
    if (!viewportRect) return
    const element = createElementFromGesture(
      { type: 'text', key: 'text', vertical: false },
      { start: point, end: { x: point.x + 200, y: point.y } },
      viewportRect,
      scale,
      presentation.theme,
    )
    if (runtime.commit('Create text', [{ type: 'element.add', elements: element }])) {
      runtime.store.dispatch(editorActions.selectionChanged([element.id]))
    }
  }

  const handleBlankPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('.mona-drawing-workspace')) return
    if (mobileInteraction) {
      if (event.pointerType !== 'touch' || event.button !== 0) return
      setMenu(null)
      runtime.store.dispatch(editorActions.selectionChanged([]))
      runtime.store.dispatch(editorActions.pageSelectionChanged(true))
      window.getSelection()?.removeAllRanges()
      return
    }
    if (activeTool) {
      if (event.button !== 0) return
      const stageRect = stageRef.current?.getBoundingClientRect()
      const viewportRect = canvasRef.current?.getBoundingClientRect()
      if (!stageRect || !viewportRect) return
      begin(event, 'create', inputPoint(event.nativeEvent), {
        kind: 'create',
        stageOffset: { x: stageRect.left, y: stageRect.top },
        tool: activeTool,
        viewportRect: { left: viewportRect.left, top: viewportRect.top },
        viewportScale: scale,
      })
      return
    }
    stageRef.current?.focus()
    runtime.store.dispatch(editorActions.canvasFocusChanged(true))
    runtime.store.dispatch(editorActions.thumbnailsFocusChanged(false))
    setMenu(null)
    if (cropElementId) finishCropEditing(true)
    if (event.button !== 0) {
      // Canvas.vue receives every mousedown button. A secondary-button blank
      // press therefore clears element focus before its context menu opens.
      runtime.store.dispatch(editorActions.selectionChanged([]))
      runtime.store.dispatch(editorActions.pageSelectionChanged(true))
      window.getSelection()?.removeAllRanges()
      return
    }
    if (spacePressedRef.current) {
      runtime.store.dispatch(editorActions.selectionChanged([]))
      runtime.store.dispatch(editorActions.pageSelectionChanged(false))
      window.getSelection()?.removeAllRanges()
      begin(event, 'pan', { x: event.clientX, y: event.clientY }, { kind: 'pan', pan: canvasPan })
      return
    }
    runtime.store.dispatch(editorActions.selectionChanged([]))
    runtime.store.dispatch(editorActions.pageSelectionChanged(true))
    window.getSelection()?.removeAllRanges()
    const point = slidePoint(event.nativeEvent)
    if (!point) return
    begin(event, 'lasso', point, { kind: 'lasso' })
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (runtime.interaction.getSnapshot().status !== 'active') return
    const context = gestureRef.current
    const point = context?.kind === 'pan' || context?.kind === 'create'
      ? context.kind === 'create'
        ? inputPoint(event.nativeEvent)
        : { x: event.clientX, y: event.clientY }
      : slidePoint(event.nativeEvent)
    if (!point) return
    const rawOrigin = rawGestureOriginRef.current
    const rawPointer = inputPoint(event.nativeEvent)
    if (context?.kind === 'resize' && rawOrigin) {
      context.rawDelta = { x: rawPointer.x - rawOrigin.x, y: rawPointer.y - rawOrigin.y }
    }
    const legacyDelta = rawOrigin
      ? context?.kind === 'pan' || context?.kind === 'create'
        ? { x: rawPointer.x - rawOrigin.x, y: rawPointer.y - rawOrigin.y }
        : {
          x: (rawPointer.x - rawOrigin.x) / scale,
          y: (rawPointer.y - rawOrigin.y) / scale,
        }
      : undefined
    const duplicateWasActive = context?.kind === 'drag' && context.duplicateActivated
    runtime.interaction.updatePointer(point, pointerModifiers(event.nativeEvent), legacyDelta)
    if (context?.kind === 'drag' && duplicateWasActive) context.duplicatePreviewReady = true
    if (context?.kind === 'drag' && !context.duplicateActivated) {
      const snapshot = runtime.interaction.getSnapshot()
      if (
        exceedsActivationDistance(snapshot.delta, context.activationDistance) &&
        (snapshot.modifiers.control || snapshot.modifiers.meta)
      ) {
        // Vue mutates its local element list on every drag frame. If duplicate
        // mode starts later in the same gesture, duplicateElement() first
        // writes that previously rendered list into the slide, then creates a
        // copy from the pointer-down geometry. Preserve that exact hand-off:
        // the original remains at the last non-duplicate preview position and
        // the copy continues using the full pointer delta.
        if (context.lastPreviewUpdates.size) {
          runtime.commit('Move elements before duplicate', [
            ...toCommands(context.lastPreviewUpdates),
            { type: 'element.add', elements: context.duplicateElements },
          ], { recordHistory: false })
        }
        else {
          runtime.commit(
            'Begin duplicate drag',
            [{ type: 'element.add', elements: context.duplicateElements }],
            { recordHistory: false },
          )
        }
        context.duplicateActivated = true
        runtime.store.dispatch(editorActions.selectionChanged(context.duplicateElements.map(element => element.id)))
        runtime.store.dispatch(editorActions.handleElementChanged(context.duplicateHandleElementId))
        runtime.store.dispatch(editorActions.activeGroupElementChanged(null))
      }
      else {
        context.lastPreviewUpdates = derivePreview(
          context,
          snapshot,
          currentSlide,
          presentation.viewportSize,
          presentation.viewportRatio,
        ).updates
      }
    }
  }

  const finishGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const context = gestureRef.current
    const snapshot = runtime.interaction.getSnapshot()
    if (!context || snapshot.status !== 'active') return
    const finalPreview = derivePreview(context, snapshot, currentSlide, presentation.viewportSize, presentation.viewportRatio)
    let finalUpdates = finalPreview.updates
    if (context.kind === 'resize' && context.elements.length === 1) {
      const element = context.elements[0]
      if (element?.type === 'text' && !element.fixedHeight) {
        const content = canvasRef.current?.querySelector<HTMLElement>(
          `[data-element-id="${CSS.escape(element.id)}"] .mona-text-content`,
        )
        if (content) {
          const measuredUpdates = new Map<string, Partial<PPTElement>>(finalUpdates)
          const props = measuredUpdates.get(element.id) ?? {}
          const styles = getComputedStyle(content)
          const measured = Number.parseFloat(element.vertical ? styles.width : styles.height)
          measuredUpdates.set(element.id, (element.vertical
            ? { ...props, width: measured }
            : { ...props, height: measured }) as Partial<PPTElement>)
          finalUpdates = measuredUpdates
        }
      }
      else if (element?.type === 'table') {
        const table = canvasRef.current?.querySelector<HTMLElement>(
          `[data-element-id="${CSS.escape(element.id)}"] .mona-static-table`,
        )
        if (table) {
          const measuredUpdates = new Map<string, Partial<PPTElement>>(finalUpdates)
          measuredUpdates.set(element.id, {
            ...(measuredUpdates.get(element.id) ?? {}),
            height: table.offsetHeight,
          } as Partial<PPTElement>)
          finalUpdates = measuredUpdates
        }
      }
    }
    runtime.interaction.complete()
    gestureRef.current = null
    rawGestureOriginRef.current = null
    setGestureContext(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)

    if (context.kind === 'drag') {
      const painterTarget = currentSlide.elements.find((element): element is Extract<PPTElement, { type: 'shape' }> => (
        element.id === context.sourceHandleElementId && element.type === 'shape'
      ))
      if (painterTarget) runtime.shapeFormatPainter.apply(painterTarget)
    }

    if (context.kind === 'pan' && finalPreview.pan) {
      runtime.store.dispatch(editorActions.canvasPanChanged(finalPreview.pan))
      runtime.store.dispatch(editorActions.canvasDraggedChanged(true))
      return
    }
    if (context.kind === 'drag' && !context.activated) {
      if (snapshot.delta.x === 0 && snapshot.delta.y === 0) {
        if (context.pendingToggleIds?.length) {
          runtime.store.dispatch(editorActions.selectionChanged(context.pendingToggleIds))
          runtime.store.dispatch(editorActions.activeGroupElementChanged(null))
        }
        else if (context.pendingActiveGroupElementId) {
          runtime.store.dispatch(editorActions.activeGroupElementChanged(context.pendingActiveGroupElementId))
        }
      }
      // Quirk retired: the source editor recorded a history snapshot for sub-threshold
      // moved drags even though no document field changed.
      return
    }
    if (context.kind === 'lasso' && finalPreview.lasso) {
      const selection = rectToBounds(finalPreview.lasso)
      const intersecting = event.ctrlKey || event.metaKey || event.shiftKey
      const ids = getLassoSelectionIds({
        elements: currentSlide.elements,
        hiddenElementIds: new Set(session.hiddenElementIds),
        intersecting,
        selection,
      })
      runtime.store.dispatch(editorActions.selectionChanged(ids))
      return
    }
    if (context.kind === 'create') {
      const selection = resolveCreateGestureSelection({
        lastPointer: snapshot.pointer,
        modifiers: snapshot.modifiers,
        rawPointer: inputPoint(event.nativeEvent),
        start: snapshot.origin,
        tool: context.tool.type,
      })
      const element = createElementFromGesture(
        context.tool,
        selection,
        context.viewportRect,
        context.viewportScale,
        presentation.theme,
      )
      if (runtime.commit(`Create ${context.tool.type}`, [{ type: 'element.add', elements: element }])) {
        runtime.store.dispatch(editorActions.selectionChanged([element.id]))
        onCreateToolChange(null)
      }
      return
    }
    if (context.kind === 'crop') {
      if (exceedsActivationDistance(snapshot.delta, TRANSFORM_ACTIVATION_DISTANCE) && finalPreview.cropGeometry) {
        updateCropDraft({
          dirty: true,
          element: context.element,
          geometry: finalPreview.cropGeometry,
        })
      }
      return
    }
    const activationDistance = context.kind === 'drag' ? context.activationDistance : TRANSFORM_ACTIVATION_DISTANCE
    if (!exceedsActivationDistance(snapshot.delta, activationDistance) || !finalUpdates.size) {
      // Quirk retired: the source editor recorded a duplicate snapshot when the handle
      // of an already-rotated element was clicked without movement.
      return
    }
    if (context.kind === 'drag' && context.duplicateActivated) {
      if (!context.duplicatePreviewReady) {
        runtime.recordHistorySnapshot('drag-elements')
        return
      }
      const duplicateUpdates = new Map<string, Partial<PPTElement>>()
      context.duplicateElements.forEach((duplicate, index) => {
        const source = context.elements[index]
        const props = source ? finalUpdates.get(source.id) : undefined
        if (props) duplicateUpdates.set(duplicate.id, props)
      })
      runtime.commit(
        'Duplicate and move elements',
        toCommands(duplicateUpdates),
        { historyKey: 'drag-elements' },
      )
      return
    }
    if (context.kind === 'rotate' && context.mode === 'group') {
      // Vue's group-rotate hook returns before applying when deltaAngle is 0;
      // an identical-value commit would still schedule a history snapshot.
      const unchanged = [...finalUpdates.entries()].every(([id, props]) => {
        const original = context.elements.find(element => element.id === id)
        return original && Object.entries(props).every(([key, value]) => (original as unknown as Record<string, unknown>)[key] === value)
      })
      if (unchanged) return
    }
    if (context.kind === 'drag' || context.kind === 'resize' || context.kind === 'rotate') {
      const labels = { drag: 'Move elements', resize: 'Resize elements', rotate: 'Rotate elements' } as const
      runtime.commit(
        labels[context.kind],
        toCommands(finalUpdates),
        context.kind === 'drag' ? { historyKey: 'drag-elements' } : undefined,
      )
      return
    }
    if (context.kind === 'line-point' || context.kind === 'shape-keypoint') {
      runtime.commit(
        context.kind === 'line-point' ? 'Move line control point' : 'Move shape keypoint',
        toCommands(finalUpdates),
      )
    }
  }

  const cancelGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const context = gestureRef.current
    runtime.interaction.cancel()
    gestureRef.current = null
    rawGestureOriginRef.current = null
    setGestureContext(null)
    if (context?.kind === 'drag' && context.duplicateActivated) {
      // The copies were committed (without history) when duplicate mode
      // activated; a cancelled gesture must not leave them stacked on the
      // originals as a silent document mutation.
      runtime.commit('Cancel duplicate drag', [{
        type: 'element.delete',
        elementIds: context.duplicateElements.map(element => element.id),
      }], { recordHistory: false })
      runtime.store.dispatch(editorActions.selectionChanged(context.elements.map(element => element.id)))
      runtime.store.dispatch(editorActions.handleElementChanged(context.sourceHandleElementId))
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>, handle: ResizeHandle) => {
    event.stopPropagation()
    const point = slidePoint(event.nativeEvent)
    if (!point || !transformElements.length || !canResizeSelection(transformElements)) return
    begin(event, 'resize', point, {
      kind: 'resize',
      elements: structuredClone(transformElements),
      bounds: transformElements.length === 1 && transformElements[0]?.type !== 'line'
        ? {
          minX: transformElements[0].left,
          maxX: transformElements[0].left + transformElements[0].width,
          minY: transformElements[0].top,
          maxY: transformElements[0].top + transformElements[0].height,
        }
        : getTransformBounds(transformElements),
      fixedRatio: transformElements.length === 1 && transformElements[0]?.type !== 'line'
        ? Boolean(
          event.ctrlKey || event.metaKey || event.shiftKey ||
            ('fixedRatio' in transformElements[0] && transformElements[0].fixedRatio),
        )
        : false,
      handle,
      scale,
    })
  }

  const beginRotate = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const point = slidePoint(event.nativeEvent)
    if (!point || !transformElements.length) return
    const single = transformElements.length === 1 && transformElements[0]?.type !== 'line'
      ? transformElements[0]
      : undefined
    const rotationReference = single ? single.rotate : getGroupRotationReference(transformElements)
    const center = single
      ? { x: single.left + single.width / 2, y: single.top + single.height / 2 }
      : getGroupRotationCenter(transformElements, rotationReference ?? 0)
    begin(event, 'rotate', point, {
      kind: 'rotate',
      elements: structuredClone(transformElements),
      center,
      mode: single ? 'single' : 'group',
      rotationReference,
      startAngle: angleFromPoint(center, point),
    })
  }

  const beginCrop = (event: ReactPointerEvent<HTMLElement>, handle: CropControlHandle) => {
    event.stopPropagation()
    const image = selectedElements.length === 1 && selectedElements[0]?.type === 'image' ? selectedElements[0] : undefined
    const point = slidePoint(event.nativeEvent)
    if (!point || !image) return
    begin(event, 'crop', point, {
      kind: 'crop',
      element: structuredClone(cropDraft?.element.id === image.id ? cropDraft.element : image),
      geometry: structuredClone(cropGeometry ?? getImageCropGeometry(image)),
      handle,
    })
  }

  const beginLinePoint = (event: ReactPointerEvent<HTMLButtonElement>, handle: LineControlHandle) => {
    event.stopPropagation()
    const line = transformElements.length === 1 && transformElements[0]?.type === 'line'
      ? transformElements[0]
      : undefined
    const point = slidePoint(event.nativeEvent)
    if (!point || !line) return
    begin(event, 'resize', point, { kind: 'line-point', element: structuredClone(line), handle })
  }

  const beginShapeKeypoint = (event: ReactPointerEvent<HTMLButtonElement>, index: number) => {
    event.stopPropagation()
    const shape = transformElements.length === 1 && transformElements[0]?.type === 'shape'
      ? transformElements[0]
      : undefined
    const point = slidePoint(event.nativeEvent)
    if (!point || !shape) return
    begin(event, 'resize', point, { kind: 'shape-keypoint', element: structuredClone(shape), index })
  }


  const { handleDrop, handlePaste } = useCanvasClipboard({ presentation, runtime, shiftPressedRef })


  const deleteCurrentSelection = () => {
    const liveSession = selectSession(runtime.store.getState())
    const ids = liveSession.activeGroupElementId
      ? [liveSession.activeGroupElementId]
      : liveSession.activeElementIds
    if (!ids.length) return false
    const changed = runtime.commit('Delete elements', [{ type: 'element.delete', elementIds: ids }])
    if (changed) {
      runtime.store.dispatch(editorActions.selectionChanged([]))
      runtime.store.dispatch(editorActions.activeGroupElementChanged(null))
    }
    return changed
  }

  const duplicateCurrentSelection = () => {
    const state = runtime.store.getState()
    const liveSession = selectSession(state)
    const slide = selectCurrentSlide(state)
    if (!slide) return false
    const sourceIds = liveSession.activeGroupElementId
      ? [liveSession.activeGroupElementId]
      : liveSession.activeElementIds
    const source = slide.elements.filter(element => sourceIds.includes(element.id))
    if (!source.length) return false
    const duplicates = duplicatePreviewElements(source, Boolean(liveSession.activeGroupElementId)).map(element => ({
      ...element,
      left: element.left + 10,
      top: element.top + 10,
    })) as PPTElement[]
    if (!runtime.commit('Duplicate elements', [{ type: 'element.add', elements: duplicates }], { historyKey: 'duplicate-elements' })) return false
    const duplicateIds = duplicates.map(element => element.id)
    runtime.store.dispatch(editorActions.selectionChanged(duplicateIds))
    runtime.store.dispatch(editorActions.handleElementChanged(duplicateIds.length === 1 ? duplicateIds[0]! : null))
    return true
  }

  const groupCurrentSelection = () => {
    const state = runtime.store.getState()
    const slide = selectCurrentSlide(state)
    const ids = state.session.activeElementIds
    if (!slide || ids.length < 2) return false
    return runtime.commit('Group elements', [{
      type: 'slide.update',
      props: { elements: groupElements(slide.elements, new Set(ids), createPresentationId(10)) },
    }])
  }

  const ungroupCurrentSelection = () => {
    const state = runtime.store.getState()
    const slide = selectCurrentSlide(state)
    const ids = state.session.activeElementIds
    if (!slide || !ids.length) return false
    const elements = ungroupElements(slide.elements, new Set(ids))
    if (!elements) return false
    const changed = runtime.commit('Ungroup elements', [{ type: 'slide.update', props: { elements } }])
    if (changed) {
      runtime.store.dispatch(editorActions.selectionChanged(ids))
      runtime.store.dispatch(editorActions.handleElementChanged(ids[0] ?? null))
    }
    return changed
  }

  const setCurrentSelectionLocked = (lock: boolean) => {
    const state = runtime.store.getState()
    const slide = selectCurrentSlide(state)
    if (!slide) return false
    const result = setElementLocks({
      elements: slide.elements,
      lock,
      selectedIds: new Set(state.session.activeElementIds),
      targetElementId: contextualCapabilities.targetElement?.id,
    })
    if (!result) return false
    const changed = runtime.commit(lock ? 'Lock elements' : 'Unlock elements', [{
      type: 'slide.update',
      props: { elements: result.elements },
    }])
    if (changed) runtime.store.dispatch(editorActions.selectionChanged(result.selectedIds))
    return changed
  }

  const flushCurrentTableMeasurements = () => {
    const slide = selectCurrentSlide(runtime.store.getState())
    if (!slide || !canvasRef.current) return
    const commands: PresentationCommand[] = []
    for (const element of slide.elements) {
      if (element.type !== 'table') continue
      const root = canvasRef.current.querySelector<HTMLElement>(
        `[data-element-id="${CSS.escape(element.id)}"].mona-table-element`,
      )
      if (!root) continue
      const height = Number.parseFloat(getComputedStyle(root).height)
      if (!Number.isFinite(height) || Math.abs(height - element.height) < 0.01) continue
      commands.push({
        type: 'element.update',
        payload: { id: element.id, props: { height } },
      })
    }
    if (commands.length) runtime.commit('Measure table elements', commands, { recordHistory: false })
  }

  const { handleKeyDown, handleWheel } = useCanvasHotkeys({
    commitElementLockChange,
    ctrlOrMetaPressedRef,
    deleteCurrentSelection,
    finishCropEditing,
    flushCurrentTableMeasurements,
    handleContextAction,
    isCropping: () => Boolean(cropElementId),
    onCreateToolChange,
    runtime,
    setIsSpacePressed,
    spacePressedRef,
  })

  function commitElementLockChange(input: {
    action: 'lock' | 'unlock'
    elements: readonly PPTElement[]
    selectedIds: readonly string[]
    targetElementId?: string
  }) {
    const result = setElementLocks({
      elements: input.elements,
      lock: input.action === 'lock',
      selectedIds: new Set(input.selectedIds),
      targetElementId: input.targetElementId,
    })
    if (!result) return false
    const changed = runtime.commit(input.action === 'lock' ? 'Lock elements' : 'Unlock elements', [{
      type: 'slide.update',
      props: { elements: result.elements },
    }])
    if (changed) runtime.store.dispatch(editorActions.selectionChanged(result.selectedIds))
    return changed
  }

  function handleContextAction(action: string) {
    setMenu(null)
    stageRef.current?.focus()
    const liveRootState = runtime.store.getState()
    const livePresentation = selectPresentation(liveRootState)
    const liveSession = selectSession(liveRootState)
    const liveCurrentSlide = selectCurrentSlide(liveRootState) ?? EMPTY_EDITOR_SLIDE
    const liveActiveElementIds = liveSession.activeElementIds
    const liveMenuElement = menu?.elementId
      ? liveCurrentSlide.elements.find(element => element.id === menu.elementId)
      : undefined
    if (action.startsWith('table-') && liveMenuElement?.type === 'table' && menu?.cell) {
      const selected = liveSession.selectedTableCells.length
        ? liveSession.selectedTableCells
        : [tableCellKey(menu.cell.row, menu.cell.column)]
      let next: PPTTableElement | null = null
      if (action === 'table-insert-column-left') next = insertTableColumn(liveMenuElement, menu.cell.column)
      else if (action === 'table-insert-column-right') next = insertTableColumn(liveMenuElement, menu.cell.column + 1)
      else if (action === 'table-insert-row-above') next = insertTableRow(liveMenuElement, menu.cell.row)
      else if (action === 'table-insert-row-below') next = insertTableRow(liveMenuElement, menu.cell.row + 1)
      else if (action === 'table-delete-column') next = deleteTableColumn(liveMenuElement, menu.cell.column)
      else if (action === 'table-delete-row') next = deleteTableRow(liveMenuElement, menu.cell.row)
      else if (action === 'table-merge') {
        next = mergeTableCells(liveMenuElement, selected)
        runtime.store.dispatch(editorActions.selectedTableCellsChanged([]))
      }
      else if (action === 'table-split') {
        next = splitTableCell(liveMenuElement, menu.cell.row, menu.cell.column)
        runtime.store.dispatch(editorActions.selectedTableCellsChanged([]))
      }
      else if (action === 'table-select-column') {
        runtime.store.dispatch(editorActions.selectedTableCellsChanged(liveMenuElement.data.map((_row, row) => tableCellKey(row, menu.cell!.column))))
      }
      else if (action === 'table-select-row') {
        runtime.store.dispatch(editorActions.selectedTableCellsChanged(liveMenuElement.data[menu.cell.row]!.map((_cell, column) => tableCellKey(menu.cell!.row, column))))
      }
      else if (action === 'table-select-all') {
        runtime.store.dispatch(editorActions.selectedTableCellsChanged(liveMenuElement.data.flatMap((row, rowIndex) => row.map((_cell, column) => tableCellKey(rowIndex, column)))))
      }
      if (next && next !== liveMenuElement) {
        runtime.commit('Edit table', [{
          type: 'element.update',
          payload: { id: next.id, props: { data: next.data, width: next.width, colWidths: next.colWidths } },
        }])
      }
      return
    }
    if (action === 'copy') void writeClipboard(runtime.copySelection())
    else if (action === 'cut') void writeClipboard(runtime.cutSelection())
    else if (action === 'paste') {
      if (!runtime.paste().length && navigator.clipboard) {
        void navigator.clipboard.readText().then(serialized => runtime.paste(serialized)).catch(() => undefined)
      }
    }
    else if (action === 'delete') deleteCurrentSelection()
    else if (action === 'select-all') runtime.selectAll()
    else if (action === 'ruler') runtime.store.dispatch(editorActions.rulerVisibilityChanged(!showRuler))
    else if (action === 'grid-toggle') runtime.store.dispatch(editorActions.gridLineSizeChanged(gridLineSize ? 0 : 50))
    else if (action.startsWith('grid-')) runtime.store.dispatch(editorActions.gridLineSizeChanged(Number(action.slice(5))))
    else if (action === 'reset-slide') {
      const elementIds = liveCurrentSlide.elements.map(element => element.id)
      if (elementIds.length && runtime.commit('Reset slide', [{ type: 'element.delete', elementIds }])) {
        runtime.store.dispatch(editorActions.selectionChanged([]))
      }
    }
    else if (action === 'slideshow') {
      startPresentation({ fromStart: true })
    }
    else if (action.startsWith('align-')) {
      const command = action.slice('align-'.length) as Parameters<typeof alignElementsToCanvas>[0]['command']
      const elements = alignElementsToCanvas({
        command,
        elements: liveCurrentSlide.elements,
        selectedIds: new Set(liveActiveElementIds),
        viewportHeight: livePresentation.viewportSize * livePresentation.viewportRatio,
        viewportWidth: livePresentation.viewportSize,
      })
      runtime.commit('Align elements to slide', [{ type: 'slide.update', props: { elements } }])
    }
    else if (['bring-front', 'bring-forward', 'send-back', 'send-backward'].includes(action)) {
      const orderTarget = liveMenuElement ?? liveCurrentSlide.elements.find(element => element.id === liveSession.handleElementId)
      if (!orderTarget) return
      const command = ({
        'bring-front': 'top',
        'bring-forward': 'up',
        'send-back': 'bottom',
        'send-backward': 'down',
      } as const)[action as 'bring-front' | 'bring-forward' | 'send-back' | 'send-backward']
      const elements = orderElement(liveCurrentSlide.elements, orderTarget.id, command)
      if (elements) runtime.commit('Reorder elements', [{ type: 'slide.update', props: { elements } }])
    }
    else if (action === 'group') {
      const selected = new Set(liveActiveElementIds)
      const elements = groupElements(liveCurrentSlide.elements, selected, createPresentationId(10))
      runtime.commit('Group elements', [{ type: 'slide.update', props: { elements } }])
    }
    else if (action === 'ungroup') {
      const elements = ungroupElements(liveCurrentSlide.elements, new Set(liveActiveElementIds))
      if (!elements) return
      const changed = runtime.commit('Ungroup elements', [{ type: 'slide.update', props: { elements } }])
      const selectedId = liveMenuElement?.id ?? liveSession.handleElementId ?? liveActiveElementIds[0]
      if (changed && selectedId) runtime.store.dispatch(editorActions.selectionChanged([selectedId]))
    }
    else if (action === 'lock' || action === 'unlock') {
      commitElementLockChange({
        action,
        elements: liveCurrentSlide.elements,
        selectedIds: liveActiveElementIds,
        targetElementId: liveMenuElement?.id,
      })
    }
    else if (action === 'set-link' && liveMenuElement) {
      openLinkEditorFor(liveMenuElement)
    }
  }

  function openLinkEditorFor(element: PPTElement) {
    const livePresentation = runtime.store.getState().presentation
    const liveSlide = livePresentation.slides[livePresentation.slideIndex]
    const defaultSlideId = livePresentation.slides.find(slide => slide.id !== liveSlide?.id)?.id ?? ''
    runtime.store.dispatch(editorActions.hotkeysDisabledChanged(true))
    setLinkEditor({
      address: element.link?.type === 'web' ? element.link.target : '',
      elementId: element.id,
      slideId: element.link?.type === 'slide' ? element.link.target : defaultSlideId,
      type: element.link?.type ?? 'web',
    })
  }


  // useEffectEvent replaces the manual ref-mirroring pattern: the long-lived
  // native listeners below always observe the latest render's handlers.
  const dispatchDocumentKeyDown = useEffectEvent((event: KeyboardEvent) => handleKeyDown(event))
  const dispatchDocumentPaste = useEffectEvent((event: ClipboardEvent) => handlePaste(event))
  const dispatchStageWheel = useEffectEvent((event: WheelEvent) => handleWheel(event))

  useLayoutEffect(() => {
    if (interactionProfile === 'mobile') return undefined
    const listener = (event: KeyboardEvent) => dispatchDocumentKeyDown(event)
    document.addEventListener('keydown', listener)
    return () => document.removeEventListener('keydown', listener)
  }, [interactionProfile])

  useLayoutEffect(() => {
    if (interactionProfile === 'mobile') return undefined
    const listener = (event: ClipboardEvent) => dispatchDocumentPaste(event)
    document.addEventListener('paste', listener)
    return () => document.removeEventListener('paste', listener)
  }, [interactionProfile])

  // Unmounting mid-gesture (e.g. F5 slideshow during a drag) must not leave
  // the shared interaction controller publishing phantom pointer updates.
  useEffect(() => () => {
    runtime.interaction.cancel()
  }, [runtime])

  // Vue prevents the browser's default file-drop navigation across the whole
  // document while the editor is mounted; without this a dropped file
  // replaces the editor page.
  useEffect(() => {
    if (interactionProfile === 'mobile') return undefined
    const prevent = (event: DragEvent) => event.preventDefault()
    document.addEventListener('dragenter', prevent)
    document.addEventListener('dragleave', prevent)
    document.addEventListener('dragover', prevent)
    document.addEventListener('drop', prevent)
    return () => {
      document.removeEventListener('dragenter', prevent)
      document.removeEventListener('dragleave', prevent)
      document.removeEventListener('dragover', prevent)
      document.removeEventListener('drop', prevent)
    }
  }, [interactionProfile])

  // React's root-delegated onWheel listener is passive, so preventDefault()
  // inside it cannot stop browser page zoom (ctrl+wheel) or ancestor scroll.
  // The canvas needs a native non-passive listener.
  const hasCurrentSlide = Boolean(selectedCurrentSlide)
  useEffect(() => {
    if (interactionProfile === 'mobile' || !hasCurrentSlide) return undefined
    const stage = stageRef.current
    if (!stage) return undefined
    const listener = (event: WheelEvent) => dispatchStageWheel(event)
    stage.addEventListener('wheel', listener, { passive: false })
    return () => stage.removeEventListener('wheel', listener)
  }, [interactionProfile, hasCurrentSlide])

  const closeLinkEditor = () => {
    runtime.store.dispatch(editorActions.hotkeysDisabledChanged(false))
    setLinkEditor(null)
  }

  const applyLink = () => {
    if (!linkEditor) return
    const target = linkEditor.type === 'web' ? linkEditor.address : linkEditor.slideId
    if (linkEditor.type === 'web') {
      const linkPattern = /^(https?):\/\/[\w-]+(\.[\w-]+)+([\w-.,@?^=%&:/~+#]*[\w-@?^=%&/~+#])?$/
      if (!linkPattern.test(target)) {
        setLinkEditor({ ...linkEditor, address: '' })
        notifications.notify({ text: t('foundation.editor.link.invalid'), type: 'error' })
        return
      }
    }
    else if (!target) {
      notifications.notify({ text: t('foundation.editor.link.selectTarget'), type: 'error' })
      return
    }
    runtime.commit('Set element link', [{
      type: 'element.update',
      payload: {
        id: linkEditor.elementId,
        props: { link: { type: linkEditor.type, target } },
      },
    }])
    closeLinkEditor()
  }

  const frameWidth = presentation.viewportSize * scale
  const frameHeight = presentation.viewportSize * presentation.viewportRatio * scale

  if (!selectedCurrentSlide) return <section className="mona-render-stage">{t('foundation.editor.noSlides')}</section>

  return (
    <section
      aria-label={t('foundation.editor.canvas')}
      className={`mona-render-stage mona-editor-stage${canvasFocus ? ' has-focus' : ''}${activeTool ? ' is-creating' : ''}${isSpacePressed ? ' is-panning' : ''}`}
      data-active-tool={activeTool?.key ?? 'select'}
      id="mona-editor-canvas"
      onDoubleClick={interactionProfile === 'mobile' ? undefined : event => {
        if ((event.target as HTMLElement).closest('[data-element-hit]')) return
        if (activeElementIds.length) return
        if (!activeTool) createTextAtPoint(inputPoint(event.nativeEvent))
      }}
      onKeyUp={interactionProfile === 'mobile' ? undefined : event => {
        if (event.key === ' ') {
          spacePressedRef.current = false
          setIsSpacePressed(false)
        }
      }}
      onFocus={interactionProfile === 'mobile' ? undefined : () => {
        runtime.store.dispatch(editorActions.canvasFocusChanged(true))
        runtime.store.dispatch(editorActions.thumbnailsFocusChanged(false))
      }}
      onDrop={interactionProfile === 'mobile' ? undefined : handleDrop}
      onPointerCancel={cancelGesture}
      onPointerDown={handleBlankPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishGesture}
      onContextMenu={interactionProfile === 'mobile' ? undefined : event => {
        event.preventDefault()
        if (activeTool) {
          onCreateToolChange(null)
          setMenu(null)
          return
        }
        stageRef.current?.focus()
        setMenu({ position: { x: event.clientX, y: event.clientY }, surface: 'canvas' })
      }}
      ref={stageRef}
      role={interactionProfile === 'mobile' ? undefined : 'application'}
      tabIndex={interactionProfile === 'mobile' ? undefined : 0}
    >
      {viewportFit.dimension > 0 ? (
        <div
          className="mona-editor-viewport-frame"
          ref={frameRef}
          style={{
            width: frameWidth,
            height: frameHeight,
            position: 'absolute',
            left: ((viewportFit.width - frameWidth) / 2) + pan.x,
            top: ((viewportFit.height - frameHeight) / 2) + pan.y,
          }}
        >
          {gridLineSize ? (
            <svg
              aria-hidden="true"
              className="mona-editor-grid"
            >
              <path
                d={buildEditorGridPath(presentation.viewportSize, presentation.viewportRatio, gridLineSize)}
                fill="none"
                stroke={tinycolor.mostReadable(
                  currentSlide.background?.color || '#fff',
                  ['#000', '#fff'],
                  { includeFallbackColors: true },
                ).setAlpha(0.5).toRgbString()}
                strokeDasharray="5"
                strokeWidth="0.3"
                style={{ transform: `scale(${scale})` }}
              />
            </svg>
          ) : null}
          {preview.guides.map((guide, index) => (
            <i
              aria-hidden="true"
              className={`mona-alignment-guide is-${guide.orientation}`}
              key={`${guide.orientation}-${guide.axis}-${index}`}
              style={guide.orientation === 'horizontal'
                ? {
                  left: guide.from * scale,
                  top: guide.axis * scale,
                  width: (guide.to - guide.from) * scale,
                  height: 0,
                }
                : {
                  left: guide.axis * scale,
                  top: guide.from * scale,
                  width: 0,
                  height: (guide.to - guide.from) * scale,
                }}
            />
          ))}
          <div
            className="mona-editor-slide-canvas"
            ref={canvasRef}
            style={{
              width: presentation.viewportSize,
              height: presentation.viewportSize * presentation.viewportRatio,
              transform: `scale(${scale})`,
            }}
          >
            <SlideRenderer
              mediaEditor={element => ({
                active: session.handleElementId === element.id,
                onContextMenu: event => handleElementContextMenu(event, element),
                onPointerDown: (event, canMove) => handleMediaPointerDown(event, element, canMove),
                scale,
                viewportRatio: presentation.viewportRatio,
                viewportSize: presentation.viewportSize,
              })}
              shapeEditor={element => ({
                ariaLabel: t('foundation.editor.selectElement', { type: element.name || element.type, id: element.id }),
                content: element.text?.content || shapeTextEditorId === element.id
                  ? (
                    <EditorRichText
                      element={element}
                      fallbackColor={presentation.theme.fontColor}
                      fallbackFontName={presentation.theme.fontName}
                      isHandleElement={session.handleElementId === element.id}
                      modifierPressed={() => ctrlOrMetaPressedRef.current || shiftPressedRef.current}
                      onMouseDown={event => handleTextEditorMouseDown(event, element)}
                      runtime={runtime}
                    />
                  )
                  : undefined,
                onContextMenu: event => handleElementContextMenu(event, element),
                onDoubleClick: event => {
                  event.stopPropagation()
                  if (element.lock) return
                  setShapeTextEditorId(element.id)
                  requestAnimationFrame(() => {
                    document.querySelector<HTMLElement>(`[data-element-id="${CSS.escape(element.id)}"] .ProseMirror`)?.focus()
                  })
                },
                onPointerDown: event => handleElementPointerDown(event, element),
                onPointerUp: () => runtime.shapeFormatPainter.apply(element),
              })}
              sourcePackages={presentation.sourcePackages}
              slide={renderedSlide}
              tableEditor={element => ({
                editable: tableEditorId === element.id,
                isHandle: session.handleElementId === element.id,
                scale,
                selectedCells: session.selectedTableCells,
                onContextMenu: (event, row, column) => handleTableCellContextMenu(event, element, row, column),
                onElementChange: (next, label) => {
                  runtime.commit(label, [{
                    type: 'element.update',
                    payload: {
                      id: next.id,
                      props: {
                        data: next.data,
                        width: next.width,
                        colWidths: next.colWidths,
                      },
                    },
                  }])
                },
                onHeightChange: height => runtime.commit('Measure table element', [{
                  type: 'element.update', payload: { id: element.id, props: { height } },
                }], { recordHistory: false }),
                onPointerDown: event => handleElementPointerDown(event, element),
                onSelectedCellsChange: cells => runtime.store.dispatch(editorActions.selectedTableCellsChanged(cells)),
                onStartEdit: () => {
                  setTableEditorId(element.id)
                  runtime.store.dispatch(editorActions.hotkeysDisabledChanged(true))
                },
              })}
              textEditor={element => ({
                content: (
                  <EditorRichText
                    element={element}
                    isHandleElement={session.handleElementId === element.id}
                    modifierPressed={() => ctrlOrMetaPressedRef.current || shiftPressedRef.current}
                    onMouseDown={event => handleTextEditorMouseDown(event, element)}
                    runtime={runtime}
                  />
                ),
                onContextMenu: event => handleElementContextMenu(event, element),
                onPointerDown: event => handleElementPointerDown(event, element),
              })}
              theme={presentation.theme}
              viewportRatio={presentation.viewportRatio}
              viewportSize={presentation.viewportSize}
            />
            {showDrawingWorkspace ? (
              <Suspense fallback={<div aria-label={t('foundation.editor.drawing.loading')} className="mona-drawing-loading" />}>
                <DrawingWorkspace
                  active={session.drawingMode}
                  key={currentSlide.id}
                  onActiveChange={active => onDrawingModeChange?.(active)}
                  onBuildThis={handoff => onBuildSketch?.(handoff)}
                  onVisibilityChange={visible => onSketchVisibilityChange?.(visible)}
                  referenceCount={activeElementIds.length}
                  scale={scale}
                  slideId={currentSlide.id}
                  store={drawingStore!}
                  viewportHeight={presentation.viewportSize * presentation.viewportRatio}
                  viewportWidth={presentation.viewportSize}
                  visible={session.sketchesVisible}
                />
              </Suspense>
            ) : null}
            {cropSourceImage ? (
              <EditorImageCropEditor
                element={cropSourceImage}
                geometry={cropGeometry}
                onCropPointerDown={beginCrop}
              />
            ) : null}
            {previewSlide.elements.map((element, index) => {
              if (element.id === cropElementId) return null
              if (element.type === 'text' || element.type === 'shape' || element.type === 'table' || element.type === 'video' || element.type === 'audio') return null
              const bounds = element.type === 'line' ? getElementBounds(element) : undefined
              return (
                <button
                  aria-label={t('foundation.editor.selectElement', { type: element.name || element.type, id: element.id })}
                  className="mona-element-hit-target"
                  data-element-hit={element.id}
                  key={element.id}
                  onContextMenu={event => handleElementContextMenu(event, element)}
                  onDoubleClick={event => {
                    event.stopPropagation()
                    if (element.type === 'chart' && !element.lock) onEditChart(element.id)
                    if (element.type === 'latex' && !element.lock) onEditLatex(element.id)
                  }}
                  onPointerDown={event => handleElementPointerDown(event, element)}
                  type="button"
                  style={element.type === 'line'
                    ? {
                      left: bounds!.minX,
                      top: bounds!.minY - 6,
                      width: Math.max(bounds!.maxX - bounds!.minX, 12),
                      height: Math.max(bounds!.maxY - bounds!.minY, 12),
                      zIndex: 500 + index,
                    }
                    : {
                      left: element.left,
                      top: element.top,
                      width: element.width,
                      height: element.height,
                      transform: `rotate(${element.rotate}deg)`,
                      zIndex: 500 + index,
                    }}
                />
              )
            })}
            {preview.lasso ? <div className="mona-lasso-selection" style={preview.lasso} /> : null}
          </div>
          <div className="mona-editor-operation-layer">
            <EditorSelectionOverlay
              activeGroupElementId={session.activeGroupElementId}
              cropElementId={cropElementId}
              elements={mobileInteraction ? selectedElements.filter(element => element.type !== 'line') : selectedElements}
              handleElementId={session.handleElementId}
              interactionProfile={interactionProfile}
              onLinePointerDown={beginLinePoint}
              onResizePointerDown={beginResize}
              onRotatePointerDown={beginRotate}
              onShapeKeypointPointerDown={beginShapeKeypoint}
              scale={scale}
            />
            <div className="mona-editor-float-layer">
              {!mobileInteraction && session.toolbarState === 'elAnimation' ? (() => {
                // Vue overlays 1-based animation order badges on every
                // animated element while the animation panel is open.
                const formatted = selectFormattedCurrentSlideAnimations(presentation)
                return currentSlide.elements.map(element => {
                  if (session.hiddenElementIds.includes(element.id)) return null
                  const indexList = formatted.flatMap((group, index) => (
                    group.animations.some(animation => animation.elId === element.id) ? [index] : []
                  ))
                  if (!indexList.length) return null
                  const range = getElementBounds(element)
                  return (
                    <div className="mona-animation-index" key={element.id} style={{ left: range.minX * scale - 24, top: range.minY * scale }}>
                      {indexList.map(index => <div className="mona-animation-index-item" key={index}>{index + 1}</div>)}
                    </div>
                  )
                })
              })() : null}
              {!mobileInteraction && contextualCapabilities.selectionKind !== 'empty' && contextualCapabilities.selectionKind !== 'page' ? (
                <EditorSelectionActions
                  capabilities={contextualCapabilities}
                  elements={contextualActionElements}
                  frameRef={frameRef}
                  onAskMona={openAgent}
                  onComment={() => editorShell?.openTaskPanel('comments')}
                  onDelete={() => {
                    if (contextualCapabilities.selectionKind === 'page') {
                      if (runtime.deleteSlides()) runtime.store.dispatch(editorActions.pageSelectionChanged(true))
                    }
                    else deleteCurrentSelection()
                  }}
                  onDuplicate={() => {
                    if (contextualCapabilities.selectionKind === 'page') {
                      if (runtime.duplicateSlides().length) runtime.store.dispatch(editorActions.pageSelectionChanged(true))
                    }
                    else duplicateCurrentSelection()
                  }}
                  onEditLink={() => {
                    if (contextualCapabilities.targetElement) openLinkEditorFor(contextualCapabilities.targetElement)
                  }}
                  onGroup={groupCurrentSelection}
                  onLock={lock => setCurrentSelectionLocked(lock)}
                  onSelectGroup={() => runtime.store.dispatch(editorActions.activeGroupElementChanged(null))}
                  onUngroup={ungroupCurrentSelection}
                  scale={scale}
                  stageRef={stageRef}
                  viewportRatio={presentation.viewportRatio}
                  viewportSize={presentation.viewportSize}
                />
              ) : null}
              {!mobileInteraction ? (() => {
                // Vue shows an open/change/remove hyperlink bubble under the
                // handle element whenever it carries a link.
                const linkElement = session.handleElementId && !session.hiddenElementIds.includes(session.handleElementId)
                  ? currentSlide.elements.find(element => element.id === session.handleElementId)
                  : undefined
                if (!linkElement?.link) return null
                const toolbarTargetId = session.activeGroupElementId || (activeElementIds.length === 1 ? activeElementIds[0] : null)
                const toolbarVisible = Boolean(
                  toolbarTargetId === linkElement.id &&
                  linkElement.type !== 'video' && linkElement.type !== 'audio',
                )
                return (
                  <EditorFloatingLinkHandler
                    element={linkElement}
                    frameRef={frameRef}
                    key={linkElement.id}
                    onChangeLink={() => openLinkEditorFor(linkElement)}
                    runtime={runtime}
                    scale={scale}
                    stageRef={stageRef}
                    toolbarVisible={toolbarVisible}
                  />
                )
              })() : null}
            </div>
          </div>
        </div>
      ) : null}
      {activeTool ? (
        <div aria-hidden="true" className="mona-element-create-selection">
          {preview.createRect ? (
            <div
              className={`mona-create-selection is-${activeTool.type}`}
              style={{
                ...preview.createRect,
                height: activeTool.type === 'line' ? Math.max(preview.createRect.height, 24) : preview.createRect.height,
                width: activeTool.type === 'line' ? Math.max(preview.createRect.width, 24) : preview.createRect.width,
              }}
            >
              {activeTool.type === 'line' && preview.createLinePath ? (
                <svg height={Math.max(preview.createRect.height, 24)} overflow="visible" width={Math.max(preview.createRect.width, 24)}>
                  <path d={preview.createLinePath} fill="none" stroke="var(--editor-selection)" strokeWidth="2" />
                </svg>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {customShapeActive ? (
        <EditorCustomShapeCreator
          color={presentation.theme.themeColors[0] ?? '#d14424'}
          onCancel={() => onCustomShapeChange(false)}
          onCreated={result => {
            const element: PPTShapeElement = {
              id: createPresentationId(),
              type: 'shape',
              left: result.left,
              top: result.top,
              width: result.width,
              height: result.height,
              rotate: 0,
              fixedRatio: false,
              viewBox: result.viewBox,
              path: result.path,
              fill: result.fill ?? presentation.theme.themeColors[0] ?? '#d14424',
              ...(result.outline ? { outline: result.outline } : {}),
            }
            if (runtime.commit('Create custom shape', [{ type: 'element.add', elements: element }])) {
              runtime.store.dispatch(editorActions.selectionChanged([element.id]))
            }
          }}
          scale={scale}
          stageRef={stageRef}
          viewportRef={canvasRef}
        />
      ) : null}
      {isSpacePressed ? <div aria-hidden="true" className="mona-drag-mask" /> : null}
      {viewportFit.dimension > 0 && showRuler ? (
        <EditorRulers
          frameHeight={frameHeight}
          frameWidth={frameWidth}
          height={presentation.viewportSize * presentation.viewportRatio}
          pan={pan}
          scale={scale}
          selection={selectionBounds}
          width={presentation.viewportSize}
        />
      ) : null}
      {menu ? (
        <EditorContextMenu
          canDeleteTableColumn={menuElement?.type === 'table' ? canDeleteTableAxis(menuElement).column : false}
          canDeleteTableRow={menuElement?.type === 'table' ? canDeleteTableAxis(menuElement).row : false}
          canGroup={activeElementIds.length > 1}
          canMergeTableCells={menu?.surface === 'table-cell' && session.selectedTableCells.length > 1}
          canOrder={activeElementIds.length <= 1 || !!menuElement?.groupId}
          canPaste={!!runtime.getClipboardText() || !!navigator.clipboard}
          canSplitTableCell={menuElement?.type === 'table' && !!menu.cell && session.selectedTableCells.length <= 1 && (() => {
            const cell = menuElement.data[menu.cell.row]?.[menu.cell.column]
            return !!cell && (cell.rowspan > 1 || cell.colspan > 1)
          })()}
          gridLineSize={gridLineSize}
          grouped={!!menuElement?.groupId}
          locked={!!menuElement?.lock}
          onAction={handleContextAction}
          onDismiss={() => setMenu(null)}
          position={menu.position}
          showRuler={showRuler}
          surface={menu.surface}
        />
      ) : null}
      {linkEditor ? (
        <LinkEditor
          address={linkEditor.address}
          linkType={linkEditor.type}
          onCancel={closeLinkEditor}
          onAddressChange={address => setLinkEditor({ ...linkEditor, address })}
          onSlideChange={slideId => setLinkEditor({ ...linkEditor, slideId })}
          onSubmit={applyLink}
          onTypeChange={type => setLinkEditor({ ...linkEditor, type })}
          slideId={linkEditor.slideId}
          slideOptions={presentation.slides.map((slide, index) => ({
            disabled: slide.id === currentSlide.id,
            id: slide.id,
            label: t('foundation.editor.link.slideOption', { number: index + 1 }),
          }))}
          slides={presentation.slides}
          sourcePackages={presentation.sourcePackages}
          theme={presentation.theme}
          viewportRatio={presentation.viewportRatio}
          viewportSize={presentation.viewportSize}
        />
      ) : null}
      <span aria-live="polite" className="mona-editor-status">
        {activeTool
          ? t('foundation.editor.creationToolActive', { tool: t(`foundation.editor.tool.${activeTool.key}`) })
          : t('foundation.editor.selection', { count: selectedElements.length })}
      </span>
    </section>
  )
}
