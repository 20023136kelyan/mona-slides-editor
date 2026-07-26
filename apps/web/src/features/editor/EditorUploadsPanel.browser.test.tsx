import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import { EditorPanelSearchProvider } from '@/features/editor/panel/editor-panel-search'
import { PanelSearchBar } from '@/features/editor/panel/EditorPanelPrimitives'

import { EditorUploadsPanel } from '@/features/editor/EditorUploadsPanel'
import { mediaLibraryDatabase } from '@/features/editor/editor-media-library'
import { EditorApplicationProvider } from '@/features/editor/services/EditorApplicationProvider'
import type { EditorApplication } from '@/features/editor/services/editor-application'
import { createEditorNotificationService } from '@/features/editor/services/editor-notifications'
import { initializeI18n, setLocale } from '@/i18n'

/**
 * Answers the next open dialog with one file, then clicks Upload files.
 *
 * The panel used to be driven by reaching for its hidden `<input type="file">`
 * and forging a change event. There is no input now — the button asks the shell
 * for files — so the stand-in is the shell's answer, which is both closer to
 * what happens and the only part of it a test can legitimately decide.
 */
const uploadOneFile = async (name: string) => {
  const pngBytes = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
    char => char.charCodeAt(0),
  )
  window.mona!.files.open = async () => [{
    bytes: pngBytes.buffer.slice(0) as ArrayBuffer,
    mediaType: 'image/png',
    name,
  }]
  await page.getByRole('button', { name: 'Upload files' }).click()
}


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

beforeAll(async () => {
  await initializeI18n()
})

beforeEach(async () => {
  await setLocale('en-US')
  await mediaLibraryDatabase.items.clear()
})

afterEach(async () => {
  await mediaLibraryDatabase.items.clear()
})

test('keeps record funnel and library insert inside the uploads panel', async () => {
  const onInsertAudio = vi.fn<(payload: { ext?: string; src: string }) => void>()
  const onInsertImageSource = vi.fn<(src: string) => void>()
  const onInsertVideo = vi.fn<(payload: { ext?: string; src: string }) => void>()

  const screen = await render(
    <div style={{ height: 520, width: 288 }}>
      <EditorApplicationProvider value={application}>
        <EditorPanelSearchProvider route="uploads">
          <PanelSearchBar label="Search" placeholder="Search uploads" />
          <EditorUploadsPanel
            onInsertAudio={onInsertAudio}
            onInsertImageSource={onInsertImageSource}
            onInsertVideo={onInsertVideo}
          />
        </EditorPanelSearchProvider>
      </EditorApplicationProvider>
    </div>,
  )

  await expect.element(page.getByRole('button', { name: 'Upload files' })).toBeVisible()
  await expect.element(page.getByText('Upload images, video, or audio to build your media library.')).toBeVisible()

  await page.getByRole('button', { name: 'Record yourself' }).click()
  await expect.element(page.getByRole('button', { name: 'Record a talking head' })).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Record your screen' })).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Generate an AI voiceover' })).toBeVisible()
  expect(document.querySelector('[role="dialog"]')).toBeNull()

  await page.getByRole('button', { name: 'Record a talking head' }).click()
  await expect.element(page.getByRole('status')).toHaveTextContent('Recording tools are coming soon')

  await page.getByRole('button', { name: 'Back to uploads' }).click()
  await expect.element(page.getByRole('button', { name: 'Upload files' })).toBeVisible()

  await uploadOneFile('panel-hero.png')

  await expect.poll(() => mediaLibraryDatabase.items.count()).toBe(1)
  await expect.element(page.getByRole('button', { name: 'Insert panel-hero.png' })).toBeVisible()
  await page.getByRole('button', { name: 'Insert panel-hero.png' }).click()

  await expect.poll(() => onInsertImageSource.mock.calls.length).toBe(1)
  expect(onInsertImageSource.mock.calls[0]![0]).toMatch(/^blob:/)
  expect(onInsertAudio).not.toHaveBeenCalled()
  expect(onInsertVideo).not.toHaveBeenCalled()
  expect(document.querySelector('[role="dialog"]')).toBeNull()

  screen.unmount()
})
