/**
 * The environment the Claude Code subprocess runs with.
 *
 * `env` replaces the subprocess environment outright rather than merging, and
 * the SDK's own example spreads `process.env` into it. We must not: a Claude
 * credential in this server's environment outranks the token we are trying to
 * use. `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_API_KEY` both sit above
 * `CLAUDE_CODE_OAUTH_TOKEN` in Claude Code's authentication precedence, and the
 * cloud-provider switches sit above all three - so an operator key would
 * silently serve, and bill, every user's turn.
 *
 * An allowlist makes that impossible by construction instead of by vigilance.
 */

/** Variables the subprocess genuinely needs from its parent. */
const FORWARDED = [
  'HOME',
  'LANG',
  'LC_ALL',
  'PATH',
  'SHELL',
  'TMPDIR',
  'TZ',
  'USER',
] as const

/** How Mona identifies itself in the SDK's User-Agent. */
const CLIENT_APP = 'mona-slides/0.1.0'

/**
 * `setupToken` is optional, and omitting it is the local-desktop case: with no
 * token supplied the CLI falls through to the subscription login the user
 * already made, which it reads from `HOME` rather than the environment. That is
 * why `HOME` is forwarded and why stripping the operator's key matters just as
 * much here - a stray `ANTHROPIC_API_KEY` would quietly outrank their own login.
 */
export const monaAgentEnv = (
  setupToken?: string,
  parent: NodeJS.ProcessEnv = process.env,
): Record<string, string> => {
  const env: Record<string, string> = {}
  for (const name of FORWARDED) {
    const value = parent[name]
    if (typeof value === 'string' && value !== '') env[name] = value
  }
  env.CLAUDE_AGENT_SDK_CLIENT_APP = CLIENT_APP
  if (setupToken) env.CLAUDE_CODE_OAUTH_TOKEN = setupToken
  return env
}
