import type {
  DataSourceCapabilities,
  DataSourceDocument,
  DataSourceItem,
  DataSourceProviderKind,
  DataSourceStatus,
} from '@mona/data-source'

export interface StoredDataSourceConfig {
  createdAt: number
  id: string
  isDefaultSaveLocation: boolean
  name: string
  provider: DataSourceProviderKind
  rootPath: string
}

export type CatalogItem = DataSourceItem & {
  /** Adapter-private locator. Never crosses IPC. */
  relativePath: string
}

export interface DataSourceCatalog {
  indexedAt: number
  items: CatalogItem[]
  sourceId: string
  version: number
}

export interface DataSourceThumbnail {
  bytes: ArrayBuffer
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
}

export interface DataSourceAdapter {
  /** Increment when persisted catalog semantics change and old indexes must be rebuilt. */
  catalogVersion: number
  capabilities: DataSourceCapabilities
  createDocument: (
    source: StoredDataSourceConfig,
    name: string,
    bytes: ArrayBuffer,
  ) => Promise<string>
  inspect: (source: StoredDataSourceConfig) => Promise<DataSourceStatus>
  provider: DataSourceProviderKind
  readDocument: (
    source: StoredDataSourceConfig,
    catalog: DataSourceCatalog,
    itemId: string,
  ) => Promise<{ bytes: ArrayBuffer; document: DataSourceDocument }>
  readThumbnail: (
    source: StoredDataSourceConfig,
    catalog: DataSourceCatalog,
    itemId: string,
  ) => Promise<DataSourceThumbnail | null>
  deleteDocument: (
    source: StoredDataSourceConfig,
    catalog: DataSourceCatalog,
    itemId: string,
  ) => Promise<void>
  renameDocument: (
    source: StoredDataSourceConfig,
    catalog: DataSourceCatalog,
    itemId: string,
    name: string,
  ) => Promise<void>
  scan: (source: StoredDataSourceConfig) => Promise<DataSourceCatalog>
  writeDocument: (
    source: StoredDataSourceConfig,
    catalog: DataSourceCatalog,
    itemId: string,
    bytes: ArrayBuffer,
  ) => Promise<void>
  watch: (
    source: StoredDataSourceConfig,
    listener: (kind: 'content' | 'availability') => void,
  ) => Promise<() => void>
}
