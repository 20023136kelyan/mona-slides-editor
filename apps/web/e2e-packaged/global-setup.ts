import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')

/**
 * Build the artifact the test launches.
 *
 * `MONA_SKIP_PACKAGE_BUILD=1` is only a local iteration escape hatch. CI always
 * packages from the exact source under test so a stale app cannot pass.
 */
export default function globalSetup(): void {
  if (process.env.MONA_SKIP_PACKAGE_BUILD === '1') return
  execFileSync('npm', ['run', 'package:dir', '-w', '@mona/desktop'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })
}
