import { useState } from 'react'
import { beforeAll, beforeEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { useTranslation } from 'react-i18next'

import { editorActions } from '@mona/editor-state'
import type { PresentationState } from '@mona/presentation-core'

import { Button } from '@/components/ui/button'
import { useEditorImport } from '@/features/editor/editor-import'
import { createEditorRuntime, type EditorRuntime } from '@/features/editor/editor-runtime'
import { createEditorNotificationService } from '@/features/editor/services/editor-notifications'
import { initializeI18n, setLocale } from '@/i18n'

beforeAll(async () => {
  await initializeI18n()
})

beforeEach(async () => {
  await setLocale('en-US')
})

const presentation: PresentationState = {
  title: 'Existing title',
  slides: [{ id: 'empty-slide', elements: [] }],
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

const serializedFile = (title: string, slideId: string) => new File([JSON.stringify({
  height: 750,
  slides: [{ id: slideId, elements: [] }],
  theme: { backgroundColor: '#f0f0f0' },
  title,
  width: 1000,
})], `${slideId}.json`, { type: 'application/json' })

function ImportHarness({
  files,
  runtime,
}: {
  files: File[]
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const [status, setStatus] = useState('ready')
  const [notifications] = useState(createEditorNotificationService)
  const { importFiles, importing } = useEditorImport(runtime, t, notifications.notify)
  const run = async () => {
    setStatus('running')
    await Promise.all(files.map(file => importFiles({ files: [file], type: 'json' })))
    setStatus('complete')
  }
  return (
    <>
      <Button onClick={() => void run()} type="button">Run import</Button>
      <output>{importing ? 'importing' : status}</output>
      <output data-testid="notification">{notifications.getSnapshot().at(-1)?.text ?? ''}</output>
    </>
  )
}

test('replaces an empty deck atomically, restores its title, clears stale interaction state, and remains undoable', async () => {
  const runtime = createEditorRuntime(presentation)
  runtime.store.dispatch(editorActions.selectionChanged(['stale-element']))
  runtime.store.dispatch(editorActions.selectedSlideIndexesChanged([0]))
  runtime.store.dispatch(editorActions.hiddenElementsChanged(['stale-element']))
  runtime.store.dispatch(editorActions.cropElementChanged('stale-element'))
  runtime.store.dispatch(editorActions.activeToolChanged('shape'))
  runtime.store.dispatch(editorActions.creatingCustomShapeChanged(true))
  runtime.store.dispatch(editorActions.drawingModeChanged(true))

  await render(<ImportHarness files={[serializedFile('Imported title', 'imported-slide')]} runtime={runtime} />)
  await page.getByRole('button', { name: 'Run import' }).click()
  await expect.element(page.getByText('complete')).toBeVisible()

  const state = runtime.store.getState()
  expect(state.presentation.title).toBe('Imported title')
  expect(state.presentation.slides.map(slide => slide.id)).toEqual(['imported-slide'])
  expect(state.presentation.viewportRatio).toBe(0.75)
  expect(state.session.activeElementIds).toEqual([])
  expect(state.session.selectedSlideIndexes).toEqual([])
  expect(state.session.hiddenElementIds).toEqual([])
  expect(state.session.cropElementId).toBeNull()
  expect(state.session.activeTool).toBeNull()
  expect(state.session.creatingCustomShape).toBe(false)
  expect(state.session.drawingMode).toBe(false)

  expect(runtime.undo()).toBe(true)
  expect(runtime.store.getState().presentation.title).toBe('Existing title')
  expect(runtime.store.getState().presentation.slides.map(slide => slide.id)).toEqual(['empty-slide'])
})

test('serializes concurrent requests and preserves the deck when parsing fails', async () => {
  const runtime = createEditorRuntime(presentation)
  await render(
    <ImportHarness
      files={[
        serializedFile('First import wins', 'first-slide'),
        serializedFile('Overlapping import', 'second-slide'),
      ]}
      runtime={runtime}
    />,
  )
  await page.getByRole('button', { name: 'Run import' }).click()
  await expect.element(page.getByText('complete')).toBeVisible()
  expect(runtime.store.getState().presentation.title).toBe('First import wins')
  expect(runtime.store.getState().presentation.slides.map(slide => slide.id)).toEqual(['first-slide'])

  const failedRuntime = createEditorRuntime(presentation)
  await render(
    <ImportHarness
      files={[new File(['not valid JSON'], 'broken.json', { type: 'application/json' })]}
      runtime={failedRuntime}
    />,
  )
  const runButtons = page.getByRole('button', { name: 'Run import' })
  await runButtons.nth(1).click()
  await expect.element(page.getByText('This file could not be read or parsed')).toBeVisible()
  expect(failedRuntime.store.getState().presentation).toEqual(presentation)
})

test('appends to a populated deck without importing document metadata or leaving a stale selection', async () => {
  const populated: PresentationState = {
    ...presentation,
    slides: [{
      id: 'existing-slide',
      elements: [{
        id: 'existing-shape',
        type: 'shape',
        left: 20,
        top: 20,
        width: 120,
        height: 80,
        rotate: 0,
        fixedRatio: false,
        viewBox: [120, 80],
        path: 'M0 0 H120 V80 H0 Z',
        fill: '#222',
      }],
    }],
  }
  const runtime = createEditorRuntime(populated)
  runtime.store.dispatch(editorActions.selectionChanged(['existing-shape']))
  runtime.store.dispatch(editorActions.cropElementChanged('existing-shape'))
  await render(<ImportHarness files={[serializedFile('Ignored imported title', 'appended-slide')]} runtime={runtime} />)

  await page.getByRole('button', { name: 'Run import' }).click()
  await expect.element(page.getByText('complete')).toBeVisible()
  const state = runtime.store.getState()
  expect(state.presentation.title).toBe('Existing title')
  expect(state.presentation.viewportRatio).toBe(0.5625)
  expect(state.presentation.slides).toHaveLength(2)
  expect(state.presentation.slides[1]!.id).not.toBe('appended-slide')
  expect(state.presentation.slideIndex).toBe(1)
  expect(state.session.activeElementIds).toEqual([])
  expect(state.session.cropElementId).toBeNull()
  expect(state.session.pageSelected).toBe(true)

  expect(runtime.undo()).toBe(true)
  expect(runtime.store.getState().presentation.slides).toEqual(populated.slides)
})
