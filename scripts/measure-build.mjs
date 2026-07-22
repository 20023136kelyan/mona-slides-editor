/* eslint-env node */
/* eslint-disable no-console */

import { gzipSync } from 'node:zlib'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, relative, resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const buildDirectory = resolve(projectRoot, process.env.MONA_BUILD_DIR || 'apps/web/dist')
const runtimeLabel = process.env.MONA_RUNTIME_LABEL || 'react-production'

const collectFiles = async directory => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectFiles(entryPath))
    else files.push(entryPath)
  }
  return files
}

const extensionGroup = file => {
  const extension = extname(file).slice(1).toLowerCase()
  if (['woff', 'woff2', 'ttf', 'otf'].includes(extension)) return 'fonts'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension)) return 'images'
  return extension || 'other'
}

const files = await collectFiles(buildDirectory)
const fileMetrics = []

for (const file of files) {
  const bytes = await readFile(file)
  fileMetrics.push({
    file: relative(buildDirectory, file),
    group: extensionGroup(file),
    bytes: bytes.byteLength,
    gzipBytes: gzipSync(bytes).byteLength,
  })
}

const byGroup = {}
for (const metric of fileMetrics) {
  byGroup[metric.group] ||= { files: 0, bytes: 0, gzipBytes: 0 }
  byGroup[metric.group].files++
  byGroup[metric.group].bytes += metric.bytes
  byGroup[metric.group].gzipBytes += metric.gzipBytes
}

const report = {
  schemaVersion: 1,
  runtime: runtimeLabel,
  totals: {
    files: fileMetrics.length,
    bytes: fileMetrics.reduce((total, metric) => total + metric.bytes, 0),
    gzipBytes: fileMetrics.reduce((total, metric) => total + metric.gzipBytes, 0),
  },
  byGroup,
  largestFiles: [...fileMetrics]
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, 12),
}

const outputIndex = process.argv.indexOf('--write')
if (outputIndex >= 0) {
  const outputArgument = process.argv[outputIndex + 1]
  if (!outputArgument) throw new Error('--write requires an output path')
  const outputPath = resolve(projectRoot, outputArgument)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Build baseline written to ${relative(projectRoot, outputPath)}`)
}
else {
  console.log(JSON.stringify(report, null, 2))
}
