import { beforeAll, beforeEach, expect, test } from 'vitest'
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

// 4x4 red PNG — the crop editor only needs a decodable source.
const IMAGE_SRC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC'

const presentation: PresentationState = {
  title: 'Crop fixture',
  slideIndex: 0,
  slides: [{
    id: 'slide-1',
    elements: [{
      id: 'image-1',
      type: 'image',
      src: IMAGE_SRC,
      left: 100,
      top: 100,
      width: 200,
      height: 200,
      rotate: 0,
      fixedRatio: false,
    }],
  }],
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
} as unknown as PresentationState

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

const settle = () => new Promise(resolve => setTimeout(resolve, 60))

/**
 * The crop lifecycle lives in useCanvasCropDraft, whose commit-on-outside-click
 * runs from a capture-phase document listener. Nothing covered it before, so a
 * regression there was invisible to the suite.
 */
test('entering crop mode renders the crop editor and clicking outside exits it', async () => {
  const runtime = createEditorRuntime(presentation)
  runtime.store.dispatch(editorActions.selectionChanged(['image-1']))
  await render(
    <div style={{ height: 700, width: 1200 }}>
      <EditorApplicationProvider value={testApplication}>
        <EditorDeck presentation={presentation} runtime={runtime} />
      </EditorApplicationProvider>
    </div>,
  )
  await settle()

  runtime.store.dispatch(editorActions.cropElementChanged('image-1'))
  await settle()
  expect(runtime.store.getState().session.cropElementId).toBe('image-1')
  expect(document.querySelector('.mona-image-crop-editor')).not.toBeNull()

  // Capture-phase pointerdown outside the crop editor commits and exits.
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  await settle()

  expect(runtime.store.getState().session.cropElementId).toBeNull()
  expect(document.querySelector('.mona-image-crop-editor')).toBeNull()
})
