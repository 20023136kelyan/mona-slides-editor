import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface AgentServerConfig {
  /** Signs photo-search result ids so an agent cannot redirect the importer. */
  assetSigningKey: Buffer
  allowedOrigins: ReadonlySet<string>
  assetDirectory: string
  development: boolean
  host: string
  port: number
}

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const varDirectory = resolve(appDirectory, 'var')

const decodeKey = (value: string, name: string): Buffer => {
  const normalized = value.trim()
  const key = /^[a-f\d]{64}$/i.test(normalized)
    ? Buffer.from(normalized, 'hex')
    : Buffer.from(normalized, 'base64')
  if (key.byteLength !== 32) throw new Error(`${name} must decode to exactly 32 bytes`)
  return key
}

const loadDevelopmentKey = async (filename: string): Promise<Buffer> => {
  const path = resolve(varDirectory, filename)
  try {
    return decodeKey(await readFile(path, 'utf8'), filename)
  }
  catch (error) {
    if (error instanceof Error && !('code' in error && error.code === 'ENOENT')) throw error
  }
  const key = randomBytes(32)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, `${key.toString('base64')}\n`, { mode: 0o600 })
  return key
}

const loadSecret = async (envName: string, developmentFilename: string, development: boolean) => {
  const configured = process.env[envName]
  if (configured) return decodeKey(configured, envName)
  if (!development) throw new Error(`${envName} is required in production`)
  return loadDevelopmentKey(developmentFilename)
}

export const loadAgentServerConfig = async (): Promise<AgentServerConfig> => {
  const development = process.env.NODE_ENV !== 'production'
  const stateDirectory = resolve(process.env.MONA_AGENT_STATE_DIR ?? varDirectory)
  const port = Number.parseInt(process.env.MONA_AGENT_PORT ?? '8788', 10)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('MONA_AGENT_PORT is invalid')
  const origins = (process.env.MONA_WEB_ORIGINS ?? [
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://127.0.0.1:6174',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:6174',
  ].join(','))
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
  if (!origins.length) throw new Error('MONA_WEB_ORIGINS must contain at least one origin')

  return {
    allowedOrigins: new Set(origins),
    assetDirectory: resolve(stateDirectory, 'assets'),
    assetSigningKey: await loadSecret('MONA_ASSET_SIGNING_KEY', 'asset-signing.key', development),
    development,
    host: process.env.MONA_AGENT_HOST ?? '127.0.0.1',
    port,
  }
}
