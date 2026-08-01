import { describe, expect, it } from 'vitest'

import {
  PROJECT_STORAGE_VERSION,
  isProjectRecord,
  projectTitleFromPrompt,
} from './index'

describe('project domain', () => {
  it('accepts a provider-neutral project record', () => {
    expect(isProjectRecord({
      artifacts: [{
        createdAt: 1,
        documentType: 'presentation',
        id: 'artifact-1',
        mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        name: 'Launch deck.pptx',
        reference: { itemId: 'Launch deck.pptx', sourceId: 'local-files' },
        state: 'referenced',
        updatedAt: 1,
      }],
      createdAt: 1,
      id: 'project-1',
      lastOpenedAt: 2,
      messages: [{
        content: 'Refresh the launch narrative.',
        createdAt: 1,
        id: 'message-1',
        role: 'user',
        status: 'complete',
      }],
      title: 'Launch narrative',
      updatedAt: 2,
      version: PROJECT_STORAGE_VERSION,
    })).toBe(true)
  })

  it('rejects duplicate references even when artifact ids differ', () => {
    const artifact = {
      createdAt: 1,
      documentType: 'presentation',
      mediaType: 'application/vnd.mona.presentation-package',
      name: 'Deck.mona',
      reference: { itemId: 'Deck.mona', sourceId: 'local-files' },
      state: 'referenced',
      updatedAt: 1,
    } as const
    expect(isProjectRecord({
      artifacts: [
        { ...artifact, id: 'artifact-1' },
        { ...artifact, id: 'artifact-2' },
      ],
      createdAt: 1,
      id: 'project-1',
      lastOpenedAt: 1,
      messages: [],
      title: '',
      updatedAt: 1,
      version: PROJECT_STORAGE_VERSION,
    })).toBe(false)
  })

  it('derives a compact local title from the first request', () => {
    expect(projectTitleFromPrompt('Update the launch deck. Keep the current structure.'))
      .toBe('Update the launch deck')
    expect(projectTitleFromPrompt('x'.repeat(80))).toHaveLength(56)
  })
})
