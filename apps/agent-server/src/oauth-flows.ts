import type {
  AuthEvent,
  AuthInteraction,
  AuthPrompt,
  Models,
} from '@earendil-works/pi-ai'
import { randomBytes } from 'node:crypto'

import {
  getProviderConfiguration,
  type ExternalProviderId,
} from './models.js'

export type PublicAuthPrompt = {
  id: string
  message: string
  options?: readonly {
    description?: string
    id: string
    label: string
  }[]
  placeholder?: string
  type: AuthPrompt['type']
}

export interface PublicOAuthFlow {
  authorizationUrl?: string
  deviceCode?: {
    expiresInSeconds?: number
    intervalSeconds?: number
    userCode: string
    verificationUri: string
  }
  error?: string
  flowId: string
  message?: string
  prompt?: PublicAuthPrompt
  status: 'complete' | 'error' | 'pending'
}

export class OAuthFlowBusyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OAuthFlowBusyError'
  }
}

interface InternalOAuthFlow extends PublicOAuthFlow {
  abortController: AbortController
  createdAt: number
  promptAnswer?: {
    reject: (error: Error) => void
    resolve: (value: string) => void
  }
  providerId: ExternalProviderId
  ready: () => void
  sessionId: string
}

const FLOW_LIFETIME = 16 * 60_000

