import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, resolve } from 'node:path'

const root = process.cwd()
const failures = []
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs'])
const expectedSchemaHash = 'b4ee4a7bd7978706cd0033e62c29daf8a0167a964d1be40ebf59989788347bb5'

const read = path => readFileSync(resolve(root, path), 'utf8')
const normalizeSchema = source => source
  .split(/\r?\n/)
  .map(line => line.trimEnd())
  .join('\n')

const walk = path => {
  const absolutePath = resolve(root, path)
  if (!existsSync(absolutePath)) return []
  return readdirSync(absolutePath).flatMap(entry => {
    const child = `${path}/${entry}`
    const stats = statSync(resolve(root, child))
    if (stats.isDirectory()) return ['node_modules', 'dist', '__screenshots__'].includes(entry) ? [] : walk(child)
    return sourceExtensions.has(extname(entry)) ? [child] : []
  })
}

const canonicalModel = normalizeSchema(read('packages/presentation-core/src/model.ts'))
const modelHash = createHash('sha256').update(canonicalModel).digest('hex')
if (modelHash !== expectedSchemaHash) {
  failures.push('The canonical presentation model no longer matches the frozen reference schema.')
}

const frameworkFreeRoots = [
  'packages/presentation-core/src',
  'packages/editor-state/src',
  'packages/editor-interactions/src',
  'packages/parity-fixtures/src',
  'packages/rich-text/src',
]
const forbiddenFrameworkImport = /(?:from\s+|import\s*\()['"](?:vue|pinia|react|react-dom)(?:\/[^'"]*)?['"]/
for (const file of frameworkFreeRoots.flatMap(walk)) {
  if (forbiddenFrameworkImport.test(read(file))) failures.push(`${file} imports a UI framework.`)
}

const applicationRoots = ['apps/web/src', ...frameworkFreeRoots]
const applicationFiles = applicationRoots.flatMap(walk)
const retiredFrameworkImport = /(?:from\s+|import\s*\()['"](?:vue|pinia|vue-i18n|@vue\/[^'"]+)(?:\/[^'"]*)?['"]/
for (const file of applicationFiles) {
  if (retiredFrameworkImport.test(read(file))) failures.push(`${file} imports retired Vue runtime code.`)
}

const vueSourceFiles = []
const findVueFiles = path => {
  const absolutePath = resolve(root, path)
  if (!existsSync(absolutePath)) return
  for (const entry of readdirSync(absolutePath)) {
    if (['node_modules', 'dist', '.artifacts', 'tests'].includes(entry)) continue
    const child = `${path}/${entry}`
    const stats = statSync(resolve(root, child))
    if (stats.isDirectory()) findVueFiles(child)
    else if (entry.endsWith('.vue')) vueSourceFiles.push(child)
  }
}
for (const path of ['apps', 'packages', 'src']) findVueFiles(path)
for (const file of vueSourceFiles) failures.push(`${file} is a retired Vue source file.`)

const manifests = ['package.json', 'apps/web/package.json', ...readdirSync(resolve(root, 'packages')).map(name => `packages/${name}/package.json`)]
const retiredPackages = new Set(['vue', 'pinia', 'vue-i18n', 'vue-tsc', '@vitejs/plugin-vue', '@vue/compiler-dom', '@vue/compiler-sfc'])
for (const manifest of manifests) {
  const packageJson = JSON.parse(read(manifest))
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const dependency of Object.keys(packageJson[section] ?? {})) {
      if (retiredPackages.has(dependency) || dependency.startsWith('@vue/')) {
        failures.push(`${manifest} still declares retired dependency ${dependency}.`)
      }
    }
  }
}

const canonicalTypeNames = [
  'Slide',
  'PPTElement',
  'PPTTextElement',
  'PPTImageElement',
  'PPTShapeElement',
  'PPTLineElement',
  'PPTChartElement',
  'PPTTableElement',
  'PPTVideoElement',
  'PPTAudioElement',
  'PPTLatexElement',
  'Note',
  'NoteReply',
]
const duplicateTypePattern = new RegExp(`export\\s+(?:interface|type)\\s+(?:${canonicalTypeNames.join('|')})\\b`)
for (const file of applicationFiles) {
  if (file === 'packages/presentation-core/src/model.ts') continue
  if (duplicateTypePattern.test(read(file))) failures.push(`${file} duplicates a canonical presentation type.`)
}

for (const file of applicationFiles) {
  if (/from\s+['"]nanoid['"]/.test(read(file)) && file !== 'packages/presentation-core/src/ids.ts') {
    failures.push(`${file} bypasses the presentation ID policy.`)
  }
}

const runtime = read('apps/web/src/features/editor/editor-runtime.ts')
for (const contract of [
  "createEditorStore({ presentation })",
  'editorActions.transactionCommitted',
  'createPresentationTransaction({',
]) {
  if (!runtime.includes(contract)) failures.push(`The React editor runtime is missing canonical adapter contract: ${contract}`)
}

if (failures.length) {
  console.error('Gate 2 boundary audit failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Gate 2 boundary audit passed: schema, framework, ID, React adapter, and retired-Vue boundaries are intact.')
