import type { DataSourceDocumentReference } from '@mona/data-source'

export const DOCUMENT_JOB_STORAGE_VERSION = 1

export type DocumentJobStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export type DocumentJobStepStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'skipped'

export interface DocumentSourceRevision {
  contentHash: string
  modifiedAt: number
  size: number
}

export interface DocumentJobStep {
  artifactId: string
  createdAt: number
  error?: string
  expectedRevision: DocumentSourceRevision
  finishedAt?: number
  id: string
  name: string
  operation: 'presentation.replace'
  reference: DataSourceDocumentReference
  startedAt?: number
  status: DocumentJobStepStatus
  updatedAt: number
}

export interface DocumentJobRecord {
  cancelRequested: boolean
  createdAt: number
  explanation: string
  finishedAt?: number
  id: string
  projectId: string
  startedAt?: number
  status: DocumentJobStatus
  steps: DocumentJobStep[]
  updatedAt: number
  version: typeof DOCUMENT_JOB_STORAGE_VERSION
}

export interface CreateDocumentJobStepInput {
  artifactId: string
  expectedRevision: DocumentSourceRevision
  name: string
  operation: DocumentJobStep['operation']
  reference: DataSourceDocumentReference
}

export interface CreateDocumentJobInput {
  explanation: string
  projectId: string
  steps: CreateDocumentJobStepInput[]
}

/**
 * Ephemeral commit payload passed from an agent workspace to the desktop job
 * engine. It is intentionally never written into the durable job record.
 */
export interface PresentationDocumentChange {
  addedAssets: Record<string, { base64: string; mediaType: string }>
  artifactId: string
  expectedRevision: DocumentSourceRevision
  presentation: unknown
}

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/
const HASH = /^[a-f0-9]{64}$/

export const isDocumentJobId = (value: unknown): value is string => (
  typeof value === 'string' && ID.test(value)
)

const isTimestamp = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0
)

const isReference = (value: unknown): value is DataSourceDocumentReference => {
  if (!value || typeof value !== 'object') return false
  const reference = value as Partial<DataSourceDocumentReference>
  return typeof reference.itemId === 'string'
    && reference.itemId.length > 0
    && typeof reference.sourceId === 'string'
    && reference.sourceId.length > 0
}

export const isDocumentSourceRevision = (
  value: unknown,
): value is DocumentSourceRevision => {
  if (!value || typeof value !== 'object') return false
  const revision = value as Partial<DocumentSourceRevision>
  return typeof revision.contentHash === 'string'
    && HASH.test(revision.contentHash)
    && isTimestamp(revision.modifiedAt)
    && typeof revision.size === 'number'
    && Number.isFinite(revision.size)
    && revision.size >= 0
}

export const isDocumentJobStep = (value: unknown): value is DocumentJobStep => {
  if (!value || typeof value !== 'object') return false
  const step = value as Partial<DocumentJobStep>
  return isDocumentJobId(step.id)
    && isDocumentJobId(step.artifactId)
    && typeof step.name === 'string'
    && step.name.length > 0
    && step.operation === 'presentation.replace'
    && isReference(step.reference)
    && isDocumentSourceRevision(step.expectedRevision)
    && isTimestamp(step.createdAt)
    && isTimestamp(step.updatedAt)
    && (step.startedAt === undefined || isTimestamp(step.startedAt))
    && (step.finishedAt === undefined || isTimestamp(step.finishedAt))
    && (step.error === undefined || typeof step.error === 'string')
    && (
      step.status === 'pending'
      || step.status === 'running'
      || step.status === 'succeeded'
      || step.status === 'failed'
      || step.status === 'cancelled'
      || step.status === 'skipped'
    )
}

export const isDocumentJobRecord = (value: unknown): value is DocumentJobRecord => {
  if (!value || typeof value !== 'object') return false
  const job = value as Partial<DocumentJobRecord>
  return job.version === DOCUMENT_JOB_STORAGE_VERSION
    && isDocumentJobId(job.id)
    && isDocumentJobId(job.projectId)
    && typeof job.explanation === 'string'
    && job.explanation.length > 0
    && typeof job.cancelRequested === 'boolean'
    && isTimestamp(job.createdAt)
    && isTimestamp(job.updatedAt)
    && (job.startedAt === undefined || isTimestamp(job.startedAt))
    && (job.finishedAt === undefined || isTimestamp(job.finishedAt))
    && (
      job.status === 'queued'
      || job.status === 'running'
      || job.status === 'cancelling'
      || job.status === 'succeeded'
      || job.status === 'partial'
      || job.status === 'failed'
      || job.status === 'cancelled'
      || job.status === 'interrupted'
    )
    && Array.isArray(job.steps)
    && job.steps.length > 0
    && job.steps.every(isDocumentJobStep)
    && new Set(job.steps.map(step => step.id)).size === job.steps.length
}

export const isTerminalDocumentJobStatus = (status: DocumentJobStatus): boolean => (
  status === 'succeeded'
  || status === 'partial'
  || status === 'failed'
  || status === 'cancelled'
  || status === 'interrupted'
)

export const documentJobProgress = (
  job: Pick<DocumentJobRecord, 'steps'>,
): { completed: number; percent: number; total: number } => {
  const total = job.steps.length
  const completed = job.steps.filter(step => (
    step.status === 'succeeded'
    || step.status === 'failed'
    || step.status === 'cancelled'
    || step.status === 'skipped'
  )).length
  return {
    completed,
    percent: total ? Math.round((completed / total) * 100) : 0,
    total,
  }
}
