import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

/* eslint-disable no-console */

const root = process.cwd()
const localeDir = path.join(root, 'apps/web/src/i18n/shared')
const sourceDir = path.join(root, 'apps/web/src')
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
  if (entry.isDirectory()) return entry.name === '__screenshots__' ? [] : walkFiles(target)
  return [target]
})

const inspectScript = file => {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  for (const [index, line] of lines.entries()) {
    if (!hanPattern.test(line)) continue
    const withoutNativeFontNames = [...nativeFontNames].reduce(
      (source, name) => source.replaceAll(name, ''),
      line,
    )
    if (hanPattern.test(withoutNativeFontNames)) {
      errors.push(`${path.relative(root, file)}:${index + 1} contains untranslated UI text: ${line.trim()}`)
    }
  }
}

for (const file of walkFiles(sourceDir)) {
  if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue
  if (/(?:\.(?:unit|browser|e2e))?\.test\.tsx?$/.test(file) || file.includes(`${path.sep}i18n${path.sep}shared${path.sep}`)) continue
  inspectScript(file)
}

if (errors.length) {
  console.error(`i18n check failed with ${errors.length} error(s):`)
  errors.forEach(error => console.error(`- ${error}`))
  process.exit(1)
}

console.log('i18n check passed: catalog synchronization and untranslated UI text are clean.')
