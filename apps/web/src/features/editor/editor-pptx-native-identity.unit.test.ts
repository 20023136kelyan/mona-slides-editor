import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { parse, type Element as ParsedElement } from '@mona/pptx-parser'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { createPowerPointPackageBacking } from '@/features/editor/editor-pptx-package'

const corpusFile = (name: string) => new URL(
  `../../../../../tests/corpus/public/${name}`,
  import.meta.url,
)

const flattenElements = (elements: ParsedElement[]): ParsedElement[] => elements.flatMap(element => (
  element.type === 'group'
    ? [element, ...flattenElements(element.elements)]
    : element.type === 'diagram'
      ? [element, ...element.elements]
      : [element]
))

const fixtures = [
  'corpus-01-text.pptx',
  'corpus-02-shapes-lines.pptx',
  'corpus-03-media.pptx',
  'corpus-04-chart-table.pptx',
  'corpus-05-groups.pptx',
] as const

const privateSmartArtFixture = new URL(
  '../../../../../tests/corpus/private/real-04-powerpoint-design-smartart-notes.pptx',
  import.meta.url,
)
const privateOleFixture = new URL(
  '../../../../../tests/corpus/private/real-01-powerpoint-native-charts-stress.pptx',
  import.meta.url,
)
const privateCorporateFixture = new URL(
  '../../../../../tests/corpus/private/real-03-nasa-sewp-corporate.pptx',
  import.meta.url,
)

