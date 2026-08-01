import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { PresentationState } from '@mona/presentation-core'

import {
  initDeckPersistence,
  restoreDocument,
  type DeckPersistenceStatus,
} from '@/features/editor/editor-persistence'
import { createEditorRuntime } from '@/features/editor/editor-runtime'

const storageMocks = vi.hoisted(() => ({
  clearPowerPointPackages: vi.fn<() => Promise<undefined>>(),
  clearSketchRecords: vi.fn<() => Promise<undefined>>(),
  deletePowerPointPackage: vi.fn<(key: IDBValidKey) => Promise<undefined>>(),
  listPowerPointPackageIds: vi.fn<() => Promise<IDBValidKey[]>>(),
  readPowerPointPackage: vi.fn<(key: string) => Promise<unknown>>(),
  writePowerPointPackage: vi.fn<(key: string, value: unknown) => Promise<IDBValidKey>>(),
}))

vi.mock('@/lib/deck-storage', () => storageMocks)

/** The desktop shell's deck store, which is where persistence now lives. */
const deck = vi.hoisted(() => ({
  collectGarbage: vi.fn<(id: string, keep: readonly string[]) => Promise<void>>(),
  flushPending: vi.fn<() => Promise<void>>(),
  // The shell asking for unsaved work before a window closes; nothing closes
  // one here, so this only has to exist and hand back an unsubscribe.
  onFlushRequest: vi.fn<(listener: () => Promise<void>) => () => void>(() => () => {}),
  writeAsset: vi.fn<(id: string, name: string, bytes: ArrayBuffer) => Promise<string>>(),
}))

const documents = vi.hoisted(() => ({
  read: vi.fn<(id: string) => Promise<unknown>>(),
  write: vi.fn<(id: string, presentation: unknown) => Promise<number>>(),
}))

const DOCUMENT_ID = 'document-1'

const presentation: PresentationState = {
  title: 'Persistence fixture',
  slides: [{ id: 'slide-1', elements: [] }],
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

const drainMicrotasks = async () => {
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  storageMocks.listPowerPointPackageIds.mockResolvedValue([])
  storageMocks.readPowerPointPackage.mockResolvedValue(undefined)
  documents.read.mockResolvedValue(null)
  documents.write.mockResolvedValue(1_700_000_000_000)
  deck.collectGarbage.mockResolvedValue(undefined)
  const windowTarget = new EventTarget() as EventTarget & {
    mona?: unknown
    onbeforeunload: null | (() => boolean | undefined)
  }
  windowTarget.onbeforeunload = null
  windowTarget.mona = { deck, documents }
  const documentTarget = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState }
  documentTarget.visibilityState = 'visible'
  vi.stubGlobal('window', windowTarget)
  vi.stubGlobal('document', documentTarget)
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('restoreDocument', () => {
  test('restores a deck written by this build', async () => {
    documents.read.mockResolvedValue({ presentation, savedAt: 3, version: 5 })

    await expect(restoreDocument(DOCUMENT_ID)).resolves.toEqual(presentation)
  })

  test('refuses a deck from before assets were files without deleting it', async () => {
    // Those versions kept binary in IndexedDB under `blob:` keys this build cannot
    // resolve, so restoring one would produce a deck with every image blank and
    // nothing to explain why. Re-importing gives a deck that works.
    documents.read.mockResolvedValue({ presentation, savedAt: 3, version: 4 })

    await expect(restoreDocument(DOCUMENT_ID)).resolves.toBeNull()
  })

  test('drops a record of the wrong shape rather than wedging boot', async () => {
    documents.read.mockResolvedValue({ nonsense: true })

    await expect(restoreDocument(DOCUMENT_ID)).resolves.toBeNull()
  })

  test('returns nothing when there is no deck on disk', async () => {
    documents.read.mockResolvedValue(null)

    await expect(restoreDocument(DOCUMENT_ID)).resolves.toBeNull()
  })

  test('clamps a slide index that points past the end', async () => {
    documents.read.mockResolvedValue({
      presentation: { ...presentation, slideIndex: 9 },
      savedAt: 3,
      version: 5,
    })

    await expect(restoreDocument(DOCUMENT_ID)).resolves.toMatchObject({ slideIndex: 0 })
  })
})

describe('initDeckPersistence', () => {
  test('publishes pending, saving, and saved states around a serialized save', async () => {
    let releaseWrite: (() => void) | undefined
    documents.write.mockImplementation(() => new Promise(resolve => {
      releaseWrite = () => resolve(1_700_000_000_000)
    }))
    const runtime = createEditorRuntime(presentation)
    const persistence = initDeckPersistence(runtime, DOCUMENT_ID)
    const statuses: DeckPersistenceStatus[] = [persistence.getSnapshot().status]
    const unsubscribe = persistence.subscribe(() => statuses.push(persistence.getSnapshot().status))

    runtime.commit('Rename', [{
      type: 'presentation.title.set',
      title: 'Saved fixture',
      fallbackTitle: 'Untitled presentation',
    }], { recordHistory: false })
    expect(persistence.getSnapshot()).toMatchObject({ dirty: true, status: 'pending' })

    vi.advanceTimersByTime(800)
    await drainMicrotasks()
    expect(persistence.getSnapshot()).toMatchObject({ dirty: true, status: 'saving' })
    expect(releaseWrite).toBeTypeOf('function')

    releaseWrite?.()
    await drainMicrotasks()
    expect(persistence.getSnapshot()).toMatchObject({
      dirty: false,
      error: null,
      status: 'saved',
    })
    expect(persistence.getSnapshot().savedAt).toBeTypeOf('number')
    expect(statuses).toEqual(expect.arrayContaining(['idle', 'pending', 'saving', 'saved']))

    unsubscribe()
    persistence.stop()
  })

  test('retains dirty state on failure and exposes a working retry', async () => {
    documents.write.mockRejectedValueOnce(new Error('Disk unavailable'))
    const runtime = createEditorRuntime(presentation)
    const persistence = initDeckPersistence(runtime, DOCUMENT_ID)

    runtime.commit('Rename', [{
      type: 'presentation.title.set',
      title: 'Retry fixture',
      fallbackTitle: 'Untitled presentation',
    }], { recordHistory: false })
    vi.advanceTimersByTime(800)
    await drainMicrotasks()

    expect(persistence.getSnapshot()).toMatchObject({
      dirty: true,
      error: 'Disk unavailable',
      status: 'error',
    })

    documents.write.mockResolvedValueOnce(1_700_000_000_000)
    await persistence.retry()
    expect(persistence.getSnapshot()).toMatchObject({
      dirty: false,
      error: null,
      status: 'saved',
    })

    persistence.stop()
  })

  test('writes page metadata through to the deck on disk', async () => {
    const runtime = createEditorRuntime(presentation)
    const persistence = initDeckPersistence(runtime, DOCUMENT_ID)
    runtime.commit('Update page metadata', [{
      type: 'slide.update',
      slideId: 'slide-1',
      props: {
        durationMs: 7000,
        hidden: true,
        title: 'Timed page',
        turningMode: 'slideX',
      },
    }], { recordHistory: false })

    await persistence.flush()

    // The presentation itself, not an envelope: the version and timestamp belong
    // to the file the shell writes, not to anything the renderer assembles.
    expect(documents.write).toHaveBeenCalledWith(DOCUMENT_ID, expect.objectContaining({
      slides: [expect.objectContaining({
        durationMs: 7000,
        hidden: true,
        title: 'Timed page',
        turningMode: 'slideX',
      })],
    }))
    persistence.stop()
  })
})
