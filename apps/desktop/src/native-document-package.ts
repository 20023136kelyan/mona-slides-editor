import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

import JSZip from 'jszip'

import type { DataSourceDocumentReference } from '@mona/data-source'

export const MONA_DOCUMENT_FORMAT = 'mona.presentation'
export const MONA_DOCUMENT_PACKAGE_VERSION = 1

const MAX_ARCHIVE_BYTES = 1_073_741_824
const MAX_DECK_BYTES = 64 * 1024 * 1024
const MAX_ENTRY_COUNT = 20_000
const MAX_ENTRY_BYTES = 512 * 1024 * 1024
const DOCUMENT_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/

export interface MonaDocumentManifest {
  createdAt: number
  documentId: string
  format: typeof MONA_DOCUMENT_FORMAT
  updatedAt: number
  version: typeof MONA_DOCUMENT_PACKAGE_VERSION
}

interface StoredPackageDeck {
  portableDocumentId?: string
  presentation: unknown
  savedAt: number
  sourceReference?: DataSourceDocumentReference
  version: number
}

const isTimestamp = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0
)

const isManifest = (value: unknown): value is MonaDocumentManifest => {
  if (!value || typeof value !== 'object') return false
  const manifest = value as Partial<MonaDocumentManifest>
  return manifest.format === MONA_DOCUMENT_FORMAT
    && manifest.version === MONA_DOCUMENT_PACKAGE_VERSION
    && typeof manifest.documentId === 'string'
    && DOCUMENT_ID.test(manifest.documentId)
    && isTimestamp(manifest.createdAt)
    && isTimestamp(manifest.updatedAt)
}

const isStoredDeck = (value: unknown): value is StoredPackageDeck => {
  if (!value || typeof value !== 'object') return false
  const deck = value as Partial<StoredPackageDeck>
  return typeof deck.version === 'number'
    && isTimestamp(deck.savedAt)
    && !!deck.presentation
    && typeof deck.presentation === 'object'
}

const parseManifest = (value: string): MonaDocumentManifest | null => {
  try {
    const parsed: unknown = JSON.parse(value)
    return isManifest(parsed) ? parsed : null
  }
  catch {
    return null
  }
}

const loadArchive = async (bytes: Uint8Array): Promise<JSZip> => {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error('This Mona document is too large to open safely.')
  }
  const archive = await JSZip.loadAsync(bytes, {
    checkCRC32: true,
    createFolders: false,
  })
  const entries = Object.values(archive.files)
  if (entries.length > MAX_ENTRY_COUNT) {
    throw new Error('This Mona document contains too many package entries.')
  }
  return archive
}

export const readMonaDocumentManifest = async (
  bytes: Uint8Array,
): Promise<MonaDocumentManifest | null> => {
  try {
    const archive = await loadArchive(bytes)
    const entry = archive.file('manifest.json')
    if (!entry) return null
    return parseManifest(await entry.async('string'))
  }
  catch {
    return null
  }
}

export const readMonaDocumentManifestFile = async (
  path: string,
): Promise<MonaDocumentManifest | null> => {
  const file = await readFile(path).catch(() => null)
  return file ? readMonaDocumentManifest(file) : null
}

const collectFiles = async (root: string): Promise<Array<{ absolutePath: string; packagePath: string }>> => {
  const files: Array<{ absolutePath: string; packagePath: string }> = []
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.endsWith('.pending')) continue
      const absolutePath = join(directory, entry.name)
      const packagePath = relative(root, absolutePath).split(sep).join('/')
      if (entry.isDirectory()) {
        await visit(absolutePath)
      }
      else if (entry.isFile() && (
        packagePath === 'deck.json'
        || packagePath.startsWith('assets/')
        || packagePath.startsWith('data/')
        || packagePath.startsWith('previews/')
      )) {
        files.push({ absolutePath, packagePath })
      }
    }
  }
  await visit(root)
  return files
}

export const buildMonaDocumentPackage = async (
  documentId: string,
  portableDocumentId: string,
  documentRoot: string,
  createdAt: number,
): Promise<ArrayBuffer> => {
  if (!DOCUMENT_ID.test(documentId) || !DOCUMENT_ID.test(portableDocumentId)) {
    throw new Error('Invalid Mona document identity.')
  }
  const deck = JSON.parse(await readFile(join(documentRoot, 'deck.json'), 'utf8')) as unknown
  if (!isStoredDeck(deck)) throw new Error('The Mona recovery copy is not a valid presentation.')

  const archive = new JSZip()
  const manifest: MonaDocumentManifest = {
    createdAt,
    documentId: portableDocumentId,
    format: MONA_DOCUMENT_FORMAT,
    updatedAt: deck.savedAt,
    version: MONA_DOCUMENT_PACKAGE_VERSION,
  }
  archive.file('manifest.json', JSON.stringify(manifest))
  const files = await collectFiles(documentRoot)
  for (const file of files) {
    if (file.packagePath === 'deck.json') {
      const {
        portableDocumentId: _portableDocumentId,
        sourceReference: _machineSpecificReference,
        ...portableDeck
      } = deck
      archive.file(file.packagePath, JSON.stringify({
        ...portableDeck,
        presentation: replaceAssetOwner(
          portableDeck.presentation,
          documentId,
          portableDocumentId,
        ),
      }), { compression: 'DEFLATE' })
    }
    else {
      archive.file(file.packagePath, await readFile(file.absolutePath), { compression: 'STORE' })
    }
  }
  return archive.generateAsync({
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    type: 'arraybuffer',
  })
}

