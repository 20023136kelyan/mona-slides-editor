import { useMemo, useState } from 'react'
import { beforeAll, beforeEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import { editorActions } from '@mona/editor-state'
import type { PresentationState } from '@mona/presentation-core'

import { EditorDeck } from '@/features/editor/EditorDeck'
import { createEditorRuntime } from '@/features/editor/editor-runtime'
import {
  EditorApplicationProvider,
} from '@/features/editor/services/EditorApplicationProvider'
import type { EditorApplication } from '@/features/editor/services/editor-application'
import { createEditorNotificationService } from '@/features/editor/services/editor-notifications'
import { initializeI18n, setLocale } from '@/i18n'

beforeAll(async () => {
  await initializeI18n()
})

beforeEach(async () => {
  await setLocale('en-US')
})

const presentation: PresentationState = {
  title: 'Interaction fixture',
  slides: [{
    id: 'slide-1',
    elements: [{
      id: 'shape-1',
      type: 'shape',
      left: 100,
      top: 100,
      width: 200,
      height: 120,
      rotate: 0,
      fixedRatio: false,
      viewBox: [200, 120],
      path: 'M0 0 H200 V120 H0 Z',
      fill: '#d14424',
    }],
  }],
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
}

const textPresentation: PresentationState = {
  ...presentation,
  slides: [{
    id: 'slide-1',
    elements: [{
      id: 'text-1',
      type: 'text',
      content: '<p>Contextual editing</p>',
      defaultFontName: 'Arial',
      defaultColor: '#222222',
      left: 100,
      top: 100,
      width: 400,
      height: 100,
      rotate: 0,
    }],
  }],
}

const templatePresentation: PresentationState = {
  ...presentation,
  templates: [
    { id: 'template_1', name: 'Crimson Landscape', cover: '/imgs/template_1.webp' },
    { id: 'template_2', name: 'Urban Blue', cover: '/imgs/template_2.webp' },
  ],
}

const pageWorkflowPresentation: PresentationState = {
  ...presentation,
  slides: [
    { ...presentation.slides[0]!, id: 'page-1', title: 'Opening' },
    {
      id: 'page-2',
      elements: [],
      title: 'Plan',
      remark: '<p>Speaker note two</p>',
      notes: [{ id: 'page-2-comment', content: 'Review the plan.', time: 1_700_000_000_000, user: 'Reviewer' }],
    },
    { id: 'page-3', elements: [], title: 'Closing' },
  ],
}

const testApplication: EditorApplication = {
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

const TestEditorDeck = (props: Parameters<typeof EditorDeck>[0]) => (
  <EditorApplicationProvider value={testApplication}>
    <EditorDeck {...props} />
  </EditorApplicationProvider>
)

const StatefulTestEditorDeck = (props: Parameters<typeof EditorDeck>[0]) => {
  const [agentOpen, setAgentOpen] = useState(false)
  const application = useMemo<EditorApplication>(() => ({
    ...testApplication,
    agentOpen,
    closeAgent: () => setAgentOpen(false),
    openAgent: () => setAgentOpen(true),
  }), [agentOpen])
  return (
    <EditorApplicationProvider value={application}>
      <EditorDeck {...props} />
    </EditorApplicationProvider>
  )
}

test('selects rendered elements and exposes transform handles without replacing the renderer', async () => {
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={presentation} /></div>)

  await page.getByRole('button', { name: 'Select shape shape-1' }).click()
  expect(document.querySelector('[aria-label="1 selected element"]')).not.toBeNull()
  await expect.element(page.getByRole('button', { name: 'Resize bottom-right' })).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Rotate selection' })).toBeVisible()
  expect(document.querySelectorAll('[data-element-type="shape"]')).toHaveLength(2)
})

test('activates creation tools from the focused canvas keyboard surface', async () => {
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={presentation} /></div>)
  const canvas = document.querySelector<HTMLElement>('[aria-label="Editable slide canvas"]')!
  await page.getByRole('application', { name: 'Editable slide canvas' }).click({ position: { x: 20, y: 20 } })
  canvas.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'r' }))
  await expect.element(page.getByRole('application', { name: 'Editable slide canvas' })).toHaveAttribute('data-active-tool', 'shape')
  await expect.element(page.getByText('shape creation tool active')).toBeInTheDocument()
})

