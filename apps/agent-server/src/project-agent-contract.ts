import type {
  DocumentJobRecord,
  PresentationDocumentChange,
} from '@mona/document-jobs'

import type { ProjectWorkspaceDocument } from './project-agent-workspace.js'

export interface ProjectAgentExecutor {
  apply: (
    explanation: string,
    changes: PresentationDocumentChange[],
  ) => Promise<DocumentJobRecord>
  prepare: () => Promise<ProjectWorkspaceDocument[]>
}
