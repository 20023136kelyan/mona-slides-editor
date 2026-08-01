import { watch } from 'node:fs'
import { copyFile, lstat, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import type { Readable } from 'node:stream'

import JSZip from 'jszip'

import type {
  DataSourceDocument,
  DataSourceDocumentType,
  DataSourceStatus,
} from '@mona/data-source'

import type {
  CatalogItem,
  DataSourceAdapter,
  DataSourceCatalog,
  DataSourceThumbnail,
  StoredDataSourceConfig,
} from './data-source-adapter.js'
import { readMonaDocumentManifestFile } from './native-document-package.js'

const CATALOG_VERSION = 2
const ROOT_ITEM_ID = 'root'
const MAX_THUMBNAIL_ARCHIVE_BYTES = 1024 * 1024 * 1024
const MAX_THUMBNAIL_BYTES = 12 * 1024 * 1024
const MAX_THUMBNAIL_ARCHIVE_ENTRIES = 20_000

const DOCUMENT_TYPES = new Map<string, {
  documentType: DataSourceDocumentType
  mediaType: string
}>([
  ['.mona', {
    documentType: 'presentation',
    mediaType: 'application/vnd.mona.presentation',
  }],
  ['.pdf', {
    documentType: 'pdf',
    mediaType: 'application/pdf',
  }],
  ['.pptist', {
    documentType: 'presentation',
    mediaType: 'application/vnd.mona.legacy-presentation',
  }],
  ['.pptx', {
    documentType: 'presentation',
    mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  }],
])

const insideRoot = (rootPath: string, target: string): boolean => {
  const normalizedRoot = resolve(rootPath)
  const normalizedTarget = resolve(target)
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${sep}`)
}

const itemId = (
  kind: 'document' | 'folder',
  entry: Awaited<ReturnType<typeof lstat>>,
): string => `${kind}:${entry.dev.toString(36)}:${entry.ino.toString(36)}`

const documentItemId = async (
  path: string,
  extension: string,
  entry: Awaited<ReturnType<typeof lstat>>,
): Promise<string> => {
  if (extension === '.mona') {
    const manifest = await readMonaDocumentManifestFile(path)
    if (manifest) return `document:mona:${manifest.documentId}`
  }
  return itemId('document', entry)
}

const publicDocument = (item: CatalogItem): DataSourceDocument => {
  if (item.kind !== 'document') throw new Error('The selected item is not a document.')
  const { relativePath: _relativePath, ...document } = item
  return document
}

const thumbnailEntries = {
  '.mona': [
    { mediaType: 'image/webp', path: 'previews/cover.webp' },
    { mediaType: 'image/png', path: 'previews/cover.png' },
    { mediaType: 'image/jpeg', path: 'previews/cover.jpg' },
    { mediaType: 'image/jpeg', path: 'previews/cover.jpeg' },
  ],
  '.pptx': [
    { mediaType: 'image/jpeg', path: 'docProps/thumbnail.jpeg' },
    { mediaType: 'image/jpeg', path: 'docProps/thumbnail.jpg' },
    { mediaType: 'image/png', path: 'docProps/thumbnail.png' },
  ],
} satisfies Record<string, Array<{ mediaType: DataSourceThumbnail['mediaType']; path: string }>>

const readBoundedArchiveEntry = async (
  entry: JSZip.JSZipObject,
): Promise<Uint8Array | null> => {
  const stream = entry.nodeStream() as Readable
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += bytes.byteLength
    if (size > MAX_THUMBNAIL_BYTES) {
      stream.destroy()
      return null
    }
    chunks.push(bytes)
  }
  return size ? Buffer.concat(chunks, size) : null
}

const readArchiveThumbnail = async (
  path: string,
  extension: string,
): Promise<DataSourceThumbnail | null> => {
  const candidates = thumbnailEntries[extension as keyof typeof thumbnailEntries]
  if (!candidates) return null
  const file = await readFile(path)
  if (file.byteLength > MAX_THUMBNAIL_ARCHIVE_BYTES) return null
  const archive = await JSZip.loadAsync(file, { checkCRC32: false, createFolders: false })
  if (Object.keys(archive.files).length > MAX_THUMBNAIL_ARCHIVE_ENTRIES) return null
  for (const candidate of candidates) {
    const entry = archive.file(candidate.path)
    if (!entry) continue
    const bytes = await readBoundedArchiveEntry(entry)
    if (!bytes) return null
    return {
      bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      mediaType: candidate.mediaType,
    }
  }
  return null
}

const scanLocalFolder = async (source: StoredDataSourceConfig): Promise<DataSourceCatalog> => {
  const rootStats = await stat(source.rootPath)
  if (!rootStats.isDirectory()) throw new Error('The configured local source is not a folder.')

  const items: CatalogItem[] = []
  const visit = async (directoryPath: string, parentId: string): Promise<void> => {
    const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => [])
    const visible = entries
      .filter(entry => !entry.name.startsWith('.') && !entry.isSymbolicLink())
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      })

    for (const entry of visible) {
      const absolutePath = join(directoryPath, entry.name)
      if (!insideRoot(source.rootPath, absolutePath)) continue
      const entryStats = await lstat(absolutePath).catch(() => null)
      if (!entryStats || entryStats.isSymbolicLink()) continue
      const relativePath = relative(source.rootPath, absolutePath)

      if (entryStats.isDirectory()) {
        const id = itemId('folder', entryStats)
        items.push({
          hasChildren: false,
          id,
          kind: 'folder',
          name: entry.name,
          parentId,
          relativePath,
          sourceId: source.id,
        })
        await visit(absolutePath, id)
        continue
      }

      if (!entryStats.isFile()) continue
      const extension = extname(entry.name).toLocaleLowerCase()
      const type = DOCUMENT_TYPES.get(extension)
      if (!type) continue
      const monaManifest = extension === '.mona'
        ? await readMonaDocumentManifestFile(absolutePath)
        : null
      items.push({
        ...type,
        ...(monaManifest ? { mediaType: 'application/vnd.mona.presentation-package' } : {}),
        extension,
        id: monaManifest
          ? `document:mona:${monaManifest.documentId}`
          : itemId('document', entryStats),
        kind: 'document',
        modifiedAt: entryStats.mtimeMs,
        name: entry.name,
        parentId,
        relativePath,
        size: entryStats.size,
        sourceId: source.id,
      })
    }
  }

  await visit(source.rootPath, ROOT_ITEM_ID)
  const foldersById = new Map(
    items
      .filter(item => item.kind === 'folder')
      .map(folder => [folder.id, folder]),
  )
  const foldersWithDocuments = new Set<string>()
  for (const document of items.filter(item => item.kind === 'document')) {
    let parentId = document.parentId
    while (parentId && parentId !== ROOT_ITEM_ID) {
      const parent = foldersById.get(parentId)
      if (!parent) break
      foldersWithDocuments.add(parent.id)
      parentId = parent.parentId
    }
  }
  const catalogItems = items.filter(item => (
    item.kind === 'document' || foldersWithDocuments.has(item.id)
  ))

  // The sidebar uses folders only as document-location filters. Empty branches
  // are omitted, and disclosure is reserved for retained child folders.
  const parentsWithChildren = new Set(
    catalogItems.filter(item => item.kind === 'folder').map(item => item.parentId),
  )
  for (const item of catalogItems) {
    if (item.kind === 'folder') item.hasChildren = parentsWithChildren.has(item.id)
  }
  return {
    indexedAt: Date.now(),
    items: catalogItems,
    sourceId: source.id,
    version: CATALOG_VERSION,
  }
}

const inspectLocalFolder = async (source: StoredDataSourceConfig): Promise<DataSourceStatus> => {
  try {
    const rootStats = await stat(source.rootPath)
    return rootStats.isDirectory() ? 'available' : 'unavailable'
  }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM') return 'permission-required'
    if (code === 'ENOENT' || code === 'ENOTDIR') return 'unavailable'
    return 'error'
  }
}

export const localFolderDataSourceAdapter: DataSourceAdapter = {
  catalogVersion: CATALOG_VERSION,
  capabilities: {
    listChildren: true,
    read: true,
    revisions: false,
    search: 'indexed',
    watch: true,
    write: true,
  },
  createDocument: async (source, requestedName, bytes) => {
    const requested = basename(requestedName).trim()
    if (!requested || requested.startsWith('.') || extname(requested).toLocaleLowerCase() !== '.mona') {
      throw new Error('New local presentations must have a safe .mona filename.')
    }
    for (let suffix = 1; suffix <= 999; suffix += 1) {
      const stem = requested.slice(0, -'.mona'.length)
      const name = suffix === 1 ? requested : `${stem} ${suffix}.mona`
      const target = join(source.rootPath, name)
      if (!insideRoot(source.rootPath, target)) throw new Error('The requested presentation path is invalid.')
      try {
        await writeFile(target, Buffer.from(bytes), { flag: 'wx' })
        const writtenStats = await lstat(target)
        return documentItemId(target, '.mona', writtenStats)
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    throw new Error('Unable to choose an unused filename in this folder.')
  },
  deleteDocument: async (source, catalog, selectedItemId) => {
    const item = catalog.items.find(candidate => (
      candidate.id === selectedItemId && candidate.kind === 'document'
    ))
    if (!item || item.kind !== 'document') {
      throw new Error('The selected local presentation no longer exists.')
    }
    if (item.extension !== '.mona') {
      throw new Error('Mona only deletes its native presentation files.')
    }
    const absolutePath = resolve(source.rootPath, item.relativePath)
    if (!insideRoot(source.rootPath, absolutePath)) throw new Error('The source document path is invalid.')
    const currentStats = await lstat(absolutePath)
    if (
      !currentStats.isFile()
      || currentStats.isSymbolicLink()
      || await documentItemId(absolutePath, item.extension, currentStats) !== item.id
    ) {
      throw new Error('The source document changed identity and must be refreshed.')
    }
    await rm(absolutePath)
  },
  inspect: inspectLocalFolder,
  provider: 'local-folder',
  readDocument: async (source, catalog, selectedItemId) => {
    const item = catalog.items.find(candidate => (
      candidate.id === selectedItemId && candidate.kind === 'document'
    ))
    if (!item || item.kind !== 'document') {
      throw new Error('The selected source document no longer exists.')
    }
    const absolutePath = resolve(source.rootPath, item.relativePath)
    if (!insideRoot(source.rootPath, absolutePath)) throw new Error('The source document path is invalid.')
    const currentStats = await lstat(absolutePath)
    if (!currentStats.isFile() || currentStats.isSymbolicLink()) {
      throw new Error('The selected source document is no longer a regular file.')
    }
    if (await documentItemId(absolutePath, item.extension, currentStats) !== item.id) {
      throw new Error('The source document changed identity and must be refreshed.')
    }
    const bytes = await readFile(absolutePath)
    return {
      bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      document: publicDocument(item),
    }
  },
  readThumbnail: async (source, catalog, selectedItemId) => {
    const item = catalog.items.find(candidate => (
      candidate.id === selectedItemId && candidate.kind === 'document'
    ))
    if (!item || item.kind !== 'document') return null
    const absolutePath = resolve(source.rootPath, item.relativePath)
    if (!insideRoot(source.rootPath, absolutePath)) return null
    const currentStats = await lstat(absolutePath).catch(() => null)
    if (
      !currentStats?.isFile()
      || currentStats.isSymbolicLink()
      || await documentItemId(absolutePath, item.extension, currentStats) !== item.id
    ) return null
    return readArchiveThumbnail(absolutePath, item.extension).catch(() => null)
  },
  renameDocument: async (source, catalog, selectedItemId, requestedName) => {
    const item = catalog.items.find(candidate => (
      candidate.id === selectedItemId && candidate.kind === 'document'
    ))
    if (!item || item.kind !== 'document') {
      throw new Error('The selected local presentation no longer exists.')
    }
    if (item.extension !== '.mona') {
      throw new Error('Mona only renames its native presentation files.')
    }
    const safeName = basename(requestedName).trim()
    if (!safeName || safeName.startsWith('.') || extname(safeName).toLocaleLowerCase() !== '.mona') {
      throw new Error('Local presentations must have a safe .mona filename.')
    }
    const absolutePath = resolve(source.rootPath, item.relativePath)
    const currentStats = await lstat(absolutePath)
    if (
      !insideRoot(source.rootPath, absolutePath)
      || !currentStats.isFile()
      || currentStats.isSymbolicLink()
      || await documentItemId(absolutePath, item.extension, currentStats) !== item.id
    ) {
      throw new Error('The source document changed identity and must be refreshed.')
    }
    const stem = safeName.slice(0, -'.mona'.length)
    for (let suffix = 1; suffix <= 999; suffix += 1) {
      const candidateName = suffix === 1 ? safeName : `${stem} ${suffix}.mona`
      const target = join(dirname(absolutePath), candidateName)
      if (!insideRoot(source.rootPath, target)) throw new Error('The requested presentation path is invalid.')
      if (target === absolutePath) return
      if (await stat(target).catch(() => null)) continue
      await rename(absolutePath, target)
      return
    }
    throw new Error('Unable to choose an unused filename in this folder.')
  },
  scan: scanLocalFolder,
  writeDocument: async (source, catalog, selectedItemId, bytes) => {
    const item = catalog.items.find(candidate => (
      candidate.id === selectedItemId && candidate.kind === 'document'
    ))
    if (!item || item.kind !== 'document') {
      throw new Error('The selected local presentation no longer exists.')
    }
    if (item.extension !== '.mona' && item.extension !== '.pptx') {
      throw new Error('Direct writeback is available only for Mona and PowerPoint presentations.')
    }
    const absolutePath = resolve(source.rootPath, item.relativePath)
    if (!insideRoot(source.rootPath, absolutePath)) throw new Error('The source document path is invalid.')
    const currentStats = await lstat(absolutePath)
    if (!currentStats.isFile() || currentStats.isSymbolicLink()) {
      throw new Error('The selected source document is no longer a regular file.')
    }
    if (await documentItemId(absolutePath, item.extension, currentStats) !== item.id) {
      throw new Error('The source document changed identity and must be refreshed.')
    }
    const pending = `${absolutePath}.pending`
    const rollback = `${absolutePath}.rollback`
    try {
      await writeFile(pending, Buffer.from(bytes))
      if (item.extension === '.mona') {
        await rename(pending, absolutePath)
      }
      else {
        // External PowerPoint identities are inode-backed. Replacing the file
        // with rename would make a successful write look like a different
        // document to the catalog, so patch it through the existing file
        // descriptor and retain a rollback copy until fsync completes.
        await copyFile(absolutePath, rollback)
        const handle = await open(absolutePath, 'r+')
        try {
          await handle.writeFile(Buffer.from(bytes))
          await handle.truncate(bytes.byteLength)
          await handle.sync()
        }
        catch (error) {
          await handle.close().catch(() => undefined)
          await copyFile(rollback, absolutePath).catch(() => undefined)
          throw error
        }
        await handle.close()
      }
    }
    finally {
      await Promise.all([
        rm(pending, { force: true }).catch(() => undefined),
        rm(rollback, { force: true }).catch(() => undefined),
      ])
    }
  },
  watch: async (source, listener) => {
    try {
      const watcher = watch(source.rootPath, { recursive: true }, () => listener('content'))
      watcher.on('error', () => listener('availability'))
      return () => watcher.close()
    }
    catch {
      listener('availability')
      return () => {}
    }
  },
}

export const LOCAL_SOURCE_ROOT_ITEM_ID = ROOT_ITEM_ID