test('keeps the editor drawer closed until the user requests a task or contextual panel', async () => {
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={presentation} /></div>)

  expect(document.querySelector('.mona-editor-drawer')).toBeNull()

  await page.getByTestId('mona-editor-surface').getByRole('button', { name: 'Templates' }).click()
  expect(document.querySelector('.mona-editor-drawer')).not.toBeNull()
  await expect.element(page.getByText('Background fill')).toBeVisible()

  // The border pill is the single collapse affordance (panels have no X).
  await page.getByRole('button', { name: 'Collapse panel' }).click()
  expect(document.querySelector('.mona-editor-drawer')).toBeNull()
})

test('toggles creation panels from the persistent rail', async () => {
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={presentation} /></div>)
  const design = page.getByRole('navigation', { name: 'Editor tools' }).getByRole('button', { name: 'Templates' })

  await design.click()
  expect(document.querySelector('.mona-editor-drawer')).not.toBeNull()
  await expect.element(design).toHaveAttribute('aria-pressed', 'true')

  await design.click()
  expect(document.querySelector('.mona-editor-drawer')).toBeNull()
  await expect.element(design).toHaveAttribute('aria-pressed', 'false')
})

test('changes the contextual controls on selection without forcing the inspector open', async () => {
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={presentation} /></div>)

  await page.getByRole('button', { name: 'Select shape shape-1' }).click()
  expect(document.querySelector('.mona-editor-drawer')).toBeNull()
  await expect.element(page.getByRole('button', { name: 'Position' })).toBeVisible()

  await page.getByRole('button', { name: 'Position' }).click()
  expect(document.querySelector('.mona-editor-drawer')).not.toBeNull()
  await expect.element(page.getByText('Bring to front')).toBeVisible()

  await page.getByRole('tab', { name: 'Layers' }).click()
  await expect.element(page.getByRole('button', { name: 'Show all' })).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Hide all' })).toBeVisible()
  const selectLayer = page.getByRole('button', { name: 'Select Shape', exact: true })
  expect(document.querySelector('[aria-label="Select Shape"]')?.tagName).toBe('BUTTON')
  await selectLayer.click()
  await expect.element(selectLayer).toHaveAttribute('aria-pressed', 'true')
  await expect.element(page.getByRole('button', { name: 'Move forward', exact: true })).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Move backward', exact: true })).toBeVisible()
})

test('keeps the semantic layers task panel operable while hiding and revealing elements', async () => {
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={presentation} /></div>)

  await page.getByRole('button', { name: 'View', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Selection pane' }).click()
  const selectLayer = page.getByRole('button', { name: 'Select Shape', exact: true })
  await expect.element(selectLayer).toBeVisible()
  expect(document.querySelector('[aria-label="Select Shape"]')?.tagName).toBe('BUTTON')
  await selectLayer.click()
  await expect.element(selectLayer).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Hide Shape', exact: true }).click()
  await expect.element(page.getByRole('button', { name: 'Show Shape', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Show Shape', exact: true }).click()
  await expect.element(page.getByRole('button', { name: 'Hide Shape', exact: true })).toBeVisible()
})

test('renames layers with F2 and restores focus on cancel and commit', async () => {
  const runtime = createEditorRuntime(presentation)
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={presentation} runtime={runtime} /></div>)
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Selection pane' }).click()

  const selectLayer = page.getByRole('button', { name: 'Select Shape', exact: true })
  await selectLayer.click({ clickCount: 2 })
  const rename = page.getByRole('textbox', { name: 'Rename Shape' })
  await rename.fill('Discarded name')
  document.querySelector<HTMLInputElement>('.mona-selection-item input')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }))
  await new Promise(resolve => requestAnimationFrame(resolve))
  expect(runtime.store.getState().presentation.slides[0]!.elements[0]!.name).toBeUndefined()
  expect(document.activeElement).toBe(document.querySelector('.mona-selection-select'))

  await page.getByRole('button', { name: 'Select Shape', exact: true }).click({ clickCount: 2 })
  await page.getByRole('textbox', { name: 'Rename Shape' }).fill('Hero block')
  document.querySelector<HTMLInputElement>('.mona-selection-item input')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }))
  await new Promise(resolve => requestAnimationFrame(resolve))
  expect(runtime.store.getState().presentation.slides[0]!.elements[0]!.name).toBe('Hero block')
  expect(document.activeElement?.textContent).toBe('Hero block')
})

