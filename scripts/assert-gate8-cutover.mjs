import { createHash } from 'node:crypto'
import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

const fail = (message) => failures.push(message)
const exists = async (path) => access(path).then(() => true, () => false)
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))

const walkFiles = async (directory) => {
  if (!await exists(directory)) return []
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walkFiles(path) : [path]
  }))
  return nested.flat()
}

const rootManifest = await readJson(join(repositoryRoot, 'package.json'))
const expectedRootScripts = {
  dev: 'npm exec -w @mona/web -- vite --host 127.0.0.1 --port 5173',
  build: 'npm run i18n:check && npm run build -w @mona/web',
  preview: 'npm exec -w @mona/web -- vite preview',
}
for (const [name, expected] of Object.entries(expectedRootScripts)) {
  if (rootManifest.scripts?.[name] !== expected) {
    fail(`root script ${name} does not route to the React web workspace`)
  }
}
if (rootManifest.name !== 'mona-slides') fail('root package is not named mona-slides')
if (!rootManifest.workspaces?.includes('apps/*') || !rootManifest.workspaces?.includes('packages/*')) {
  fail('root workspace layout is incomplete')
}

const productionRoots = ['src', 'apps', 'packages'].map(path => join(repositoryRoot, path))
const productionFiles = (await Promise.all(productionRoots.map(walkFiles))).flat()
const vueSourceFiles = productionFiles.filter(path => path.endsWith('.vue'))
if (vueSourceFiles.length) {
  fail(`Vue source remains in production roots: ${vueSourceFiles.map(path => relative(repositoryRoot, path)).join(', ')}`)
}

const retiredRootEntries = [
  '.eslintrc.cjs',
  'components.d.ts',
  'env.d.ts',
  'index.html',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'vite.config.ts',
]
for (const entry of retiredRootEntries) {
  if (await exists(join(repositoryRoot, entry))) fail(`retired Vue root entry still exists: ${entry}`)
}
const legacyRootSource = await walkFiles(join(repositoryRoot, 'src'))
if (legacyRootSource.length) fail('the retired root src/ tree is not empty')
if (await exists(join(repositoryRoot, 'src'))) fail('the retired root src/ directory still exists')

const packageManifestPaths = [join(repositoryRoot, 'package.json')]
for (const workspaceRoot of ['apps', 'packages']) {
  const workspaceDirectory = join(repositoryRoot, workspaceRoot)
  for (const entry of await readdir(workspaceDirectory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const manifest = join(workspaceDirectory, entry.name, 'package.json')
      if (await exists(manifest)) packageManifestPaths.push(manifest)
    }
  }
}
const retiredPackages = new Set([
  'vue',
  'pinia',
  'vue-i18n',
  'vue-tsc',
  '@vitejs/plugin-vue',
  '@vue/compiler-sfc',
])
for (const manifestPath of packageManifestPaths) {
  const manifest = await readJson(manifestPath)
  for (const group of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const dependency of Object.keys(manifest[group] || {})) {
      if (retiredPackages.has(dependency)) {
        fail(`${relative(repositoryRoot, manifestPath)} still declares ${dependency}`)
      }
    }
  }
}
const lockfile = await readJson(join(repositoryRoot, 'package-lock.json'))
for (const retiredPackage of retiredPackages) {
  const key = `node_modules/${retiredPackage}`
  if (lockfile.packages?.[key]) fail(`package-lock.json still installs ${retiredPackage}`)
  if (await exists(join(repositoryRoot, key))) fail(`node_modules still contains ${retiredPackage}`)
}

const webIndex = await readFile(join(repositoryRoot, 'apps/web/index.html'), 'utf8')
if (!webIndex.includes('<div id="root"></div>') || !webIndex.includes('/src/main.tsx')) {
  fail('apps/web/index.html is not the React production entry')
}
const webManifest = await readJson(join(repositoryRoot, 'apps/web/package.json'))
if (!webManifest.dependencies?.react || !webManifest.dependencies?.['react-dom']) {
  fail('React runtime dependencies are missing from @mona/web')
}

