import { describe, expect, it } from 'vitest'

import { monaAgentEnv } from './agent-sdk-env.js'

describe('agent subprocess environment', () => {
  it('forwards the variables the subprocess genuinely needs', () => {
    const env = monaAgentEnv({ HOME: '/home/mona', PATH: '/usr/bin' })

    expect(env.PATH).toBe('/usr/bin')
    // The subprocess reads the user's Claude login from HOME, so this one is not
    // convenience - it is the whole authentication path.
    expect(env.HOME).toBe('/home/mona')
    expect(env.CLAUDE_AGENT_SDK_CLIENT_APP).toBe('mona-slides/0.1.0')
  })

  it('never forwards a Claude credential, whichever form it takes', () => {
    // Each of these outranks the user's own subscription login in Claude Code's
    // authentication precedence. Someone with a key exported for unrelated work
    // would otherwise find Mona billing it instead of the account they signed in with.
    const env = monaAgentEnv({
      ANTHROPIC_API_KEY: 'sk-ant-api03-someone-elses',
      ANTHROPIC_AUTH_TOKEN: 'a-bearer',
      ANTHROPIC_BASE_URL: 'https://elsewhere.example',
      AWS_SECRET_ACCESS_KEY: 'aws-secret',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_USE_VERTEX: '1',
      HOME: '/home/mona',
    })

    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
    expect(env.CLAUDE_CODE_USE_VERTEX).toBeUndefined()
    expect(env.HOME).toBe('/home/mona')
  })

  it('forwards nothing beyond the allowlist, so a new secret cannot leak in', () => {
    // An allowlist rather than a denylist: a variable nobody has thought of yet
    // is excluded by construction instead of by remembering to add it.
    const env = monaAgentEnv({ HOME: '/home/mona', SOMETHING_INVENTED_TOMORROW: 'secret' })

    expect(Object.keys(env).sort()).toEqual(['CLAUDE_AGENT_SDK_CLIENT_APP', 'HOME'])
  })

  it('drops empty values rather than forwarding them as set', () => {
    const env = monaAgentEnv({ HOME: '', PATH: '/usr/bin' })

    expect('HOME' in env).toBe(false)
    expect(env.PATH).toBe('/usr/bin')
  })
})
