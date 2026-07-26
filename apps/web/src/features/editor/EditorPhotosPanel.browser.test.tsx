import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import { EditorPanelSearchProvider } from '@/features/editor/panel/editor-panel-search'
import { PanelSearchBar } from '@/features/editor/panel/EditorPanelPrimitives'

import { EditorPhotosPanel } from '@/features/editor/EditorPhotosPanel'
import { onlinePhotosDatabase } from '@/features/editor/editor-photos-recent'
import { EditorApplicationProvider } from '@/features/editor/services/EditorApplicationProvider'
import type { EditorApplication } from '@/features/editor/services/editor-application'
import { createEditorNotificationService } from '@/features/editor/services/editor-notifications'
import { initializeI18n, setLocale } from '@/i18n'

const samplePhotos = [
  { id: 1, width: 800, height: 600, src: 'https://images.pexels.com/photos/1/a.jpeg' },
  { id: 2, width: 600, height: 900, src: 'https://images.pexels.com/photos/2/b.jpeg' },
  { id: 3, width: 1000, height: 700, src: 'https://images.pexels.com/photos/3/c.jpeg' },
]

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
  await onlinePhotosDatabase.recent.clear()
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as { query?: string } : {}
    const query = body.query || 'trending'
    return new Response(JSON.stringify({
      data: samplePhotos.map(photo => ({ ...photo, id: `${query}-${photo.id}` })),
      total: samplePhotos.length,
    }), { headers: { 'content-type': 'application/json' }, status: 200 })
  }))
})

afterEach(async () => {
  await onlinePhotosDatabase.recent.clear()
  vi.unstubAllGlobals()
})

test('keeps photos discovery and see-all navigation inside the panel', async () => {
  const onInsertImageSource = vi.fn<(src: string) => void>()
  await render(
    <div style={{ height: 640, width: 352 }}>
      <EditorApplicationProvider value={application}>
        <EditorPanelSearchProvider mode="submit" route="photos">
          <PanelSearchBar label="Search" placeholder="Search millions of photos" />
          <EditorPhotosPanel onInsertImageSource={onInsertImageSource} />
        </EditorPanelSearchProvider>
      </EditorApplicationProvider>
    </div>,
  )

  await expect.element(page.getByPlaceholder('Search millions of photos')).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Coffee' })).toBeVisible()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(page.getByText('Recently used').elements().length).toBe(0)

  await expect.poll(() => page.getByRole('heading', { name: 'Trending' }).elements().length).toBe(1)
  await page.getByRole('button', { name: 'See all' }).first().click()
  await expect.element(page.getByRole('heading', { name: 'Trending' })).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Back to photos' })).toBeVisible()
  expect(document.querySelector('.mona-photos-panel')).not.toBeNull()

  await page.getByRole('button', { name: 'Back to photos' }).click()
  await page.getByRole('button', { name: 'Coffee' }).click()
  await expect.element(page.getByRole('heading', { name: 'coffee' })).toBeVisible()

  await page.getByRole('button', { name: 'Insert photo' }).first().click()
  await expect.poll(() => onInsertImageSource.mock.calls.length).toBe(1)
  await expect.poll(() => onlinePhotosDatabase.recent.count()).toBe(1)
})
