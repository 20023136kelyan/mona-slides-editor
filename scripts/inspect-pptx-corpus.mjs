/* eslint-env node */
/* eslint-disable no-console */

import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, relative, resolve } from 'node:path'

import JSZip from 'jszip'

const projectRoot = resolve(import.meta.dirname, '..')
const corpusRoot = resolve(projectRoot, 'tests/corpus')
const fixtureDirectories = [resolve(corpusRoot, 'public'), resolve(corpusRoot, 'private')]

const count = (value, expression) => [...value.matchAll(expression)].length
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const numbered = (prefix, suffix = '.xml') => name => {
  const match = name.match(new RegExp(`^${escapeRegExp(prefix)}(\\d+)${escapeRegExp(suffix)}$`))
  return match ? Number(match[1]) : null
}

const sortedParts = (zip, prefix, suffix = '.xml') => Object.keys(zip.files)
  .map(name => ({ index: numbered(prefix, suffix)(name), name }))
  .filter(item => item.index !== null)
  .sort((left, right) => left.index - right.index)
  .map(item => item.name)

const readParts = async (zip, names) => Promise.all(names.map(async name => {
  const part = zip.file(name)
  if (!part) throw new Error(`Missing OOXML package part: ${name}`)
  return part.async('string')
}))

const inspect = async file => {
  const bytes = await readFile(file)
  const zip = await JSZip.loadAsync(bytes)
  const names = Object.keys(zip.files)
  const slideNames = sortedParts(zip, 'ppt/slides/slide')
  const slideXml = await readParts(zip, slideNames)
  const slideRelationshipNames = names
    .filter(name => /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
  const slideRels = await readParts(zip, slideRelationshipNames)
  const chartNames = sortedParts(zip, 'ppt/charts/chart')
  const chartXml = await readParts(zip, chartNames)
  const templateNames = names
    .filter(name => /^ppt\/(?:slideLayouts\/slideLayout|slideMasters\/slideMaster)\d+\.xml$/.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
  const templateXml = await readParts(zip, templateNames)
  const allSlides = slideXml.join('\n')
  const allSlideRels = slideRels.join('\n')
  const allTemplates = templateXml.join('\n')
  const diagramTargets = new Set([...allSlideRels.matchAll(/Target="\.\.\/diagrams\/(data\d+\.xml)"/g)].map(match => match[1]))

  return {
    file: basename(file),
    location: relative(corpusRoot, file),
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    package: {
      slides: slideNames.length,
      masters: names.filter(name => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(name)).length,
      layouts: names.filter(name => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(name)).length,
      themes: names.filter(name => /^ppt\/theme\/theme\d+\.xml$/.test(name)).length,
      charts: chartNames.length,
      tables: count(allSlides, /<a:tbl\b/g),
      pictures: count(allSlides, /<p:pic\b/g),
      groups: count(allSlides, /<p:grpSp\b/g),
      notesSlides: names.filter(name => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name)).length,
      media: names.filter(name => /^ppt\/media\/[^/]+$/.test(name)).length,
      hyperlinkRelationships: count(allSlideRels, /relationships\/hyperlink"/g),
      hyperlinkReferences: count(allSlides, /<a:hlink(?:Click|MouseOver)\b/g),
      smartArt: diagramTargets.size,
      equations: count(allSlides, /<m:oMath(?:Para)?\b/g),
      mergedCellAttributes: count(allSlides, /\b(?:gridSpan|rowSpan|hMerge|vMerge)="/g),
      rotatedTransforms: count(allSlides, /<a:xfrm\b[^>]*\brot="/g),
      croppedImages: count(allSlides, /<a:srcRect\b/g),
      shadows: count(allSlides, /<a:(?:outerShdw|innerShdw|prstShdw)\b/g),
      alphaEffects: count(allSlides, /<a:alpha(?:ModFix|Mod|Off|Repl)?\b/g),
      transitions: count(allSlides, /<p:transition\b/g),
      timingSlides: count(allSlides, /<p:timing\b/g),
      slideNumberPlaceholders: count(allSlides, /type="sldNum"/g),
      footerPlaceholders: count(allSlides, /type="ftr"/g),
      templateSlideNumberPlaceholders: count(allTemplates, /type="sldNum"/g),
      templateFooterPlaceholders: count(allTemplates, /type="ftr"/g),
    },
    charts: chartXml.map((xml, index) => {
      const types = new Set([...xml.matchAll(/<c:([A-Za-z0-9]+Chart)\b/g)].map(match => match[1]))
      return {
        part: chartNames[index],
        types: [...types].sort(),
        series: count(xml, /<c:ser\b/g),
        legend: /<c:legend\b/.test(xml),
      }
    }),
  }
}

const files = []
for (const directory of fixtureDirectories) {
  try {
    for (const name of await readdir(directory)) {
      if (name.endsWith('.pptx')) files.push(resolve(directory, name))
    }
  }
  catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

const report = {
  schemaVersion: 2,
  fixtures: await Promise.all(files.sort().map(inspect)),
}

const outputIndex = process.argv.indexOf('--write')
if (outputIndex >= 0) {
  const argument = process.argv[outputIndex + 1]
  if (!argument) throw new Error('--write requires an output path')
  const output = resolve(projectRoot, argument)
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Corpus ground truth written to ${relative(projectRoot, output)}`)
}
else console.log(JSON.stringify(report, null, 2))
