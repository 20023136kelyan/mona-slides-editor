import { describe, expect, it } from 'vitest'

import { resolveExternalModelId } from './models.js'

describe('external agent model selection', () => {
  it('uses an explicit supported model rather than silently substituting another', () => {
    expect(resolveExternalModelId('openai-chatgpt', 'gpt-5.6-terra')).toBe('gpt-5.6-terra')
    expect(resolveExternalModelId('anthropic-claude', 'claude-opus-4-8')).toBe('claude-opus-4-8')
  })

  it('keeps a deliberate default when older clients omit a model', () => {
    expect(resolveExternalModelId('openai-chatgpt')).toBe('gpt-5.6-sol')
    expect(resolveExternalModelId('anthropic-claude')).toBe('claude-sonnet-5')
  })

  it('rejects cross-provider and unknown model ids', () => {
    expect(() => resolveExternalModelId('openai-chatgpt', 'claude-sonnet-5')).toThrow(
      'Model claude-sonnet-5 is not available for openai-chatgpt',
    )
    expect(() => resolveExternalModelId('anthropic-claude', 'imaginary-model')).toThrow(
      'Model imaginary-model is not available for anthropic-claude',
    )
  })
})
