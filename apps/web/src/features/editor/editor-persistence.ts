import { validateImportedSlides, validatePresentationState, type PresentationState } from '@mona/presentation-core'

import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { sanitizePowerPointPackageReference, sanitizeSlides } from '@/lib/deck-sanitizer'
import {
  clearDeckSlot,
  clearPowerPointPackages,
  clearSketchRecords,
  deleteMediaBlob,
  listMediaKeys,
  readDeckSlot,
  readMediaBlob,
  writeDeckSlot,
  writeMediaBlob,
} from '@/lib/deck-storage'

// Working-copy persistence: the deck autosaves to IndexedDB shortly after
// every change and is restored on the next boot, so a crash, tab close, or
// reload can no longer lose work. blob: media URLs die with the document, so
// their payloads are captured alongside the deck and re-minted on restore.

const SAVE_DEBOUNCE_MS = 800
const STORAGE_VERSION = 4

interface StoredDeck {
  presentation: PresentationState
  savedAt: number
  version: number
}

export interface DeckPersistence {
  flush: () => Promise<void>
  getSnapshot: () => DeckPersistenceSnapshot
  isDirty: () => boolean
  retry: () => Promise<void>
  stop: () => void
  subscribe: (listener: () => void) => () => void
}

export type DeckPersistenceStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

export interface DeckPersistenceSnapshot {
  dirty: boolean
  error: string | null
  pendingSince: number | null
  savedAt: number | null
  status: DeckPersistenceStatus
}

// Fixture sessions are throwaway and automated runs must stay hermetic:
// persistence is off for development fixtures, in audience mirror windows, and
// under webdriver unless a persistence test opts in via ?persistTest=1.
export const isPersistenceEnabled = (url: URL = new URL(window.location.href)): boolean => {
  if (url.searchParams.has('developmentFixture')) return false
  if (url.searchParams.get('mode') === 'audience') return false
  if (navigator.webdriver && !url.searchParams.has('persistTest')) return false
  return true
}

const BLOB_URL_PATTERN = /^blob:/
export const collectBlobUrls = (value: unknown, found = new Set<string>()): Set<string> => {
  if (typeof value === 'string') {
    if (BLOB_URL_PATTERN.test(value)) found.add(value)
  }
  else if (Array.isArray(value)) {
    for (const entry of value) collectBlobUrls(entry, found)
  }
  else if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) collectBlobUrls(entry, found)
  }
  return found
}

export const replaceStrings = <T>(value: T, replacements: ReadonlyMap<string, string>): T => {
  if (replacements.size === 0) return value
  if (typeof value === 'string') return (replacements.get(value) ?? value) as T
  if (Array.isArray(value)) return value.map(entry => replaceStrings(entry, replacements)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, replaceStrings(entry, replacements)]),
    ) as T
  }
  return value
}

let restoredWorkingCopy = false
export const consumeRestoredDeckFlag = (): boolean => {
  const value = restoredWorkingCopy
  restoredWorkingCopy = false
  return value
}

const isStoredDeck = (value: unknown): value is StoredDeck => {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<StoredDeck>
  return (record.version === 1 || record.version === 2 || record.version === 3 || record.version === STORAGE_VERSION)
    && !!record.presentation && typeof record.presentation === 'object'
}

const migrateStoredDeck = (stored: StoredDeck): StoredDeck => {
  if (stored.version === STORAGE_VERSION) return stored
  // Version 2 added optional page metadata. Version 3 temporarily synthesized
  // order-based PPTX provenance. Version 4 permits source patching only when a
  // native part + cNvPr identity was captured, and removes legacy fallbacks
  // rather than presenting them as exact PowerPoint object addresses.
  return {
    ...stored,
    presentation: {
      ...stored.presentation,
      slides: stored.presentation.slides.map(slide => ({
        ...slide,
        elements: slide.elements.map(element => {
          const source = element.source
          if (!source || source.kind !== 'pptx') return element
          if (source.nativeShapeId && source.sourceObjectId && source.sourcePart) {
            return {
              ...element,
              source: {
                ...source,
                stableId: source.sourceObjectId,
              },
            }
          }
          const { source: _unresolvedSource, ...elementWithoutUnresolvedSource } = element
          void _unresolvedSource
          return elementWithoutUnresolvedSource
        }),
      })),
    },
    version: STORAGE_VERSION,
  }
}

export const restoreWorkingDeck = async (): Promise<PresentationState | null> => {
  try {
    const stored = await readDeckSlot()
    if (stored === undefined) return null
    if (!isStoredDeck(stored)) {
      // A corrupt or foreign-shaped slot must never wedge boot: drop it.
      await clearDeckSlot().catch(() => {})
      return null
    }
    const migrated = migrateStoredDeck(stored)
    if (!validateImportedSlides(migrated.presentation.slides).valid) {
      await clearDeckSlot().catch(() => {})
      return null
    }

    // Stored blob: URLs are dead in this document; re-mint object URLs from
    // the captured payloads before the deck reaches the store.
    const replacements = new Map<string, string>()
    for (const url of collectBlobUrls(migrated.presentation)) {
      const blob = await readMediaBlob(url).catch(() => undefined)
      if (blob instanceof Blob) replacements.set(url, URL.createObjectURL(blob))
    }

    const restoredPresentation = replaceStrings(migrated.presentation, replacements)
    const presentation: PresentationState = {
      ...restoredPresentation,
      slides: sanitizeSlides(restoredPresentation.slides),
      sourcePackages: restoredPresentation.sourcePackages?.map(sanitizePowerPointPackageReference),
      slideIndex: Math.min(Math.max(migrated.presentation.slideIndex, 0), migrated.presentation.slides.length - 1),
    }
    if (!validatePresentationState(presentation).valid) {
      await clearDeckSlot().catch(() => {})
      return null
    }
    restoredWorkingCopy = true
    return presentation
  }
  catch {
    return null
  }
}

