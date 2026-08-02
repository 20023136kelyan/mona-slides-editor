/* oxlint-disable react-hooks/rules-of-hooks, eslint/no-empty-pattern --
   Playwright requires an object-destructured fixture argument and names the
   continuation `use`; neither is a React hook or unsafe destructuring here. */
import { accessSync, constants, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const ARTIFACT_ROOT = join(REPO_ROOT, '.artifacts', 'desktop')

const firstDirectory = (prefix: string): string | undefined => (
  readdirSync(ARTIFACT_ROOT, { withFileTypes: true })
    .find(entry => entry.isDirectory() && entry.name.startsWith(prefix))?.name
)

export const packagedExecutable = (): string => {
  if (process.platform === 'darwin') {
    const directory = firstDirectory('mac')
    if (directory) return join(ARTIFACT_ROOT, directory, 'Mona.app', 'Contents', 'MacOS', 'Mona')
  }
  if (process.platform === 'win32') {
    const directory = firstDirectory('win')
    if (directory) return join(ARTIFACT_ROOT, directory, 'Mona.exe')
  }
  const directory = firstDirectory('linux')
  if (directory) {
    const candidates = ['mona', 'Mona']
    const executable = candidates.map(name => join(ARTIFACT_ROOT, directory, name)).find(existsSync)
    if (executable) return executable
  }
  throw new Error(`No packaged Mona executable was found under ${ARTIFACT_ROOT}.`)
}

export const assertPackagedResources = (resourcesPath: string): void => {
  const platformPackage = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`
  const claude = join(
    resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    platformPackage,
    process.platform === 'win32' ? 'claude.exe' : 'claude',
  )
  accessSync(claude, process.platform === 'win32' ? constants.F_OK : constants.X_OK)

  const codexTargets: Record<string, string> = {
    'darwin-arm64': 'aarch64-apple-darwin',
    'darwin-x64': 'x86_64-apple-darwin',
    'linux-arm64': 'aarch64-unknown-linux-gnu',
    'linux-x64': 'x86_64-unknown-linux-musl',
    'win32-arm64': 'aarch64-pc-windows-msvc',
    'win32-x64': 'x86_64-pc-windows-msvc',
  }
  const codexTarget = codexTargets[`${process.platform}-${process.arch}`]
  expect(codexTarget).toBeTruthy()
  const codex = join(
    resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    `@openai/codex-${process.platform}-${process.arch}`,
    'vendor',
    codexTarget!,
    'bin',
    process.platform === 'win32' ? 'codex.exe' : 'codex',
  )
  accessSync(codex, process.platform === 'win32' ? constants.F_OK : constants.X_OK)

  const appAsar = join(resourcesPath, 'app.asar')
  expect(statSync(appAsar).size).toBeGreaterThan(1_000)
  expect(existsSync(join(resourcesPath, 'renderer', 'index.html'))).toBe(true)
  expect(existsSync(join(resourcesPath, 'agent-plugin', '.claude-plugin', 'plugin.json'))).toBe(true)
  expect(existsSync(join(resourcesPath, 'agent-plugin', 'skills', 'mona-deck', 'SKILL.md'))).toBe(true)
  expect(existsSync(join(resourcesPath, 'agent-plugin', 'skills', 'mona-project', 'SKILL.md'))).toBe(true)
}

interface PackagedFixtures {
  app: ElectronApplication
  consoleProblems: string[]
  page: Page
}

export const test = base.extend<PackagedFixtures>({
  app: async ({}, use, testInfo) => {
    const app = await electron.launch({
      args: [`--user-data-dir=${join(testInfo.outputDir, 'user-data')}`],
      executablePath: packagedExecutable(),
    })
    await use(app)
    await app.close()
  },
  consoleProblems: async ({ page }, use) => {
    const problems: string[] = []
    page.on('console', message => {
      if (message.type() === 'error' || message.type() === 'warning') {
        problems.push(`${message.type()}: ${message.text()}`)
      }
    })
    page.on('response', response => {
      if (response.status() >= 400) {
        problems.push(`http ${response.status()}: ${response.url()}`)
      }
    })
    page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))
    await use(problems)
  },
  page: async ({ app }, use) => {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await use(page)
  },
})

export { expect, type ElectronApplication, type Page }
