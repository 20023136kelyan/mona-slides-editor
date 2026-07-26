import { describe, expect, it } from 'vitest'

import { monaAgentEnv } from './agent-sdk-env.js'

describe('agent subprocess environment', () => {
  it('carries the user token and the variables the subprocess needs', () => {
    const env = monaAgentEnv('sk-ant-oat01-user', { HOME: '/home/mona', PATH: '/usr/bin' })

    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-user')
    expect(env.PATH).toBe('/usr/bin')
    expect(env.HOME).toBe('/home/mona')
    expect(env.CLAUDE_AGENT_SDK_CLIENT_APP).toBe('mona-slides/0.1.0')
  })

  it('never forwards a Claude credential from this server, whichever form it takes', () => {
    // Each of these outranks CLAUDE_CODE_OAUTH_TOKEN in Claude Code's
    // authentication precedence, so forwarding one would silently serve every
    // user's turn from the operator's account instead of their subscription.
    const env = monaAgentEnv('sk-ant-oat01-user', {
      ANTHROPIC_API_KEY: 'sk-ant-api03-operator',
      ANTHROPIC_AUTH_TOKEN: 'operator-bearer',
      ANTHROPIC_BASE_URL: 'https://operator.example',
      AWS_SECRET_ACCESS_KEY: 'aws-secret',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_USE_VERTEX: '1',
      PATH: '/usr/bin',
    })

    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN')
    expect(env).not.toHaveProperty('ANTHROPIC_BASE_URL')
    expect(env).not.toHaveProperty('AWS_SECRET_ACCESS_KEY')
    expect(env).not.toHaveProperty('CLAUDE_CODE_USE_BEDROCK')
    expect(env).not.toHaveProperty('CLAUDE_CODE_USE_VERTEX')
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-user')
  })

  it('forwards nothing beyond the allowlist, so a new secret cannot leak in', () => {
    const env = monaAgentEnv('token', {
      MONA_PEXELS_KEY: 'pexels-secret',
      PATH: '/usr/bin',
      SOME_FUTURE_SECRET: 'whatever',
    })

    expect(Object.keys(env).sort()).toEqual([
      'CLAUDE_AGENT_SDK_CLIENT_APP',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'PATH',
    ])
  })

  it('leaves the credential to the local login when no token is supplied', () => {
    // The desktop case: the user already signed in to Claude, and the CLI reads
    // that from HOME. Setting no token is what lets it through.
    const env = monaAgentEnv(undefined, {
      ANTHROPIC_API_KEY: 'sk-ant-api03-operator',
      HOME: '/Users/mona',
      PATH: '/usr/bin',
    })

    expect(env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN')
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(env.HOME).toBe('/Users/mona')
  })

  it('omits an allowlisted variable that is absent or empty', () => {
    const env = monaAgentEnv('token', { HOME: '', PATH: '/usr/bin' })

    expect(env).not.toHaveProperty('HOME')
    expect(env).not.toHaveProperty('TMPDIR')
  })
})
