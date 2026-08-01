import {
  deleteDocumentSketchRecord,
  deleteSketchRecord,
  readDocumentSketchRecords,
  readSketchRecords,
  writeDocumentSketchRecord,
  writeSketchRecord,
} from '@/lib/deck-storage'
import { maybeActiveDocumentId } from '@/features/documents/active-document'

export const SLIDE_SKETCH_VERSION = 1
const PERSIST_DEBOUNCE_MS = 350
const MAX_SKETCH_BYTES = 8 * 1024 * 1024

export interface SerializedDrawingScene {
  appState?: Record<string, unknown>
  elements: readonly Record<string, unknown>[]
  files?: Record<string, unknown>
  source?: string
  type?: string
  version?: number
}

export interface SlideSketch {
  scene: SerializedDrawingScene
  slideId: string
  updatedAt: number
  version: typeof SLIDE_SKETCH_VERSION
}

export interface DrawingPersistenceAdapter {
  delete: (slideId: string) => Promise<unknown>
  list: () => Promise<unknown[]>
  write: (slideId: string, sketch: SlideSketch) => Promise<unknown>
}

export interface DrawingStore {
  clear: (slideId: string) => void
  flush: () => Promise<void>
  getRevision: () => number
  getSketch: (slideId: string) => SlideSketch | undefined
  hasSketch: (slideId: string) => boolean
  hydrate: () => Promise<void>
  prune: (validSlideIds: ReadonlySet<string>) => void
  setScene: (slideId: string, scene: SerializedDrawingScene) => SlideSketch | undefined
  stop: () => Promise<void>
  subscribe: (listener: () => void) => () => void
}

const defaultAdapter: DrawingPersistenceAdapter = {
  delete: deleteSketchRecord,
  list: readSketchRecords,
  write: writeSketchRecord,
}

const documentAdapter = (documentId: string): DrawingPersistenceAdapter => ({
  delete: slideId => deleteDocumentSketchRecord(documentId, slideId),
  list: () => readDocumentSketchRecords(documentId),
  write: (slideId, sketch) => writeDocumentSketchRecord(documentId, slideId, sketch),
})

const isScene = (value: unknown): value is SerializedDrawingScene => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Array.isArray((value as Partial<SerializedDrawingScene>).elements)
}

export const isSlideSketch = (value: unknown): value is SlideSketch => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<SlideSketch>
  return candidate.version === SLIDE_SKETCH_VERSION
    && typeof candidate.slideId === 'string'
    && Boolean(candidate.slideId)
    && typeof candidate.updatedAt === 'number'
    && Number.isFinite(candidate.updatedAt)
    && isScene(candidate.scene)
}

const hasLiveElements = (scene: SerializedDrawingScene) =>
  scene.elements.some(element => element.isDeleted !== true)

const withinStorageBudget = (scene: SerializedDrawingScene) => {
  try {
    return new Blob([JSON.stringify(scene)]).size <= MAX_SKETCH_BYTES
  }
  catch {
    return false
  }
}

export const createDrawingStore = ({
  adapter,
  persistenceEnabled = true,
}: {
  adapter?: DrawingPersistenceAdapter
  persistenceEnabled?: boolean
} = {}): DrawingStore => {
  const documentId = maybeActiveDocumentId()
  const persistenceAdapter = adapter
    ?? (documentId ? documentAdapter(documentId) : defaultAdapter)
  const sketches = new Map<string, SlideSketch>()
  const touchedSlideIds = new Set<string>()
  const pendingWrites = new Map<string, SlideSketch | null>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const listeners = new Set<() => void>()
  let hydrated = false
  let stopped = false
  let revision = 0
  let writeQueue = Promise.resolve()

  const publish = () => {
    revision += 1
    for (const listener of listeners) listener()
  }
  const persist = (slideId: string) => {
    if (!persistenceEnabled || stopped) return
    const pending = timers.get(slideId)
    if (pending) clearTimeout(pending)
    timers.set(slideId, setTimeout(() => {
      timers.delete(slideId)
      const sketch = pendingWrites.get(slideId)
      pendingWrites.delete(slideId)
      writeQueue = writeQueue
        .then(() => sketch ? persistenceAdapter.write(slideId, sketch) : persistenceAdapter.delete(slideId))
        .then(() => undefined)
        .catch(() => undefined)
    }, PERSIST_DEBOUNCE_MS))
  }
  const clear = (slideId: string) => {
    touchedSlideIds.add(slideId)
    const changed = sketches.delete(slideId)
    pendingWrites.set(slideId, null)
    persist(slideId)
    if (changed) publish()
  }
  const setScene = (slideId: string, scene: SerializedDrawingScene) => {
    touchedSlideIds.add(slideId)
    if (!isScene(scene) || !withinStorageBudget(scene)) return undefined
    if (!hasLiveElements(scene)) {
      clear(slideId)
      return undefined
    }
    const wasPresent = sketches.has(slideId)
    const sketch: SlideSketch = {
      scene: structuredClone(scene),
      slideId,
      updatedAt: Date.now(),
      version: SLIDE_SKETCH_VERSION,
    }
    sketches.set(slideId, sketch)
    pendingWrites.set(slideId, sketch)
    persist(slideId)
    // The editor shell only needs to learn when a sketch appears or
    // disappears. Pointer-move scene updates stay local to Excalidraw and do
    // not trigger high-frequency React shell renders.
    if (!wasPresent) publish()
    return sketch
  }
  const flush = async () => {
    if (!persistenceEnabled) return
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    const writes = [...pendingWrites.entries()]
    pendingWrites.clear()
    writeQueue = writeQueue.then(async () => {
      await Promise.all(writes.map(([slideId, sketch]) => (
        sketch ? persistenceAdapter.write(slideId, sketch) : persistenceAdapter.delete(slideId)
      )))
    }).catch(() => undefined)
    await writeQueue
  }

  return {
    clear,
    flush,
    getRevision: () => revision,
    getSketch: slideId => sketches.get(slideId),
    hasSketch: slideId => {
      const sketch = sketches.get(slideId)
      return Boolean(sketch && hasLiveElements(sketch.scene))
    },
    hydrate: async () => {
      if (hydrated || !persistenceEnabled) {
        hydrated = true
        return
      }
      hydrated = true
      const records = await persistenceAdapter.list().catch(() => [])
      let changed = false
      for (const record of records) {
        if (!isSlideSketch(record) || touchedSlideIds.has(record.slideId) || !withinStorageBudget(record.scene)) continue
        sketches.set(record.slideId, structuredClone(record))
        changed = true
      }
      if (changed) publish()
    },
    prune: validSlideIds => {
      for (const slideId of sketches.keys()) {
        if (!validSlideIds.has(slideId)) clear(slideId)
      }
    },
    setScene,
    stop: async () => {
      await flush()
      stopped = true
      listeners.clear()
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