const documentationContracts = [
  ['README.md', ['completed React re-platform', 'test evidence only']],
  ['README_zh.md', ['已经完成 PPTist 编辑器的 React 迁移', '只用于测试']],
  ['apps/web/README.md', ['sole production frontend', 'compile-time excluded']],
  ['doc/I18N.md', ['i18next with react-i18next', 'Presentation content is document data']],
  ['doc/REACT_MIGRATION_BLUEPRINT.md', ['React migration complete through Gate 8', 'Migration complete:']],
  ['tests/parity/PARITY_MATRIX.md', ['Gates 1–8 complete', 'test-only and immutable']],
]
for (const [documentationPath, requiredPhrases] of documentationContracts) {
  const documentation = await readFile(join(repositoryRoot, documentationPath), 'utf8')
  for (const phrase of requiredPhrases) {
    if (!documentation.includes(phrase)) fail(`${documentationPath} is missing current cutover language: ${phrase}`)
  }
}

const oracleRoot = join(repositoryRoot, 'tests/oracle/vue')
const checksumFile = join(oracleRoot, 'SHA256SUMS')
if (!await exists(join(oracleRoot, 'README.md')) || !await exists(checksumFile)) {
  fail('the frozen Vue test oracle is incomplete')
}
else {
  const checksumLines = (await readFile(checksumFile, 'utf8')).trim().split('\n').filter(Boolean)
  const checkedOraclePaths = new Set()
  for (const line of checksumLines) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line)
    if (!match) {
      fail(`invalid oracle checksum line: ${line}`)
      continue
    }
    const [, expected, oraclePath] = match
    checkedOraclePaths.add(oraclePath)
    const absolutePath = join(oracleRoot, oraclePath)
    if (!await exists(absolutePath)) {
      fail(`oracle checksum target is missing: ${oraclePath}`)
      continue
    }
    const actual = createHash('sha256').update(await readFile(absolutePath)).digest('hex')
    if (actual !== expected) fail(`frozen oracle checksum changed: ${oraclePath}`)
  }
  const uncheckedOracleFiles = (await walkFiles(oracleRoot))
    .map(path => relative(oracleRoot, path).replaceAll('\\', '/'))
    .filter(path => path !== 'README.md' && path !== 'SHA256SUMS' && !checkedOraclePaths.has(path))
  if (uncheckedOracleFiles.length) {
    fail(`frozen oracle files lack checksums: ${uncheckedOracleFiles.join(', ')}`)
  }
}

const distRoot = join(repositoryRoot, 'apps/web/dist')
const distFiles = await walkFiles(distRoot)
if (!distFiles.length || !await exists(join(distRoot, 'index.html'))) {
  fail('React production output is missing; run npm run build first')
}
const forbiddenDistPaths = distFiles.filter((path) => {
  const normalized = relative(distRoot, path).replaceAll('\\', '/').toLowerCase()
  return normalized.endsWith('.pptx')
    || normalized.includes('corpus')
    || normalized.includes('private')
    || normalized.endsWith('mocks/gate3-renderer.json')
})
if (forbiddenDistPaths.length) {
  fail(`test/private artifacts leaked into production: ${forbiddenDistPaths.map(path => relative(distRoot, path)).join(', ')}`)
}

const productionJavaScript = (await Promise.all(
  distFiles.filter(path => path.endsWith('.js')).map(path => readFile(path, 'utf8')),
)).join('\n')
const forbiddenBundleMarkers = [
  'rendererFixture',
  'gate3-renderer',
  'gate4-editor',
  'gate5-multi',
  'gate6-workflows',
  'gate6-slideshow',
  '__MONA_REACT_TEST__',
  '__MONA_TEST__',
  'vue-i18n',
]
for (const marker of forbiddenBundleMarkers) {
  if (productionJavaScript.includes(marker)) fail(`production JavaScript contains migration/test marker: ${marker}`)
}

const productionImports = productionFiles
  .filter(path => /\.[cm]?[jt]sx?$/.test(path))
  .map(path => [path, relative(repositoryRoot, path)])
for (const [path, displayPath] of productionImports) {
  const source = await readFile(path, 'utf8')
  if (/from\s+['"][^'"]*(?:tests\/oracle|\/src\/.*\.vue)['"]/.test(source)) {
    fail(`production source imports the frozen/retired implementation: ${displayPath}`)
  }
}

if (failures.length) {
  console.error('Gate 8 cutover verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

const oracleFiles = await walkFiles(oracleRoot)
console.log('Gate 8 cutover verification passed.')
console.log(`- production source files audited: ${productionFiles.length}`)
console.log(`- package manifests audited: ${packageManifestPaths.length}`)
console.log(`- production artifacts audited: ${distFiles.length}`)
console.log(`- frozen oracle files retained for tests only: ${oracleFiles.length}`)
