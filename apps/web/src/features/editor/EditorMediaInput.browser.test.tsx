import { beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import { EditorMediaInput } from '@/features/editor/EditorMediaInput'
import { EditorApplicationProvider } from '@/features/editor/services/EditorApplicationProvider'
import type { EditorApplication } from '@/features/editor/services/editor-application'
import { createEditorNotificationService } from '@/features/editor/services/editor-notifications'
import { initializeI18n, setLocale } from '@/i18n'

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
})

test('creates blob-backed uploaded media for persistence and preserves its extension', async () => {
  const onInsertAudio = vi.fn<(payload: { ext?: string; src: string }) => void>()
  const onInsertVideo = vi.fn<(payload: { ext?: string; src: string }) => void>()
  await render(
    <EditorApplicationProvider value={application}>
      <EditorMediaInput onInsertAudio={onInsertAudio} onInsertVideo={onInsertVideo} />
    </EditorApplicationProvider>,
  )

  const input = document.querySelector<HTMLInputElement>('.mona-media-file-input')!
  const file = new File(['video fixture'], 'fixture.customvideo', { type: '' })
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  input.dispatchEvent(new Event('change', { bubbles: true }))

  await expect.poll(() => onInsertVideo.mock.calls.length).toBe(1)
  const payload = onInsertVideo.mock.calls[0]![0]
  expect(payload).toEqual({
    ext: 'customvideo',
    src: expect.stringMatching(/^blob:/),
  })
  expect(onInsertAudio).not.toHaveBeenCalled()
  URL.revokeObjectURL(payload.src)
  await expect.element(page.getByRole('button', { name: 'Upload video' })).toBeVisible()
})
