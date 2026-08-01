import { randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

import type { DataSourceDocumentReference } from '@mona/data-source'

import {
  buildMonaDocumentPackage,
  extractMonaDocumentPackage,
  readMonaDocumentManifest,
} from './native-document-package.js'

/**
 * The filesystem catalogue for Mona documents.
 *
 * A document owns one directory:
 *
 *   documents/<id>/deck.json
 *   documents/<id>/assets/
 *
 * `library.json` is an index, never the only copy of document metadata. If it is
 * missing or malformed it is rebuilt from those deck files, so a catalogue
 * failure cannot orphan a presentation that is still present on disk.
 */

const LIBRARY_VERSION = 1
export const DECK_STORAGE_VERSION = 5
const MAX_PREVIEW_BYTES = 12 * 1024 * 1024
const PREVIEW_MEDIA_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])

export interface DocumentSummary {
  createdAt: number
  id: string
  lastOpenedAt: number
  slideCount: number
  sourceReference?: DataSourceDocumentReference
  thumbnailRevision?: number
  title: string
  updatedAt: number
}

export interface StoredDeck {
  portableDocumentId?: string
  presentation: unknown
  savedAt: number
  sourceReference?: DataSourceDocumentReference
  version: number
}

interface LibraryIndex {
  documents: DocumentSummary[]
  version: number
}

interface DocumentPreviewMetadata {
  generatedAt: number
  mediaType: string
  savedAt: number
  slideId: string
  version: 1
}

const isFiniteTimestamp = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0
)

const isSourceReference = (value: unknown): value is DataSourceDocumentReference => {
  if (!value || typeof value !== 'object') return false
  const reference = value as Partial<DataSourceDocumentReference>
  return typeof reference.sourceId === 'string'
    && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(reference.sourceId)
    && typeof reference.itemId === 'string'
    && reference.itemId.length > 0
    && reference.itemId.length <= 512
}

const isDocumentSummary = (value: unknown): value is DocumentSummary => {
  if (!value || typeof value !== 'object') return false
  const summary = value as Partial<DocumentSummary>
  return isDocumentId(summary.id)
    && typeof summary.title === 'string'
    && Number.isInteger(summary.slideCount)
    && (summary.slideCount ?? -1) >= 0
    && isFiniteTimestamp(summary.createdAt)
    && isFiniteTimestamp(summary.lastOpenedAt)
    && isFiniteTimestamp(summary.updatedAt)
    && (summary.thumbnailRevision === undefined || isFiniteTimestamp(summary.thumbnailRevision))
    && (summary.sourceReference === undefined || isSourceReference(summary.sourceReference))
}

const documentsRoot = () => join(app.getPath('userData'), 'documents')
const libraryFile = () => join(documentsRoot(), 'library.json')
export const documentRoot = (id: string) => join(documentsRoot(), id)
export const documentAssetsRoot = (id: string) => join(documentRoot(id), 'assets')
export const documentDeckFile = (id: string) => join(documentRoot(id), 'deck.json')
export const documentPreviewsRoot = (id: string) => join(documentRoot(id), 'previews')
const documentPreviewMetadataFile = (id: string) => join(documentPreviewsRoot(id), 'cover.json')

const readPreviewMetadataUnsafe = async (id: string): Promise<DocumentPreviewMetadata | null> => {
  try {
    const parsed = JSON.parse(await readFile(documentPreviewMetadataFile(id), 'utf8')) as Partial<DocumentPreviewMetadata>
    if (
      parsed.version !== 1
      || !isFiniteTimestamp(parsed.generatedAt)
      || !isFiniteTimestamp(parsed.savedAt)
      || typeof parsed.slideId !== 'string'
      || !PREVIEW_MEDIA_TYPES.has(parsed.mediaType ?? '')
    ) return null
    return parsed as DocumentPreviewMetadata
  }
  catch {
    return null
  }
}

export const readDocumentPreview = async (
  id: string,
): Promise<{ mediaType: string; path: string; revision: number } | null> => {
  if (!isDocumentId(id)) return null
  const metadata = await readPreviewMetadataUnsafe(id)
  if (!metadata) return null
  const extension = PREVIEW_MEDIA_TYPES.get(metadata.mediaType)
  if (!extension) return null
  const path = join(documentPreviewsRoot(id), `cover.${extension}`)
  const file = await stat(path).catch(() => null)
  return file?.isFile()
    ? { mediaType: metadata.mediaType, path, revision: metadata.generatedAt }
    : null
}

