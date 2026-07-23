import { beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import type { PresentationState } from '@mona/presentation-core'

import {
  EditorExportDialog,
  type EditorExportActions,
} from '@/features/editor/EditorExportDialog'
import { createEditorRuntime } from '@/features/editor/editor-runtime'
import { initializeI18n, setLocale } from '@/i18n'

beforeAll(async () => {
  await initializeI18n()
})

beforeEach(async () => {
  await setLocale('en-US')
  await page.viewport(1100, 760)
})

const presentation: PresentationState = {
  title: 'Export fixture',
  slides: [
    { id: 'slide-1', elements: [] },
    { id: 'slide-2', elements: [] },
    { id: 'slide-3', elements: [] },
  ],
  slideIndex: 1,
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

const createActions = (): EditorExportActions => ({
  exportImage: vi.fn<EditorExportActions['exportImage']>(async () => {}),
  exportImagePptx: vi.fn<EditorExportActions['exportImagePptx']>(async () => {}),
  exportJson: vi.fn<EditorExportActions['exportJson']>(),
  exportNative: vi.fn<EditorExportActions['exportNative']>(),
  exportPptx: vi.fn<EditorExportActions['exportPptx']>(async () => {}),
  printPdf: vi.fn<EditorExportActions['printPdf']>(async () => {}),
})

test('exposes every export surface with specifically named controls', async () => {
  const runtime = createEditorRuntime(presentation)
  await render(
    <EditorExportDialog
      actions={createActions()}
      onClose={() => {}}
      openType="image"
      runtime={runtime}
    />,
  )

  await expect.element(page.getByRole('dialog', { name: 'Export' })).toBeVisible()
  for (const tab of ['Export Mona file', 'Export PPTX', 'Export images', 'Export JSON', 'Print / Export PDF']) {
    await expect.element(page.getByRole('tab', { name: tab })).toBeVisible()
  }
  await expect.element(page.getByRole('radiogroup', { name: 'Export range:' })).toBeVisible()
  await expect.element(page.getByRole('radiogroup', { name: 'Export format:' })).toBeVisible()
  await expect.element(page.getByRole('slider', { name: 'Image quality:' })).toBeVisible()
  await page.getByText('Custom', { exact: true }).click()
  await expect.element(page.getByRole('slider', { name: 'Custom range 1' })).toBeVisible()
  await expect.element(page.getByRole('slider', { name: 'Custom range 2' })).toBeVisible()
  await page.getByRole('tab', { name: 'Export PPTX' }).click()
  await expect.element(page.getByRole('radiogroup', { name: 'Export mode:' })).toBeVisible()
})

test('exports only the chosen current slide and blocks the dialog while an async export settles', async () => {
  const runtime = createEditorRuntime(presentation)
  let resolveExport!: () => void
  const actions = createActions()
  actions.exportPptx = vi.fn<EditorExportActions['exportPptx']>(() => new Promise<void>(resolve => {
    resolveExport = resolve
  }))
  await render(
    <EditorExportDialog
      actions={actions}
      onClose={() => {}}
      openType="pptx"
      runtime={runtime}
    />,
  )

  await page.getByText('Current slide', { exact: true }).click()
  await page.getByRole('button', { name: 'Export PPTX' }).click()
  await expect.element(page.getByText('Exporting...')).toBeVisible()
  expect(actions.exportPptx).toHaveBeenCalledWith([presentation.slides[1]], true, true)

  resolveExport()
  await expect.element(page.getByText('Exporting...')).not.toBeInTheDocument()
})
