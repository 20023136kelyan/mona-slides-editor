import { beforeAll, beforeEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import { editorActions, type EditorToolbarState } from '@mona/editor-state'
import type { PresentationState } from '@mona/presentation-core'
import type { PPTElement } from '@mona/presentation-core/model'

import { EditorContextToolbar } from '@/features/editor/EditorContextToolbar'
import { createEditorRuntime } from '@/features/editor/editor-runtime'
import { EditorApplicationProvider } from '@/features/editor/services/EditorApplicationProvider'
import type { EditorApplication } from '@/features/editor/services/editor-application'
import { createEditorNotificationService } from '@/features/editor/services/editor-notifications'
import { initializeI18n, setLocale } from '@/i18n'

beforeAll(async () => {
  await initializeI18n()
})

beforeEach(async () => {
  await setLocale('en-US')
})

const shape = (id: string, props: Partial<Extract<PPTElement, { type: 'shape' }>> = {}): Extract<PPTElement, { type: 'shape' }> => ({
  type: 'shape',
  id,
  left: 0,
  top: 0,
  width: 100,
  height: 100,
  rotate: 0,
  fixedRatio: false,
  viewBox: [100, 100],
  path: 'M0 0H100V100H0Z',
  fill: '#fff',
  ...props,
})

const elements: PPTElement[] = [
  {
    type: 'text',
    id: 'text',
    content: '<p>Text</p>',
    defaultFontName: 'Inter',
    defaultColor: '#111',
    left: 0,
    top: 0,
    width: 100,
    height: 40,
    rotate: 0,
  },
  shape('shape'),
  {
    type: 'image',
    id: 'image',
    src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
    fixedRatio: true,
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    rotate: 0,
  },
  {
    type: 'line',
    id: 'line',
    left: 0,
    top: 0,
    width: 2,
    start: [0, 0],
    end: [100, 100],
    style: 'solid',
    color: '#000',
    points: ['', 'arrow'],
  },
  {
    type: 'chart',
    id: 'chart',
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    rotate: 0,
    chartType: 'bar',
    data: { labels: ['A'], legends: ['Series'], series: [[1]] },
    themeColors: ['#000'],
  },
  {
    type: 'table',
    id: 'table',
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    rotate: 0,
    outline: { color: '#000', style: 'solid', width: 1 },
    colWidths: [100],
    cellMinHeight: 20,
    data: [[{ id: 'cell', colspan: 1, rowspan: 1, text: '<p>Cell</p>' }]],
  },
  {
    type: 'latex',
    id: 'equation',
    left: 0,
    top: 0,
    width: 100,
    height: 40,
    rotate: 0,
    latex: 'x',
    path: 'M0 0',
    color: '#000',
    strokeWidth: 1,
    viewBox: [100, 40],
    fixedRatio: true,
  },
  {
    type: 'video',
    id: 'media',
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    rotate: 0,
    src: 'video.mp4',
    autoplay: false,
  },
]

const makePresentation = (slideElements: PPTElement[] = elements): PresentationState => ({
  title: 'Context toolbar fixture',
  slides: [{ id: 'slide', elements: slideElements }],
  slideIndex: 0,
  viewportSize: 1000,
  viewportRatio: 0.5625,
  theme: {
    themeColors: [],
    fontColor: '#000',
    fontName: 'Arial',
    backgroundColor: '#fff',
    shadow: { h: 0, v: 0, blur: 0, color: '#000' },
    outline: { width: 1, color: '#000', style: 'solid' },
  },
  templates: [],
})

const renderToolbar = async ({
  activeMode = 'select',
  activeGroupElementId = null,
  cropElementId = null,
  editingTextElementId = null,
  pageSelected = false,
  presentation = makePresentation(),
  selected = [],
}: {
  activeMode?: 'create' | 'draw' | 'select'
  activeGroupElementId?: string | null
  cropElementId?: string | null
  editingTextElementId?: string | null
  pageSelected?: boolean
  presentation?: PresentationState
  selected?: readonly string[]
}) => {
  const runtime = createEditorRuntime(presentation)
  runtime.store.dispatch(editorActions.selectionChanged([...selected]))
  runtime.store.dispatch(editorActions.pageSelectionChanged(pageSelected))
  runtime.store.dispatch(editorActions.activeGroupElementChanged(activeGroupElementId))
  runtime.store.dispatch(editorActions.cropElementChanged(cropElementId))
  runtime.store.dispatch(editorActions.editingTextElementChanged(editingTextElementId))
  const state = runtime.store.getState()
  const application: EditorApplication = {
    agentOpen: false,
    closeAgent: () => {},
    closeExport: () => {},
    exitPresentation: () => {},
    exportType: null,
    importFiles: async () => {},
    importing: false,
    notifications: createEditorNotificationService(),
    openAgent: () => {},
    openExport: () => {},
    persistence: null,
    presenting: false,
    startPresentation: () => {},
    subscribeToPresentationStart: () => () => {},
  }
  await render(
    <EditorApplicationProvider value={application}>
      <EditorContextToolbar
        activeMode={activeMode}
        currentSlide={state.presentation.slides[0]!}
        onEditChart={() => {}}
        onEditLatex={() => {}}
        onOpenInspector={(_state: EditorToolbarState) => {}}
        presentation={state.presentation}
        runtime={runtime}
        session={state.session}
      />
    </EditorApplicationProvider>,
  )
  return runtime
}

test.each([
  ['text', 'text', '.mona-contextual-text-controls'],
  ['shape', 'shape', '.mona-contextual-shape-controls'],
  ['image', 'image', '.mona-contextual-image-controls'],
  ['line', 'line', '.mona-contextual-line-controls'],
  ['chart', 'chart', '.mona-contextual-chart-controls'],
  ['table', 'table', '.mona-contextual-table-controls'],
  ['equation', 'equation', '.mona-contextual-latex-controls'],
  ['media', 'media', '.mona-contextual-media-controls'],
] as const)('renders the complete %s control family for a %s selection', async (id, kind, selector) => {
  await renderToolbar({ selected: [id] })
  const toolbar = document.querySelector<HTMLElement>('[role="toolbar"]')!
  expect(toolbar.dataset.selectionKind).toBe(kind)
  expect(toolbar.querySelector(selector)).not.toBeNull()
  expect(toolbar.querySelector('[aria-label="Style"]')).not.toBeNull()
  expect(toolbar.querySelector('[aria-label="Animation"]')).not.toBeNull()
  expect(toolbar.querySelector('[aria-label="Position"]')).not.toBeNull()
})

test('distinguishes page, empty, creation, and drawing states in the rendered surface', async () => {
  await renderToolbar({ pageSelected: true })
  expect(document.querySelector('[data-selection-kind="page"]')).not.toBeNull()
  await expect.element(page.getByRole('button', { name: 'Page background' })).toBeVisible()
})

test.each(['create', 'draw'] as const)('does not leak selection formatting into %s mode', async activeMode => {
  await renderToolbar({ activeMode, pageSelected: true, selected: ['shape'] })
  expect(document.querySelector('[role="toolbar"]')).toBeNull()
})

test('renders no contextual toolbar for an intentional empty selection', async () => {
  await renderToolbar({})
  expect(document.querySelector('[role="toolbar"]')).toBeNull()
})

test.each([
  ['crop', { cropElementId: 'image', selected: ['image'] }, 'image'],
  ['text-edit', { editingTextElementId: 'text', selected: ['text'] }, 'text'],
] as const)('keeps %s as an explicit non-destructive mode', async (mode, state, kind) => {
  await renderToolbar(state)
  expect(document.querySelector(`[data-contextual-mode="${mode}"][data-selection-kind="${kind}"]`)).not.toBeNull()
})

test('renders a parent group as shared controls rather than one child type', async () => {
  const grouped = makePresentation([
    shape('group-shape', { groupId: 'group' }),
    { ...elements.find(element => element.id === 'line')!, id: 'group-line', groupId: 'group' },
  ])
  await renderToolbar({ presentation: grouped, selected: ['group-shape', 'group-line'] })
  expect(document.querySelector('[data-selection-kind="group"] .mona-contextual-multi-controls')).not.toBeNull()
  expect(document.querySelector('.mona-contextual-shape-controls')).toBeNull()
  expect(document.querySelector('.mona-contextual-line-controls')).toBeNull()
})

test('keeps a drilled group child visibly and behaviorally distinct from its parent group', async () => {
  const grouped = makePresentation([
    shape('group-shape', { groupId: 'group' }),
    { ...elements.find(element => element.id === 'line')!, id: 'group-line', groupId: 'group' },
  ])
  await renderToolbar({
    activeGroupElementId: 'group-line',
    presentation: grouped,
    selected: ['group-shape', 'group-line'],
  })
  expect(document.querySelector('[data-selection-kind="group-child"] .mona-contextual-child-badge')).not.toBeNull()
  expect(document.querySelector('.mona-contextual-line-controls')).not.toBeNull()
})

test('intersects mixed controls, exposes mixed state, and never leaks a type-only control', async () => {
  const mixed = makePresentation([
    shape('shape-a', { fill: '#f00', opacity: 1 }),
    shape('shape-b', { fill: '#0f0', opacity: 0.5 }),
  ])
  await renderToolbar({ presentation: mixed, selected: ['shape-a', 'shape-b'] })
  expect(document.querySelector('[data-selection-kind="mixed"]')).not.toBeNull()
  expect(document.querySelector('[data-mixed="true"]')).not.toBeNull()
  expect(document.querySelector('.mona-contextual-image-controls')).toBeNull()
  expect(document.querySelector('.mona-contextual-text-controls')).toBeNull()
})

test('commits a contextual mutation as one undoable transaction', async () => {
  const runtime = await renderToolbar({ selected: ['shape'] })
  await page.getByRole('button', { name: 'Flip horizontally' }).click()
  expect(runtime.store.getState().presentation.slides[0]!.elements[1]).toMatchObject({ flipH: true })

  expect(runtime.undo()).toBe(true)
  expect((runtime.store.getState().presentation.slides[0]!.elements[1] as Extract<PPTElement, { type: 'shape' }>).flipH).toBeUndefined()
})

test('focuses and navigates the contextual toolbar from the keyboard', async () => {
  await renderToolbar({ selected: ['shape'] })
  document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 'F1' }))
  const toolbar = document.querySelector<HTMLElement>('[role="toolbar"]')!
  expect(toolbar.contains(document.activeElement)).toBe(true)
  const first = document.activeElement
  first?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
  expect(toolbar.contains(document.activeElement)).toBe(true)
  expect(document.activeElement).not.toBe(first)
})