test('does not reopen a dismissed creation panel when the canvas selection later clears', async () => {
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={presentation} /></div>)

  await page.getByRole('navigation', { name: 'Editor tools' }).getByRole('button', { name: 'Templates' }).click()
  await page.getByRole('button', { name: 'Select shape shape-1' }).click()
  expect(document.querySelector('.mona-editor-drawer')).toBeNull()

  await page.getByRole('application', { name: 'Editable slide canvas' }).click({ position: { x: 20, y: 20 } })
  expect(document.querySelector('.mona-editor-drawer')).toBeNull()
})

test('runs real element edits from the contextual toolbar', async () => {
  const runtime = createEditorRuntime(presentation)
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={presentation} runtime={runtime} /></div>)

  await page.getByRole('button', { name: 'Select shape shape-1' }).click()
  await expect.element(page.getByRole('button', { name: 'Shape fill color' })).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Border' })).toBeVisible()

  await page.getByRole('button', { name: 'Shape fill color' }).click()
  await page.getByRole('button', { name: 'Select color #ff1e02' }).click()

  const shape = runtime.store.getState().presentation.slides[0]!.elements[0]
  expect(shape).toMatchObject({ id: 'shape-1', fill: '#ff1e02' })
})

test('exposes the real rich-text controls in the top toolbar', async () => {
  const runtime = createEditorRuntime(textPresentation)
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={textPresentation} runtime={runtime} /></div>)

  await page.getByText('Contextual editing').first().click()
  await expect.element(page.getByRole('button', { exact: true, name: 'Font' })).toBeVisible()
  await expect.element(page.getByRole('button', { exact: true, name: 'Font size' })).toBeVisible()
  const bold = page.getByRole('button', { name: 'Bold' })
  await expect.element(bold).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Align left' })).toBeVisible()

  await bold.click()
  await expect.element(bold).toHaveAttribute('aria-pressed', 'true')
})

test('routes creation, comments, search, layers, and speaker notes through one exclusive task panel', async () => {
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={presentation} /></div>)
  const rail = page.getByRole('navigation', { name: 'Editor tools' })

  // Task panels render no visible title or close control; the drawer itself
  // is named after the open panel via its aria-label.
  await rail.getByRole('button', { name: 'Elements' }).click()
  await expect.element(page.getByRole('complementary', { name: 'Elements' })).toBeVisible()
  expect(document.querySelectorAll('.mona-element-category-tabs button')).toHaveLength(6)

  await rail.getByRole('button', { name: 'Text' }).click()
  await expect.element(page.getByRole('complementary', { name: 'Text' })).toBeVisible()
  expect(document.querySelectorAll('.mona-editor-drawer')).toHaveLength(1)

  await page.getByRole('button', { name: 'Comments' }).click()
  await expect.element(page.getByRole('complementary', { name: 'Comments on slide 1' })).toBeVisible()
  expect(document.querySelectorAll('.mona-editor-drawer')).toHaveLength(1)

  document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 'f' }))
  await expect.element(page.getByRole('complementary', { name: 'Find and replace' })).toBeVisible()

  await page.getByRole('button', { name: 'View', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Selection pane' }).click()
  await expect.element(page.getByRole('complementary', { name: 'Layers (0/1)' })).toBeVisible()

  await page.getByRole('button', { name: 'Notes' }).click()
  await expect.element(page.getByRole('complementary', { name: 'Speaker notes' })).toBeVisible()
  expect(document.querySelectorAll('.mona-editor-drawer')).toHaveLength(1)
})

test('offers a keyboard skip path from the header to the editable canvas', async () => {
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={presentation} /></div>)
  const skip = page.getByRole('link', { name: 'Skip to slide canvas' })
  const skipElement = document.querySelector<HTMLAnchorElement>('a[href="#mona-editor-canvas"]')
  expect(skipElement).not.toBeNull()
  skipElement!.focus()
  await expect.element(skip).toBeVisible()
  await skip.click()
  expect(document.activeElement?.id).toBe('mona-editor-canvas')
})

test('records local comments in complete history and exposes undo immediately', async () => {
  const runtime = createEditorRuntime(presentation)
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={presentation} runtime={runtime} /></div>)

  await page.getByRole('button', { name: 'Comments' }).click()
  await page.getByPlaceholder('Add a comment for the current slide').fill('Undoable review note')
  await page.getByRole('button', { name: 'Add comment' }).click()

  expect(runtime.store.getState().presentation.slides[0]!.notes).toMatchObject([{
    content: 'Undoable review note',
    user: 'You',
  }])
  const undo = page.getByRole('button', { exact: true, name: 'Undo (Ctrl + Z)' })
  await expect.element(undo).toBeEnabled()

  await undo.click()
  expect(runtime.store.getState().presentation.slides[0]!.notes ?? []).toEqual([])
  await expect.element(page.getByText('No comments on this slide')).toBeVisible()
})

