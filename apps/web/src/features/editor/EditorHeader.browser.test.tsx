import { beforeAll, beforeEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import type { PresentationState } from '@mona/presentation-core'

import { EditorHeader } from '@/features/editor/EditorHeader'
import {
  type DeckPersistence,
  type DeckPersistenceSnapshot,
} from '@/features/editor/editor-persistence'
import { createEditorRuntime } from '@/features/editor/editor-runtime'
import { EditorApplicationProvider } from '@/features/editor/services/EditorApplicationProvider'
import type { EditorApplication } from '@/features/editor/services/editor-application'
import { createEditorNotificationService } from '@/features/editor/services/editor-notifications'
import { EditorShellProvider } from '@/features/editor/shell/EditorShellProvider'
import { initializeI18n, setLocale } from '@/i18n'

beforeAll(async () => {
  await initializeI18n()
})

beforeEach(async () => {
  await setLocale('en-US')
  await page.viewport(1357, 700)
})

const presentation: PresentationState = {
  title: 'Header fixture',
  slides: [{
    id: 'slide-1',
    elements: [{
      id: 'shape-1',
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

interface FakePersistence extends DeckPersistence {
  setSnapshot: (snapshot: DeckPersistenceSnapshot) => void
}

const createFakePersistence = (): FakePersistence => {
  let snapshot: DeckPersistenceSnapshot = {
    dirty: false,
    error: null,
    pendingSince: null,
    savedAt: null,
    status: 'idle',
  }
  const listeners = new Set<() => void>()
  return {
    flush: async () => {},
    getSnapshot: () => snapshot,
    isDirty: () => snapshot.dirty,
    retry: async () => {},
    setSnapshot: next => {
      snapshot = next
      for (const listener of listeners) listener()
    },
    stop: () => {},
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const createApplication = (persistence: DeckPersistence | null): EditorApplication => ({
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
  persistence,
  presenting: false,
  startPresentation: () => {},
  subscribeToPresentationStart: () => () => {},
})

test('keeps title geometry stable across focus, typing, cancel, commit, and undo', async () => {
  const runtime = createEditorRuntime(presentation)
  await render(
    <div style={{ width: 1357 }}>
      <EditorApplicationProvider value={createApplication(null)}>
        <EditorShellProvider>
          <EditorHeader runtime={runtime} />
        </EditorShellProvider>
      </EditorApplicationProvider>
    </div>,
  )
  const title = page.getByRole('textbox', { name: 'Presentation title' })
  const element = document.querySelector<HTMLInputElement>('.mona-editor-header-title-input')!
  const geometry = () => {
    const rect = element.getBoundingClientRect()
    return {
      height: rect.height,
      left: element.offsetLeft,
      top: element.offsetTop,
      width: rect.width,
    }
  }
  const resting = geometry()

  await title.click()
  expect(element.readOnly).toBe(false)
  expect(geometry()).toEqual(resting)
  await title.fill('Cancelled title')
  expect(geometry()).toEqual(resting)
  element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(element.value).toBe('Header fixture')
  expect(element.readOnly).toBe(true)
  expect(geometry()).toEqual(resting)

  await title.click()
  await title.fill('Committed title')
  element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(runtime.store.getState().presentation.title).toBe('Committed title')
  expect(geometry()).toEqual(resting)

  await new Promise(resolve => setTimeout(resolve, 320))
  expect(runtime.undo()).toBe(true)
  expect(runtime.store.getState().presentation.title).toBe('Header fixture')
  expect(geometry()).toEqual(resting)
})

test('drives save status from persistence and confirms a fully undoable new presentation', async () => {
  const runtime = createEditorRuntime(presentation)
  const persistence = createFakePersistence()
  let retryCount = 0
  persistence.retry = async () => {
    retryCount += 1
  }
  await render(
    <div style={{ width: 1357 }}>
      <EditorApplicationProvider value={createApplication(persistence)}>
        <EditorShellProvider>
          <EditorHeader runtime={runtime} />
        </EditorShellProvider>
      </EditorApplicationProvider>
    </div>,
  )

  await expect.element(page.getByRole('button', { name: 'Saved locally' })).toBeVisible()
  persistence.setSnapshot({
    dirty: true,
    error: null,
    pendingSince: Date.now(),
    savedAt: null,
    status: 'pending',
  })
  await expect.element(page.getByRole('button', { name: 'Changes pending' })).toBeVisible()
  persistence.setSnapshot({
    dirty: true,
    error: null,
    pendingSince: Date.now(),
    savedAt: null,
    status: 'saving',
  })
  await expect.element(page.getByRole('button', { name: 'Saving…' })).toBeVisible()
  persistence.setSnapshot({
    dirty: true,
    error: 'Storage unavailable',
    pendingSince: Date.now(),
    savedAt: null,
    status: 'error',
  })
  const saveFailed = page.getByRole('button', { name: 'Save failed' })
  await expect.element(saveFailed).toBeVisible()
  await saveFailed.click()
  await page.getByRole('button', { name: 'Retry save' }).click()
  expect(retryCount).toBe(1)

  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New presentation' }).click()
  await expect.element(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('button', { name: 'Create new' }).click()

  expect(runtime.store.getState().presentation.title).toBe('')
  expect(runtime.store.getState().presentation.slides).toHaveLength(1)
  expect(runtime.store.getState().presentation.slides[0]!.elements).toEqual([])
  await new Promise(resolve => setTimeout(resolve, 320))
  expect(runtime.undo()).toBe(true)
  expect(runtime.store.getState().presentation.title).toBe('Header fixture')
  expect(runtime.store.getState().presentation.slides[0]!.elements).toHaveLength(1)
})

test('keeps compact desktop header groups separate from the editable title', async () => {
  await page.viewport(600, 700)
  try {
    const runtime = createEditorRuntime(presentation)
    await render(
      <div style={{ width: '100%' }}>
        <EditorApplicationProvider value={createApplication(null)}>
          <EditorShellProvider>
            <EditorHeader runtime={runtime} />
          </EditorShellProvider>
        </EditorApplicationProvider>
      </div>,
    )

    const header = document.querySelector<HTMLElement>('.mona-editor-header')!
    const left = document.querySelector<HTMLElement>('.mona-editor-header-left')!.getBoundingClientRect()
    const center = document.querySelector<HTMLElement>('.mona-editor-header-center')!.getBoundingClientRect()
    const right = document.querySelector<HTMLElement>('.mona-editor-header-right')!.getBoundingClientRect()
    expect(left.right).toBeLessThanOrEqual(center.left)
    expect(center.right).toBeLessThanOrEqual(right.left)
    expect(center.width).toBeGreaterThan(40)
    expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth)

    const title = page.getByRole('textbox', { name: 'Presentation title' })
    await title.click()
    await title.fill('A compact title that must ellipsize safely')
    const focusedCenter = document.querySelector<HTMLElement>('.mona-editor-header-center')!.getBoundingClientRect()
    expect(document.querySelector<HTMLElement>('.mona-editor-header-left')!.getBoundingClientRect().right).toBeLessThanOrEqual(focusedCenter.left)
    expect(focusedCenter.right).toBeLessThanOrEqual(document.querySelector<HTMLElement>('.mona-editor-header-right')!.getBoundingClientRect().left)

    for (const name of ['File', 'View', 'Tools', 'Comments', 'Start slideshow (F5)', 'Generate presentation with AI', 'Export', 'Settings']) {
      await expect.element(page.getByRole('button', { name, exact: true })).toBeVisible()
    }
    for (const control of document.querySelectorAll<HTMLElement>('.mona-editor-header button')) {
      const rect = control.getBoundingClientRect()
      if (!rect.width || !rect.height) continue
      expect(rect.width).toBeGreaterThanOrEqual(40)
      expect(rect.height).toBeGreaterThanOrEqual(40)
    }
  }
  finally {
    await page.viewport(1357, 700)
  }
})

test('names header regions and supports roving focus across document menus', async () => {
  const runtime = createEditorRuntime(presentation)
  await render(
    <div style={{ width: 1357 }}>
      <EditorApplicationProvider value={createApplication(null)}>
        <EditorShellProvider>
          <EditorHeader runtime={runtime} />
        </EditorShellProvider>
      </EditorApplicationProvider>
    </div>,
  )

  await expect.element(page.getByRole('banner', { name: 'Presentation editor header' })).toBeVisible()
  await expect.element(page.getByRole('group', { name: 'Document controls' })).toBeVisible()
  await expect.element(page.getByRole('group', { name: 'Presentation controls' })).toBeVisible()

  const view = page.getByRole('button', { name: 'View', exact: true })
  const tools = page.getByRole('button', { name: 'Tools', exact: true })
  const fileElement = document.querySelector<HTMLButtonElement>('[data-header-menu-trigger]')
  expect(fileElement).not.toBeNull()
  fileElement!.focus()
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
  expect(document.activeElement?.textContent).toBe('View')
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' }))
  expect(document.activeElement?.textContent).toBe('Tools')
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Home' }))
  expect(document.activeElement?.textContent).toBe('File')
  await expect.element(view).toBeVisible()
  await expect.element(tools).toBeVisible()
})
