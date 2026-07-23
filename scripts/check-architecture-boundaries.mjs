import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, resolve } from 'node:path'

const root = process.cwd()
const failures = []
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs'])

const read = path => readFileSync(resolve(root, path), 'utf8')
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

const canonicalModel = read('packages/presentation-core/src/model.ts')
const slideContract = canonicalModel.match(/export interface Slide\s*{([\s\S]*?)\n}/)?.[1] ?? ''
for (const property of ['id:', 'elements:', 'title?:', 'hidden?:', 'durationMs?:']) {
  if (!slideContract.includes(property)) {
    failures.push(`The canonical Slide contract is missing ${property}`)
  }
}

const frameworkFreeRoots = [
  'packages/presentation-core/src',
  'packages/editor-state/src',
  'packages/editor-interactions/src',
  'packages/test-fixtures/src',
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

const featureFiles = walk('apps/web/src/features')
const directUiPrimitiveImport = /(?:from\s+|import\s*\()['"](?:radix-ui|@radix-ui\/[^'"]+)['"]/
for (const file of featureFiles) {
  if (directUiPrimitiveImport.test(read(file))) {
    failures.push(`${file} bypasses the shadcn component layer with a direct Radix import.`)
  }
}

const nativeButtonAllowlist = new Set([
  'apps/web/src/features/editor/EditorCanvas.tsx',
  'apps/web/src/features/editor/EditorGradientBar.tsx',
  'apps/web/src/features/editor/EditorSelectionOverlay.tsx',
  'apps/web/src/features/mobile/MobileThumbnails.tsx',
  'apps/web/src/features/presentation-renderer/ReadOnlyDeck.tsx',
  'apps/web/src/features/presentation-renderer/elements/MediaElements.tsx',
])
for (const file of featureFiles) {
  const source = read(file)
  if (/<button\b/.test(source) && !nativeButtonAllowlist.has(file)) {
    failures.push(`${file} introduces an ordinary native button; compose the shadcn Button, Toggle, or Tabs component instead.`)
  }
  if (/<(?:select|textarea)\b/.test(source)) {
    failures.push(`${file} introduces a native form control; use the shadcn component layer.`)
  }
}

const uiTokens = read('apps/web/src/index.css')
for (const token of [
  '--brand-deep-red:',
  '--brand-red:',
  '--brand-orange:',
  '--radius-detail:',
  '--radius-control:',
  '--radius-surface:',
  '--radius-action:',
  '--radius-overlay:',
  '--radius-pill:',
  '--editor-selection:',
]) {
  if (!uiTokens.includes(token)) failures.push(`The centralized UI token ${token.slice(0, -1)} is missing.`)
}

const editorCss = read('apps/web/src/features/editor/editor.css')
if (!editorCss.includes('geometry and direct-manipulation exceptions')) {
  failures.push('apps/web/src/features/editor/editor.css must document that it owns geometry, not ordinary chrome skins.')
}
if (/\.mona-editor-header\s*\{/.test(editorCss) && /height:\s*56px/.test(editorCss.match(/\.mona-editor-header\s*\{[\s\S]*?\n\}/)?.[0] ?? '')) {
  failures.push('apps/web/src/features/editor/editor.css still skins the header; move header chrome to Tailwind + Button variants.')
}
if (/\.mona-statusbar[^{\s]*\s*\{[^}]*background/.test(editorCss)) {
  failures.push('apps/web/src/features/editor/editor.css still skins the status bar; use Tailwind status-bar recipes instead.')
}

for (const file of [
  'apps/web/src/features/editor/editor.css',
  'apps/web/src/features/mobile/mobile.css',
  'apps/web/src/features/presentation-renderer/renderer.css',
  'apps/web/src/features/screen/screen.css',
]) {
  const source = read(file)
  if (/border-radius:\s*(?:\d*\.?\d+(?:px|rem|em)|50%)/.test(source)) {
    failures.push(`${file} contains a literal radius; use a centralized radius role.`)
  }
  if (/(?:#d14424|#bb3d22|#db654a|rgba?\(209[, ]+68[, ]+36)/i.test(source)) {
    failures.push(`${file} restores the retired orange control accent; use neutral semantic UI tokens.`)
  }
}

for (const file of applicationFiles) {
  if (file === 'apps/web/src/lib/legacy-compatibility.ts') continue
  if (/pptist/i.test(read(file))) {
    failures.push(`${file} leaks legacy product naming outside the isolated compatibility boundary.`)
  }
}

for (const file of applicationFiles) {
  if (/mona:notice/.test(read(file))) {
    failures.push(`${file} uses the retired document-wide notification event; use the typed editor notification service.`)
  }
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
  console.error('Architecture boundary audit failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Architecture boundary audit passed: canonical model, framework, UI primitive, token, ID, adapter, and retired-framework boundaries are intact.')