describe('Mona PowerPoint parser native identity', () => {
  it.each(fixtures)('carries an exact OOXML part and cNvPr id through %s', async fileName => {
    const file = await readFile(corpusFile(fileName))
    const source = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
    const [parsed, backing] = await Promise.all([
      parse(source, { audioMode: 'blob', imageMode: 'base64', videoMode: 'blob' }),
      createPowerPointPackageBacking(source, fileName),
    ])
    const parsedElements = parsed.slides.flatMap(slide => (
      flattenElements([...(slide.masterElements ?? []), ...slide.layoutElements, ...slide.elements])
    ))

    expect(parsedElements.length).toBeGreaterThan(0)
    for (const element of parsedElements) {
      expect(element.native, `${fileName}: ${element.type} at order ${element.order}`).toBeDefined()
      const native = element.native!
      const matches = backing.manifest.objects.filter(identity => (
        identity.partPath === native.partPath
        && identity.nativeId === native.id
      ))
      expect(matches.length, `${fileName}: ${native.partPath}#${native.id}`).toBeGreaterThan(0)
    }
  })

  it('does not use object names as identity', async () => {
    const fileName = 'corpus-02-shapes-lines.pptx'
    const file = await readFile(corpusFile(fileName))
    const source = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
    const parsed = await parse(source)
    const elements = parsed.slides.flatMap(slide => flattenElements(slide.elements))
    const byName = new Map<string, typeof elements>()
    for (const element of elements) {
      const name = element.native?.name
      if (!name) continue
      const matches = byName.get(name) ?? []
      matches.push(element)
      byName.set(name, matches)
    }

    for (const sameNameElements of byName.values()) {
      expect(new Set(sameNameElements.map(element => (
        `${element.native!.partPath}#${element.native!.id}`
      ))).size).toBe(sameNameElements.length)
    }
  })

  it('resolves package-absolute chart relationships without silently losing charts', async () => {
    const fileName = 'corpus-04-chart-table.pptx'
    const file = await readFile(corpusFile(fileName))
    const source = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
    const parsed = await parse(source)
    const charts = parsed.slides.flatMap(slide => slide.elements).filter(element => element.type === 'chart')

    expect(charts.map(chart => chart.chartType)).toEqual([
      'barChart',
      'lineChart',
      'pieChart',
    ])
  })

  it('carries identity through an equation AlternateContent branch', async () => {
    const base = await readFile(corpusFile('corpus-01-text.pptx'))
    const zip = await JSZip.loadAsync(base)
    const slidePath = 'ppt/slides/slide1.xml'
    const slide = await zip.file(slidePath)!.async('text')
    zip.file(slidePath, slide.replace('</p:spTree>', `
      <mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
        xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <mc:Choice Requires="a14">
          <p:sp>
            <p:nvSpPr><p:cNvPr id="900" name="Equation 1"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
            <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>
            <p:txBody><a:bodyPr/><a:lstStyle/><a:p><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></a:p></p:txBody>
          </p:sp>
        </mc:Choice>
        <mc:Fallback/>
      </mc:AlternateContent>
    </p:spTree>`))
    const source = await zip.generateAsync({ type: 'arraybuffer' })
    const [parsed, backing] = await Promise.all([
      parse(source),
      createPowerPointPackageBacking(source, 'equation.pptx'),
    ])
    const equation = parsed.slides.flatMap(item => item.elements).find(element => element.type === 'math')

    expect(equation?.native).toMatchObject({
      id: '900',
      kind: 'math',
      name: 'Equation 1',
      partPath: slidePath,
      sourceLayer: 'slide',
    })
    expect(backing.manifest.objects).toContainEqual(expect.objectContaining({
      nativeId: '900',
      partPath: slidePath,
    }))
  })

  it.runIf(existsSync(privateSmartArtFixture))(
    'carries identity through real SmartArt frames and diagram drawing children',
    async () => {
      const file = await readFile(privateSmartArtFixture)
      const source = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
      const [parsed, backing] = await Promise.all([
        parse(source),
        createPowerPointPackageBacking(source, 'smartart.pptx'),
      ])
      const diagrams = parsed.slides
        .flatMap(slide => [...(slide.masterElements ?? []), ...slide.layoutElements, ...slide.elements])
        .filter(element => element.type === 'diagram')

      expect(diagrams.length).toBeGreaterThan(0)
      for (const diagram of diagrams) {
        expect(diagram.native?.kind).toBe('graphic-frame')
        expect(diagram.native?.partPath).toMatch(/^ppt\/slides\//)
        for (const child of diagram.elements) {
          expect(child.native?.sourceLayer).toBe('diagram')
          expect(child.native?.partPath).toMatch(/^ppt\/diagrams?\//)
          expect(backing.manifest.objects).toContainEqual(expect.objectContaining({
            nativeId: child.native?.id,
            partPath: child.native?.partPath,
          }))
        }
      }
    },
  )

  it.runIf(existsSync(privateOleFixture))(
    'uses the VML preview for an embedded OLE object instead of silently dropping it',
    async () => {
      const file = await readFile(privateOleFixture)
      const source = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
      const parsed = await parse(source)
      const preview = parsed.slides
        .flatMap(slide => slide.elements)
        .find(element => element.native?.id === '58373')

      expect(preview).toMatchObject({
        type: 'image',
        native: {
          id: '58373',
          kind: 'graphic-frame',
          partPath: 'ppt/slides/slide10.xml',
        },
      })
      expect(preview?.type === 'image' ? preview.base64 : '').toMatch(/^data:image\//)
    },
  )

  it.runIf(existsSync(privateCorporateFixture))(
    'retains authored background layers, theme schemes, master text styles, and header/footer policy',
    async () => {
      const file = await readFile(privateCorporateFixture)
      const source = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
      const [parsed, backing] = await Promise.all([
        parse(source, { imageMode: 'base64' }),
        createPowerPointPackageBacking(source, 'corporate.pptx'),
      ])

      expect(parsed.slides.some(slide => (
        slide.backgrounds?.source && slide.backgrounds.source !== 'default'
      ))).toBe(true)
      expect(parsed.slides.some(slide => slide.backgrounds?.master)).toBe(true)
      expect(backing.reference.hierarchy?.themes.some(theme => (
        Boolean(theme.majorFont?.latin)
        && Boolean(theme.minorFont?.latin)
        && theme.colors.length >= 8
      ))).toBe(true)
      expect(backing.reference.hierarchy?.masters.some(master => (
        Boolean(master.colorMap)
        && Boolean(master.textStyles?.title.length)
        && Boolean(master.textStyles?.body.length)
      ))).toBe(true)
      expect(backing.reference.hierarchy?.masters.some(master => Boolean(master.headerFooter))).toBe(true)
      expect(backing.reference.hierarchy?.placeholders.some(placeholder => placeholder.layer === 'master')).toBe(true)
      expect(backing.reference.hierarchy?.placeholders.some(placeholder => placeholder.layer === 'layout')).toBe(true)
      const structuredText = parsed.slides.flatMap(slide => (
        flattenElements([...(slide.masterElements ?? []), ...slide.layoutElements, ...slide.elements])
      )).flatMap(element => (
        element.type === 'text' || element.type === 'shape'
          ? element.textBody ? [element.textBody] : []
          : []
      ))
      expect(structuredText.length).toBeGreaterThan(0)
      expect(structuredText.some(body => body.paragraphs.some(paragraph => paragraph.runs.length))).toBe(true)
      expect(structuredText.some(body => body.paragraphs.some(paragraph => (
        paragraph.runs.some(run => run.properties?.fontSize || run.properties?.fontFamily)
      )))).toBe(true)
      expect(backing.reference.hierarchy?.masters.some(master => (
        master.textStyles?.body.some(level => Boolean(level.paragraph) && Boolean(level.run))
      ))).toBe(true)
    },
  )
})
