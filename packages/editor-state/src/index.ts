import {
  configureStore,
  createSelector,
  createSlice,
  current,
  type PayloadAction,
} from '@reduxjs/toolkit'
import {
  applyPresentationTransaction,
  buildElementIndex,
  selectCurrentSlide as selectCurrentSlideFromPresentation,
  type PresentationState,
  type PresentationTransaction,
  type PresentationValidationIssue,
} from '@mona/presentation-core'

export interface EditorSessionState {
  activeElementIds: string[]
  handleElementId: string | null
  activeGroupElementId: string | null
  hiddenElementIds: string[]
  selectedSlideIndexes: number[]
  activeTool: string | null
  creatingCustomShape: boolean
  drawingMode: boolean
  sketchesVisible: boolean
  canvasZoom: number
  canvasPan: { x: number; y: number }
  canvasDragged: boolean
  canvasFocus: boolean
  pageSelected: boolean
  workspaceMode: 'canvas' | 'page-grid'
  filmstripVisible: boolean
  thumbnailsFocus: boolean
  disableHotkeys: boolean
  editingTextElementId: string | null
  selectedTableCells: string[]
  gridLineSize: number
  showRuler: boolean
  cropElementId: string | null
  toolbarState: EditorToolbarState
}

export type EditorToolbarState =
  | 'elAnimation'
  | 'elPosition'
  | 'elStyle'
  | 'multiPosition'
  | 'multiStyle'
  | 'slideAnimation'
  | 'slideDesign'

export interface RejectedEditorTransaction {
  transactionId: string
  reason: string
  issues: PresentationValidationIssue[]
}

export interface CanonicalEditorState {
  presentation: PresentationState
  session: EditorSessionState
  lastAppliedTransactionId: string | null
  lastRejectedTransaction: RejectedEditorTransaction | null
}

export interface CreateEditorStoreOptions {
  presentation: PresentationState
  session?: Partial<EditorSessionState>
  devChecks?: boolean
}

const createSessionState = (
  input: Partial<EditorSessionState> = {},
): EditorSessionState => ({
  activeElementIds: input.activeElementIds ?? [],
  handleElementId: input.handleElementId ?? null,
  activeGroupElementId: input.activeGroupElementId ?? null,
  hiddenElementIds: input.hiddenElementIds ?? [],
  selectedSlideIndexes: input.selectedSlideIndexes ?? [],
  activeTool: input.activeTool ?? null,
  creatingCustomShape: input.creatingCustomShape ?? false,
  drawingMode: input.drawingMode ?? false,
  sketchesVisible: input.sketchesVisible ?? true,
  canvasZoom: input.canvasZoom ?? 90,
  canvasPan: input.canvasPan ?? { x: 0, y: 0 },
  canvasDragged: input.canvasDragged ?? false,
  canvasFocus: input.canvasFocus ?? false,
  pageSelected: input.pageSelected ?? true,
  workspaceMode: input.workspaceMode ?? 'canvas',
  filmstripVisible: input.filmstripVisible ?? true,
  thumbnailsFocus: input.thumbnailsFocus ?? false,
  disableHotkeys: input.disableHotkeys ?? false,
  editingTextElementId: input.editingTextElementId ?? null,
  selectedTableCells: input.selectedTableCells ?? [],
  gridLineSize: input.gridLineSize ?? 0,
  showRuler: input.showRuler ?? false,
  cropElementId: input.cropElementId ?? null,
  toolbarState: input.toolbarState ?? 'slideDesign',
})

const emptyPresentation: PresentationState = {
  title: '',
  theme: {
    themeColors: [],
    fontColor: '#000',
    fontName: '',
    backgroundColor: '#fff',
    shadow: { h: 0, v: 0, blur: 0, color: '#000' },
    outline: { width: 0, color: '#000', style: 'solid' },
  },
  slides: [{ id: '__empty__', elements: [] }],
  slideIndex: 0,
  viewportSize: 1000,
  viewportRatio: 0.5625,
  templates: [],
}

const initialState: CanonicalEditorState = {
  presentation: emptyPresentation,
  session: createSessionState(),
  lastAppliedTransactionId: null,
  lastRejectedTransaction: null,
}