test('filters template catalogs in place instead of exposing a decorative search control', async () => {
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={templatePresentation} /></div>)

  await page.getByRole('navigation', { name: 'Editor tools' }).getByRole('button', { name: 'Templates' }).click()
  const search = page.getByRole('searchbox', { name: 'Describe your ideal design' })
  await expect.element(page.getByRole('button', { name: 'Crimson Landscape' })).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Urban Blue' })).toBeVisible()

  await search.fill('urban')
  await expect.element(page.getByRole('button', { name: 'Urban Blue' })).toBeVisible()
  expect(document.querySelector('[aria-label="Crimson Landscape"]')).toBeNull()

  await search.fill('no matching design')
  await expect.element(page.getByText('No templates match your search.')).toBeVisible()
})

test('keeps the uploads record funnel inside the panel without modals', async () => {
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={presentation} /></div>)

  await page.getByRole('navigation', { name: 'Editor tools' }).getByRole('button', { name: 'Uploads' }).click()
  await expect.element(page.getByRole('button', { name: 'Upload files' })).toBeVisible()
  await page.getByRole('button', { name: 'Record yourself' }).click()

  await expect.element(page.getByRole('button', { name: 'Record a talking head' })).toBeVisible()
  expect(document.querySelector('.mona-uploads-panel')?.closest('.mona-editor-drawer')).not.toBeNull()
  expect(document.querySelector('[role="dialog"]')).toBeNull()

  await page.getByRole('button', { name: 'Back to uploads' }).click()
  await expect.element(page.getByRole('button', { name: 'Upload files' })).toBeVisible()
})

test('inserts library media as an undoable native element from Uploads', async () => {
  const runtime = createEditorRuntime(presentation)
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={presentation} runtime={runtime} /></div>)

  await page.getByRole('navigation', { name: 'Editor tools' }).getByRole('button', { name: 'Uploads' }).click()
  const input = document.querySelector<HTMLInputElement>('.mona-uploads-file-input')!
  const pngBytes = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
    char => char.charCodeAt(0),
  )
  const file = new File([pngBytes], 'deck-hero.png', { type: 'image/png' })
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  input.dispatchEvent(new Event('change', { bubbles: true }))

  await expect.element(page.getByRole('button', { name: 'Insert deck-hero.png' })).toBeVisible()
  await page.getByRole('button', { name: 'Insert deck-hero.png' }).click()

  await expect.poll(() => runtime.store.getState().presentation.slides[0]!.elements.at(-1)?.type).toBe('image')
  expect(runtime.store.getState().presentation.slides[0]!.elements.at(-1)).toMatchObject({
    type: 'image',
    src: expect.stringMatching(/^data:image\/png;base64,/),
  })
  expect(runtime.undo()).toBe(true)
  expect(runtime.store.getState().presentation.slides[0]!.elements).toHaveLength(1)
})

test('restores focus to the invoking control when a task panel closes', async () => {
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={presentation} /></div>)
  const design = page.getByRole('navigation', { name: 'Editor tools' }).getByRole('button', { name: 'Templates' })

  await design.click()
  await page.getByRole('button', { name: 'Collapse panel' }).click()
  await new Promise(resolve => requestAnimationFrame(resolve))

  expect(document.activeElement).toBe(document.querySelector('[data-task-panel-route="design"]'))
})

