import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

import {
  PROJECT_STORAGE_VERSION,
  isProjectAgentSessionBinding,
  isProjectArtifact,
  isProjectId,
  isProjectRecord,
  migrateProjectRecord,
  projectSummary,
  projectTitleFromPrompt,
  type AddProjectArtifactInput,
  type AppendProjectMessageInput,
  type CreateProjectInput,
  type ProjectArtifact,
  type ProjectMessage,
  type ProjectRecord,
  type ProjectSummary,
} from '@mona/project-core'
import type {
  AgentProviderId,
  AgentProviderSessionBinding,
} from '@mona/agent-protocol'

const projectsRoot = (): string => join(app.getPath('userData'), 'projects')
export const projectRoot = (id: string): string => join(projectsRoot(), id)
const projectFile = (id: string): string => join(projectRoot(id), 'project.json')

const atomicJsonWrite = async (target: string, value: unknown): Promise<void> => {
  const pending = `${target}.pending`
  await writeFile(pending, JSON.stringify(value))
  await rename(pending, target)
}

const readProjectUnsafe = async (id: string): Promise<ProjectRecord | null> => {
  if (!isProjectId(id)) return null
  try {
    const parsed: unknown = JSON.parse(await readFile(projectFile(id), 'utf8'))
    const project = migrateProjectRecord(parsed)
    if (!project || project.id !== id) return null
    if (!isProjectRecord(parsed)) await atomicJsonWrite(projectFile(id), project)
    return project
  }
  catch {
    return null
  }
}

const normalizeTitle = (title: string): string => (
  title.replace(/\s+/g, ' ').trim().slice(0, 160)
)

const artifactFromInput = (
  input: AddProjectArtifactInput,
  now: number,
): ProjectArtifact => ({
  createdAt: now,
  documentType: input.documentType,
  id: randomUUID(),
  mediaType: input.mediaType,
  name: input.name.trim(),
  reference: {
    itemId: input.reference.itemId,
    sourceId: input.reference.sourceId,
  },
  state: input.state ?? 'referenced',
  updatedAt: now,
})

const isArtifactInput = (value: unknown): value is AddProjectArtifactInput => {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<AddProjectArtifactInput>
  const now = Date.now()
  return isProjectArtifact({
    createdAt: now,
    documentType: input.documentType,
    id: 'candidate',
    mediaType: input.mediaType,
    name: input.name,
    reference: input.reference,
    state: input.state ?? 'referenced',
    updatedAt: now,
  })
}

export class ProjectStore {
  #changeListener: (() => void) | null = null
  #mutationTail = Promise.resolve()

  onChange(listener: () => void): void {
    this.#changeListener = listener
  }

