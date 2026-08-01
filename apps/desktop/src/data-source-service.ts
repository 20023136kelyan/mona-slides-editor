import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { app } from 'electron'

import type {
  DataSourceChangeEvent,
  DataSourceCreatedDocument,
  DataSourceDocument,
  DataSourceDocumentReference,
  DataSourceItem,
  DataSourcePickedDocument,
  DataSourceQuery,
  DataSourceSummary,
} from '@mona/data-source'

import type {
  CatalogItem,
  DataSourceAdapter,
  DataSourceCatalog,
  DataSourceThumbnail,
  StoredDataSourceConfig,
} from './data-source-adapter.js'
import {
  localFolderDataSourceAdapter,
  LOCAL_SOURCE_ROOT_ITEM_ID,
} from './local-folder-data-source.js'

const STORE_VERSION = 2
const SOURCE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/

interface StoredSources {
  sources: StoredDataSourceConfig[]
  version: number
}

const adapters = new Map<string, DataSourceAdapter>([
  [localFolderDataSourceAdapter.provider, localFolderDataSourceAdapter],
])

const storeRoot = () => join(app.getPath('userData'), 'data-sources')
const storeFile = () => join(storeRoot(), 'sources.json')
const catalogRoot = () => join(storeRoot(), 'catalogs')
const catalogFile = (sourceId: string) => join(catalogRoot(), `${sourceId}.json`)
const thumbnailRoot = () => join(storeRoot(), 'thumbnails')
const THUMBNAIL_CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000
const thumbnailExtension = new Map<DataSourceThumbnail['mediaType'], string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])

const atomicJsonWrite = async (target: string, value: unknown): Promise<void> => {
  const pending = `${target}.pending`
  await writeFile(pending, JSON.stringify(value))
  await rename(pending, target)
}

const isStoredSource = (value: unknown): value is StoredDataSourceConfig => {
  if (!value || typeof value !== 'object') return false
  const source = value as Partial<StoredDataSourceConfig>
  return typeof source.id === 'string'
    && SOURCE_ID.test(source.id)
    && typeof source.name === 'string'
    && source.name.trim().length > 0
    && source.provider === 'local-folder'
    && typeof source.rootPath === 'string'
    && isAbsolute(source.rootPath)
    && typeof source.createdAt === 'number'
    && Number.isFinite(source.createdAt)
    && (source.isDefaultSaveLocation === undefined || typeof source.isDefaultSaveLocation === 'boolean')
}

const isCatalogItem = (value: unknown, sourceId: string): value is CatalogItem => {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<CatalogItem>
  if (
    item.sourceId !== sourceId
    || typeof item.id !== 'string'
    || !item.id
    || typeof item.name !== 'string'
    || typeof item.relativePath !== 'string'
    || !item.relativePath
    || isAbsolute(item.relativePath)
    || (item.parentId !== null && typeof item.parentId !== 'string')
  ) return false
  if (item.kind === 'folder') return typeof item.hasChildren === 'boolean'
  return item.kind === 'document'
    && typeof item.documentType === 'string'
    && typeof item.extension === 'string'
    && typeof item.mediaType === 'string'
    && typeof item.modifiedAt === 'number'
    && Number.isFinite(item.modifiedAt)
    && typeof item.size === 'number'
    && Number.isFinite(item.size)
    && item.size >= 0
}

const isCatalog = (
  value: unknown,
  sourceId: string,
  catalogVersion: number,
): value is DataSourceCatalog => {
  if (!value || typeof value !== 'object') return false
  const catalog = value as Partial<DataSourceCatalog>
  return catalog.version === catalogVersion
    && catalog.sourceId === sourceId
    && typeof catalog.indexedAt === 'number'
    && Array.isArray(catalog.items)
    && catalog.items.every(item => isCatalogItem(item, sourceId))
}

const readStoredSources = async (): Promise<StoredDataSourceConfig[]> => {
  try {
    const parsed = JSON.parse(await readFile(storeFile(), 'utf8')) as Partial<StoredSources>
    if (
      (parsed.version !== 1 && parsed.version !== STORE_VERSION)
      || !Array.isArray(parsed.sources)
      || parsed.sources.some(source => !isStoredSource(source))
      || new Set(parsed.sources.map(source => source.id)).size !== parsed.sources.length
    ) return []
    const defaultSource = parsed.sources.find(source => source.isDefaultSaveLocation)
    return parsed.sources.map(source => ({
      ...source,
      isDefaultSaveLocation: source.id === defaultSource?.id,
    }))
  }
  catch {
    return []
  }
}