export const discardWorkingDeck = async (): Promise<void> => {
  await clearDeckSlot().catch(() => {})
  await clearPowerPointPackages().catch(() => {})
  await clearSketchRecords().catch(() => {})
  const keys = await listMediaKeys().catch(() => [] as IDBValidKey[])
  await Promise.all(keys.map(key => deleteMediaBlob(key).catch(() => {})))
}

export const initDeckPersistence = (runtime: EditorRuntime): DeckPersistence => {
  let lastSaved = runtime.store.getState().presentation
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let saving = Promise.resolve()
  let snapshot: DeckPersistenceSnapshot = {
    dirty: false,
    error: null,
    pendingSince: null,
    savedAt: null,
    status: 'idle',
  }
  const listeners = new Set<() => void>()

  const updateSnapshot = (patch: Partial<DeckPersistenceSnapshot>) => {
    const next = { ...snapshot, ...patch }
    if (
      next.dirty === snapshot.dirty
      && next.error === snapshot.error
      && next.pendingSince === snapshot.pendingSince
      && next.savedAt === snapshot.savedAt
      && next.status === snapshot.status
    ) return
    snapshot = next
    for (const listener of listeners) listener()
  }

  const enqueueSave = (): Promise<void> => {
    // Serialize saves so a slow blob capture cannot interleave with the next.
    saving = saving.then(async () => {
      if (stopped) return
      const presentation = runtime.store.getState().presentation
      updateSnapshot({ dirty: true, error: null, status: 'saving' })
      try {
        const referenced = collectBlobUrls(presentation)
        for (const url of referenced) {
          const existing = await readMediaBlob(url).catch(() => undefined)
          if (existing instanceof Blob) continue
          const blob = await fetch(url).then(response => response.blob()).catch(() => undefined)
          if (blob) await writeMediaBlob(url, blob).catch(() => {})
        }
        const keys = await listMediaKeys().catch(() => [] as IDBValidKey[])
        await Promise.all(keys
          .filter(key => typeof key === 'string' && !referenced.has(key))
          .map(key => deleteMediaBlob(key).catch(() => {})))
        await runtime.pptxBackingStore.retain(
          (presentation.sourcePackages ?? []).map(source => source.packageId),
        )

        const savedAt = Date.now()
        const payload: StoredDeck = { presentation, savedAt, version: STORAGE_VERSION }
        await writeDeckSlot(payload)
        lastSaved = presentation
        if (runtime.store.getState().presentation === presentation) {
          updateSnapshot({
            dirty: false,
            error: null,
            pendingSince: null,
            savedAt,
            status: 'saved',
          })
        }
        else {
          updateSnapshot({
            dirty: true,
            error: null,
            pendingSince: snapshot.pendingSince ?? Date.now(),
            savedAt,
            status: 'pending',
          })
        }
      }
      catch (error) {
        // Storage unavailable: stay dirty so beforeunload keeps its warning,
        // and expose a retryable failure instead of falsely reporting saved.
        updateSnapshot({
          dirty: true,
          error: error instanceof Error ? error.message : 'Unable to save this presentation',
          status: 'error',
        })
      }
    })
    return saving
  }

  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void enqueueSave()
    }, SAVE_DEBOUNCE_MS)
  }

  const unsubscribe = runtime.store.subscribe(() => {
    const presentation = runtime.store.getState().presentation
    if (presentation === lastSaved) return
    updateSnapshot({
      dirty: true,
      error: null,
      pendingSince: snapshot.pendingSince ?? Date.now(),
      status: snapshot.status === 'saving' ? 'saving' : 'pending',
    })
    schedule()
  })

  const flush = (): Promise<void> => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!snapshot.dirty) return saving
    return enqueueSave()
  }

  const retry = (): Promise<void> => {
    if (!snapshot.dirty) return saving
    return flush()
  }

  const onPageHide = () => {
    void flush()
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') void flush()
  }
  // The prompt only fires while a change is still in flight to IndexedDB —
  // once persisted, closing the tab is safe and stays silent.
  const onBeforeUnload = () => (snapshot.dirty ? false : undefined)

  window.addEventListener('pagehide', onPageHide)
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.onbeforeunload = onBeforeUnload

  return {
    flush,
    getSnapshot: () => snapshot,
    isDirty: () => snapshot.dirty,
    retry,
    stop: () => {
      stopped = true
      if (timer) clearTimeout(timer)
      unsubscribe()
      listeners.clear()
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (window.onbeforeunload === onBeforeUnload) window.onbeforeunload = null
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
