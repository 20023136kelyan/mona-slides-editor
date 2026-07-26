import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'

import { getProviderConfiguration, type ExternalProviderId } from './models.js'
import type { CredentialVault } from './credential-vault.js'

/**
 * Where each provider's subscription tokens are honoured.
 *
 * Anthropic accepts a bearer token on its ordinary API, gated behind beta
 * headers. OpenAI does not: subscription tokens work only against the Codex
 * surface, whose path shape matches the Responses API the SDK already speaks.
 */
const OPENAI_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex'
const ANTHROPIC_OAUTH_BETAS = 'claude-code-20250219,oauth-2025-04-20'
/** Claim namespace carrying the ChatGPT account id inside the access token. */
const OPENAI_JWT_CLAIM = 'https://api.openai.com/auth'

/**
 * The ChatGPT account id, read from the access token itself.
 *
 * Codex requires it as a header but it is never issued separately - it is a
 * claim inside the JWT, so it is decoded rather than stored.
 */
const readChatGptAccountId = (token: string): string | undefined => {
  const payload = token.split('.')[1]
  if (!payload) return undefined
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as
      Record<string, { chatgpt_account_id?: unknown } | undefined>
    const accountId = claims[OPENAI_JWT_CLAIM]?.chatgpt_account_id
    return typeof accountId === 'string' ? accountId : undefined
  }
  catch {
    return undefined
  }
}

/** The transport decision for one provider: endpoint, headers, key. */
export interface ProviderAuth {
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string>
  /** True when auth is a subscription bearer rather than an API key. */
  subscription: boolean
}

export class MissingCredentialError extends Error {
  constructor(providerId: string) {
    super(`Connect ${providerId} before using it`)
    this.name = 'MissingCredentialError'
  }
}

/**
 * How a provider is authenticated, given what the vault holds.
 *
 * Separated from model construction so the decision is assertable: which
 * endpoint a subscription is honoured on, and that a bearer credential is never
 * sent as an API key.
 */
export const resolveProviderAuth = (
  providerId: ExternalProviderId,
  credential: { access?: string; key?: string; type?: string } | undefined,
): ProviderAuth => {
  const bearer = credential?.type === 'oauth' ? credential.access : undefined
  const apiKey = credential?.type === 'api_key' ? credential.key : undefined
  if (!bearer && !apiKey) throw new MissingCredentialError(providerId)

  if (providerId === 'anthropic-claude') {
    // `authToken` sends `Authorization: Bearer` *instead of* `x-api-key`, so a
    // subscription token needs no API key at all.
    return bearer
      ? { headers: { 'anthropic-beta': ANTHROPIC_OAUTH_BETAS }, subscription: true }
      : { apiKey, subscription: false }
  }

  if (providerId === 'openai-chatgpt') {
    if (!bearer) return { apiKey, subscription: false }
    const accountId = readChatGptAccountId(bearer)
    // A placeholder apiKey is unavoidable: the provider calls loadApiKey while
    // building headers and throws without one. Our headers spread last and win.
    return {
      apiKey: 'subscription',
      baseURL: OPENAI_CODEX_BASE_URL,
      headers: {
        Authorization: `Bearer ${bearer}`,
        ...(accountId ? { 'chatgpt-account-id': accountId } : {}),
        originator: 'mona',
      },
      subscription: true,
    }
  }

  return bearer
    ? { apiKey: 'subscription', headers: { Authorization: `Bearer ${bearer}` }, subscription: true }
    : { apiKey, subscription: false }
}

/**
 * Builds the language model for a session's chosen provider.
 *
 * Credentials never leave the server: the browser names a provider and model,
 * and this reads the session's stored credential - a subscription bearer token
 * or an API key - and configures the SDK provider around it.
 */
export const resolveAiModel = async (
  vault: CredentialVault,
  sessionId: string,
  providerId: ExternalProviderId,
  modelId: string,
): Promise<LanguageModel> => {
  const configuration = getProviderConfiguration(providerId)
  const credential = await vault.read(sessionId, configuration.piProviderId)
  if (!credential) throw new MissingCredentialError(providerId)
  const auth = resolveProviderAuth(providerId, credential as never)

  if (providerId === 'anthropic-claude') {
    const bearer = (credential as { access?: string }).access
    return createAnthropic(auth.subscription
      ? { authToken: bearer, headers: auth.headers }
      : { apiKey: auth.apiKey })(modelId)
  }

  if (providerId === 'openai-chatgpt') {
    const openai = createOpenAI({ apiKey: auth.apiKey, baseURL: auth.baseURL, headers: auth.headers })
    return auth.subscription ? openai.responses(modelId) : openai(modelId)
  }

  return createGoogleGenerativeAI({ apiKey: auth.apiKey, headers: auth.headers })(modelId)
}
