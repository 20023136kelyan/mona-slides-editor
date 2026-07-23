import {
  exportToCanvas,
  getCommonBounds,
  serializeAsJSON,
} from '@excalidraw/excalidraw'
import type { AppState, BinaryFiles, ExcalidrawInitialDataState, NormalizedZoomValue } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'

import type { SerializedDrawingScene } from '@/features/editor/drawing/drawing-store'

const normalizedZoom = (zoom: number) => Math.min(30, Math.max(0.1, zoom)) as NormalizedZoomValue

export interface SketchAgentHandoff {
  preview: Blob
  scene: SerializedDrawingScene
  slideId: string
  updatedAt: number
}

export const serializeDrawingScene = (
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles,
): SerializedDrawingScene => JSON.parse(
  serializeAsJSON(elements, appState, files, 'local'),
) as SerializedDrawingScene

export const sceneAsInitialData = (
  scene: SerializedDrawingScene | undefined,
  zoom = 1,
): ExcalidrawInitialDataState => ({
  ...(scene as ExcalidrawInitialDataState | undefined),
  appState: {
    ...(scene?.appState ?? {}),
    exportBackground: false,
    scrollX: 0,
    scrollY: 0,
    viewBackgroundColor: 'transparent',
    zoom: { value: normalizedZoom(zoom) },
  },
  elements: scene?.elements as ExcalidrawInitialDataState['elements'] ?? [],
  files: scene?.files as ExcalidrawInitialDataState['files'] ?? {},
})

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => {
  canvas.toBlob(blob => {
    if (blob) resolve(blob)
    else reject(new Error('Unable to encode sketch preview'))
  }, 'image/png')
})

/**
 * Excalidraw exports content bounds. Mona places that result back into a
 * transparent slide-sized bitmap at the original scene coordinates so vision
 * models receive the same spatial intent the user drew.
 */
export const exportDrawingPreview = async ({
  appState,
  elements,
  files,
  height,
  width,
}: {
  appState: AppState
  elements: readonly ExcalidrawElement[]
  files: BinaryFiles
  height: number
  width: number
}): Promise<Blob> => {
  const liveElements = elements.filter(element => !element.isDeleted)
  const target = document.createElement('canvas')
  target.width = Math.max(1, Math.round(width))
  target.height = Math.max(1, Math.round(height))
  if (!liveElements.length) return canvasToBlob(target)

  const exported = await exportToCanvas({
    appState: { ...appState, exportBackground: false, viewBackgroundColor: 'transparent' },
    elements: liveElements,
    exportPadding: 0,
    files,
    getDimensions: (contentWidth: number, contentHeight: number) => ({
      height: Math.max(1, Math.ceil(contentHeight)),
      scale: 1,
      width: Math.max(1, Math.ceil(contentWidth)),
    }),
  })
  const [minX, minY] = getCommonBounds(liveElements)
  target.getContext('2d')?.drawImage(exported, Math.round(minX), Math.round(minY))
  return canvasToBlob(target)
}

export const drawingSceneBlob = (scene: SerializedDrawingScene): Blob =>
  new Blob([JSON.stringify(scene, null, 2)], { type: 'application/json' })
