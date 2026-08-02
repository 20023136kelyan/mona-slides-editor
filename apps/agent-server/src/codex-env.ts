/**
 * Environment inherited by Codex.
 *
 * Authentication comes from the user's Codex/ChatGPT login under HOME. API-key
 * variables are intentionally not forwarded, so Mona cannot unexpectedly bill a
 * key exported for unrelated terminal work.
 */
const FORWARDED = [
  'CODEX_HOME',
  'HOME',
  'LANG',
  'LC_ALL',
  'PATH',
  'SHELL',
  'TMPDIR',
  'TZ',
  'USER',
] as const

export const monaCodexEnv = (
  parent: NodeJS.ProcessEnv = process.env,
): Record<string, string> => {
  const env: Record<string, string> = {}
  for (const name of FORWARDED) {
    const value = parent[name]
    if (typeof value === 'string' && value !== '') env[name] = value
  }
  return env
}
