import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'

/**
 * Reads the repository's `.env` during development.
 *
 * The agent host used to be a separate process started by a script that loaded this
 * file, so it inherited `PEXELS_API_KEY` and the rest. The host is this process now,
 * and launching Electron directly inherits nothing — which shows up as a Photos
 * panel that returns no results and says nothing about why.
 *
 * Development only. A packaged app has no repository beside it, and a key that
 * belongs to a shipped build belongs in its own settings rather than in a file next
 * to the source.
 */
export const loadDevelopmentEnvironment = async (): Promise<void> => {
  if (app.isPackaged) return
  const file = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env')
  const contents = await readFile(file, 'utf8').catch(() => undefined)
  if (!contents) return
  for (const line of contents.split('\n')) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i.exec(line)
    if (!match) continue
    const [, name, raw] = match
    // Anything already in the environment wins, so an explicit override still works.
    if (name && process.env[name] === undefined) {
      process.env[name] = raw?.trim().replace(/^(['"])(.*)\1$/s, '$2') ?? ''
    }
  }
}