const safeAuthError = (error: unknown): string => {
  if (!(error instanceof Error)) return 'Provider sign-in failed'
  if (error.name === 'AbortError') return 'Provider sign-in was cancelled'
  return error.message
    .replaceAll(/(?:access|refresh|id)_token["'=:\s]+[A-Za-z\d._~-]+/gi, '[credential redacted]')
    .slice(0, 600)
}

export class OAuthFlowManager {
  readonly #flows = new Map<string, InternalOAuthFlow>()
  readonly #modelsForSession: (sessionId: string) => Models

  constructor(modelsForSession: (sessionId: string) => Models) {
    this.#modelsForSession = modelsForSession
  }

  #public(flow: InternalOAuthFlow): PublicOAuthFlow {
    return {
      flowId: flow.flowId,
      status: flow.status,
      ...(flow.authorizationUrl ? { authorizationUrl: flow.authorizationUrl } : {}),
      ...(flow.deviceCode ? { deviceCode: flow.deviceCode } : {}),
      ...(flow.error ? { error: flow.error } : {}),
      ...(flow.message ? { message: flow.message } : {}),
      ...(flow.prompt ? { prompt: flow.prompt } : {}),
    }
  }

  #find(sessionId: string, flowId: string): InternalOAuthFlow {
    const flow = this.#flows.get(flowId)
    if (!flow || flow.sessionId !== sessionId) throw new Error('Authentication flow not found')
    return flow
  }

  async start(sessionId: string, providerId: ExternalProviderId): Promise<PublicOAuthFlow> {
    this.cleanup()
    if (
      providerId === 'anthropic-claude'
      && [...this.#flows.values()].some(flow => (
        flow.providerId === providerId
        && flow.status === 'pending'
        && flow.sessionId !== sessionId
      ))
    ) {
      // The current upstream Anthropic flow binds a fixed localhost callback
      // port. Reject overlapping hosted attempts instead of letting the second
      // request fail unpredictably with EADDRINUSE.
      throw new OAuthFlowBusyError('Another Anthropic sign-in is in progress. Try again when it finishes.')
    }
    for (const flow of this.#flows.values()) {
      if (flow.sessionId === sessionId && flow.providerId === providerId && flow.status === 'pending') {
        flow.abortController.abort()
        flow.promptAnswer?.reject(new DOMException('Authentication replaced', 'AbortError'))
        flow.status = 'error'
        flow.error = 'A newer sign-in attempt replaced this one'
      }
    }
    const flowId = randomBytes(24).toString('base64url')
    let resolveReady: () => void = () => undefined
    const ready = new Promise<void>(resolve => {
      resolveReady = resolve
    })
    const flow: InternalOAuthFlow = {
      abortController: new AbortController(),
      createdAt: Date.now(),
      flowId,
      providerId,
      ready: resolveReady,
      sessionId,
      status: 'pending',
    }
    this.#flows.set(flowId, flow)
    void this.#run(flow)
    await Promise.race([
      ready,
      new Promise<void>(resolve => setTimeout(resolve, 8_000)),
    ])
    return this.#public(flow)
  }

  async #run(flow: InternalOAuthFlow): Promise<void> {
    const models = this.#modelsForSession(flow.sessionId)
    const configuration = getProviderConfiguration(flow.providerId)
    const interaction: AuthInteraction = {
      signal: flow.abortController.signal,
      notify: (event: AuthEvent) => {
        switch (event.type) {
          case 'auth_url':
            flow.authorizationUrl = event.url
            flow.message = event.instructions
            break
          case 'device_code':
            flow.authorizationUrl = event.verificationUri
            flow.deviceCode = {
              userCode: event.userCode,
              verificationUri: event.verificationUri,
              ...(event.intervalSeconds ? { intervalSeconds: event.intervalSeconds } : {}),
              ...(event.expiresInSeconds ? { expiresInSeconds: event.expiresInSeconds } : {}),
            }
            break
          case 'info':
          case 'progress':
            flow.message = event.message
            break
        }
        flow.ready()
      },
      prompt: async (prompt: AuthPrompt) => {
        if (
          flow.providerId === 'openai-chatgpt'
          && prompt.type === 'select'
          && prompt.options.some(option => option.id === 'device_code')
        ) {
          return 'device_code'
        }
        const promptId = randomBytes(18).toString('base64url')
        flow.prompt = {
          id: promptId,
          message: prompt.message,
          type: prompt.type,
          ...('placeholder' in prompt && prompt.placeholder ? { placeholder: prompt.placeholder } : {}),
          ...(prompt.type === 'select' ? { options: prompt.options } : {}),
        }
        flow.ready()
        return new Promise<string>((resolve, reject) => {
          const onAbort = () => reject(new DOMException('Authentication cancelled', 'AbortError'))
          flow.abortController.signal.addEventListener('abort', onAbort, { once: true })
          prompt.signal?.addEventListener('abort', onAbort, { once: true })
          flow.promptAnswer = {
            reject,
            resolve: value => {
              flow.abortController.signal.removeEventListener('abort', onAbort)
              prompt.signal?.removeEventListener('abort', onAbort)
              resolve(value)
            },
          }
        })
      },
    }
    try {
      await models.login(configuration.piProviderId, 'oauth', interaction)
      flow.prompt = undefined
      flow.promptAnswer = undefined
      flow.status = 'complete'
      flow.message = 'Account connected'
    }
    catch (error) {
      flow.status = 'error'
      flow.error = safeAuthError(error)
    }
    finally {
      flow.ready()
    }
  }

  get(sessionId: string, flowId: string): PublicOAuthFlow {
    this.cleanup()
    return this.#public(this.#find(sessionId, flowId))
  }

  answerPrompt(sessionId: string, flowId: string, promptId: string, answer: unknown): PublicOAuthFlow {
    const flow = this.#find(sessionId, flowId)
    if (
      flow.status !== 'pending'
      || !flow.prompt
      || flow.prompt.id !== promptId
      || !flow.promptAnswer
      || typeof answer !== 'string'
      || !answer.trim()
      || answer.length > 8_000
    ) {
      throw new Error('Authentication prompt is no longer active')
    }
    if (
      flow.prompt.type === 'select'
      && !flow.prompt.options?.some(option => option.id === answer)
    ) {
      throw new Error('Invalid authentication selection')
    }
    const pending = flow.promptAnswer
    flow.prompt = undefined
    flow.promptAnswer = undefined
    pending.resolve(answer.trim())
    return this.#public(flow)
  }

  cancel(sessionId: string, flowId: string): void {
    const flow = this.#find(sessionId, flowId)
    flow.abortController.abort()
    flow.promptAnswer?.reject(new DOMException('Authentication cancelled', 'AbortError'))
    flow.prompt = undefined
    flow.promptAnswer = undefined
    flow.status = 'error'
    flow.error = 'Provider sign-in was cancelled'
  }

  cleanup(): void {
    const cutoff = Date.now() - FLOW_LIFETIME
    for (const [flowId, flow] of this.#flows) {
      if (flow.createdAt >= cutoff) continue
      flow.abortController.abort()
      flow.promptAnswer?.reject(new DOMException('Authentication expired', 'AbortError'))
      this.#flows.delete(flowId)
    }
  }
}
