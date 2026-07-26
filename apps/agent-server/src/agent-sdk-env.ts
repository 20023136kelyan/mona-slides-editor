/**
 * The environment the Claude Code subprocess runs with.
 *
 * `env` replaces the subprocess environment outright rather than merging, and the
 * SDK's own example spreads `process.env` into it. We must not: a stray
 * `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` outranks the user's own
 * subscription login in Claude Code's authentication precedence, and the
 * cloud-provider switches outrank all of them. Someone with a key exported in their
 * shell for unrelated work would find Mona quietly billing it instead of using the
 * account they signed in with.
 *
 * An allowlist makes that impossible by construction rather than by vigilance.
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
 * Nothing here authenticates the subprocess.
 *
 * The CLI falls through to the subscription login the user already made, which it
 * reads from `HOME` rather than from the environment. That is why `HOME` is
 * forwarded, and why the stripping above is what makes it work rather than a
 * precaution around it.
 */
export const monaAgentEnv = (
  parent: NodeJS.ProcessEnv = process.env,
): Record<string, string> => {
  const env: Record<string, string> = {}
  for (const name of FORWARDED) {
    const value = parent[name]
    if (typeof value === 'string' && value !== '') env[name] = value
  }
  env.CLAUDE_AGENT_SDK_CLIENT_APP = CLIENT_APP
  return env
}
