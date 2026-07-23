let drawingWorkspacePromise: ReturnType<typeof importDrawingWorkspace> | undefined

const importDrawingWorkspace = () => import('@/features/editor/drawing/DrawingWorkspace')

/**
 * The Excalidraw bundle stays out of the initial editor load, but hovering or
 * keyboard-focusing Draw starts the download before activation.
 */
export const loadDrawingWorkspace = () => {
  drawingWorkspacePromise ??= importDrawingWorkspace()
  return drawingWorkspacePromise
}

export const prefetchDrawingWorkspace = () => {
  void loadDrawingWorkspace()
}
