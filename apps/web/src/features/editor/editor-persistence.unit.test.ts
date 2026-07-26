import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { PresentationState } from '@mona/presentation-core'

import {
  initDeckPersistence,
  restoreWorkingDeck,
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
  clear: vi.fn<() => Promise<void>>(),
  collectGarbage: vi.fn<(keep: readonly string[]) => Promise<void>>(),
  read: vi.fn<() => Promise<unknown>>(),
  write: vi.fn<(presentation: unknown) => Promise<number>>(),
  writeAsset: vi.fn<(name: string, bytes: ArrayBuffer) => Promise<string>>(),
}))

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
  deck.read.mockResolvedValue(null)
  deck.write.mockResolvedValue(1_700_000_000_000)
  deck.collectGarbage.mockResolvedValue(undefined)
  deck.clear.mockResolvedValue(undefined)
  const windowTarget = new EventTarget() as EventTarget & {
    mona?: unknown
    onbeforeunload: null | (() => boolean | undefined)
  }
  windowTarget.onbeforeunload = null
  windowTarget.mona = { deck }
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

describe('restoreWorkingDeck', () => {
  test('restores a deck written by this build', async () => {
    deck.read.mockResolvedValue({ presentation, savedAt: 3, version: 5 })

    await expect(restoreWorkingDeck()).resolves.toEqual(presentation)
  })

  test('refuses a deck from before assets were files, and clears it', async () => {
    // Those versions kept binary in IndexedDB under `blob:` keys this build cannot
    // resolve, so restoring one would produce a deck with every image blank and
    // nothing to explain why. Re-importing gives a deck that works.
    deck.read.mockResolvedValue({ presentation, savedAt: 3, version: 4 })

    await expect(restoreWorkingDeck()).resolves.toBeNull()
    expect(deck.clear).toHaveBeenCalled()
  })

  test('drops a record of the wrong shape rather than wedging boot', async () => {
    deck.read.mockResolvedValue({ nonsense: true })

    await expect(restoreWorkingDeck()).resolves.toBeNull()
    expect(deck.clear).toHaveBeenCalled()
  })

  test('returns nothing when there is no deck on disk', async () => {
    deck.read.mockResolvedValue(null)

    await expect(restoreWorkingDeck()).resolves.toBeNull()
    // Nothing to clear: absent is not corrupt.
    expect(deck.clear).not.toHaveBeenCalled()
  })

  test('clamps a slide index that points past the end', async () => {
    deck.read.mockResolvedValue({
      presentation: { ...presentation, slideIndex: 9 },
      savedAt: 3,
      version: 5,
    })

    await expect(restoreWorkingDeck()).resolves.toMatchObject({ slideIndex: 0 })
  })
})

describe('initDeckPersistence', () => {
  test('publishes pending, saving, and saved states around a serialized save', async () => {
    let releaseWrite: (() => void) | undefined
    deck.write.mockImplementation(() => new Promise(resolve => {
      releaseWrite = () => resolve(1_700_000_000_000)
    }))
    const runtime = createEditorRuntime(presentation)
    const persistence = initDeckPersistence(runtime)
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
    deck.write.mockRejectedValueOnce(new Error('IndexedDB quota exceeded'))
    const runtime = createEditorRuntime(presentation)
    const persistence = initDeckPersistence(runtime)

    runtime.commit('Rename', [{
      type: 'presentation.title.set',
      title: 'Retry fixture',
      fallbackTitle: 'Untitled presentation',
    }], { recordHistory: false })
    vi.advanceTimersByTime(800)
    await drainMicrotasks()

    expect(persistence.getSnapshot()).toMatchObject({
      dirty: true,
      error: 'IndexedDB quota exceeded',
      status: 'error',
    })

    deck.write.mockResolvedValueOnce(1_700_000_000_000)
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
    const persistence = initDeckPersistence(runtime)
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
    expect(deck.write).toHaveBeenCalledWith(expect.objectContaining({
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
