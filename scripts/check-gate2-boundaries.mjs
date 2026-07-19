import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const failures = []
const sourceExtensions = new Set(['.ts', '.tsx', '.vue', '.js', '.mjs'])
const expectedSchemaHash = 'b4ee4a7bd7978706cd0033e62c29daf8a0167a964d1be40ebf59989788347bb5'

const read = path => readFileSync(resolve(root, path), 'utf8')
const normalizeSchema = source => source
  .split(/\r?\n/)
  .map(line => line.trimEnd())
  .join('\n')

const walk = path => {
  const absolutePath = resolve(root, path)
  return readdirSync(absolutePath).flatMap(entry => {
    const child = `${path}/${entry}`
    const stats = statSync(resolve(root, child))
    if (stats.isDirectory()) return entry === 'node_modules' ? [] : walk(child)
    const extension = entry.slice(entry.lastIndexOf('.'))
    return sourceExtensions.has(extension) ? [child] : []
  })
}

const canonicalModel = normalizeSchema(read('packages/presentation-core/src/model.ts'))
const modelHash = createHash('sha256').update(canonicalModel).digest('hex')
if (modelHash !== expectedSchemaHash) {
  failures.push('The canonical presentation model no longer matches the frozen Vue schema.')
}

const compatibilityExport = read('src/types/slides.ts')
if (!compatibilityExport.includes("export * from '@mona/presentation-core/model'")) {
  failures.push('src/types/slides.ts must remain a compatibility export of the canonical model.')
}

const frameworkFreeRoots = [
  'packages/presentation-core/src',
  'packages/editor-state/src',
  'packages/editor-interactions/src',
  'packages/parity-fixtures/src',
]
const forbiddenFrameworkImport = /(?:from\s+|import\s*\()['"](?:vue|pinia|react|react-dom)(?:\/[^'"]*)?['"]/
for (const file of frameworkFreeRoots.flatMap(walk)) {
  if (forbiddenFrameworkImport.test(read(file))) {
    failures.push(`${file} imports a UI framework.`)
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
for (const file of [...walk('src'), ...walk('packages')]) {
  if (file === 'packages/presentation-core/src/model.ts') continue
  if (duplicateTypePattern.test(read(file))) failures.push(`${file} duplicates a canonical presentation type.`)
}

const allowedDirectNanoidImports = new Set([
  'src/components/OutlineEditor.vue',
  'src/store/main.ts',
  'src/views/Editor/Toolbar/common/SVGLine.vue',
])
for (const file of walk('src')) {
  if (/from\s+['"]nanoid['"]/.test(read(file)) && !allowedDirectNanoidImports.has(file)) {
    failures.push(`${file} bypasses the presentation ID policy.`)
  }
}

const slidesStore = read('src/store/slides.ts')
const actionCommands = new Map([
  ['setTitle', 'presentation.title.set'],
  ['setTheme', 'presentation.theme.update'],
  ['setViewportSize', 'presentation.viewport-size.set'],
  ['setViewportRatio', 'presentation.viewport-ratio.set'],
  ['setSlides', 'presentation.slides.replace'],
  ['setTemplates', 'presentation.templates.replace'],
  ['addSlide', 'slide.add'],
  ['updateSlide', 'slide.update'],
  ['removeSlideProps', 'slide.properties.remove'],
  ['deleteSlide', 'slide.delete'],
  ['updateSlideIndex', 'slide.focus'],
  ['addElement', 'element.add'],
  ['deleteElement', 'element.delete'],
  ['updateElement', 'element.update'],
  ['removeElementProps', 'element.properties.remove'],
])
for (const [action, command] of actionCommands) {
  if (!slidesStore.includes(`${action}(`) || !slidesStore.includes(`type: '${command}'`)) {
    failures.push(`The Vue ${action} action is not mapped to ${command}.`)
  }
}

const directStoreWrite = /slidesStore\.(?:title|theme|slides|slideIndex|viewportSize|viewportRatio|templates)\s*=|slidesStore\.\$patch\s*\(/
for (const file of walk('src')) {
  if (file === 'src/store/slides.ts') continue
  if (directStoreWrite.test(read(file))) failures.push(`${file} writes presentation state outside the core adapter.`)
}

if (failures.length) {
  console.error('Gate 2 boundary audit failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Gate 2 boundary audit passed: schema, framework, ID, and Vue mutation boundaries are intact.')