test('opens AI as a structural dock and collapses the left panel on a compact viewport', async () => {
  await render(<div style={{ height: 700, width: 1200 }}><StatefulTestEditorDeck presentation={presentation} /></div>)
  const stage = document.querySelector<HTMLElement>('.mona-editor-stage')!
  const initialWidth = stage.getBoundingClientRect().width

  await page.getByRole('button', { name: 'Generate presentation with AI' }).click()
  await expect.element(page.getByRole('complementary', { name: 'Mona AI' })).toBeVisible()
  expect(document.querySelector('.mona-agent-dialog')).toBeNull()
  // The dock is a real sidebar column, so opening it pushes the canvas.
  expect(stage.getBoundingClientRect().width).toBeLessThan(initialWidth)

  await page.getByRole('navigation', { name: 'Editor tools' }).getByRole('button', { name: 'Elements' }).click()
  await expect.element(page.getByRole('complementary', { name: 'Mona AI' })).toBeVisible()
  expect(document.querySelectorAll('.mona-editor-drawer')).toHaveLength(1)
  expect(getComputedStyle(document.querySelector<HTMLElement>('.mona-drawer-region')!).display).toBe('none')

  await page.getByRole('complementary', { name: 'Mona AI' }).getByRole('button', { name: 'Close' }).click()
  expect(document.querySelector('.mona-agent-dock')).toBeNull()
})

test('toggles the page strip and navigates with a bounded direct page input', async () => {
  const runtime = createEditorRuntime(pageWorkflowPresentation)
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={pageWorkflowPresentation} runtime={runtime} /></div>)

  const pages = page.getByRole('button', { name: 'Pages' })
  await pages.click()
  expect(document.querySelector('[aria-label="Slides"]')).toBeNull()
  await pages.click()
  await expect.element(page.getByRole('region', { name: 'Slides' })).toBeVisible()

  const input = page.getByRole('spinbutton', { name: 'Go to page' })
  await input.fill('99')
  await page.getByRole('button', { name: 'Fit to screen' }).click()
  expect(runtime.store.getState().presentation.slideIndex).toBe(2)
  await expect.element(input).toHaveValue(3)

  await input.fill('')
  await page.getByRole('button', { name: 'Fit to screen' }).click()
  expect(runtime.store.getState().presentation.slideIndex).toBe(2)
  await expect.element(input).toHaveValue(3)

  await input.fill('0')
  await page.getByRole('button', { name: 'Fit to screen' }).click()
  expect(runtime.store.getState().presentation.slideIndex).toBe(0)
  await expect.element(input).toHaveValue(1)
})

test('offers a real fill-workspace zoom mode alongside fit and continuous zoom', async () => {
  const runtime = createEditorRuntime(pageWorkflowPresentation)
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={pageWorkflowPresentation} runtime={runtime} /></div>)
  await new Promise(resolve => requestAnimationFrame(resolve))

  document.querySelector<HTMLButtonElement>('.mona-canvas-zoom-text')!.click()
  const fill = page.getByRole('button', { name: 'Fill workspace' })
  await expect.element(fill).toBeVisible()
  Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Fill workspace')!.click()
  await new Promise(resolve => requestAnimationFrame(resolve))
  expect(runtime.store.getState().session.canvasZoom).toBeGreaterThan(90)
  expect(runtime.store.getState().session.canvasPan).toEqual({ x: 0, y: 0 })
})

test('supports keyboard navigation and range selection in page grid', async () => {
  const runtime = createEditorRuntime(pageWorkflowPresentation)
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={pageWorkflowPresentation} runtime={runtime} /></div>)

  await page.getByRole('button', { name: 'Grid view' }).click()
  const gridCards = () => Array.from(document.querySelectorAll<HTMLElement>('.mona-page-grid-item'))
  await new Promise(resolve => requestAnimationFrame(resolve))
  expect(document.activeElement).toBe(gridCards()[0])
  gridCards()[0]!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
  await new Promise(resolve => requestAnimationFrame(resolve))
  expect(runtime.store.getState().presentation.slideIndex).toBe(1)

  gridCards()[1]!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight', shiftKey: true }))
  await new Promise(resolve => requestAnimationFrame(resolve))
  expect(runtime.store.getState().presentation.slideIndex).toBe(2)
  await expect.element(page.getByText('2 pages selected')).toBeVisible()

  gridCards()[2]!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Home' }))
  await new Promise(resolve => requestAnimationFrame(resolve))
  expect(runtime.store.getState().presentation.slideIndex).toBe(0)
  await expect.element(page.getByText('1 page selected')).toBeVisible()
})

