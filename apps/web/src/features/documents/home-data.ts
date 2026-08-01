import type {
  DataSourceDocument,
  DataSourceSummary,
} from '@mona/data-source'

import type { MonaDocumentSummary } from '@/lib/mona-bridge'
import type { ProjectSummary } from '@mona/project-core'

import type { DocumentBrowserScope } from './use-data-source-browser'

export interface DocumentHomeData {
  documents: MonaDocumentSummary[]
  initialScope: DocumentBrowserScope
  projects: ProjectSummary[]
  sourceDocuments: DataSourceDocument[]
  sources: DataSourceSummary[]
}
