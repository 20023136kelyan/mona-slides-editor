import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'

import { monaAgentEnv } from './agent-sdk-env.js'

const run = promisify(execFile)

/**
 * The Claude login on this machine, if there is one.
 *
 * Anthropic authenticates through the Agent SDK rather than a key in our vault,
 * so "connected" is not something we store - it is a property of the machine.
 * The CLI reports it as JSON, which is the only supported way to ask: the
 * credential itself lives in the OS keychain and is never read here.
 */
export interface LocalClaudeLogin {
  connected: boolean
  email?: string
  plan?: string
}

interface AuthStatus {
  authMethod?: string
  email?: string
  loggedIn?: boolean
  subscriptionType?: string
}

/** Plans as the dock should name them. */
const PLAN_LABELS: Record<string, string> = {
  enterprise: 'Claude Enterprise',
  max: 'Claude Max',
  pro: 'Claude Pro',
  team: 'Claude Team',
}

/**
 * The Claude Code binary the SDK would itself use.
 *
 * Resolved from the SDK's own platform package so a packaged build asks the
 * binary it ships rather than whatever happens to be on PATH; PATH is the
 * fallback for a dev machine where the optional package was skipped.
 */
const resolveExecutable = (): string => {
  const platform = process.platform === 'win32'
    ? 'win32'
    : process.platform === 'darwin' ? 'darwin' : 'linux'
  const architecture = process.arch === 'arm64' ? 'arm64' : 'x64'
  try {
    const require = createRequire(import.meta.url)
    const packageJson = require.resolve(
      `@anthropic-ai/claude-agent-sdk-${platform}-${architecture}/package.json`,
    )
    return packageJson.replace(/package\.json$/, platform === 'win32' ? 'claude.exe' : 'claude')
  }
  catch {
    return 'claude'
  }
}

/** Status is asked on every dock render, so it is worth not re-spawning. */
const CACHE_MS = 30_000
let cached: { at: number; value: LocalClaudeLogin } | undefined

export const readLocalClaudeLogin = async (
  now = Date.now(),
  executablePath = resolveExecutable(),
): Promise<LocalClaudeLogin> => {
  if (cached && now - cached.at < CACHE_MS) return cached.value
  const value = await probe(executablePath)
  cached = { at: now, value }
  return value
}

/** Forget the cached answer - used after a sign-in or sign-out. */
export const forgetLocalClaudeLogin = (): void => {
  cached = undefined
}

export const interpretAuthStatus = (raw: string): LocalClaudeLogin => {
  let status: AuthStatus
  try {
    status = JSON.parse(raw) as AuthStatus
  }
  catch {
    return { connected: false }
  }
  if (status.loggedIn !== true) return { connected: false }
  const plan = status.subscriptionType
    ? PLAN_LABELS[status.subscriptionType] ?? `Claude ${status.subscriptionType}`
    : status.authMethod === 'claude.ai' ? 'Claude subscription' : undefined
  return {
    connected: true,
    ...(status.email ? { email: status.email } : {}),
    ...(plan ? { plan } : {}),
  }
}

const probe = async (executablePath: string): Promise<LocalClaudeLogin> => {
  try {
    const { stdout } = await run(executablePath, ['auth', 'status'], {
      env: monaAgentEnv(),
      timeout: 10_000,
    })
    return interpretAuthStatus(stdout)
  }
  catch {
    // No binary, no login, or a CLI too old to answer: all the same to the dock.
    return { connected: false }
  }
}

/** Launch the CLI's supported Claude subscription browser flow. */
export const loginLocalClaudeAccount = async (
  executablePath = resolveExecutable(),
): Promise<LocalClaudeLogin> => {
  await run(executablePath, ['auth', 'login', '--claudeai'], {
    env: monaAgentEnv(),
    timeout: 5 * 60_000,
  })
  forgetLocalClaudeLogin()
  return await readLocalClaudeLogin(Date.now(), executablePath)
}
