import type {
  DataSourceDocument,
  DataSourceSummary,
} from '@mona/data-source'
import type { DocumentJobRecord } from '@mona/document-jobs'
import type {
  ProjectRecord,
  ProjectSummary,
} from '@mona/project-core'

import type { MonaDocumentSummary } from '@/lib/mona-bridge'

export interface ProjectPageData {
  documents: MonaDocumentSummary[]
  jobs: DocumentJobRecord[]
  project: ProjectRecord
  projects: ProjectSummary[]
  sourceDocuments: DataSourceDocument[]
  sources: DataSourceSummary[]
}