const readCatalog = async (source: StoredDataSourceConfig): Promise<DataSourceCatalog | null> => {
  try {
    const adapter = adapters.get(source.provider)
    if (!adapter) return null
    const parsed: unknown = JSON.parse(await readFile(catalogFile(source.id), 'utf8'))
    return isCatalog(parsed, source.id, adapter.catalogVersion) ? parsed : null
  }
  catch {
    return null
  }
}

const pruneThumbnailCache = async (): Promise<void> => {
  const entries = await readdir(thumbnailRoot(), { withFileTypes: true }).catch(() => [])
  const cutoff = Date.now() - THUMBNAIL_CACHE_MAX_AGE
  await Promise.all(entries.map(async entry => {
    if (!entry.isFile()) return
    const path = join(thumbnailRoot(), entry.name)
    const details = await stat(path).catch(() => null)
    if (details && details.mtimeMs < cutoff) await rm(path, { force: true })
  }))
}

export class DataSourceService {
  readonly #catalogs = new Map<string, DataSourceCatalog>()
  readonly #refreshing = new Map<string, Promise<DataSourceCatalog | null>>()
  readonly #thumbnailReads = new Map<string, Promise<DataSourceThumbnail | null>>()
  readonly #refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
  readonly #watchers = new Map<string, () => void>()
  #changeListener: ((event: DataSourceChangeEvent) => void) | null = null
  #initializing: Promise<void> | null = null
  #mutationTail = Promise.resolve()
  #sources: StoredDataSourceConfig[] = []

  onChange(listener: (event: DataSourceChangeEvent) => void): void {
    this.#changeListener = listener
  }

  async initialize(): Promise<void> {
    if (this.#initializing) return this.#initializing
    this.#initializing = (async () => {
      await Promise.all([
        mkdir(storeRoot(), { recursive: true }),
        mkdir(catalogRoot(), { recursive: true }),
        mkdir(thumbnailRoot(), { recursive: true }),
      ])
      void pruneThumbnailCache()
      this.#sources = await readStoredSources()
      const catalogs = await Promise.all(this.#sources.map(source => readCatalog(source)))
      for (const catalog of catalogs) {
        if (catalog) this.#catalogs.set(catalog.sourceId, catalog)
      }
      await Promise.all(this.#sources.map(source => this.#startWatcher(source)))
      // Reconcile changes that happened while Mona was closed without delaying
      // the first Home render, which can use the persisted last-known catalog.
      for (const source of this.#sources) this.#scheduleRefresh(source.id)
    })()
    return this.#initializing
  }

  async listSources(): Promise<DataSourceSummary[]> {
    await this.initialize()
    return Promise.all(this.#sources.map(async source => {
      const adapter = this.#adapter(source)
      return {
        capabilities: adapter.capabilities,
        createdAt: source.createdAt,
        id: source.id,
        isDefaultSaveLocation: source.isDefaultSaveLocation,
        name: source.name,
        provider: source.provider,
        rootItemId: LOCAL_SOURCE_ROOT_ITEM_ID,
        status: await adapter.inspect(source),
      }
    }))
  }

