import { describe, expect, it } from 'vitest'

import { MissingCredentialError, resolveProviderAuth } from './ai-models.js'

/** A base64url JWT payload carrying the ChatGPT account claim. */
const codexToken = (accountId: string): string => {
  const payload = Buffer
    .from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: accountId } }))
    .toString('base64url')
  return `header.${payload}.signature`
}

const oauth = (access: string) => ({ access, type: 'oauth' })
const apiKey = (key: string) => ({ key, type: 'api_key' })

describe('resolveProviderAuth', () => {
  it('refuses when the provider is not connected', () => {
    expect(() => resolveProviderAuth('anthropic-claude', undefined))
      .toThrow(MissingCredentialError)
    expect(() => resolveProviderAuth('anthropic-claude', { type: 'oauth' }))
      .toThrow(MissingCredentialError)
  })

  it('authenticates Anthropic with a bearer and never an API key', () => {
    const auth = resolveProviderAuth('anthropic-claude', oauth('oat-token'))
    expect(auth.subscription).toBe(true)
    expect(auth.apiKey).toBeUndefined()
    // The beta headers are what make a subscription token acceptable there.
    expect(auth.headers?.['anthropic-beta']).toContain('oauth-2025-04-20')
  })

  it('uses the stored API key when that is what was connected', () => {
    const auth = resolveProviderAuth('anthropic-claude', apiKey('sk-ant-test'))
    expect(auth.subscription).toBe(false)
    expect(auth.apiKey).toBe('sk-ant-test')
    expect(auth.headers).toBeUndefined()
  })

  it('routes an OpenAI subscription through Codex with the account id from the token', () => {
    const auth = resolveProviderAuth('openai-chatgpt', oauth(codexToken('acct-123')))
    // Subscription tokens are only honoured on Codex, not api.openai.com.
    expect(auth.baseURL).toBe('https://chatgpt.com/backend-api/codex')
    expect(auth.headers?.Authorization).toBe(`Bearer ${codexToken('acct-123')}`)
    expect(auth.headers?.['chatgpt-account-id']).toBe('acct-123')
  })

  it('still works when the OpenAI token carries no account claim', () => {
    const auth = resolveProviderAuth('openai-chatgpt', oauth('not.a.jwt'))
    expect(auth.baseURL).toBe('https://chatgpt.com/backend-api/codex')
    expect(auth.headers).not.toHaveProperty('chatgpt-account-id')
  })

  it('leaves an OpenAI API key on the default endpoint', () => {
    const auth = resolveProviderAuth('openai-chatgpt', apiKey('sk-test'))
    expect(auth.baseURL).toBeUndefined()
    expect(auth.apiKey).toBe('sk-test')
  })

  it('carries a placeholder key for providers that demand one, so headers can win', () => {
    // OpenAI and Google throw while building headers if no key is present at
    // all, even when auth actually comes from the Authorization header.
    expect(resolveProviderAuth('openai-chatgpt', oauth(codexToken('a'))).apiKey).toBe('subscription')
    expect(resolveProviderAuth('google-ai-studio', oauth('token')).apiKey).toBe('subscription')
  })
})