/** IDs cross an IPC boundary and become path segments, so reject everything else. */
export const isDocumentId = (value: unknown): value is string => (
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)
)

const presentationDetails = (presentation: unknown): { slideCount: number; title: string } => {
  if (!presentation || typeof presentation !== 'object') return { slideCount: 0, title: '' }
  const candidate = presentation as { slides?: unknown; title?: unknown }
  return {
    slideCount: Array.isArray(candidate.slides) ? candidate.slides.length : 0,
    title: typeof candidate.title === 'string' ? candidate.title : '',
  }
}

const atomicJsonWrite = async (target: string, value: unknown): Promise<void> => {
  const pending = `${target}.pending`
  await writeFile(pending, JSON.stringify(value))
  await rename(pending, target)
}

const readStoredDeckUnsafe = async (id: string): Promise<StoredDeck | null> => {
  if (!isDocumentId(id)) return null
  try {
    const parsed = JSON.parse(await readFile(documentDeckFile(id), 'utf8')) as Partial<StoredDeck>
    if (
      !parsed
      || typeof parsed !== 'object'
      || typeof parsed.savedAt !== 'number'
      || typeof parsed.version !== 'number'
      || !parsed.presentation
      || typeof parsed.presentation !== 'object'
    ) return null
    return parsed as StoredDeck
  }
  catch {
    return null
  }
}

const summaryFromDeck = async (
  id: string,
  deck: StoredDeck,
  previous?: DocumentSummary,
): Promise<DocumentSummary> => {
  const details = presentationDetails(deck.presentation)
  const fileStats = await stat(documentDeckFile(id)).catch(() => null)
  const createdAt = previous?.createdAt
    ?? fileStats?.birthtimeMs
    ?? fileStats?.mtimeMs
    ?? deck.savedAt
  const preview = await readPreviewMetadataUnsafe(id)
  return {
    createdAt,
    id,
    lastOpenedAt: previous?.lastOpenedAt ?? deck.savedAt,
    slideCount: details.slideCount,
    title: details.title,
    updatedAt: deck.savedAt,
    ...(preview ? { thumbnailRevision: preview.generatedAt } : {}),
    ...(deck.sourceReference ? { sourceReference: deck.sourceReference } : {}),
  }
}

const writeIndexUnsafe = async (documents: readonly DocumentSummary[]): Promise<void> => {
  await mkdir(documentsRoot(), { recursive: true })
  await atomicJsonWrite(libraryFile(), {
    documents: [...documents],
    version: LIBRARY_VERSION,
  } satisfies LibraryIndex)
}

const rebuildIndexUnsafe = async (
  previousDocuments: readonly DocumentSummary[] = [],
): Promise<LibraryIndex> => {
  await mkdir(documentsRoot(), { recursive: true })
  const previousById = new Map(previousDocuments.map(document => [document.id, document]))
  const entries = await readdir(documentsRoot(), { withFileTypes: true }).catch(() => [])
  const summaries = await Promise.all(entries
    .filter(entry => entry.isDirectory() && isDocumentId(entry.name))
    .map(async entry => {
      const deck = await readStoredDeckUnsafe(entry.name)
      return deck ? summaryFromDeck(entry.name, deck, previousById.get(entry.name)) : null
    }))
  const documents = summaries
    .filter((entry): entry is DocumentSummary => entry !== null)
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  await writeIndexUnsafe(documents)
  return { documents, version: LIBRARY_VERSION }
}

const readIndexUnsafe = async (): Promise<LibraryIndex> => {
  try {
    const parsed = JSON.parse(await readFile(libraryFile(), 'utf8')) as Partial<LibraryIndex>
    if (
      parsed.version !== LIBRARY_VERSION
      || !Array.isArray(parsed.documents)
      || parsed.documents.some(document => !isDocumentSummary(document))
      || new Set(parsed.documents.map(document => document.id)).size !== parsed.documents.length
    ) return rebuildIndexUnsafe()
    return parsed as LibraryIndex
  }
  catch {
    return rebuildIndexUnsafe()
  }
}

const replaceAssetUrls = (value: unknown, fromId: string | null, toId: string): unknown => {
  if (typeof value === 'string') {
    const legacyPrefix = 'mona://asset/'
    if (!value.startsWith(legacyPrefix)) return value
    const path = value.slice(legacyPrefix.length)
    const separator = path.indexOf('/')
    if (separator === -1) return `${legacyPrefix}${toId}/${path}`
    const owner = path.slice(0, separator)
    return !fromId || owner !== fromId
      ? value
      : `${legacyPrefix}${toId}/${path.slice(separator + 1)}`
  }
  if (Array.isArray(value)) return value.map(entry => replaceAssetUrls(entry, fromId, toId))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, replaceAssetUrls(entry, fromId, toId)]),
  )
}

