import { accessSync, constants } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'

const PACKAGE = `@openai/codex-${process.platform}-${process.arch}`

const TARGETS: Record<string, string> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'win32-x64': 'x86_64-pc-windows-msvc',
}

const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex'
const target = TARGETS[`${process.platform}-${process.arch}`]

const isExecutable = (path: string): boolean => {
  try {
    accessSync(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  }
  catch {
    return false
  }
}

const binaryUnder = (root: string): string | undefined => target
  ? join(root, 'vendor', target, 'bin', binaryName)
  : undefined

const developmentPath = (): string | undefined => {
  const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), 'index.js'))
  try {
    return binaryUnder(dirname(require.resolve(`${PACKAGE}/package.json`)))
  }
  catch {
    return undefined
  }
}

const packagedPath = (): string | undefined => binaryUnder(join(
  process.resourcesPath,
  'app.asar.unpacked',
  'node_modules',
  PACKAGE,
))

/** Resolve the platform binary bundled by @openai/codex, never a remote download. */
export const resolveCodexExecutable = (): string => {
  const override = process.env.MONA_CODEX_EXECUTABLE
  if (override && isExecutable(override)) return override
  const shipped = app.isPackaged ? packagedPath() : developmentPath()
  if (shipped && isExecutable(shipped)) return shipped
  return 'codex'
}