const editorSlice = createSlice({
  name: 'editor',
  initialState,
  reducers: {
    transactionCommitted(state, action: PayloadAction<PresentationTransaction>) {
      const presentation = current(state.presentation) as PresentationState
      const result = applyPresentationTransaction(presentation, action.payload)
      if (!result.ok) {
        state.lastRejectedTransaction = {
          transactionId: action.payload.id,
          reason: result.reason,
          issues: result.issues,
        }
        return
      }

      state.presentation = result.state
      state.lastAppliedTransactionId = action.payload.id
      state.lastRejectedTransaction = null
    },
    historyRestored(state, action: PayloadAction<PresentationState>) {
      state.presentation = action.payload
      state.lastAppliedTransactionId = null
      state.lastRejectedTransaction = null
      const validElementIds = new Set(action.payload.slides.flatMap(slide => slide.elements.map(element => element.id)))
      state.session.activeElementIds = state.session.activeElementIds.filter(id => validElementIds.has(id))
      if (!state.session.handleElementId || !validElementIds.has(state.session.handleElementId)) {
        state.session.handleElementId = state.session.activeElementIds.length === 1
          ? state.session.activeElementIds[0] ?? null
          : null
      }
      if (state.session.activeGroupElementId && !validElementIds.has(state.session.activeGroupElementId)) {
        state.session.activeGroupElementId = null
      }
      if (state.session.cropElementId && !validElementIds.has(state.session.cropElementId)) {
        state.session.cropElementId = null
      }
    },
    selectionChanged(state, action: PayloadAction<string[]>) {
      state.session.activeElementIds = action.payload
      state.session.handleElementId = action.payload.length === 1 ? action.payload[0] ?? null : null
      state.session.activeGroupElementId = null
      state.session.selectedTableCells = []
      state.session.pageSelected = false
      state.session.editingTextElementId = null
    },
    handleElementChanged(state, action: PayloadAction<string | null>) {
      state.session.handleElementId = action.payload
      state.session.activeGroupElementId = null
    },
    activeGroupElementChanged(state, action: PayloadAction<string | null>) {
      state.session.activeGroupElementId = action.payload
    },
    hiddenElementsChanged(state, action: PayloadAction<string[]>) {
      state.session.hiddenElementIds = action.payload
    },
    selectedSlideIndexesChanged(state, action: PayloadAction<number[]>) {
      state.session.selectedSlideIndexes = action.payload
    },
    activeToolChanged(state, action: PayloadAction<string | null>) {
      state.session.activeTool = action.payload
      if (action.payload) state.session.pageSelected = false
    },
    creatingCustomShapeChanged(state, action: PayloadAction<boolean>) {
      state.session.creatingCustomShape = action.payload
    },
    drawingModeChanged(state, action: PayloadAction<boolean>) {
      state.session.drawingMode = action.payload
      state.session.creatingCustomShape = false
      state.session.activeTool = null
      state.session.canvasFocus = action.payload
      state.session.pageSelected = action.payload
        ? false
        : state.session.activeElementIds.length === 0
    },
    sketchesVisibilityChanged(state, action: PayloadAction<boolean>) {
      state.session.sketchesVisible = action.payload
    },
    canvasZoomChanged(state, action: PayloadAction<number>) {
      // the established editor's 5% commands are guarded at 30% and 200%, so one final
      // command reaches the effective extrema of 25% and 205%.
      state.session.canvasZoom = Math.min(205, Math.max(25, action.payload))
    },
    canvasPanChanged(state, action: PayloadAction<{ x: number; y: number }>) {
      state.session.canvasPan = action.payload
    },
    canvasDraggedChanged(state, action: PayloadAction<boolean>) {
      state.session.canvasDragged = action.payload
    },
    canvasFocusChanged(state, action: PayloadAction<boolean>) {
      state.session.canvasFocus = action.payload
    },
    pageSelectionChanged(state, action: PayloadAction<boolean>) {
      state.session.pageSelected = action.payload
    },
    workspaceModeChanged(state, action: PayloadAction<'canvas' | 'page-grid'>) {
      state.session.workspaceMode = action.payload
      state.session.drawingMode = false
      state.session.canvasFocus = false
      state.session.pageSelected = action.payload === 'canvas'
      state.session.activeElementIds = []
      state.session.handleElementId = null
      state.session.activeGroupElementId = null
      state.session.editingTextElementId = null
    },
    filmstripVisibilityChanged(state, action: PayloadAction<boolean>) {
      state.session.filmstripVisible = action.payload
    },
    thumbnailsFocusChanged(state, action: PayloadAction<boolean>) {
      state.session.thumbnailsFocus = action.payload
      if (!action.payload) state.session.selectedSlideIndexes = []
    },
    hotkeysDisabledChanged(state, action: PayloadAction<boolean>) {
      state.session.disableHotkeys = action.payload
    },
    editingTextElementChanged(state, action: PayloadAction<string | null>) {
      state.session.editingTextElementId = action.payload
    },
    selectedTableCellsChanged(state, action: PayloadAction<string[]>) {
      state.session.selectedTableCells = action.payload
    },
    gridLineSizeChanged(state, action: PayloadAction<number>) {
      state.session.gridLineSize = action.payload
    },
    rulerVisibilityChanged(state, action: PayloadAction<boolean>) {
      state.session.showRuler = action.payload
    },
    cropElementChanged(state, action: PayloadAction<string | null>) {
      state.session.cropElementId = action.payload
    },
    toolbarStateChanged(state, action: PayloadAction<EditorToolbarState>) {
      state.session.toolbarState = action.payload
    },
  },
})