/**
 * Moves the desktop migration's singleton working copy into the library once.
 *
 * The directory is renamed, not copied and deleted, so a crash cannot leave the
 * old deck gone before the new one exists. Its legacy unscoped asset URLs are
 * rewritten after the move; the bytes themselves stay beside the deck.
 */
const migrateLegacyWorkingDeckUnsafe = async (): Promise<void> => {
  const legacyRoot = join(app.getPath('userData'), 'decks', 'working')
  const legacyDeck = join(legacyRoot, 'deck.json')
  if (!await stat(legacyDeck).then(entry => entry.isFile()).catch(() => false)) return

  await mkdir(documentsRoot(), { recursive: true })
  const id = randomUUID()
  await rename(legacyRoot, documentRoot(id))
  const stored = await readStoredDeckUnsafe(id)
  if (stored) {
    const migrated: StoredDeck = {
      ...stored,
      presentation: replaceAssetUrls(stored.presentation, null, id),
    }
    await atomicJsonWrite(documentDeckFile(id), migrated)
  }
  // The previous renderer kept these two document-owned stores in IndexedDB.
  // Mark the moved document so the renderer imports those records exactly once
  // when this presentation is first opened.
  const dataRoot = join(documentRoot(id), 'data')
  await mkdir(dataRoot, { recursive: true })
  await Promise.all([
    writeFile(join(dataRoot, 'migrate-powerpoint-packages'), ''),
    writeFile(join(dataRoot, 'migrate-sketches'), ''),
  ])
  await rm(join(app.getPath('userData'), 'decks'), { force: true, recursive: true }).catch(() => undefined)
  // Force the next read to discover the moved directory even if a previous
  // library index already existed.
  await rm(libraryFile(), { force: true }).catch(() => undefined)
}

let mutationTail = Promise.resolve()

const serialize = <Result>(operation: () => Promise<Result>): Promise<Result> => {
  const result = mutationTail.then(operation, operation)
  mutationTail = result.then(() => undefined, () => undefined)
  return result
}

const prepareUnsafe = async (): Promise<LibraryIndex> => {
  await migrateLegacyWorkingDeckUnsafe()
  return readIndexUnsafe()
}

export const listDocuments = (): Promise<DocumentSummary[]> => serialize(async () => {
  const index = await prepareUnsafe()
  const entries = await readdir(documentsRoot(), { withFileTypes: true }).catch(() => [])
  const deckIds = (await Promise.all(entries
    .filter(entry => entry.isDirectory() && isDocumentId(entry.name))
    .map(async entry => await readStoredDeckUnsafe(entry.name) ? entry.name : null)))
    .filter((id): id is string => id !== null)
  const indexedIds = new Set(index.documents.map(document => document.id))
  if (
    deckIds.length !== indexedIds.size
    || deckIds.some(id => !indexedIds.has(id))
  ) {
    return (await rebuildIndexUnsafe(index.documents)).documents
  }
  return [...index.documents].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
})

export const createDocument = (
  presentation: unknown,
  sourceReference?: DataSourceDocumentReference,
): Promise<DocumentSummary> => serialize(async () => {
  const index = await prepareUnsafe()
  const id = randomUUID()
  const now = Date.now()
  if (sourceReference && !isSourceReference(sourceReference)) {
    throw new Error('Invalid source document reference.')
  }
  const deck: StoredDeck = {
    presentation,
    savedAt: now,
    version: DECK_STORAGE_VERSION,
    ...(sourceReference ? { sourceReference } : {}),
  }
  await mkdir(documentRoot(id), { recursive: true })
  await atomicJsonWrite(documentDeckFile(id), deck)
  const summary = await summaryFromDeck(id, deck, {
    createdAt: now,
    id,
    lastOpenedAt: now,
    slideCount: 0,
    title: '',
    updatedAt: now,
  })
  await writeIndexUnsafe([summary, ...index.documents])
  return summary
})