  list(): Promise<ProjectSummary[]> {
    return this.#serialize(async () => {
      await mkdir(projectsRoot(), { recursive: true })
      const entries = await readdir(projectsRoot(), { withFileTypes: true }).catch(() => [])
      const projects = (await Promise.all(entries
        .filter(entry => entry.isDirectory() && isProjectId(entry.name))
        .map(entry => readProjectUnsafe(entry.name))))
        .filter((project): project is ProjectRecord => project !== null)
      return projects
        .map(projectSummary)
        .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt || b.updatedAt - a.updatedAt)
    })
  }

  create(input: CreateProjectInput = {}): Promise<ProjectRecord> {
    return this.#serialize(async () => {
      if (input.artifacts?.some(artifact => !isArtifactInput(artifact))) {
        throw new Error('The project contains an invalid document reference.')
      }
      const id = randomUUID()
      const now = Date.now()
      const project: ProjectRecord = {
        artifacts: (input.artifacts ?? []).map(artifact => artifactFromInput(artifact, now)),
        createdAt: now,
        id,
        lastOpenedAt: now,
        messages: [],
        title: normalizeTitle(input.title ?? ''),
        updatedAt: now,
        version: PROJECT_STORAGE_VERSION,
      }
      if (!isProjectRecord(project)) {
        throw new Error('The project contains duplicate or invalid document references.')
      }
      await mkdir(projectRoot(id), { recursive: true })
      await atomicJsonWrite(projectFile(id), project)
      this.#emit()
      return project
    })
  }

  read(id: string): Promise<ProjectRecord | null> {
    return this.#serialize(async () => {
      const project = await readProjectUnsafe(id)
      if (!project) return null
      const opened = { ...project, lastOpenedAt: Date.now() }
      await atomicJsonWrite(projectFile(id), opened)
      return opened
    })
  }

  /**
   * Reads without changing recency. The agent uses this while streaming so every
   * token cannot reshuffle the sidebar.
   */
  peek(id: string): Promise<ProjectRecord | null> {
    return this.#serialize(() => readProjectUnsafe(id))
  }

  rename(id: string, title: string): Promise<ProjectRecord> {
    return this.#mutate(id, project => ({
      ...project,
      title: normalizeTitle(title),
      updatedAt: Date.now(),
    }))
  }

  appendMessage(id: string, input: AppendProjectMessageInput): Promise<ProjectRecord> {
    const content = input.content.trim()
    if (!content) return Promise.reject(new Error('A project message cannot be empty.'))
    return this.#mutate(id, project => {
      const now = Date.now()
      const message: ProjectMessage = {
        content,
        createdAt: now,
        id: input.id && isProjectId(input.id) ? input.id : randomUUID(),
        role: input.role,
        status: input.status ?? 'complete',
      }
      if (project.messages.some(candidate => candidate.id === message.id)) {
        return project
      }
      const firstUserMessage = input.role === 'user'
        && !project.messages.some(candidate => candidate.role === 'user')
      return {
        ...project,
        messages: [...project.messages, message],
        title: !project.title && firstUserMessage
          ? projectTitleFromPrompt(content)
          : project.title,
        updatedAt: now,
      }
    })
  }

  addArtifact(id: string, input: AddProjectArtifactInput): Promise<ProjectRecord> {
    if (!isArtifactInput(input)) {
      return Promise.reject(new Error('The project document reference is invalid.'))
    }
    return this.#mutate(id, project => {
      const existing = project.artifacts.find(artifact => (
        artifact.reference.sourceId === input.reference.sourceId
        && artifact.reference.itemId === input.reference.itemId
      ))
      if (existing) return project
      const now = Date.now()
      return {
        ...project,
        artifacts: [...project.artifacts, artifactFromInput(input, now)],
        updatedAt: now,
      }
    })
  }

  removeArtifact(id: string, artifactId: string): Promise<ProjectRecord> {
    if (!isProjectId(artifactId)) {
      return Promise.reject(new Error('Invalid project artifact id.'))
    }
    return this.#mutate(id, project => ({
      ...project,
      artifacts: project.artifacts.filter(artifact => artifact.id !== artifactId),
      updatedAt: Date.now(),
    }))
  }

  updateArtifactState(
    id: string,
    artifactId: string,
    state: ProjectArtifact['state'],
  ): Promise<ProjectRecord> {
    if (!isProjectId(artifactId)) {
      return Promise.reject(new Error('Invalid project artifact id.'))
    }
    return this.#mutate(id, project => {
      const now = Date.now()
      let changed = false
      const artifacts = project.artifacts.map(artifact => {
        if (artifact.id !== artifactId || artifact.state === state) return artifact
        changed = true
        return { ...artifact, state, updatedAt: now }
      })
      return changed ? { ...project, artifacts, updatedAt: now } : project
    })
  }

  setAgentSessionBinding(
    id: string,
    providerId: AgentProviderId,
    binding: AgentProviderSessionBinding,
  ): Promise<ProjectRecord> {
    if (!isProjectAgentSessionBinding(binding)) {
      return Promise.reject(new Error('Invalid agent session binding.'))
    }
    return this.#mutate(id, project => {
      const current = project.agentSessions?.[providerId]
      if (
        current?.sessionId === binding.sessionId
        && current.modelId === binding.modelId
        && current.synchronizedThroughMessageId === binding.synchronizedThroughMessageId
      ) return project
      return {
        ...project,
        agentSessions: { ...project.agentSessions, [providerId]: binding },
        updatedAt: Date.now(),
      }
    }, false)
  }

  delete(id: string): Promise<void> {
    return this.#serialize(async () => {
      if (!isProjectId(id)) throw new Error('Invalid project id.')
      await rm(projectRoot(id), { force: true, recursive: true })
      this.#emit()
    })
  }

  #mutate(
    id: string,
    change: (project: ProjectRecord) => ProjectRecord,
    notify = true,
  ): Promise<ProjectRecord> {
    return this.#serialize(async () => {
      if (!isProjectId(id)) throw new Error('Invalid project id.')
      const existing = await readProjectUnsafe(id)
      if (!existing) throw new Error('This project no longer exists.')
      const updated = change(existing)
      if (!isProjectRecord(updated)) throw new Error('The project update is invalid.')
      if (updated !== existing) await atomicJsonWrite(projectFile(id), updated)
      if (notify && updated !== existing) this.#emit()
      return updated
    })
  }

  #serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.#mutationTail.then(operation, operation)
    this.#mutationTail = result.then(() => undefined, () => undefined)
    return result
  }

  #emit(): void {
    this.#changeListener?.()
  }
}

export const projectStore = new ProjectStore()
