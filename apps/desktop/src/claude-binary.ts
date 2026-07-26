import { accessSync, constants } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'

/**
 * Where the `claude` binary is.
 *
 * The plan for this was "detect it on PATH, else download it on first run behind
 * a progress bar". That flow is not needed: the Agent SDK ships the binary as a
 * platform-specific optional dependency, so `npm install` has already put the
 * right one on disk and there is nothing to fetch, no progress to show, and no
 * first-run state to get wrong.
 *
 * What does need saying is which one to use, because the SDK finds it by
 * resolving from its own location and that stops being true once the
 * application is packaged.
 *
 * PATH is the fallback rather than the first choice, which is the opposite of
 * what a terminal tool would do. A GUI application on macOS does not inherit
 * the shell's PATH — launched from Finder it gets a bare one, without
 * `/opt/homebrew/bin` or `~/.local/bin` — so a `claude` the user installed for
 * their terminal is invisible here. Preferring the shipped binary also pins the
 * version the SDK was built against, rather than whatever the machine happens
 * to have.
 */

const PLATFORM_PACKAGE = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`

const isExecutable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK)
    return true
  }
  catch {
    return false
  }
}

/**
 * Inside a packaged app the binary cannot live in the archive.
 *
 * An asar is a single file, and a subprocess needs a real path to exec, so the
 * platform package is unpacked at build time — `asarUnpack` in the builder
 * configuration, which has to keep naming the same package this does.
 */
const packagedPath = (): string => join(
  process.resourcesPath,
  'app.asar.unpacked',
  'node_modules',
  PLATFORM_PACKAGE,
  'claude',
)

/** In development, wherever npm put it — which npm may have hoisted. */
const developmentPath = (): string | undefined => {
  const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), 'index.js'))
  try {
    return require.resolve(`${PLATFORM_PACKAGE}/claude`)
  }
  catch {
    return undefined
  }
}

/**
 * The executable to hand the SDK, or undefined to let it resolve its own.
 *
 * Undefined is a real answer rather than a failure: the SDK looks in the same
 * places, and on an unbundled platform its own search is the better guess.
 */
export const resolveClaudeExecutable = (): string | undefined => {
  // An explicit choice wins, which is what makes a different build testable.
  const override = process.env.MONA_CLAUDE_EXECUTABLE
  if (override && isExecutable(override)) return override

  const shipped = app.isPackaged ? packagedPath() : developmentPath()
  if (shipped && isExecutable(shipped)) return shipped

  return undefined
}
