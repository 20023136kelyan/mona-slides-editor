import { validateImportedSlides, validatePresentationState, type PresentationState } from '@mona/presentation-core'

import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { sanitizePowerPointPackageReference, sanitizeSlides } from '@/lib/deck-sanitizer'
import { collectDeckAssetNames } from '@/features/editor/editor-deck-assets'
import { maybeMonaBridge, monaBridge } from '@/lib/mona-bridge'

/**
 * Per-document persistence: the deck autosaves to its own directory shortly
 * after every change and is read back from its document route.
 *
 * It used to keep the deck in IndexedDB with binary in a second store keyed by
 * `blob:` URL, which meant every save had to fetch the bytes back through a handle
 * and re-mint that handle on restore. Assets are files now and the deck refers to
 * them by path, so there is nothing to capture, nothing to re-mint, and no way for
 * the two to fall out of step.
 */

const SAVE_DEBOUNCE_MS = 800
/** 5 is the first version whose assets are files rather than IndexedDB blobs. */
const STORAGE_VERSION = 5

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

interface DeckPersistenceOptions {
  flushDerived?: () => Promise<void>
  onSaved?: (presentation: PresentationState, savedAt: number) => void
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

const isStoredDeck = (value: unknown): value is StoredDeck => {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<StoredDeck>
  return record.version === STORAGE_VERSION
    && !!record.presentation && typeof record.presentation === 'object'
}

/**
 * Nothing to migrate.
 *
 * Earlier versions kept binary in IndexedDB under `blob:` keys, which this build
 * cannot resolve — the deck would restore with every image blank. Refusing them in
 * `isStoredDeck` is the honest outcome: the user re-imports and gets a deck that
 * works, rather than one that looks broken for reasons nothing explains.
 */
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

export const restoreDocument = async (documentId: string): Promise<PresentationState | null> => {
  try {
    const stored = await monaBridge().documents.read(documentId)
    if (!stored) return null
    if (!isStoredDeck(stored)) {
      // Never delete a corrupt document automatically. The library still knows
      // where it is, so a recovery flow can inspect or restore it later.
      return null
    }
    const migrated = migrateStoredDeck(stored)
    if (!validateImportedSlides(migrated.presentation.slides).valid) {
      return null
    }

    // Nothing to re-mint: an asset reference is a path, and it means the same
    // thing in this launch as it did in the last one.
    const restoredPresentation = migrated.presentation
    const presentation: PresentationState = {
      ...restoredPresentation,
      slides: sanitizeSlides(restoredPresentation.slides),
      sourcePackages: restoredPresentation.sourcePackages?.map(sanitizePowerPointPackageReference),
      slideIndex: Math.min(Math.max(migrated.presentation.slideIndex, 0), migrated.presentation.slides.length - 1),
    }
    if (!validatePresentationState(presentation).valid) {
      return null
    }
    return presentation
  }
  catch {
    return null
  }
}

export const initDeckPersistence = (
  runtime: EditorRuntime,
  documentId: string,
  options: DeckPersistenceOptions = {},
): DeckPersistence => {
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
        await runtime.pptxBackingStore.retain(
          (presentation.sourcePackages ?? []).map(source => source.packageId),
        )

        // The assets are already on disk - they were written before anything
        // referenced them - so saving the deck is one write and nothing else.
        const savedAt = await monaBridge().documents.write(documentId, presentation)
        lastSaved = presentation
        options.onSaved?.(presentation, savedAt)
        // Only after the deck naming them is safely stored: an orphan costs disk,
        // where deleting one still referenced costs a picture.
        void monaBridge().deck.collectGarbage(documentId, [...collectDeckAssetNames(presentation)])
          .catch(() => undefined)
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

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (snapshot.dirty) await enqueueSave()
    else await saving
    await options.flushDerived?.()
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
  /**
   * Closing a window is not leaving a page.
   *
   * This used to set `window.onbeforeunload` while a save was in flight, which
   * is what a web page can do: ask the browser to talk the user out of leaving.
   * A desktop window has no such conversation — the prompt arrives as a native
   * modal the application does not control, and there is no tab to abandon.
   *
   * The shell holds the window open instead and asks for a flush, so an edit
   * made a moment before quitting is written rather than argued about.
   */
  const stopFlushRequests = maybeMonaBridge()?.deck.onFlushRequest(async () => {
    await flush()
  })

  window.addEventListener('pagehide', onPageHide)
  document.addEventListener('visibilitychange', onVisibilityChange)

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
      stopFlushRequests?.()
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