test('supports keyboard selection, range selection, and reordering in the filmstrip', async () => {
  const runtime = createEditorRuntime(pageWorkflowPresentation)
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={pageWorkflowPresentation} runtime={runtime} /></div>)

  const filmstripPages = () => Array.from(document.querySelectorAll<HTMLElement>('.mona-thumbnail-item'))
  filmstripPages()[0]!.focus()
  filmstripPages()[0]!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
  await new Promise(resolve => requestAnimationFrame(resolve))
  expect(runtime.store.getState().presentation.slideIndex).toBe(1)
  expect(document.activeElement).toBe(filmstripPages()[1])

  filmstripPages()[1]!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight', shiftKey: true }))
  await new Promise(resolve => requestAnimationFrame(resolve))
  expect(runtime.store.getState().session.selectedSlideIndexes).toEqual([1, 2])

  runtime.store.dispatch(editorActions.selectedSlideIndexesChanged([]))
  runtime.focusSlide(0)
  filmstripPages()[0]!.focus()
  filmstripPages()[0]!.dispatchEvent(new KeyboardEvent('keydown', { altKey: true, bubbles: true, key: 'End' }))
  await new Promise(resolve => requestAnimationFrame(resolve))
  expect(runtime.store.getState().presentation.slides.map(slide => slide.title)).toEqual([
    'Plan', 'Closing', 'Opening',
  ])
  await expect.element(page.getByText('Moved Opening to position 3 of 3')).toBeVisible()
  expect(runtime.canUndo()).toBe(true)
})

test('manages keyboard focus inside the filmstrip context menu', async () => {
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={pageWorkflowPresentation} /></div>)
  const first = document.querySelector<HTMLElement>('.mona-thumbnail-item')!
  first.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2, clientX: 100, clientY: 100 }))
  await expect.element(page.getByRole('menu', { name: 'Slide menu' })).toBeVisible()
  await new Promise(resolve => requestAnimationFrame(resolve))
  expect(document.activeElement?.getAttribute('role')).toBe('menuitem')
  expect(document.activeElement?.textContent).toContain('Cut')

  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }))
  expect(document.activeElement?.textContent).toContain('Copy')
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
  await new Promise(resolve => requestAnimationFrame(resolve))
  expect(document.querySelector('[role="menu"][aria-label="Slide menu"]')).toBeNull()
  expect(document.activeElement).toBe(first)
})

test('edits section titles and opens section actions from the keyboard', async () => {
  const sectionPresentation: PresentationState = {
    ...pageWorkflowPresentation,
    slides: pageWorkflowPresentation.slides.map((slide, index) => (
      index === 0 ? { ...slide, sectionTag: { id: 'section-opening', title: 'Opening section' } } : slide
    )),
  }
  const runtime = createEditorRuntime(sectionPresentation)
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={sectionPresentation} runtime={runtime} /></div>)

  const sectionButton = document.querySelector<HTMLButtonElement>('.mona-section-title-text')!
  sectionButton.focus()
  sectionButton.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'F2' }))
  const sectionInput = page.getByRole('textbox', { name: 'Enter section name' })
  await expect.element(sectionInput).toBeVisible()
  await sectionInput.fill('Strategy')
  document.querySelector<HTMLInputElement>('.mona-section-title input')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
  await expect.element(page.getByRole('button', { name: 'Edit section Strategy' })).toBeVisible()
  expect(runtime.store.getState().presentation.slides[0]!.sectionTag?.title).toBe('Strategy')

  const renamedSection = document.querySelector<HTMLButtonElement>('.mona-section-title-text')!
  renamedSection.focus()
  renamedSection.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'F10', shiftKey: true }))
  await expect.element(page.getByRole('menu', { name: 'Section menu' })).toBeVisible()
  await expect.element(page.getByRole('menuitem', { name: 'Rename section' })).toBeVisible()
})

test('opens a filmstrip note badge for the slide that owns the note', async () => {
  const runtime = createEditorRuntime(pageWorkflowPresentation)
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={pageWorkflowPresentation} runtime={runtime} /></div>)

  expect(runtime.store.getState().presentation.slideIndex).toBe(0)
  const noteButton = page.getByRole('button', { name: 'Open speaker notes: Show slide 2, Plan' })
  await expect.element(noteButton).toBeVisible()
  await noteButton.click()

  expect(runtime.store.getState().presentation.slideIndex).toBe(1)
  await expect.element(page.getByRole('complementary', { name: 'Speaker notes' })).toBeVisible()
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Open speaker notes: Show slide 2, Plan')
})