  async addLocalFolder(
    rootPath: string,
    options: { defaultSaveLocation?: boolean } = {},
  ): Promise<DataSourceSummary> {
    return this.#serialize(async () => {
      await this.initialize()
      const canonicalPath = await realpath(rootPath)
      const rootStats = await stat(canonicalPath)
      if (!rootStats.isDirectory()) throw new Error('Choose a folder to add as a data source.')
      const duplicate = this.#sources.find(source => source.rootPath === canonicalPath)
      if (duplicate) {
        if (options.defaultSaveLocation) await this.#setDefaultSaveLocationUnsafe(duplicate.id)
        return this.#summary(this.#source(duplicate.id))
      }

      const source: StoredDataSourceConfig = {
        createdAt: Date.now(),
        id: randomUUID(),
        isDefaultSaveLocation: false,
        name: basename(canonicalPath) || canonicalPath,
        provider: 'local-folder',
        rootPath: canonicalPath,
      }
      this.#sources = [...this.#sources, source]
      if (options.defaultSaveLocation) {
        this.#sources = this.#sources.map(candidate => ({
          ...candidate,
          isDefaultSaveLocation: candidate.id === source.id,
        }))
      }
      await this.#writeSources()
      await this.#refresh(source.id, true)
      await this.#startWatcher(source)
      this.#emit({ kind: 'configuration', sourceId: source.id })
      return this.#summary(this.#source(source.id))
    })
  }

  async setDefaultSaveLocation(sourceId: string): Promise<DataSourceSummary> {
    return this.#serialize(async () => {
      await this.initialize()
      await this.#setDefaultSaveLocationUnsafe(sourceId)
      return this.#summary(this.#source(sourceId))
    })
  }

  async createDocument(
    sourceId: string,
    name: string,
    bytes: ArrayBuffer,
  ): Promise<DataSourceCreatedDocument> {
    return this.#serialize(async () => {
      await this.initialize()
      const source = this.#source(sourceId)
      const adapter = this.#adapter(source)
      if (!adapter.capabilities.write) throw new Error('This data source is read-only.')
      const itemId = await adapter.createDocument(source, name, bytes)
      const catalog = await this.#refresh(source.id, true)
      const item = catalog?.items.find(candidate => candidate.id === itemId && candidate.kind === 'document')
      if (!item || item.kind !== 'document') {
        throw new Error('The saved presentation was not found after writing it.')
      }
      const { relativePath: _relativePath, ...document } = item
      this.#emit({ kind: 'content', sourceId: source.id })
      return {
        document,
        reference: { itemId: document.id, sourceId: source.id },
      }
    })
  }

  async writeDocument(
    reference: DataSourceDocumentReference,
    bytes: ArrayBuffer,
  ): Promise<DataSourceDocument> {
    return this.#serialize(async () => {
      await this.initialize()
      const source = this.#source(reference.sourceId)
      const adapter = this.#adapter(source)
      if (!adapter.capabilities.write) throw new Error('This data source is read-only.')
      let catalog = await this.#ensureCatalog(source)
      try {
        await adapter.writeDocument(source, catalog, reference.itemId, bytes)
      }
      catch {
        const refreshed = await this.#refresh(source.id, true)
        if (!refreshed) throw new Error('The selected source document is unavailable.')
        catalog = refreshed
        await adapter.writeDocument(source, catalog, reference.itemId, bytes)
      }
      const refreshed = await this.#refresh(source.id, true)
      const item = refreshed?.items.find(candidate => (
        candidate.id === reference.itemId && candidate.kind === 'document'
      ))
      if (!item || item.kind !== 'document') {
        throw new Error('The saved presentation could not be resolved after writing it.')
      }
      const { relativePath: _relativePath, ...document } = item
      this.#emit({ kind: 'content', sourceId: source.id })
      return document
    })
  }

  async renameDocument(
    reference: DataSourceDocumentReference,
    name: string,
  ): Promise<DataSourceDocument> {
    return this.#serialize(async () => {
      await this.initialize()
      const source = this.#source(reference.sourceId)
      const adapter = this.#adapter(source)
      let catalog = await this.#ensureCatalog(source)
      try {
        await adapter.renameDocument(source, catalog, reference.itemId, name)
      }
      catch {
        const refreshed = await this.#refresh(source.id, true)
        if (!refreshed) throw new Error('The selected source document is unavailable.')
        catalog = refreshed
        await adapter.renameDocument(source, catalog, reference.itemId, name)
      }
      const refreshed = await this.#refresh(source.id, true)
      const item = refreshed?.items.find(candidate => (
        candidate.id === reference.itemId && candidate.kind === 'document'
      ))
      if (!item || item.kind !== 'document') {
        throw new Error('The renamed presentation could not be resolved.')
      }
      const { relativePath: _relativePath, ...document } = item
      this.#emit({ kind: 'content', sourceId: source.id })
      return document
    })
  }

  async deleteDocument(reference: DataSourceDocumentReference): Promise<void> {
    await this.#serialize(async () => {
      await this.initialize()
      const source = this.#source(reference.sourceId)
      const adapter = this.#adapter(source)
      let catalog = await this.#ensureCatalog(source)
      try {
        await adapter.deleteDocument(source, catalog, reference.itemId)
      }
      catch {
        const refreshed = await this.#refresh(source.id, true)
        if (!refreshed) throw new Error('The selected source document is unavailable.')
        catalog = refreshed
        await adapter.deleteDocument(source, catalog, reference.itemId)
      }
      await this.#refresh(source.id, true)
      this.#emit({ kind: 'content', sourceId: source.id })
    })
  }

  async getDocument(reference: DataSourceDocumentReference): Promise<DataSourceDocument> {
    await this.initialize()
    const source = this.#source(reference.sourceId)
    const catalog = await this.#ensureCatalog(source)
    const item = catalog.items.find(candidate => (
      candidate.id === reference.itemId && candidate.kind === 'document'
    ))
    if (!item || item.kind !== 'document') {
      throw new Error('The selected source document no longer exists.')
    }
    const { relativePath: _relativePath, ...document } = item
    return document
  }

  async removeSource(sourceId: string): Promise<void> {
    await this.#serialize(async () => {
      await this.initialize()
      const source = this.#source(sourceId)
      this.#watchers.get(source.id)?.()
      this.#watchers.delete(source.id)
      const timer = this.#refreshTimers.get(source.id)
      if (timer) clearTimeout(timer)
      this.#refreshTimers.delete(source.id)
      this.#catalogs.delete(source.id)
      this.#sources = this.#sources.filter(candidate => candidate.id !== source.id)
      await Promise.all([
        this.#writeSources(),
        rm(catalogFile(source.id), { force: true }),
      ])
      this.#emit({ kind: 'configuration', sourceId: source.id })
    })
  }

  async listChildren(sourceId: string, parentItemId: string): Promise<DataSourceItem[]> {
    await this.initialize()
    const source = this.#source(sourceId)
    const catalog = await this.#ensureCatalog(source)
    return catalog.items
      .filter(item => item.parentId === parentItemId)
      .map(({ relativePath: _relativePath, ...item }) => item)
  }

  async queryDocuments(query: DataSourceQuery = {}): Promise<DataSourceDocument[]> {
    await this.initialize()
    const sources = query.scope
      ? [this.#source(query.scope.sourceId)]
      : this.#sources
    const catalogs = await Promise.all(sources.map(source => this.#ensureCatalog(source)))
    const needle = query.query?.trim().toLocaleLowerCase() ?? ''
    const documents: DataSourceDocument[] = []

    for (const catalog of catalogs) {
      const scope = query.scope?.sourceId === catalog.sourceId ? query.scope.itemId : null
      const byId = new Map(catalog.items.map(item => [item.id, item]))
      const insideScope = (document: DataSourceDocument): boolean => {
        if (!scope || scope === LOCAL_SOURCE_ROOT_ITEM_ID) return true
        if (document.id === scope) return true
        let parentId = document.parentId
        while (parentId && parentId !== LOCAL_SOURCE_ROOT_ITEM_ID) {
          if (parentId === scope) return true
          parentId = byId.get(parentId)?.parentId ?? null
        }
        return false
      }
      for (const item of catalog.items) {
        if (item.kind !== 'document') continue
        const { relativePath: _relativePath, ...document } = item
        if (insideScope(document) && (!needle || document.name.toLocaleLowerCase().includes(needle))) {
          documents.push(document)
        }
      }
    }
    return documents.sort((a, b) => b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name))
  }

  async readDocument(reference: DataSourceDocumentReference): Promise<DataSourcePickedDocument> {
    await this.initialize()
    const source = this.#source(reference.sourceId)
    let catalog = await this.#ensureCatalog(source)
    try {
      return await this.#adapter(source).readDocument(source, catalog, reference.itemId)
    }
    catch {
      const refreshed = await this.#refresh(source.id, true)
      if (!refreshed) throw new Error('The selected source document is unavailable.')
      catalog = refreshed
      return this.#adapter(source).readDocument(source, catalog, reference.itemId)
    }
  }

  async readThumbnail(reference: DataSourceDocumentReference): Promise<DataSourceThumbnail | null> {
    await this.initialize()
    const source = this.#source(reference.sourceId)
    const catalog = await this.#ensureCatalog(source)
    const item = catalog.items.find(candidate => (
      candidate.id === reference.itemId && candidate.kind === 'document'
    ))
    if (!item || item.kind !== 'document') return null
    const cacheKey = createHash('sha256')
      .update(`${source.id}\0${item.id}\0${item.modifiedAt}\0${item.size}`)
      .digest('hex')
    const active = this.#thumbnailReads.get(cacheKey)
    if (active) return active
    const operation = (async (): Promise<DataSourceThumbnail | null> => {
      for (const [mediaType, extension] of thumbnailExtension) {
        const cached = await readFile(join(thumbnailRoot(), `${cacheKey}.${extension}`)).catch(() => null)
        if (!cached) continue
        return {
          bytes: cached.buffer.slice(cached.byteOffset, cached.byteOffset + cached.byteLength) as ArrayBuffer,
          mediaType,
        }
      }
      if (await stat(join(thumbnailRoot(), `${cacheKey}.none`)).catch(() => null)) return null
      const thumbnail = await this.#adapter(source).readThumbnail(source, catalog, item.id)
      if (!thumbnail) {
        await writeFile(join(thumbnailRoot(), `${cacheKey}.none`), '')
        return null
      }
      const extension = thumbnailExtension.get(thumbnail.mediaType)
      if (!extension) return null
      await writeFile(join(thumbnailRoot(), `${cacheKey}.${extension}`), Buffer.from(thumbnail.bytes))
      return thumbnail
    })().finally(() => this.#thumbnailReads.delete(cacheKey))
    this.#thumbnailReads.set(cacheKey, operation)
    return operation
  }

  async #summary(source: StoredDataSourceConfig): Promise<DataSourceSummary> {
    const adapter = this.#adapter(source)
    return {
      capabilities: adapter.capabilities,
      createdAt: source.createdAt,
      id: source.id,
      isDefaultSaveLocation: source.isDefaultSaveLocation,
      name: source.name,
      provider: source.provider,
      rootItemId: LOCAL_SOURCE_ROOT_ITEM_ID,
      status: await adapter.inspect(source),
    }
  }

  async #setDefaultSaveLocationUnsafe(sourceId: string): Promise<void> {
    const source = this.#source(sourceId)
    if (!this.#adapter(source).capabilities.write) {
      throw new Error('This data source cannot save new presentations.')
    }
    this.#sources = this.#sources.map(candidate => ({
      ...candidate,
      isDefaultSaveLocation: candidate.id === sourceId,
    }))
    await this.#writeSources()
    this.#emit({ kind: 'configuration', sourceId })
  }

  #adapter(source: StoredDataSourceConfig): DataSourceAdapter {
    const adapter = adapters.get(source.provider)
    if (!adapter) throw new Error(`No adapter is registered for ${source.provider}.`)
    return adapter
  }

  #source(sourceId: string): StoredDataSourceConfig {
    if (!SOURCE_ID.test(sourceId)) throw new Error('Invalid data source id.')
    const source = this.#sources.find(candidate => candidate.id === sourceId)
    if (!source) throw new Error('This data source no longer exists.')
    return source
  }

  async #ensureCatalog(source: StoredDataSourceConfig): Promise<DataSourceCatalog> {
    const existing = this.#catalogs.get(source.id)
    if (existing) return existing
    const stored = await readCatalog(source)
    if (stored) {
      this.#catalogs.set(source.id, stored)
      return stored
    }
    const refreshed = await this.#refresh(source.id, true)
    if (!refreshed) throw new Error('This data source is unavailable.')
    return refreshed
  }

  async #refresh(sourceId: string, persist: boolean): Promise<DataSourceCatalog | null> {
    const active = this.#refreshing.get(sourceId)
    if (active) return active
    const source = this.#source(sourceId)
    const operation = this.#adapter(source).scan(source)
      .then(async catalog => {
        this.#catalogs.set(source.id, catalog)
        if (persist) {
          await mkdir(catalogRoot(), { recursive: true })
          await atomicJsonWrite(catalogFile(source.id), catalog)
        }
        return catalog
      })
      .catch(() => null)
      .finally(() => this.#refreshing.delete(sourceId))
    this.#refreshing.set(sourceId, operation)
    return operation
  }

  async #startWatcher(source: StoredDataSourceConfig): Promise<void> {
    this.#watchers.get(source.id)?.()
    this.#watchers.delete(source.id)
    const stop = await this.#adapter(source).watch(source, kind => {
      if (kind === 'availability') {
        this.#emit({ kind, sourceId: source.id })
      }
      this.#scheduleRefresh(source.id)
    })
    this.#watchers.set(source.id, stop)
  }

  #scheduleRefresh(sourceId: string): void {
    const previous = this.#refreshTimers.get(sourceId)
    if (previous) clearTimeout(previous)
    this.#refreshTimers.set(sourceId, setTimeout(() => {
      this.#refreshTimers.delete(sourceId)
      void this.#refresh(sourceId, true).then(catalog => {
        this.#emit({
          kind: catalog ? 'content' : 'availability',
          sourceId,
        })
      })
    }, 250))
  }

  async #writeSources(): Promise<void> {
    await mkdir(storeRoot(), { recursive: true })
    await atomicJsonWrite(storeFile(), {
      sources: this.#sources,
      version: STORE_VERSION,
    } satisfies StoredSources)
  }

  #emit(event: DataSourceChangeEvent): void {
    this.#changeListener?.(event)
  }

  #serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.#mutationTail.then(operation, operation)
    this.#mutationTail = result.then(() => undefined, () => undefined)
    return result
  }
}
