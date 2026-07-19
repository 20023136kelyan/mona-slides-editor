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
  openPanel: string | null
}

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
  openPanel: input.openPanel ?? null,
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
    selectionChanged(state, action: PayloadAction<string[]>) {
      state.session.activeElementIds = action.payload
      state.session.handleElementId = action.payload.length === 1 ? action.payload[0] ?? null : null
    },
    handleElementChanged(state, action: PayloadAction<string | null>) {
      state.session.handleElementId = action.payload
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
    },
    openPanelChanged(state, action: PayloadAction<string | null>) {
      state.session.openPanel = action.payload
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
