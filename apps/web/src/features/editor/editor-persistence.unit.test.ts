import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { PresentationState } from '@mona/presentation-core'

import {
  collectBlobUrls,
  initDeckPersistence,
  replaceStrings,
  restoreWorkingDeck,
  type DeckPersistenceStatus,
} from '@/features/editor/editor-persistence'
import { createEditorRuntime } from '@/features/editor/editor-runtime'

const storageMocks = vi.hoisted(() => ({
  clearDeckSlot: vi.fn<() => Promise<undefined>>(),
  clearPowerPointPackages: vi.fn<() => Promise<undefined>>(),
  clearSketchRecords: vi.fn<() => Promise<undefined>>(),
  deletePowerPointPackage: vi.fn<(key: IDBValidKey) => Promise<undefined>>(),
  deleteMediaBlob: vi.fn<(key: IDBValidKey) => Promise<undefined>>(),
  listMediaKeys: vi.fn<() => Promise<IDBValidKey[]>>(),
  listPowerPointPackageIds: vi.fn<() => Promise<IDBValidKey[]>>(),
  readDeckSlot: vi.fn<() => Promise<unknown>>(),
  readMediaBlob: vi.fn<(key: string) => Promise<unknown>>(),
  readPowerPointPackage: vi.fn<(key: string) => Promise<unknown>>(),
  writeDeckSlot: vi.fn<(value: unknown) => Promise<IDBValidKey>>(),
  writeMediaBlob: vi.fn<(key: string, blob: Blob) => Promise<IDBValidKey>>(),
  writePowerPointPackage: vi.fn<(key: string, value: unknown) => Promise<IDBValidKey>>(),
}))

vi.mock('@/lib/deck-storage', () => storageMocks)

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
  storageMocks.listMediaKeys.mockResolvedValue([])
  storageMocks.listPowerPointPackageIds.mockResolvedValue([])
  storageMocks.readMediaBlob.mockResolvedValue(undefined)
  storageMocks.readPowerPointPackage.mockResolvedValue(undefined)
  storageMocks.writeDeckSlot.mockResolvedValue('working-deck')
  const windowTarget = new EventTarget() as EventTarget & { onbeforeunload: null | (() => boolean | undefined) }
  windowTarget.onbeforeunload = null
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

describe('collectBlobUrls', () => {
  test('finds blob urls at any depth and ignores everything else', () => {
    const deck = {
      slides: [
        {
          elements: [
            { type: 'image', src: 'blob:http://localhost/abc' },
            { type: 'video', src: 'https://example.com/movie.mp4', poster: 'blob:http://localhost/def' },
            { type: 'text', content: '<p>not a url</p>' },
          ],
          background: { image: { src: 'blob:http://localhost/abc' } },
        },
      ],
    }
    expect([...collectBlobUrls(deck)].sort()).toEqual([
      'blob:http://localhost/abc',
      'blob:http://localhost/def',
    ])
    expect(collectBlobUrls(null).size).toBe(0)
    expect(collectBlobUrls('blob:x').size).toBe(1)
  })
})

describe('replaceStrings', () => {
  test('rewrites exact string matches while preserving structure', () => {
    const replacements = new Map([['blob:old', 'blob:new']])
    const input = {
      a: 'blob:old',
      b: ['blob:old', 'keep', { c: 'blob:old', d: 42 }],
      e: 'prefix blob:old suffix',
    }
    expect(replaceStrings(input, replacements)).toEqual({
      a: 'blob:new',
      b: ['blob:new', 'keep', { c: 'blob:new', d: 42 }],
      e: 'prefix blob:old suffix',
    })
  })

  test('returns the original reference when there is nothing to replace', () => {
    const input = { a: ['x'] }
    expect(replaceStrings(input, new Map())).toBe(input)
  })
})

describe('restoreWorkingDeck', () => {
  test('migrates a version 1 working copy without inventing page metadata', async () => {
    storageMocks.readDeckSlot.mockResolvedValue({
      presentation,
      savedAt: 1,
      version: 1,
    })

    const restored = await restoreWorkingDeck()

    expect(restored).toEqual(presentation)
    expect(restored?.slides[0]).not.toHaveProperty('title')
    expect(storageMocks.clearDeckSlot).not.toHaveBeenCalled()
  })

  test('migrates version 2 page metadata without changing its values', async () => {
    const storedPresentation: PresentationState = {
      ...presentation,
      slides: [{
        id: 'slide-1',
        durationMs: 12_500,
        elements: [],
        hidden: true,
        title: 'Stored page',
        turningMode: 'fade',
      }],
    }
    storageMocks.readDeckSlot.mockResolvedValue({
      presentation: storedPresentation,
      savedAt: 2,
      version: 2,
    })

    await expect(restoreWorkingDeck()).resolves.toEqual(storedPresentation)
  })

  test('removes legacy order-based PowerPoint provenance instead of treating it as exact', async () => {
    const storedPresentation = {
      ...presentation,
      sourcePackages: [{
        byteLength: 100,
        fileName: 'legacy-source.pptx',
        kind: 'pptx',
        packageId: 'pptx:legacy',
        slides: [{ slidePart: 'ppt/slides/slide1.xml' }],
      }],
      slides: [{
        id: 'slide-1',
        elements: [{
          fixedRatio: true,
          height: 100,
          id: 'image-1',
          left: 0,
          rotate: 0,
          source: {
            kind: 'pptx',
            packageId: 'pptx:legacy',
            slidePart: 'ppt/slides/slide1.xml',
            sourceLayer: 'slide',
            sourceOrder: 42,
            sourcePart: 'ppt/slides/slide1.xml',
          },
          src: 'data:image/png;base64,',
          top: 0,
          type: 'image',
          width: 100,
        }],
      }],
    } as unknown as PresentationState
    storageMocks.readDeckSlot.mockResolvedValue({
      presentation: storedPresentation,
      savedAt: 3,
      version: 2,
    })

    const restored = await restoreWorkingDeck()

    expect(restored?.slides[0]?.elements[0]?.source).toBeUndefined()
  })
})

describe('initDeckPersistence', () => {
  test('publishes pending, saving, and saved states around a serialized save', async () => {
    let releaseWrite: (() => void) | undefined
    storageMocks.writeDeckSlot.mockImplementation(() => new Promise(resolve => {
      releaseWrite = () => resolve('working-deck')
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
    storageMocks.writeDeckSlot.mockRejectedValueOnce(new Error('IndexedDB quota exceeded'))
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

    storageMocks.writeDeckSlot.mockResolvedValueOnce('working-deck')
    await persistence.retry()
    expect(persistence.getSnapshot()).toMatchObject({
      dirty: false,
      error: null,
      status: 'saved',
    })

    persistence.stop()
  })

  test('writes page metadata in the current versioned storage envelope', async () => {
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

    expect(storageMocks.writeDeckSlot).toHaveBeenCalledWith(expect.objectContaining({
      presentation: expect.objectContaining({
        slides: [expect.objectContaining({
          durationMs: 7000,
          hidden: true,
          title: 'Timed page',
          turningMode: 'slideX',
        })],
      }),
      version: 4,
    }))
    persistence.stop()
  })
})
