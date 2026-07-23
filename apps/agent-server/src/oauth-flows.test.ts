import type {
  AuthInteraction,
  Credential,
  Models,
} from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'

import { OAuthFlowBusyError, OAuthFlowManager } from './oauth-flows.js'

const fakeModels = (login: (providerId: string, interaction: AuthInteraction) => Promise<Credential>) => ({
  login: (providerId: string, _type: 'oauth', interaction: AuthInteraction) => login(providerId, interaction),
}) as Models

describe('hosted provider authentication flows', () => {
  it('selects OpenAI device login and exposes its one-time code', async () => {
    const manager = new OAuthFlowManager(() => fakeModels(async (providerId, interaction) => {
      expect(providerId).toBe('openai-codex')
      const method = await interaction.prompt({
        message: 'Choose login',
        options: [
          { id: 'browser', label: 'Browser' },
          { id: 'device_code', label: 'Device code' },
        ],
        type: 'select',
      })
      expect(method).toBe('device_code')
      interaction.notify({
        type: 'device_code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://example.test/device',
      })
      return {
        access: 'access',
        expires: Date.now() + 60_000,
        refresh: 'refresh',
        type: 'oauth',
      }
    }))
    const flow = await manager.start('session', 'openai-chatgpt')
    expect(flow.deviceCode).toMatchObject({
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://example.test/device',
    })
  })

  it('bridges a hosted manual callback prompt without exposing credentials', async () => {
    const manager = new OAuthFlowManager(() => fakeModels(async (_providerId, interaction) => {
      interaction.notify({ type: 'auth_url', url: 'https://example.test/authorize' })
      const code = await interaction.prompt({
        message: 'Paste callback URL',
        placeholder: 'http://localhost/callback',
        type: 'manual_code',
      })
      expect(code).toBe('http://localhost/callback?code=one-time-code')
      return {
        access: 'access',
        expires: Date.now() + 60_000,
        refresh: 'refresh',
        type: 'oauth',
      }
    }))
    const started = await manager.start('session', 'anthropic-claude')
    expect(started.authorizationUrl).toBe('https://example.test/authorize')
    await new Promise(resolve => setTimeout(resolve, 0))
    const pending = manager.get('session', started.flowId)
    expect(pending.prompt?.type).toBe('manual_code')
    manager.answerPrompt(
      'session',
      started.flowId,
      pending.prompt?.id ?? '',
      'http://localhost/callback?code=one-time-code',
    )
    await expect.poll(() => manager.get('session', started.flowId).status).toBe('complete')
  })

  it('rejects overlapping Anthropic flows that would contend for its fixed callback port', async () => {
    const manager = new OAuthFlowManager(() => fakeModels(async (_providerId, interaction) => {
      await interaction.prompt({
        message: 'Paste callback URL',
        type: 'manual_code',
      })
      return {
        access: 'access',
        expires: Date.now() + 60_000,
        refresh: 'refresh',
        type: 'oauth',
      }
    }))
    await manager.start('first-session', 'anthropic-claude')
    await expect(manager.start('second-session', 'anthropic-claude')).rejects.toBeInstanceOf(OAuthFlowBusyError)
  })
})