export const linkDocumentToSource = (
  id: string,
  sourceReference: DataSourceDocumentReference,
): Promise<DocumentSummary> => serialize(async () => {
  if (!isDocumentId(id) || !isSourceReference(sourceReference)) {
    throw new Error('Invalid source document link.')
  }
  const index = await prepareUnsafe()
  const existing = await readStoredDeckUnsafe(id)
  if (!existing) throw new Error('This presentation no longer exists.')
  const deck: StoredDeck = {
    ...existing,
    sourceReference,
  }
  await atomicJsonWrite(documentDeckFile(id), deck)
  const previous = index.documents.find(document => document.id === id)
  const summary = await summaryFromDeck(id, deck, previous)
  await writeIndexUnsafe([
    summary,
    ...index.documents.filter(document => document.id !== id),
  ])
  return summary
})

export const packageDocument = (id: string): Promise<ArrayBuffer> => serialize(async () => {
  if (!isDocumentId(id)) throw new Error('Invalid document id.')
  const index = await prepareUnsafe()
  const summary = index.documents.find(document => document.id === id)
  const stored = await readStoredDeckUnsafe(id)
  if (!summary || !stored) throw new Error('This presentation no longer exists.')
  return buildMonaDocumentPackage(
    id,
    stored.portableDocumentId ?? id,
    documentRoot(id),
    summary.createdAt,
  )
})

export const importPackagedDocument = (
  bytes: ArrayBuffer,
  sourceReference: DataSourceDocumentReference,
): Promise<DocumentSummary> => serialize(async () => {
  if (!isSourceReference(sourceReference)) throw new Error('Invalid source document link.')
  const manifest = await readMonaDocumentManifest(new Uint8Array(bytes))
  if (!manifest) throw new Error('This is not a current Mona document package.')
  const index = await prepareUnsafe()
  const linked = index.documents.find(document => (
    document.sourceReference?.sourceId === sourceReference.sourceId
    && document.sourceReference.itemId === sourceReference.itemId
  ))
  const conflicting = index.documents.find(document => (
    document.id === manifest.documentId
    && (
      document.sourceReference?.sourceId !== sourceReference.sourceId
      || document.sourceReference.itemId !== sourceReference.itemId
    )
  ))
  const id = linked?.id ?? (conflicting ? randomUUID() : manifest.documentId)
  const previous = index.documents.find(document => document.id === id)
  const { storedDeck } = await extractMonaDocumentPackage({
    bytes,
    documentId: id,
    sourceReference,
    targetRoot: documentRoot(id),
  })
  const summary = {
    ...await summaryFromDeck(id, storedDeck, previous),
    lastOpenedAt: Date.now(),
  }
  await writeIndexUnsafe([
    summary,
    ...index.documents.filter(document => document.id !== id),
  ])
  return summary
})

export const readDocument = (id: string): Promise<StoredDeck | null> => serialize(async () => {
  if (!isDocumentId(id)) return null
  const index = await prepareUnsafe()
  const deck = await readStoredDeckUnsafe(id)
  if (!deck) return null
  const previous = index.documents.find(document => document.id === id)
  const summary = {
    ...await summaryFromDeck(id, deck, previous),
    lastOpenedAt: Date.now(),
  }
  await writeIndexUnsafe([
    summary,
    ...index.documents.filter(document => document.id !== id),
  ])
  return deck
})

export const writeDocument = (id: string, presentation: unknown): Promise<number> => serialize(async () => {
  if (!isDocumentId(id)) throw new Error('Invalid document id.')
  const index = await prepareUnsafe()
  const existing = await readStoredDeckUnsafe(id)
  if (!existing) throw new Error('This presentation no longer exists.')
  const savedAt = Date.now()
  const deck: StoredDeck = {
    presentation,
    savedAt,
    version: DECK_STORAGE_VERSION,
    ...(existing.portableDocumentId ? { portableDocumentId: existing.portableDocumentId } : {}),
    ...(existing.sourceReference ? { sourceReference: existing.sourceReference } : {}),
  }
  await atomicJsonWrite(documentDeckFile(id), deck)
  const previous = index.documents.find(document => document.id === id)
  const summary = await summaryFromDeck(id, deck, previous)
  await writeIndexUnsafe([
    summary,
    ...index.documents.filter(document => document.id !== id),
  ])
  return savedAt
})

