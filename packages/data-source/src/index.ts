/**
 * Provider-neutral vocabulary shared by Mona's desktop host and renderer.
 *
 * Provider-native identifiers are deliberately opaque outside an adapter. A
 * renderer can retain `{ sourceId, itemId }`, but it cannot turn that pair into
 * a filesystem path or a cloud API request without returning to the host.
 */

export type DataSourceProviderKind =
  | 'local-folder'
  | 'google-drive'
  | 'icloud-drive'
  | 'onedrive'
  | 'nas'

export type DataSourceStatus =
  | 'available'
  | 'unavailable'
  | 'permission-required'
  | 'error'

export interface DataSourceCapabilities {
  listChildren: boolean
  read: boolean
  revisions: boolean
  search: 'indexed' | 'native' | 'none'
  watch: boolean
  write: boolean
}

export interface DataSourceSummary {
  capabilities: DataSourceCapabilities
  createdAt: number
  id: string
  isDefaultSaveLocation: boolean
  name: string
  provider: DataSourceProviderKind
  rootItemId: string
  status: DataSourceStatus
}

export interface DataSourceItemBase {
  id: string
  name: string
  parentId: string | null
  sourceId: string
}

export interface DataSourceFolder extends DataSourceItemBase {
  hasChildren: boolean
  kind: 'folder'
}

export type DataSourceDocumentType = 'presentation' | 'pdf' | 'document'

export interface DataSourceDocument extends DataSourceItemBase {
  documentType: DataSourceDocumentType
  extension: string
  kind: 'document'
  mediaType: string
  modifiedAt: number
  size: number
}

export type DataSourceItem = DataSourceFolder | DataSourceDocument

export interface DataSourceDocumentReference {
  itemId: string
  sourceId: string
}

export interface DataSourceQuery {
  query?: string
  scope?: DataSourceDocumentReference
}

export interface DataSourceChangeEvent {
  kind: 'configuration' | 'content' | 'availability'
  sourceId?: string
}

export interface DataSourcePickedDocument {
  bytes: ArrayBuffer
  document: DataSourceDocument
}

export interface DataSourceCreatedDocument {
  document: DataSourceDocument
  reference: DataSourceDocumentReference
}
