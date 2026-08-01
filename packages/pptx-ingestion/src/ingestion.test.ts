import { readFile } from 'node:fs/promises'

import {
  flattenElementTree,
  validatePresentationState,
  type SlideTheme,
} from '@mona/presentation-core'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { ingestPowerPoint } from './index'
import { promotePowerPointListTextStyle } from './html-fragment'

const theme: SlideTheme = {
  backgroundColor: '#ffffff',
  fontColor: '#333333',
  fontName: 'Arial',
  outline: { color: '#525252', style: 'solid', width: 2 },
  shadow: { blur: 2, color: '#808080', h: 3, v: 3 },
  themeColors: ['#5b9bd5', '#ed7d31', '#a5a5a5'],
}

const corpus = (name: string): URL => new URL(
  `../../../tests/corpus/public/${name}`,
  import.meta.url,
)

const arrayBuffer = async (name: string): Promise<ArrayBuffer> => {
  const bytes = await readFile(corpus(name))
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}

const collectStrings = (value: unknown, found: string[] = []): string[] => {
  if (typeof value === 'string') found.push(value)
  else if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, found)
  }
  else if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) collectStrings(entry, found)
  }
  return found
}

describe('desktop-safe PowerPoint ingestion', () => {
  for (const fileName of [
    'corpus-01-text.pptx',
    'corpus-02-shapes-lines.pptx',
    'corpus-03-media.pptx',
    'corpus-04-chart-table.pptx',
    'corpus-05-groups.pptx',
  ]) {
    it(`ingests ${fileName} without a renderer DOM`, async () => {
      const source = await arrayBuffer(fileName)
      const result = await ingestPowerPoint(source, { fileName, theme })
      const validation = validatePresentationState(result.presentation)

      expect(validation.issues.filter(issue => issue.severity === 'error')).toEqual([])
      expect(result.backing.bytes.byteLength).toBe(source.byteLength)
      expect(result.backing.reference.packageId).toMatch(/^pptx:[a-f0-9]{64}$/)
      expect(result.backing.reference.coordinateScale).toBeCloseTo(96 / 72, 8)
      expect(result.backing.manifest.coordinateScale).toBeCloseTo(96 / 72, 8)
      expect(result.backing.manifest.parts.length).toBeGreaterThan(0)
      expect(result.presentation.slides.length).toBeGreaterThan(0)
      expect(result.report.slides).toHaveLength(result.presentation.slides.length)
      expect(result.presentation.sourcePackages?.[0]?.importReport).toEqual(result.report)
      expect(
        result.presentation.slides.flatMap(slide => flattenElementTree(slide.elements)).length,
      ).toBeGreaterThan(0)
      expect(
        collectStrings(result.presentation).filter(value => value.startsWith('data:')),
      ).toEqual([])
      expect(new Set(result.assets.map(asset => asset.name)).size).toBe(result.assets.length)
    })
  }

  it('keeps package and media identities deterministic across runs', async () => {
    const source = await arrayBuffer('corpus-03-media.pptx')
    const first = await ingestPowerPoint(source, {
      assetUrl: ({ name }) => `asset://${name}`,
      fileName: 'corpus-03-media.pptx',
      theme,
    })
    const second = await ingestPowerPoint(source, {
      assetUrl: ({ name }) => `asset://${name}`,
      fileName: 'corpus-03-media.pptx',
      theme,
    })

    expect(second.backing.reference.packageId).toBe(first.backing.reference.packageId)
    expect(second.assets.map(asset => asset.name)).toEqual(first.assets.map(asset => asset.name))
    expect(second.assets.map(asset => asset.url)).toEqual(first.assets.map(asset => asset.url))
  })

  it('retains native theme fill, line, effect, and background style matrices', async () => {
    const source = await arrayBuffer('corpus-01-text.pptx')
    const result = await ingestPowerPoint(source, { fileName: 'theme-matrix.pptx', theme })
    const nativeTheme = result.backing.reference.hierarchy?.themes.find(candidate => !candidate.isOverride)
    expect(nativeTheme?.fillStyles?.length).toBeGreaterThan(0)
    expect(nativeTheme?.lineStyles?.length).toBeGreaterThan(0)
    expect(nativeTheme?.effectStyles?.length).toBeGreaterThan(0)
    expect(nativeTheme?.backgroundFillStyles?.length).toBeGreaterThan(0)
    expect(nativeTheme?.fillStyles?.some(style => style.colors.length > 0)).toBe(true)
  })

  it('records the exact coordinate scale used by fixed-viewport imports', async () => {
    const source = await arrayBuffer('corpus-02-shapes-lines.pptx')
    const result = await ingestPowerPoint(source, {
      fileName: 'corpus-02-shapes-lines.pptx',
      fixedViewport: true,
      theme,
    })

    expect(result.presentation.viewportSize).toBe(1000)
    expect(result.backing.reference.coordinateScale).toBeCloseTo(
      1000 / result.parsed.size.width,
      8,
    )
  })

  it('retains notes, comments, sections, custom shows, timing, transitions, and accessibility metadata', async () => {
    const source = await arrayBuffer('corpus-01-text.pptx')
    const zip = await JSZip.loadAsync(source)
    const slidePath = 'ppt/slides/slide1.xml'
    const slideEntry = zip.file(slidePath)!
    const slideXml = await slideEntry.async('text')
    zip.file(slidePath, slideXml.replace(
      '</p:sld>',
      '<p:transition advClick="0" advTm="2500" spd="fast"><p:fade thruBlk="1"/></p:transition>'
      + '<p:timing><p:tnLst><p:par><p:cTn id="7" dur="1000"><p:stCondLst><p:cond evt="onClick"><p:tgtEl><p:spTgt spid="2"/></p:tgtEl></p:cond></p:stCondLst><p:childTnLst><p:anim><p:cBhvr><p:cTn id="8"/><p:tgtEl><p:spTgt spid="2"/></p:tgtEl></p:cBhvr></p:anim></p:childTnLst></p:cTn></p:par></p:tnLst><p:bldLst><p:bldP spid="2" grpId="0"/></p:bldLst></p:timing>'
      + '</p:sld>',
    ))

    const relationshipPath = 'ppt/slides/_rels/slide1.xml.rels'
    const relationshipEntry = zip.file(relationshipPath)!
    const relationshipXml = await relationshipEntry.async('text')
    zip.file(relationshipPath, relationshipXml.replace(
      '</Relationships>',
      '<Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>'
      + '<Relationship Id="rIdComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments/comment1.xml"/>'
      + '</Relationships>',
    ))
    zip.file('ppt/notesSlides/notesSlide1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder" title="Speaker notes" descr="Detailed notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="fr-FR" b="1" sz="1800"><a:latin typeface="Aptos"/></a:rPr><a:t>Speaker context</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>')
    zip.file('ppt/comments/comment1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:cmLst xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cm authorId="0" dt="2026-08-01T12:00:00Z" idx="5"><p:pos x="120" y="240"/><p:text>Review this wording</p:text></p:cm></p:cmLst>')
    zip.file('ppt/commentAuthors.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:cmAuthorLst xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cmAuthor id="0" name="Ada" initials="AL" lastIdx="5"/></p:cmAuthorLst>')
    zip.file('ppt/theme/themeOverride1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:themeOverride xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:clrScheme name="Chart"><a:accent1><a:srgbClr val="123456"/></a:accent1></a:clrScheme><a:fmtScheme name="Chart formats"><a:fillStyleLst><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:fillStyleLst><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeOverride>')

    const presentationEntry = zip.file('ppt/presentation.xml')!
    zip.file('ppt/presentation.xml', (await presentationEntry.async('text')).replace(
      '</p:presentation>',
      '<p:sectionLst><p:section name="Introduction" id="section-1"><p:sldIdLst><p:sldId id="256"/></p:sldIdLst></p:section></p:sectionLst>'
      + '<p:custShowLst><p:custShow name="Executive" id="1"><p:sldLst><p:sld r:id="rId2"/></p:sldLst></p:custShow></p:custShowLst>'
      + '</p:presentation>',
    ))

    const archive = await zip.generateAsync({ type: 'arraybuffer' })
    const result = await ingestPowerPoint(archive, { fileName: 'semantic-metadata.pptx', theme })
    const document = result.backing.reference.document
    expect(document?.notesSlides).toHaveLength(1)
    expect(document?.notesSlides[0]?.placeholders[0]).toMatchObject({
      placeholderType: 'body',
      paragraphs: [{ runs: [{ bold: true, fontFamily: 'Aptos', language: 'fr-FR', text: 'Speaker context' }] }],
    })
    expect(document?.commentAuthors[0]).toMatchObject({ id: '0', initials: 'AL', name: 'Ada' })
    expect(document?.comments[0]).toMatchObject({
      authorId: '0',
      id: '5',
      position: { x: 120, y: 240 },
      slidePart: slidePath,
      text: 'Review this wording',
    })
    expect(document?.sections[0]).toMatchObject({ id: 'section-1', name: 'Introduction', slideIds: ['256'] })
    expect(document?.customShows[0]).toMatchObject({ name: 'Executive', relationshipIds: ['rId2'] })
    expect(document?.timings[0]?.transition).toMatchObject({
      advanceAfterMs: 2500,
      advanceOnClick: false,
      effect: { type: 'fade' },
      sourceLayer: 'slide',
      speed: 'fast',
    })
    expect(document?.timings[0]?.builds[0]).toMatchObject({ kind: 'bldP', targetShapeId: '2' })
    expect(collectStrings(document?.timings[0]?.roots).some(value => value === '2')).toBe(true)
    expect(result.backing.reference.slides[0]?.notesPart).toBe('ppt/notesSlides/notesSlide1.xml')
    expect(result.backing.reference.hierarchy?.themes).toContainEqual(expect.objectContaining({
      colorSchemeName: 'Chart',
      fillStyles: [expect.objectContaining({ kind: 'solidFill' })],
      isOverride: true,
      partPath: 'ppt/theme/themeOverride1.xml',
    }))
  })

  it('honors cancellation before reading the package', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(ingestPowerPoint(new ArrayBuffer(0), {
      fileName: 'cancelled.pptx',
      signal: controller.signal,
      theme,
    })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects incomplete OOXML rather than returning a partial presentation', async () => {
    await expect(ingestPowerPoint(new ArrayBuffer(12), {
      fileName: 'broken.pptx',
      theme,
    })).rejects.toThrow()
  })

  it('rejects entity-bearing XML before parsing package semantics', async () => {
    const zip = await JSZip.loadAsync(await arrayBuffer('corpus-01-text.pptx'))
    const path = 'ppt/slides/slide1.xml'
    const xml = await zip.file(path)!.async('text')
    zip.file(path, xml.replace(
      /(<\?xml[^>]*\?>)/,
      '$1<!DOCTYPE p:sld [<!ENTITY mona "unsafe">]>',
    ))
    const archive = await zip.generateAsync({ type: 'arraybuffer' })
    await expect(ingestPowerPoint(archive, { fileName: 'doctype.pptx', theme }))
      .rejects.toThrow(/prohibited DOCTYPE/)
  })

  it('rejects XML trees beyond the configured nesting limit', async () => {
    const zip = await JSZip.loadAsync(await arrayBuffer('corpus-01-text.pptx'))
    const path = 'ppt/slides/slide1.xml'
    const xml = await zip.file(path)!.async('text')
    const nested = `${'<a:x>'.repeat(260)}value${'</a:x>'.repeat(260)}`
    zip.file(path, xml.replace('</p:sld>', `${nested}</p:sld>`))
    const archive = await zip.generateAsync({ type: 'arraybuffer' })
    await expect(ingestPowerPoint(archive, { fileName: 'deep.pptx', theme }))
      .rejects.toThrow(/nested tags|nesting limit/i)
  })
})

describe('DOM-free rich-text compatibility', () => {
  it('promotes a shared direct-list run style without touching nested list text', () => {
    const html = [
      '<ul>',
      '<li><span style="font-size: 20px; color: #123456">One</span></li>',
      '<li><span style="font-size: 20px; color: #123456">Two</span>',
      '<ul><li><span style="font-size: 12px">Nested</span></li></ul></li>',
      '</ul>',
    ].join('')
    const promoted = promotePowerPointListTextStyle(html)

    expect(promoted).toContain('<ul style="font-size: 20px; color: #123456">')
    expect(promoted).toContain('<ul style="font-size: 12px"><li><span style="font-size: 12px">Nested</span>')
  })

  it('does not promote when direct items disagree', () => {
    const html = '<ul><li><span style="color: red">One</span></li><li><span style="color: blue">Two</span></li></ul>'
    expect(promotePowerPointListTextStyle(html)).toBe(html)
  })
})
