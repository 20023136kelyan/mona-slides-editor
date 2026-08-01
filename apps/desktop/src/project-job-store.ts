import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  DOCUMENT_JOB_STORAGE_VERSION,
  isDocumentJobId,
  isDocumentJobRecord,
  isTerminalDocumentJobStatus,
  type CreateDocumentJobInput,
  type DocumentJobRecord,
  type DocumentJobStatus,
  type DocumentJobStep,
  type DocumentJobStepStatus,
} from '@mona/document-jobs'
import { isProjectId } from '@mona/project-core'

import { projectRoot } from './project-store.js'

const jobsRoot = (projectId: string): string => join(projectRoot(projectId), 'jobs')
const jobFile = (projectId: string, jobId: string): string => (
  join(jobsRoot(projectId), `${jobId}.json`)
)

const atomicJsonWrite = async (target: string, value: unknown): Promise<void> => {
  const pending = `${target}.pending`
  await writeFile(pending, JSON.stringify(value))
  await rename(pending, target)
}

const readJobUnsafe = async (
  projectId: string,
  jobId: string,
): Promise<DocumentJobRecord | null> => {
  if (!isProjectId(projectId) || !isDocumentJobId(jobId)) return null
  try {
    const parsed: unknown = JSON.parse(await readFile(jobFile(projectId, jobId), 'utf8'))
    return isDocumentJobRecord(parsed)
      && parsed.projectId === projectId
      && parsed.id === jobId
      ? parsed
      : null
  }
  catch {
    return null
  }
}

const finalStatus = (steps: DocumentJobStep[]): DocumentJobStatus => {
  const succeeded = steps.filter(step => step.status === 'succeeded').length
  const failed = steps.filter(step => step.status === 'failed').length
  const cancelled = steps.filter(step => (
    step.status === 'cancelled' || step.status === 'skipped'
  )).length
  if (succeeded === steps.length) return 'succeeded'
  if (succeeded > 0) return 'partial'
  if (failed > 0) return 'failed'
  if (cancelled === steps.length) return 'cancelled'
  return 'interrupted'
}

export class ProjectJobStore {
  #changeListener: ((projectId: string) => void) | null = null
  #mutationTail = Promise.resolve()

  onChange(listener: (projectId: string) => void): void {
    this.#changeListener = listener
  }

