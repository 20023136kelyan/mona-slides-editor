import { describe, expect, it } from 'vitest'

import {
  DOCUMENT_JOB_STORAGE_VERSION,
  documentJobProgress,
  isDocumentJobRecord,
  type DocumentJobRecord,
} from './index'

const job = (): DocumentJobRecord => ({
  cancelRequested: false,
  createdAt: 1,
  explanation: 'Update both presentations',
  id: 'job-1',
  projectId: 'project-1',
  status: 'running',
  steps: [{
    artifactId: 'artifact-1',
    createdAt: 1,
    expectedRevision: {
      contentHash: 'a'.repeat(64),
      modifiedAt: 1,
      size: 100,
    },
    id: 'step-1',
    name: 'One.mona',
    operation: 'presentation.replace',
    reference: { itemId: 'document:1', sourceId: 'source-1' },
    status: 'succeeded',
    updatedAt: 2,
  }, {
    artifactId: 'artifact-2',
    createdAt: 1,
    expectedRevision: {
      contentHash: 'b'.repeat(64),
      modifiedAt: 1,
      size: 100,
    },
    id: 'step-2',
    name: 'Two.mona',
    operation: 'presentation.replace',
    reference: { itemId: 'document:2', sourceId: 'source-1' },
    status: 'running',
    updatedAt: 2,
  }],
  updatedAt: 2,
  version: DOCUMENT_JOB_STORAGE_VERSION,
})

describe('document jobs', () => {
  it('validates durable job records', () => {
    expect(isDocumentJobRecord(job())).toBe(true)
    expect(isDocumentJobRecord({ ...job(), steps: [] })).toBe(false)
  })

  it('reports settled-step progress without treating running work as complete', () => {
    expect(documentJobProgress(job())).toEqual({ completed: 1, percent: 50, total: 2 })
  })
})
