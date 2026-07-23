import { describe, expect, it } from 'vitest'
import { applyPresentationTransaction, type PresentationState } from '@mona/presentation-core'

import {
  summarizeAgentTransaction,
  validateAgentCommands,
} from '@/features/editor/agent/agent-command-validator'
import { getAgentDocumentRevision } from '@/features/editor/agent/agent-revision'

const presentation: PresentationState = {
  title: 'Agent fixture',
  slides: [{ id: 'slide-1', elements: [] }],
  slideIndex: 0,
  viewportSize: 1000,
  viewportRatio: 0.5625,
  theme: {
    backgroundColor: '#fff',
    fontColor: '#18181b',
    fontName: 'Arial',
    outline: { color: '#000', style: 'solid', width: 1 },
    shadow: { blur: 0, color: '#000', h: 0, v: 0 },
    themeColors: ['#6d5dfc'],
  },
  templates: [],
}

describe('agent command validation', () => {
  it('accepts an editable element transaction and reports its scope', () => {
    const transaction = validateAgentCommands(presentation, [{
      type: 'element.add',
      slideId: 'slide-1',
      elements: {
        id: 'agent-shape',
        type: 'shape',
        left: 80,
        top: 70,
        width: 240,
        height: 120,
        rotate: 0,
        fixedRatio: false,
        viewBox: [240, 120],
        path: 'M0 0H240V120H0Z',
        fill: '#6d5dfc',
      },
    }])
    const preview = applyPresentationTransaction(presentation, transaction)
    expect(preview.ok).toBe(true)
    const summary = summarizeAgentTransaction(transaction, preview, 'Create card')
    expect(summary).toMatchObject({
      commandCount: 1,
      createdElements: 1,
      deletedElements: 0,
      updatedElements: 0,
    })
    expect(summary.affectedElementIds).toEqual(['agent-shape'])
  })

  it('rejects arbitrary image URLs and identity-changing patches', () => {
    expect(() => validateAgentCommands(presentation, [{
      type: 'element.add',
      slideId: 'slide-1',
      elements: {
        id: 'unsafe-image',
        type: 'image',
        left: 0,
        top: 0,
        width: 200,
        height: 100,
        rotate: 0,
        fixedRatio: true,
        src: 'https://unmanaged.example/image.jpg',
      },
    }])).toThrow(/managed asset service/i)

    const withElement = {
      ...presentation,
      slides: [{
        id: 'slide-1',
        elements: [{
          id: 'shape',
          type: 'shape' as const,
          left: 0,
          top: 0,
          width: 100,
          height: 100,
          rotate: 0,
          fixedRatio: false,
          viewBox: [100, 100] as [number, number],
          path: 'M0 0H100V100H0Z',
          fill: '#fff',
        }],
      }],
    }
    expect(() => validateAgentCommands(withElement, [{
      type: 'element.update',
      payload: { id: 'shape', slideId: 'slide-1', props: { type: 'text' } as never },
    }])).toThrow(/cannot change "type"/i)
  })

  it('changes the document revision for content, selection-independent state, and embedded media', () => {
    const first = getAgentDocumentRevision(presentation)
    expect(getAgentDocumentRevision({ ...presentation, title: 'Changed' })).not.toBe(first)
    expect(getAgentDocumentRevision({
      ...presentation,
      slides: [{
        id: 'slide-1',
        elements: [{
          id: 'image',
          type: 'image',
          left: 0,
          top: 0,
          width: 10,
          height: 10,
          rotate: 0,
          fixedRatio: true,
          src: `data:image/png;base64,${'a'.repeat(1000)}`,
        }],
      }],
    })).not.toBe(first)
  })
})