export const writeDocumentPreview = (
  id: string,
  bytes: ArrayBuffer,
  request: {
    expectedSavedAt: number
    mediaType: string
    slideId: string
  },
): Promise<DocumentSummary | null> => serialize(async () => {
  if (!isDocumentId(id)) throw new Error('Invalid document id.')
  const extension = PREVIEW_MEDIA_TYPES.get(request.mediaType)
  if (!extension) throw new Error('Unsupported presentation preview format.')
  if (
    !Number.isFinite(request.expectedSavedAt)
    || request.expectedSavedAt < 0
    || typeof request.slideId !== 'string'
    || !request.slideId
  ) throw new Error('Invalid presentation preview metadata.')
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PREVIEW_BYTES) {
    throw new Error('Presentation preview exceeds the safe size limit.')
  }

  const index = await prepareUnsafe()
  const stored = await readStoredDeckUnsafe(id)
  if (!stored) throw new Error('This presentation no longer exists.')
  // A newer deck won the race while this cover was rendering. Keeping the old
  // preview is safer than labelling stale pixels as the current revision.
  if (stored.savedAt !== request.expectedSavedAt) return null

  const root = documentPreviewsRoot(id)
  const target = join(root, `cover.${extension}`)
  const pending = `${target}.pending`
  const generatedAt = Date.now()
  await mkdir(root, { recursive: true })
  await writeFile(pending, Buffer.from(bytes))
  await rename(pending, target)
  await Promise.all(
    [...PREVIEW_MEDIA_TYPES.values()]
      .filter(candidate => candidate !== extension)
      .map(candidate => rm(join(root, `cover.${candidate}`), { force: true })),
  )
  await atomicJsonWrite(documentPreviewMetadataFile(id), {
    generatedAt,
    mediaType: request.mediaType,
    savedAt: request.expectedSavedAt,
    slideId: request.slideId,
    version: 1,
  } satisfies DocumentPreviewMetadata)

  const previous = index.documents.find(document => document.id === id)
  const summary = await summaryFromDeck(id, stored, previous)
  await writeIndexUnsafe([
    summary,
    ...index.documents.filter(document => document.id !== id),
  ])
  return summary
})

export const renameDocument = (id: string, title: string): Promise<DocumentSummary> => serialize(async () => {
  if (!isDocumentId(id)) throw new Error('Invalid document id.')
  const index = await prepareUnsafe()
  const existing = await readStoredDeckUnsafe(id)
  if (!existing) throw new Error('This presentation no longer exists.')
  const presentation = {
    ...(existing.presentation as Record<string, unknown>),
    title: title.trim(),
  }
  const savedAt = Date.now()
  const deck: StoredDeck = {
    presentation,
    savedAt,
    version: DECK_STORAGE_VERSION,
    ...(existing.portableDocumentId ? { portableDocumentId: existing.portableDocumentId } : {}),
    ...(existing.sourceReference ? { sourceReference: existing.sourceReference } : {}),
  }
  await atomicJsonWrite(documentDeckFile(id), deck)
  const previous = index.documents.find(document => document.id === id)
  const summary = await summaryFromDeck(id, deck, previous)
  await writeIndexUnsafe([
    summary,
    ...index.documents.filter(document => document.id !== id),
  ])
  return summary
})

export const duplicateDocument = (id: string, requestedTitle?: string): Promise<DocumentSummary> => serialize(async () => {
  if (!isDocumentId(id)) throw new Error('Invalid document id.')
  const index = await prepareUnsafe()
  const source = await readStoredDeckUnsafe(id)
  if (!source) throw new Error('This presentation no longer exists.')
  const duplicateId = randomUUID()
  await cp(documentRoot(id), documentRoot(duplicateId), { recursive: true })
  const details = presentationDetails(source.presentation)
  const presentation = {
    ...(replaceAssetUrls(source.presentation, id, duplicateId) as Record<string, unknown>),
    title: requestedTitle?.trim() || (details.title ? `${details.title} copy` : ''),
  }
  const now = Date.now()
  const deck: StoredDeck = { presentation, savedAt: now, version: DECK_STORAGE_VERSION }
  await atomicJsonWrite(documentDeckFile(duplicateId), deck)
  const summary = await summaryFromDeck(duplicateId, deck, {
    createdAt: now,
    id: duplicateId,
    lastOpenedAt: now,
    slideCount: details.slideCount,
    title: '',
    updatedAt: now,
  })
  await writeIndexUnsafe([summary, ...index.documents])
  return summary
})

export const deleteDocument = (id: string): Promise<void> => serialize(async () => {
  if (!isDocumentId(id)) throw new Error('Invalid document id.')
  const index = await prepareUnsafe()
  await rm(documentRoot(id), { force: true, recursive: true })
  await writeIndexUnsafe(index.documents.filter(document => document.id !== id))
})