test('reorders pages from the grid with a keyboard operation available alongside drag', async () => {
  const runtime = createEditorRuntime(pageWorkflowPresentation)
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={pageWorkflowPresentation} runtime={runtime} /></div>)

  await page.getByRole('button', { name: 'Grid view' }).click()
  const first = document.querySelector<HTMLElement>('.mona-page-grid-item')!
  first.focus()
  first.dispatchEvent(new KeyboardEvent('keydown', { altKey: true, bubbles: true, key: 'End' }))
  await new Promise(resolve => requestAnimationFrame(resolve))

  expect(runtime.store.getState().presentation.slides.map(slide => slide.title)).toEqual([
    'Plan', 'Closing', 'Opening',
  ])
  expect(runtime.store.getState().presentation.slideIndex).toBe(2)
  await expect.element(page.getByText('Moved Opening to position 3 of 3')).toBeVisible()
})

test('supports multi-select, duplicate, delete, and return-to-canvas in page grid', async () => {
  const runtime = createEditorRuntime(pageWorkflowPresentation)
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={pageWorkflowPresentation} runtime={runtime} /></div>)

  await page.getByRole('button', { name: 'Grid view' }).click()
  await expect.element(page.getByRole('region', { name: 'Grid view' })).toBeVisible()
  await page.getByRole('option', { name: /Show slide 2/ }).click({ modifiers: ['Control'] })
  await expect.element(page.getByText('2 pages selected')).toBeVisible()

  await page.getByRole('button', { name: 'Duplicate slide' }).click()
  expect(runtime.store.getState().presentation.slides).toHaveLength(5)
  expect(runtime.store.getState().presentation.slides.map(slide => slide.title)).toEqual([
    'Opening', 'Plan', 'Opening', 'Plan', 'Closing',
  ])

  await page.getByRole('button', { name: 'Delete slide' }).click()
  expect(runtime.store.getState().presentation.slides).toHaveLength(3)

  await page.getByRole('button', { name: 'Close grid view' }).click()
  await expect.element(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
  await new Promise(resolve => requestAnimationFrame(resolve))
  expect(document.activeElement).toBe(document.querySelector('[data-grid-view-trigger]'))
})

test('edits page title, hidden state, duration, and transition through one page settings workflow', async () => {
  const runtime = createEditorRuntime(pageWorkflowPresentation)
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={pageWorkflowPresentation} runtime={runtime} /></div>)

  await page.getByRole('button', { name: 'Page settings' }).click()
  await page.getByRole('textbox', { name: 'Page title' }).fill('Executive opening')
  await page.getByRole('spinbutton', { name: 'Page duration' }).fill('5')
  await page.getByRole('switch', { name: 'Hide page' }).click()
  await page.getByRole('combobox', { name: 'Transition' }).click()
  await page.getByRole('option', { name: 'Fade' }).click()

  expect(runtime.store.getState().presentation.slides[0]).toMatchObject({
    title: 'Executive opening',
    hidden: true,
    durationMs: 5000,
    turningMode: 'fade',
  })
})

test('exposes explicit insertion and transition boundaries between pages', async () => {
  const runtime = createEditorRuntime(pageWorkflowPresentation)
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={pageWorkflowPresentation} runtime={runtime} /></div>)

  await page.getByRole('button', { name: 'Transition between page 1 and 2' }).click()
  expect(runtime.store.getState().presentation.slideIndex).toBe(1)
  await expect.element(page.getByText('Push vertically', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Collapse panel' }).click()
  await page.getByRole('button', { name: 'Insert page after page 1' }).click()
  expect(runtime.store.getState().presentation.slides).toHaveLength(4)
  expect(runtime.store.getState().presentation.slideIndex).toBe(1)
})

test('provides a working presentation timer with pause and reset', async () => {
  await render(<div style={{ height: 700, width: 1200 }}><TestEditorDeck presentation={pageWorkflowPresentation} /></div>)
  await page.getByRole('button', { name: 'Timer' }).click()
  expect(document.querySelector('.mona-editor-timer output')?.textContent).toBe('05:00')
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await new Promise(resolve => setTimeout(resolve, 1050))
  expect(document.querySelector('.mona-editor-timer output')?.textContent).toBe('04:59')

  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Subtract one minute' }).click()
  expect(document.querySelector('.mona-editor-timer output')?.textContent).toBe('03:59')
  await page.getByRole('button', { name: 'Add one minute' }).click()
  expect(document.querySelector('.mona-editor-timer output')?.textContent).toBe('04:59')
  await page.getByRole('button', { name: 'Reset' }).click()
  expect(document.querySelector('.mona-editor-timer output')?.textContent).toBe('05:00')
})
