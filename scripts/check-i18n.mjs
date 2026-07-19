import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { NodeTypes, parse as parseTemplate } from '@vue/compiler-dom'

/* eslint-disable no-console */

const root = process.cwd()
const localeDir = path.join(root, 'src/i18n/locales')
const sourceDir = path.join(root, 'src')
const hanPattern = /\p{Script=Han}/u
const nativeFontNames = new Set([
  '微软雅黑',
  '思源黑体',
  '思源宋体',
  '文鼎PL楷体',
  '文鼎PL宋体',
  '朱雀仿宋',
  '霞鹜文楷',
  '霞鹜新致宋',
  '霞鹜新晰黑',
  '阿里巴巴普惠体',
  '得意黑',
])
const errors = []

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const english = readJson(path.join(localeDir, 'en-US.json'))
const chinese = readJson(path.join(localeDir, 'zh-CN.json'))

const describeShape = (value, currentPath = '$', output = []) => {
  if (Array.isArray(value)) {
    output.push(`${currentPath}:array:${value.length}`)
    value.forEach((item, index) => describeShape(item, `${currentPath}[${index}]`, output))
    return output
  }
  if (value && typeof value === 'object') {
    output.push(`${currentPath}:object`)
    for (const key of Object.keys(value).sort()) describeShape(value[key], `${currentPath}.${key}`, output)
    return output
  }
  output.push(`${currentPath}:${typeof value}`)
  return output
}

const englishShape = describeShape(english)
const chineseShape = describeShape(chinese)
if (englishShape.join('\n') !== chineseShape.join('\n')) {
  const englishSet = new Set(englishShape)
  const chineseSet = new Set(chineseShape)
  for (const item of englishShape) if (!chineseSet.has(item)) errors.push(`Missing or mismatched in zh-CN: ${item}`)
  for (const item of chineseShape) if (!englishSet.has(item)) errors.push(`Missing or mismatched in en-US: ${item}`)
}

const inspectEnglish = (value, currentPath = '$') => {
  if (typeof value === 'string' && hanPattern.test(value)) errors.push(`Chinese text in English catalog at ${currentPath}: ${value}`)
  else if (Array.isArray(value)) value.forEach((item, index) => inspectEnglish(item, `${currentPath}[${index}]`))
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) inspectEnglish(item, `${currentPath}.${key}`)
  }
}
inspectEnglish(english)

const walkFiles = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const target = path.join(directory, entry.name)
  return entry.isDirectory() ? walkFiles(target) : [target]
})

const reportSourceText = (file, sourceFile, node, value) => {
  if (!hanPattern.test(value) || nativeFontNames.has(value)) return
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  errors.push(`${path.relative(root, file)}:${position.line + 1} contains untranslated UI text: ${value}`)
}

const inspectScript = (file, source, kind = ts.ScriptKind.TS) => {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
  const visit = node => {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) reportSourceText(file, sourceFile, node, node.text)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

const inspectTemplate = (file, source) => {
  const ast = parseTemplate(source, { comments: false })
  const visit = node => {
    if (node.type === NodeTypes.TEXT && hanPattern.test(node.content)) {
      errors.push(`${path.relative(root, file)}:${node.loc.start.line} contains untranslated template text: ${node.content.trim()}`)
    }
    if (node.type === NodeTypes.ATTRIBUTE && node.value && hanPattern.test(node.value.content)) {
      errors.push(`${path.relative(root, file)}:${node.loc.start.line} contains untranslated attribute text: ${node.value.content}`)
    }
    if (node.type === NodeTypes.DIRECTIVE && node.exp && hanPattern.test(node.exp.content)) {
      errors.push(`${path.relative(root, file)}:${node.loc.start.line} contains untranslated directive text: ${node.exp.content}`)
    }
    if ('children' in node && Array.isArray(node.children)) node.children.forEach(visit)
    if (node.type === NodeTypes.IF) node.branches.forEach(visit)
    if (node.type === NodeTypes.IF_BRANCH && node.children) node.children.forEach(visit)
    if (node.type === NodeTypes.FOR && node.children) node.children.forEach(visit)
  }
  visit(ast)
}

for (const file of walkFiles(sourceDir)) {
  if (file.endsWith('.ts') || file.endsWith('.tsx')) {
    inspectScript(file, fs.readFileSync(file, 'utf8'), file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  }
  else if (file.endsWith('.vue')) {
    const source = fs.readFileSync(file, 'utf8')
    const { descriptor, errors: parseErrors } = parseSfc(source, { filename: file })
    if (parseErrors.length) {
      errors.push(`${path.relative(root, file)} could not be parsed as a Vue SFC`)
      continue
    }
    if (descriptor.template) inspectTemplate(file, descriptor.template.content)
    if (descriptor.script) inspectScript(file, descriptor.script.content, descriptor.script.lang === 'tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    if (descriptor.scriptSetup) inspectScript(file, descriptor.scriptSetup.content, descriptor.scriptSetup.lang === 'tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  }
}

if (errors.length) {
  console.error(`i18n check failed with ${errors.length} error(s):`)
  errors.forEach(error => console.error(`- ${error}`))
  process.exit(1)
}

console.log('i18n check passed: locale parity and untranslated UI text are clean.')