export const editorActions = editorSlice.actions

export const createEditorStore = (options: CreateEditorStoreOptions) => {
  const preloadedState: CanonicalEditorState = {
    presentation: options.presentation,
    session: createSessionState(options.session),
    lastAppliedTransactionId: null,
    lastRejectedTransaction: null,
  }
  const devChecks = options.devChecks ?? true

  return configureStore({
    reducer: editorSlice.reducer,
    preloadedState,
    devTools: false,
    middleware: getDefaultMiddleware => getDefaultMiddleware({
      immutableCheck: devChecks,
      serializableCheck: devChecks,
    }),
  })
}

export type EditorStore = ReturnType<typeof createEditorStore>
export type EditorRootState = ReturnType<EditorStore['getState']>
export type EditorDispatch = EditorStore['dispatch']

export const selectPresentation = (state: EditorRootState) => state.presentation
export const selectSlides = (state: EditorRootState) => state.presentation.slides
export const selectSlideIndex = (state: EditorRootState) => state.presentation.slideIndex
export const selectSession = (state: EditorRootState) => state.session
export const selectActiveElementIds = (state: EditorRootState) => state.session.activeElementIds
export const selectCanvasFocus = (state: EditorRootState) => state.session.canvasFocus
export const selectCanvasPan = (state: EditorRootState) => state.session.canvasPan
export const selectCanvasZoom = (state: EditorRootState) => state.session.canvasZoom
export const selectCropElementId = (state: EditorRootState) => state.session.cropElementId
export const selectGridLineSize = (state: EditorRootState) => state.session.gridLineSize
export const selectShowRuler = (state: EditorRootState) => state.session.showRuler
export const selectLastRejectedTransaction = (state: EditorRootState) => state.lastRejectedTransaction

export const selectCurrentSlide = createSelector(
  [selectPresentation],
  presentation => selectCurrentSlideFromPresentation(presentation),
)

export const selectElementIndex = createSelector(
  [selectSlides],
  slides => buildElementIndex({ slides }),
)

export const makeSelectSlideById = (slideId: string) => createSelector(
  [selectSlides],
  slides => slides.find(slide => slide.id === slideId),
)

export const makeSelectElementById = (elementId: string) => createSelector(
  [selectElementIndex],
  elementIndex => elementIndex.get(elementId)?.element,
)

export const selectHandleElement = createSelector(
  [selectElementIndex, selectSession],
  (elementIndex, session) => session.handleElementId
    ? elementIndex.get(session.handleElementId)?.element
    : undefined,
)