const safePackagePath = (path: string): boolean => {
  if (!path || path.startsWith('/') || path.includes('\\')) return false
  const normalized = path.split('/').filter(Boolean)
  if (!normalized.length || normalized.some(part => part === '.' || part === '..')) return false
  return path === 'deck.json'
    || path.startsWith('assets/')
    || path.startsWith('data/')
    || path.startsWith('previews/')
}

const replaceAssetOwner = (value: unknown, fromId: string, toId: string): unknown => {
  if (typeof value === 'string') {
    const prefix = `mona://asset/${encodeURIComponent(fromId)}/`
    return value.startsWith(prefix)
      ? `mona://asset/${encodeURIComponent(toId)}/${value.slice(prefix.length)}`
      : value
  }
  if (Array.isArray(value)) return value.map(entry => replaceAssetOwner(entry, fromId, toId))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, replaceAssetOwner(entry, fromId, toId)]),
  )
}

export const extractMonaDocumentPackage = async ({
  bytes,
  documentId,
  sourceReference,
  targetRoot,
}: {
  bytes: ArrayBuffer
  documentId: string
  sourceReference: DataSourceDocumentReference
  targetRoot: string
}): Promise<{ manifest: MonaDocumentManifest; storedDeck: StoredPackageDeck }> => {
  if (!DOCUMENT_ID.test(documentId)) throw new Error('Invalid Mona document identity.')
  const archive = await loadArchive(new Uint8Array(bytes))
  const manifestEntry = archive.file('manifest.json')
  const deckEntry = archive.file('deck.json')
  if (!manifestEntry || !deckEntry) throw new Error('This is not a complete Mona document.')

  const manifest = parseManifest(await manifestEntry.async('string'))
  if (!manifest) throw new Error('This Mona document has an invalid manifest.')
  const deckText = await deckEntry.async('string')
  if (new TextEncoder().encode(deckText).byteLength > MAX_DECK_BYTES) {
    throw new Error('This Mona document has an oversized presentation model.')
  }
  const parsedDeck: unknown = JSON.parse(deckText)
  if (!isStoredDeck(parsedDeck)) throw new Error('This Mona document has an invalid presentation model.')
  const storedDeck: StoredPackageDeck = {
    ...parsedDeck,
    portableDocumentId: manifest.documentId,
    presentation: replaceAssetOwner(parsedDeck.presentation, manifest.documentId, documentId),
    sourceReference,
  }

  const parent = dirname(targetRoot)
  const staging = join(parent, `.${basename(targetRoot)}.${Date.now().toString(36)}.pending`)
  const backup = `${targetRoot}.previous`
  await rm(staging, { force: true, recursive: true })
  await mkdir(staging, { recursive: true })
  try {
    let expandedBytes = 0
    for (const [path, entry] of Object.entries(archive.files)) {
      if (entry.dir || path === 'manifest.json' || path === 'deck.json') continue
      if (!safePackagePath(path)) throw new Error('This Mona document contains an unsafe package path.')
      const target = resolve(staging, path)
      if (!target.startsWith(`${resolve(staging)}${sep}`)) {
        throw new Error('This Mona document contains an unsafe package path.')
      }
      const content = await entry.async('uint8array')
      expandedBytes += content.byteLength
      if (content.byteLength > MAX_ENTRY_BYTES || expandedBytes > MAX_ARCHIVE_BYTES) {
        throw new Error('This Mona document expands beyond the safe package limit.')
      }
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, content)
    }
    await writeFile(join(staging, 'deck.json'), JSON.stringify(storedDeck))
    await rm(backup, { force: true, recursive: true })
    if (await stat(targetRoot).catch(() => null)) await rename(targetRoot, backup)
    await rename(staging, targetRoot)
    await rm(backup, { force: true, recursive: true })
  }
  catch (error) {
    await rm(staging, { force: true, recursive: true })
    if (!await stat(targetRoot).catch(() => null) && await stat(backup).catch(() => null)) {
      await rename(backup, targetRoot)
    }
    throw error
  }
  return { manifest, storedDeck }
}
