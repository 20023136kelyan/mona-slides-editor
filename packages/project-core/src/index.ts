import type {
  DataSourceDocumentReference,
  DataSourceDocumentType,
} from '@mona/data-source'
import {
  isAgentProviderId,
  type AgentProviderId,
  type AgentProviderSessionBinding,
} from '@mona/agent-protocol'

export const PROJECT_STORAGE_VERSION = 2

export type ProjectMessageRole = 'assistant' | 'user'
export type ProjectMessageStatus = 'complete' | 'error' | 'interrupted'
export type ProjectArtifactState = 'created' | 'modified' | 'referenced'

/**
 * A project keeps the provider-neutral identity of a document, never a path,
 * provider token, or project-owned copy of the source file.
 */
export interface ProjectArtifact {
  createdAt: number
  documentType: DataSourceDocumentType
  id: string
  mediaType: string
  name: string
  reference: DataSourceDocumentReference
  state: ProjectArtifactState
  updatedAt: number
}

export interface ProjectMessage {
  content: string
  createdAt: number
  id: string
  role: ProjectMessageRole
  status: ProjectMessageStatus
}

export interface ProjectSummary {
  artifactCount: number
  createdAt: number
  id: string
  lastOpenedAt: number
  messageCount: number
  title: string
  updatedAt: number
}

export interface ProjectRecord {
  /** Native provider sessions retained behind one canonical conversation. */
  agentSessions?: Partial<Record<AgentProviderId, AgentProviderSessionBinding>>
  artifacts: ProjectArtifact[]
  createdAt: number
  id: string
  lastOpenedAt: number
  messages: ProjectMessage[]
  title: string
  updatedAt: number
  version: typeof PROJECT_STORAGE_VERSION
}

export interface CreateProjectInput {
  artifacts?: AddProjectArtifactInput[]
  title?: string
}

export type AddProjectArtifactInput = Pick<
  ProjectArtifact,
  'documentType' | 'mediaType' | 'name' | 'reference'
> & {
  state?: ProjectArtifactState
}

export interface AppendProjectMessageInput {
  content: string
  id?: string
  role: ProjectMessageRole
  status?: ProjectMessageStatus
}

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/
const SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,255}$/

export const isProjectId = (value: unknown): value is string => (
  typeof value === 'string' && ID.test(value)
)

export const isProjectAgentSessionId = (value: unknown): value is string => (
  typeof value === 'string' && SESSION_ID.test(value)
)

export const isProjectAgentSessionBinding = (
  value: unknown,
): value is AgentProviderSessionBinding => {
  if (!value || typeof value !== 'object') return false
  const binding = value as Partial<AgentProviderSessionBinding>
  return (
    isProjectAgentSessionId(binding.sessionId)
    && typeof binding.modelId === 'string'
    && binding.modelId.length > 0
    && binding.modelId.length <= 256
    && (binding.synchronizedThroughMessageId === undefined
      || isProjectId(binding.synchronizedThroughMessageId))
  )
}

const isAgentSessions = (
  value: unknown,
): value is Partial<Record<AgentProviderId, AgentProviderSessionBinding>> => {
  if (value === undefined) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.entries(value).every(([providerId, binding]) => (
    isAgentProviderId(providerId) && isProjectAgentSessionBinding(binding)
  ))
}

const isFiniteTimestamp = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0
)

const isDocumentReference = (value: unknown): value is DataSourceDocumentReference => {
  if (!value || typeof value !== 'object') return false
  const reference = value as Partial<DataSourceDocumentReference>
  return (
    typeof reference.itemId === 'string'
    && reference.itemId.length > 0
    && typeof reference.sourceId === 'string'
    && reference.sourceId.length > 0
  )
}

export const isProjectArtifact = (value: unknown): value is ProjectArtifact => {
  if (!value || typeof value !== 'object') return false
  const artifact = value as Partial<ProjectArtifact>
  return (
    isProjectId(artifact.id)
    && isFiniteTimestamp(artifact.createdAt)
    && isFiniteTimestamp(artifact.updatedAt)
    && artifact.updatedAt >= artifact.createdAt
    && (artifact.documentType === 'presentation'
      || artifact.documentType === 'pdf'
      || artifact.documentType === 'document')
    && typeof artifact.mediaType === 'string'
    && artifact.mediaType.length > 0
    && typeof artifact.name === 'string'
    && artifact.name.length > 0
    && isDocumentReference(artifact.reference)
    && (artifact.state === 'created'
      || artifact.state === 'modified'
      || artifact.state === 'referenced')
  )
}

export const isProjectMessage = (value: unknown): value is ProjectMessage => {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<ProjectMessage>
  return (
    isProjectId(message.id)
    && typeof message.content === 'string'
    && message.content.length > 0
    && isFiniteTimestamp(message.createdAt)
    && (message.role === 'assistant' || message.role === 'user')
    && (message.status === 'complete'
      || message.status === 'error'
      || message.status === 'interrupted')
  )
}

export const isProjectRecord = (value: unknown): value is ProjectRecord => {
  if (!value || typeof value !== 'object') return false
  const project = value as Partial<ProjectRecord>
  return (
    project.version === PROJECT_STORAGE_VERSION
    && isProjectId(project.id)
    && typeof project.title === 'string'
    && isFiniteTimestamp(project.createdAt)
    && isFiniteTimestamp(project.updatedAt)
    && isFiniteTimestamp(project.lastOpenedAt)
    && project.updatedAt >= project.createdAt
    && project.lastOpenedAt >= project.createdAt
    && isAgentSessions(project.agentSessions)
    && Array.isArray(project.messages)
    && project.messages.every(isProjectMessage)
    && new Set(project.messages.map(message => message.id)).size === project.messages.length
    && Array.isArray(project.artifacts)
    && project.artifacts.every(isProjectArtifact)
    && new Set(project.artifacts.map(artifact => artifact.id)).size === project.artifacts.length
    && new Set(project.artifacts.map(artifact => (
      `${artifact.reference.sourceId}:${artifact.reference.itemId}`
    ))).size === project.artifacts.length
  )
}

/**
 * Upgrade the only previous on-disk shape without discarding its Claude thread.
 * Future readers only accept the current record after this boundary.
 */
export const migrateProjectRecord = (value: unknown): ProjectRecord | null => {
  if (isProjectRecord(value)) return value
  if (!value || typeof value !== 'object') return null
  const legacy = value as Record<string, unknown>
  if (legacy.version !== 1) return null

  const { agentSessionId, ...content } = legacy
  const migrated: Record<string, unknown> = {
    ...content,
    version: PROJECT_STORAGE_VERSION,
  }
  if (isProjectAgentSessionId(agentSessionId)) {
    migrated.agentSessions = {
      anthropic: {
        modelId: 'default',
        sessionId: agentSessionId,
      },
    }
  }
  return isProjectRecord(migrated) ? migrated : null
}

export const projectSummary = (project: ProjectRecord): ProjectSummary => ({
  artifactCount: project.artifacts.length,
  createdAt: project.createdAt,
  id: project.id,
  lastOpenedAt: project.lastOpenedAt,
  messageCount: project.messages.length,
  title: project.title,
  updatedAt: project.updatedAt,
})

/**
 * The first real request gives an unnamed thread a useful local title. It is a
 * display aid, not document content, and can always be renamed by the user.
 */
export const projectTitleFromPrompt = (prompt: string): string => {
  const firstLine = prompt
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?。！？]\s.*$/, '')
  if (firstLine.length <= 56) return firstLine
  return `${firstLine.slice(0, 55).trimEnd()}\u2026`
}
