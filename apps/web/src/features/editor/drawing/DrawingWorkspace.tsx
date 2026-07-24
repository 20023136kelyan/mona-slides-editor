import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { saveAs } from 'file-saver'
import {
  CaptureUpdateAction,
  Excalidraw,
  getSceneVersion,
} from '@excalidraw/excalidraw'
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  NormalizedZoomValue,
} from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import {
  Circle,
  Crosshair,
  Download,
  Eraser,
  Eye,
  EyeOff,
  MousePointer2,
  MoveRight,
  Pencil,
  Redo2,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
} from 'lucide-react'

import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { DrawingStore, SerializedDrawingScene } from '@/features/editor/drawing/drawing-store'
import {
  drawingSceneBlob,
  exportDrawingPreview,
  sceneAsInitialData,
  serializeDrawingScene,
  type SketchAgentHandoff,
} from '@/features/editor/drawing/drawing-serialization'

import '@excalidraw/excalidraw/index.css'
import '@/features/editor/drawing/drawing.css'

type DrawingTool = 'arrow' | 'ellipse' | 'eraser' | 'freedraw' | 'rectangle' | 'reference' | 'selection' | 'text'

interface LiveScene {
  appState: AppState
  elements: readonly ExcalidrawElement[]
  files: BinaryFiles
  version: number
}

const DEFAULT_STROKE = '#171717'
const STROKE_COLORS = ['#171717', '#6b7280', '#dc2626', '#2563eb', '#16a34a']
const normalizedZoom = (zoom: number) => Math.min(30, Math.max(0.1, zoom)) as NormalizedZoomValue

const toolIcon = (tool: DrawingTool) => {
  if (tool === 'selection') return <MousePointer2 />
  if (tool === 'reference') return <Crosshair />
  if (tool === 'freedraw') return <Pencil />
  if (tool === 'rectangle') return <Square />
  if (tool === 'ellipse') return <Circle />
  if (tool === 'arrow') return <MoveRight />
  if (tool === 'text') return <Type />
  return <Eraser />
}

// Selection, viewport, and active-tool state changes continually without
// changing the authored sketch. Comparing only scene content prevents
// Excalidraw's mount lifecycle from creating a phantom undo checkpoint.
const sceneFingerprint = (scene: SerializedDrawingScene) => JSON.stringify({
  elements: scene.elements,
  files: scene.files ?? {},
})