test('updates image transforms on the selected image', async () => {
  const runtime = await renderToolbar({ selected: ['image'] })
  await page.getByRole('button', { name: 'Flip vertically' }).click()
  expect((runtime.store.getState().presentation.slides[0]!.elements[2] as Extract<PPTElement, { type: 'image' }>).flipV).toBe(true)
})

test('updates line direction on the selected line', async () => {
  const runtime = await renderToolbar({ selected: ['line'] })
  await page.getByRole('button', { name: 'Reverse direction' }).click()
  expect(runtime.store.getState().presentation.slides[0]!.elements[3]).toMatchObject({
    start: [100, 100],
    end: [0, 0],
  })
})

test('updates chart type from the contextual chart menu', async () => {
  const runtime = await renderToolbar({ selected: ['chart'] })
  await page.getByRole('button', { name: 'Type' }).click()
  await page.getByRole('button', { name: 'Line chart' }).click()
  expect(runtime.store.getState().presentation.slides[0]!.elements[4]).toMatchObject({ chartType: 'line' })
})

test('updates the selected table structure from the contextual table menu', async () => {
  const runtime = await renderToolbar({ selected: ['table'] })
  await page.getByRole('button', { name: 'Add' }).click()
  await page.getByRole('button', { name: 'Insert row below' }).click()
  const table = runtime.store.getState().presentation.slides[0]!.elements[5] as Extract<PPTElement, { type: 'table' }>
  expect(table.data).toHaveLength(2)
})

test('updates media playback behavior on the selected media element', async () => {
  const runtime = await renderToolbar({ selected: ['media'] })
  await page.getByRole('button', { name: /Autoplay/ }).click()
  expect(runtime.store.getState().presentation.slides[0]!.elements[7]).toMatchObject({ autoplay: true })
})

test('updates the explicit page target rather than an implicit empty selection', async () => {
  const runtime = await renderToolbar({ pageSelected: true })
  await page.getByRole('button', { name: 'Page background' }).click()
  await page.getByRole('button', { name: 'Select color #ff1e02' }).click()
  expect(runtime.store.getState().presentation.slides[0]).toMatchObject({
    background: { type: 'solid', color: '#ff1e02' },
  })
})
