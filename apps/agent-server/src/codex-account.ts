import type { AgentAccountDescriptor } from '@mona/agent-protocol'

import { CodexAppServerClient } from './codex-app-server.js'

interface AccountReadResponse {
  account: null | {
    email?: string | null
    planType?: string
    type?: string
  }
  requiresOpenaiAuth: boolean
}

interface LoginStartResponse {
  authUrl?: string
  loginId?: string
  type?: string
}

export const readLocalCodexAccount = async (
  executablePath: string,
): Promise<AgentAccountDescriptor> => {
  const client = await CodexAppServerClient.connect({ executablePath })
  try {
    const response = await client.request<AccountReadResponse>('account/read', {
      refreshToken: false,
    })
    const account = response.account
    if (!account || account.type !== 'chatgpt') {
      return { connected: false, providerId: 'openai' }
    }
    return {
      accountLabel: account.email ?? 'ChatGPT account connected',
      connected: true,
      planLabel: account.planType ? `ChatGPT ${account.planType}` : 'ChatGPT subscription',
      providerId: 'openai',
    }
  }
  finally {
    client.close()
  }
}

/** Run Codex's supported browser login and keep app-server alive until it resolves. */
export const loginLocalCodexAccount = async ({
  executablePath,
  openExternal,
}: {
  executablePath: string
  openExternal: (url: string) => Promise<unknown>
}): Promise<AgentAccountDescriptor> => {
  const client = await CodexAppServerClient.connect({ executablePath })
  try {
    const login = await client.request<LoginStartResponse>('account/login/start', {
      type: 'chatgpt',
    })
    if (login.type !== 'chatgpt' || !login.loginId || !login.authUrl) {
      throw new Error('Codex did not return a ChatGPT sign-in URL.')
    }
    await openExternal(login.authUrl)
    const notification = await client.waitForNotification(value => {
      if (value.method !== 'account/login/completed') return false
      return (value.params as { loginId?: unknown } | undefined)?.loginId === login.loginId
    })
    const completed = notification.params as { error?: unknown; success?: unknown }
    if (completed.success !== true) {
      throw new Error(typeof completed.error === 'string'
        ? completed.error
        : 'ChatGPT sign-in did not complete.')
    }
    const response = await client.request<AccountReadResponse>('account/read', {
      refreshToken: true,
    })
    const account = response.account
    return {
      accountLabel: account?.email ?? 'ChatGPT account connected',
      connected: account?.type === 'chatgpt',
      planLabel: account?.planType ? `ChatGPT ${account.planType}` : 'ChatGPT subscription',
      providerId: 'openai',
    }
  }
  finally {
    client.close()
  }
}