export function DrawingWorkspace({
  active,
  onActiveChange,
  onBuildThis,
  onVisibilityChange,
  referenceCount,
  scale,
  slideId,
  store,
  visible,
  viewportHeight,
  viewportWidth,
}: {
  active: boolean
  onActiveChange: (active: boolean) => void
  onBuildThis: (handoff: SketchAgentHandoff) => void
  onVisibilityChange: (visible: boolean) => void
  referenceCount: number
  scale: number
  slideId: string
  store: DrawingStore
  visible: boolean
  viewportHeight: number
  viewportWidth: number
}) {
  const { i18n, t } = useTranslation()
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const workspaceRef = useRef<HTMLElement | null>(null)
  const latestRef = useRef<LiveScene | null>(null)
  const checkpointTimerRef = useRef<number | null>(null)
  const initialScene = useMemo(() => store.getSketch(slideId)?.scene, [slideId, store])
  const historyRef = useRef<SerializedDrawingScene[]>([initialScene ?? { elements: [] }])
  const historyIndexRef = useRef(0)
  const suppressCheckpointRef = useRef(false)
  const clearingRef = useRef(false)
  const hydratedSceneRef = useRef(initialScene ? sceneFingerprint(initialScene) : '')
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [apiReady, setApiReady] = useState(false)
  const [tool, setTool] = useState<DrawingTool>('freedraw')
  const [strokeColor, setStrokeColor] = useState(DEFAULT_STROKE)
  const [strokeWidth, setStrokeWidth] = useState(2)
  const [clearOpen, setClearOpen] = useState(false)
  const [building, setBuilding] = useState(false)
  const [hasContent, setHasContent] = useState(() => Boolean(initialScene?.elements.some(element => element.isDeleted !== true)))
  const [historyState, setHistoryState] = useState({ canRedo: false, canUndo: false })
  const referenceMode = tool === 'reference'
  const canvasZoom = normalizedZoom(scale)

  const updateHistoryState = useCallback(() => setHistoryState({
    canRedo: historyIndexRef.current < historyRef.current.length - 1,
    canUndo: historyIndexRef.current > 0,
  }), [])
  const serializeLatest = useCallback(() => {
    const latest = latestRef.current
    if (!latest) return initialScene ?? { elements: [] }
    return serializeDrawingScene(latest.elements, latest.appState, latest.files)
  }, [initialScene])
  const checkpoint = useCallback(() => {
    if (checkpointTimerRef.current !== null) {
      window.clearTimeout(checkpointTimerRef.current)
      checkpointTimerRef.current = null
    }
    const scene = serializeLatest()
    if (scene.elements.some(element => element.isDeleted !== true)) store.setScene(slideId, scene)
    else store.clear(slideId)
    if (suppressCheckpointRef.current) return scene
    const fingerprint = sceneFingerprint(scene)
    if (sceneFingerprint(historyRef.current[historyIndexRef.current] ?? { elements: [] }) === fingerprint) return scene
    historyRef.current.splice(historyIndexRef.current + 1)
    historyRef.current.push(scene)
    historyIndexRef.current = historyRef.current.length - 1
    updateHistoryState()
    return scene
  }, [serializeLatest, slideId, store, updateHistoryState])
  const scheduleCheckpoint = useCallback(() => {
    if (checkpointTimerRef.current !== null) window.clearTimeout(checkpointTimerRef.current)
    checkpointTimerRef.current = window.setTimeout(checkpoint, 450)
  }, [checkpoint])

  useEffect(() => () => {
    if (checkpointTimerRef.current !== null) window.clearTimeout(checkpointTimerRef.current)
    const latest = latestRef.current
    if (!latest) return
    const scene = serializeDrawingScene(latest.elements, latest.appState, latest.files)
    if (scene.elements.some(element => element.isDeleted !== true)) store.setScene(slideId, scene)
    else store.clear(slideId)
    void store.flush()
  }, [slideId, store])

  useEffect(() => {
    if (!api) return
    const frame = requestAnimationFrame(() => {
      if (tool === 'reference') api.setCursor('crosshair')
      else {
        api.resetCursor()
        api.setActiveTool({ type: tool })
      }
      if (active) workspaceRef.current?.querySelector<HTMLElement>('canvas.interactive')?.focus()
      setApiReady(true)
    })
    return () => cancelAnimationFrame(frame)
  }, [active, api, tool])

  useEffect(() => {
    if (!api) return
    const frame = requestAnimationFrame(() => {
      api.updateScene({
        appState: {
          currentItemStrokeColor: strokeColor,
          currentItemStrokeWidth: strokeWidth,
          scrollX: 0,
          scrollY: 0,
          zoom: { value: canvasZoom },
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [api, canvasZoom, strokeColor, strokeWidth])

  // IndexedDB hydration may resolve while the lazy drawing bundle is
  // mounting. Apply that scene once if the user has not already drawn.
  useEffect(() => {
    if (!api || !apiReady || !initialScene) return
    const fingerprint = sceneFingerprint(initialScene)
    if (hydratedSceneRef.current === fingerprint) return
    hydratedSceneRef.current = fingerprint
    if (api.getSceneElements().length) return
    if (initialScene.files) {
      api.addFiles(Object.values(initialScene.files) as Parameters<ExcalidrawImperativeAPI['addFiles']>[0])
    }
    api.updateScene({
      captureUpdate: CaptureUpdateAction.NEVER,
      elements: initialScene.elements as unknown as readonly ExcalidrawElement[],
    })
    historyRef.current = [initialScene]
    historyIndexRef.current = 0
  }, [api, apiReady, initialScene])

  const handleChange = useCallback((
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    if (clearingRef.current) {
      if (elements.some(element => !element.isDeleted)) return
      clearingRef.current = false
      latestRef.current = { appState, elements, files, version: getSceneVersion(elements) }
      setHasContent(false)
      return
    }
    const version = getSceneVersion(elements)
    if (latestRef.current?.version === version) return
    latestRef.current = { appState, elements, files, version }
    setHasContent(elements.some(element => !element.isDeleted))
    scheduleCheckpoint()
  }, [scheduleCheckpoint])

  const applyHistory = (index: number) => {
    const next = historyRef.current[index]
    if (!api || !next) return
    suppressCheckpointRef.current = true
    api.updateScene({
      captureUpdate: CaptureUpdateAction.NEVER,
      elements: next.elements as unknown as readonly ExcalidrawElement[],
    })
    const nextElements = api.getSceneElementsIncludingDeleted()
    latestRef.current = {
      appState: api.getAppState(),
      elements: nextElements,
      files: api.getFiles(),
      version: getSceneVersion(nextElements),
    }
    if (next.elements.some(element => element.isDeleted !== true)) store.setScene(slideId, next)
    else store.clear(slideId)
    void store.flush()
    setHasContent(next.elements.some(element => element.isDeleted !== true))
    historyIndexRef.current = index
    suppressCheckpointRef.current = false
    updateHistoryState()
  }
  const clearSketch = () => {
    setClearOpen(false)
    if (!api) return
    suppressCheckpointRef.current = true
    clearingRef.current = true
    latestRef.current = {
      appState: api.getAppState(),
      elements: [],
      files: {},
      version: 0,
    }
    store.clear(slideId)
    void store.flush()
    api.updateScene({
      captureUpdate: CaptureUpdateAction.NEVER,
      elements: [],
    })
    setHasContent(false)
    const empty: SerializedDrawingScene = { elements: [] }
    historyRef.current.splice(historyIndexRef.current + 1)
    historyRef.current.push(empty)
    historyIndexRef.current = historyRef.current.length - 1
    suppressCheckpointRef.current = false
    updateHistoryState()
  }
  const exportPayload = async () => {
    const currentApi = apiRef.current
    if (!currentApi) throw new Error('Sketch editor is not ready')
    const elements = currentApi.getSceneElementsIncludingDeleted()
    const appState = currentApi.getAppState()
    const files = currentApi.getFiles()
    const scene = serializeDrawingScene(elements, appState, files)
    const preview = await exportDrawingPreview({
      appState,
      elements,
      files,
      height: viewportHeight,
      width: viewportWidth,
    })
    return { preview, scene }
  }
  const buildThis = async () => {
    setBuilding(true)
    try {
      checkpoint()
      await store.flush()
      const { preview, scene } = await exportPayload()
      onBuildThis({ preview, scene, slideId, updatedAt: Date.now() })
    }
    finally {
      setBuilding(false)
    }
  }

  const tools: DrawingTool[] = ['selection', 'reference', 'freedraw', 'rectangle', 'ellipse', 'arrow', 'text', 'eraser']
  return (
    <section
      aria-label={t('foundation.editor.drawing.layer')}
      className={`mona-drawing-workspace${active ? ' is-active' : ' is-passive'}${referenceMode ? ' is-reference-mode' : ''}`}
      data-scene-zoom={api?.getAppState().zoom.value}
      data-sketch-slide-id={slideId}
      onKeyDownCapture={event => {
        if (event.key !== 'Escape' || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
        event.preventDefault()
        event.stopPropagation()
        checkpoint()
        onActiveChange(false)
      }}
      ref={workspaceRef}
      style={{
        '--mona-canvas-scale': scale,
        height: viewportHeight * scale,
        transform: `scale(${1 / scale})`,
        width: viewportWidth * scale,
      } as React.CSSProperties}
    >
      <div className="mona-drawing-canvas">
        <Excalidraw
          aiEnabled={false}
          detectScroll={false}
          excalidrawAPI={nextApi => {
            apiRef.current = nextApi
            setApiReady(false)
            setApi(nextApi)
          }}
          handleKeyboardGlobally={false}
          initialData={sceneAsInitialData(initialScene, scale)}
          langCode={i18n.resolvedLanguage?.startsWith('zh') ? 'zh-CN' : 'en'}
          onChange={handleChange}
          onPointerUp={() => {
            checkpoint()
            void store.flush()
          }}
          onScrollChange={(scrollX, scrollY, zoom) => {
            if (!scrollX && !scrollY && zoom.value === canvasZoom) return
            apiRef.current?.updateScene({
              appState: {
                scrollX: 0,
                scrollY: 0,
                zoom: { value: canvasZoom },
              },
              captureUpdate: CaptureUpdateAction.NEVER,
            })
          }}
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: false,
              clearCanvas: false,
              export: false,
              loadScene: false,
              saveAsImage: false,
              saveToActiveFile: false,
              toggleTheme: false,
            },
            tools: { image: false },
          }}
          viewModeEnabled={!active}
          zenModeEnabled
        />
      </div>
      {active ? (
        <div aria-label={t('foundation.editor.drawing.palette')} className="mona-drawing-palette" role="toolbar">
          <ToggleGroup
            aria-label={t('foundation.editor.drawing.tools')}
            onValueChange={value => {
              if (value) setTool(value as DrawingTool)
            }}
            spacing={1}
            type="single"
            value={tool}
          >
            {tools.map(item => (
              <ToggleGroupItem aria-label={t(`foundation.editor.drawing.tool.${item}`)} key={item} title={t(`foundation.editor.drawing.tool.${item}`)} value={item}>
                {toolIcon(item)}
                {item === 'reference' && referenceCount ? <span className="mona-drawing-reference-count">{referenceCount}</span> : null}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <span aria-hidden="true" className="mx-0.5 h-6 w-px bg-ink/10" />
          <Popover>
            <PopoverTrigger asChild>
              <Button aria-label={t('foundation.editor.drawing.stroke')} size="editor-icon" type="button" variant="ghost">
                <SlidersHorizontal />
              </Button>
            </PopoverTrigger>
            <PopoverContent aria-label={t('foundation.editor.drawing.stroke')} align="center" className="grid w-55 gap-2.5 [&_strong]:text-xs" side="bottom">
              <strong>{t('foundation.editor.drawing.strokeColor')}</strong>
              <div className="flex gap-1.5 [&_button]:before:size-4.5 [&_button]:before:rounded-pill [&_button]:before:border-2 [&_button]:before:border-white [&_button]:before:bg-[var(--drawing-color)] [&_button]:before:shadow-[0_0_0_1px_rgb(16_18_25/16%)] [&_button]:before:content-[''] [&_button.is-active]:before:shadow-[0_0_0_2px_#fff,0_0_0_4px_#171717]">
                {STROKE_COLORS.map(color => (
                  <Button
                    aria-label={color}
                    aria-pressed={strokeColor === color}
                    className={strokeColor === color ? 'is-active' : ''}
                    key={color}
                    onClick={() => setStrokeColor(color)}
                    size="editor-icon"
                    style={{ '--drawing-color': color } as React.CSSProperties}
                    type="button"
                    variant="ghost"
                  />
                ))}
              </div>
              <strong>{t('foundation.editor.drawing.strokeWidth')}</strong>
              <Slider aria-label={t('foundation.editor.drawing.strokeWidth')} max={8} min={1} onValueChange={([value]) => setStrokeWidth(value ?? 2)} step={1} value={[strokeWidth]} />
            </PopoverContent>
          </Popover>
          <Button aria-label={t('foundation.editor.drawing.undo')} disabled={!apiReady || !historyState.canUndo} onClick={() => applyHistory(historyIndexRef.current - 1)} size="editor-icon" type="button" variant="ghost"><Undo2 /></Button>
          <Button aria-label={t('foundation.editor.drawing.redo')} disabled={!apiReady || !historyState.canRedo} onClick={() => applyHistory(historyIndexRef.current + 1)} size="editor-icon" type="button" variant="ghost"><Redo2 /></Button>
          <Button
            aria-label={t(visible ? 'foundation.editor.drawing.hide' : 'foundation.editor.drawing.show')}
            onClick={() => {
              if (visible) {
                checkpoint()
                void store.flush()
                onVisibilityChange(false)
                onActiveChange(false)
              }
              else onVisibilityChange(true)
            }}
            size="editor-icon"
            type="button"
            variant="ghost"
          >
            {visible ? <Eye /> : <EyeOff />}
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button aria-label={t('foundation.editor.drawing.export')} disabled={!apiReady || !hasContent} size="editor-icon" type="button" variant="ghost"><Download /></Button>
            </PopoverTrigger>
            <PopoverContent aria-label={t('foundation.editor.drawing.export')} align="end" className="flex w-55 flex-col gap-0.5 [&_button]:justify-start" side="bottom">
              <Button onClick={() => {
                const scene = checkpoint()
                saveAs(drawingSceneBlob(scene), `${slideId}.excalidraw`)
              }} size="sm" type="button" variant="ghost">{t('foundation.editor.drawing.downloadScene')}</Button>
              <Button onClick={() => void exportPayload().then(({ preview }) => saveAs(preview, `${slideId}-sketch.png`))} size="sm" type="button" variant="ghost">{t('foundation.editor.drawing.downloadPng')}</Button>
            </PopoverContent>
          </Popover>
          <Button aria-label={t('foundation.editor.drawing.clear')} disabled={!apiReady || !hasContent} onClick={() => setClearOpen(true)} size="editor-icon" type="button" variant="ghost"><Trash2 /></Button>
          <Button disabled={!apiReady || building || !hasContent} onClick={() => void buildThis()} size="sm" type="button" variant="default"><Sparkles />{t('foundation.editor.drawing.buildThis')}</Button>
          <Button aria-label={t('foundation.editor.drawing.exit')} onClick={() => {
            checkpoint()
            void store.flush()
            onActiveChange(false)
          }} size="editor-icon" type="button" variant="ghost"><X /></Button>
        </div>
      ) : null}
      <AlertDialog onOpenChange={setClearOpen} open={clearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('foundation.editor.drawing.clearTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('foundation.editor.drawing.clearDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <Button
              data-testid="confirm-clear-drawing"
              onClick={clearSketch}
              onPointerDown={event => {
                if (event.button === 0) clearSketch()
              }}
              type="button"
              variant="destructive"
            >
              {t('foundation.editor.drawing.clear')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
