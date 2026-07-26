import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Electron runs the bundled shell, not the TypeScript sources, so the bundle has
 * to exist and be current before the first window opens. Building it here rather
 * than in `webServer` keeps it from racing Vite, and means a stale `dist` cannot
 * quietly make a test pass or fail against yesterday's shell.
 */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')

export default function globalSetup(): void {
  execFileSync('npm', ['run', 'build', '-w', '@mona/desktop'], { cwd: REPO_ROOT, stdio: 'inherit' })
}