  list(projectId: string): Promise<DocumentJobRecord[]> {
    return this.#serialize(async () => {
      if (!isProjectId(projectId)) throw new Error('Invalid project id.')
      await mkdir(jobsRoot(projectId), { recursive: true })
      const entries = await readdir(jobsRoot(projectId), { withFileTypes: true }).catch(() => [])
      const jobs = (await Promise.all(entries
        .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
        .map(entry => readJobUnsafe(projectId, entry.name.slice(0, -'.json'.length)))))
        .filter((job): job is DocumentJobRecord => job !== null)
      return jobs.sort((left, right) => right.createdAt - left.createdAt)
    })
  }

  read(projectId: string, jobId: string): Promise<DocumentJobRecord | null> {
    return this.#serialize(() => readJobUnsafe(projectId, jobId))
  }

  create(input: CreateDocumentJobInput): Promise<DocumentJobRecord> {
    return this.#serialize(async () => {
      if (!isProjectId(input.projectId)) throw new Error('Invalid project id.')
      const explanation = input.explanation.replace(/\s+/g, ' ').trim().slice(0, 240)
      if (!explanation) throw new Error('A document job needs an explanation.')
      if (!input.steps.length) throw new Error('A document job needs at least one step.')
      const now = Date.now()
      const job: DocumentJobRecord = {
        cancelRequested: false,
        createdAt: now,
        explanation,
        id: randomUUID(),
        projectId: input.projectId,
        status: 'queued',
        steps: input.steps.map(step => ({
          ...step,
          createdAt: now,
          id: randomUUID(),
          status: 'pending',
          updatedAt: now,
        })),
        updatedAt: now,
        version: DOCUMENT_JOB_STORAGE_VERSION,
      }
      if (!isDocumentJobRecord(job)) throw new Error('The document job is invalid.')
      await mkdir(jobsRoot(job.projectId), { recursive: true })
      await atomicJsonWrite(jobFile(job.projectId, job.id), job)
      this.#emit(job.projectId)
      return job
    })
  }

  start(projectId: string, jobId: string): Promise<DocumentJobRecord> {
    return this.#mutate(projectId, jobId, job => {
      const now = Date.now()
      return {
        ...job,
        startedAt: job.startedAt ?? now,
        status: job.cancelRequested ? 'cancelling' : 'running',
        updatedAt: now,
      }
    })
  }

  requestCancel(projectId: string, jobId: string): Promise<DocumentJobRecord> {
    return this.#mutate(projectId, jobId, job => {
      if (isTerminalDocumentJobStatus(job.status)) return job
      return {
        ...job,
        cancelRequested: true,
        status: 'cancelling',
        updatedAt: Date.now(),
      }
    })
  }

  updateStep(
    projectId: string,
    jobId: string,
    stepId: string,
    status: DocumentJobStepStatus,
    error?: string,
  ): Promise<DocumentJobRecord> {
    return this.#mutate(projectId, jobId, job => {
      const now = Date.now()
      let found = false
      const steps = job.steps.map(step => {
        if (step.id !== stepId) return step
        found = true
        return {
          ...step,
          ...(error ? { error: error.slice(0, 1_000) } : {}),
          ...(status === 'running' && !step.startedAt ? { startedAt: now } : {}),
          ...(
            status === 'succeeded'
            || status === 'failed'
            || status === 'cancelled'
            || status === 'skipped'
              ? { finishedAt: now }
              : {}
          ),
          status,
          updatedAt: now,
        }
      })
      if (!found) throw new Error('This document job step no longer exists.')
      return { ...job, steps, updatedAt: now }
    })
  }

  finish(projectId: string, jobId: string): Promise<DocumentJobRecord> {
    return this.#mutate(projectId, jobId, job => {
      const now = Date.now()
      return {
        ...job,
        finishedAt: now,
        status: finalStatus(job.steps),
        updatedAt: now,
      }
    })
  }

  interruptActive(projectId: string): Promise<DocumentJobRecord[]> {
    return this.#serialize(async () => {
      const jobs = await this.#readAllUnsafe(projectId)
      const now = Date.now()
      const interrupted = await Promise.all(jobs.map(async job => {
        if (isTerminalDocumentJobStatus(job.status)) return job
        const next: DocumentJobRecord = {
          ...job,
          finishedAt: now,
          status: 'interrupted',
          steps: job.steps.map(step => (
            step.status === 'running' || step.status === 'pending'
              ? { ...step, finishedAt: now, status: 'cancelled', updatedAt: now }
              : step
          )),
          updatedAt: now,
        }
        await atomicJsonWrite(jobFile(projectId, job.id), next)
        return next
      }))
      if (interrupted.some((job, index) => job !== jobs[index])) this.#emit(projectId)
      return interrupted
    })
  }

  async #readAllUnsafe(projectId: string): Promise<DocumentJobRecord[]> {
    if (!isProjectId(projectId)) throw new Error('Invalid project id.')
    await mkdir(jobsRoot(projectId), { recursive: true })
    const entries = await readdir(jobsRoot(projectId), { withFileTypes: true }).catch(() => [])
    return (await Promise.all(entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => readJobUnsafe(projectId, entry.name.slice(0, -'.json'.length)))))
      .filter((job): job is DocumentJobRecord => job !== null)
  }

  #mutate(
    projectId: string,
    jobId: string,
    change: (job: DocumentJobRecord) => DocumentJobRecord,
  ): Promise<DocumentJobRecord> {
    return this.#serialize(async () => {
      const job = await readJobUnsafe(projectId, jobId)
      if (!job) throw new Error('This document job no longer exists.')
      const changed = change(job)
      if (!isDocumentJobRecord(changed)) throw new Error('The updated document job is invalid.')
      await atomicJsonWrite(jobFile(projectId, jobId), changed)
      this.#emit(projectId)
      return changed
    })
  }

  #emit(projectId: string): void {
    this.#changeListener?.(projectId)
  }

  #serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.#mutationTail.then(operation, operation)
    this.#mutationTail = result.then(() => undefined, () => undefined)
    return result
  }
}

export const projectJobStore = new ProjectJobStore()
