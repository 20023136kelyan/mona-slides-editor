import { describe, expect, it } from 'vitest'

import { applyPresentationCommand } from './commands'
import type { PPTShapeElement, PPTTextElement, StructuredTextBody } from './model'
import type { PowerPointMasterTextStyles, PowerPointTheme } from './source'
import type { PresentationState } from './state'
import { compileStructuredText } from './structured-text'

const theme: PowerPointTheme = {
  colors: [
    { name: 'dk1', type: 'srgb', value: '101820' },
    { name: 'accent1', type: 'srgb', value: 'E2534D' },
  ],
  id: 'theme-1',
  majorFont: {
    eastAsian: 'Noto Sans CJK JP',
    latin: 'Aptos Display',
    supplemental: [{ script: 'Jpan', typeface: 'Yu Gothic' }],
  },
  minorFont: {
    complexScript: 'Noto Naskh Arabic',
    latin: 'Aptos',
    supplemental: [{ script: 'Arab', typeface: 'Noto Naskh Arabic' }],
  },
  packageId: 'pptx:fixture',
  partPath: 'ppt/theme/theme1.xml',
}

const masterTextStyles: PowerPointMasterTextStyles = {
  body: [{
    level: 1,
    paragraph: {
      bullet: { character: '•', type: 'character' },
      lineSpacing: { unit: 'percent', value: 120 },
      marginLeft: 18,
    },
    run: {
      color: { type: 'scheme', value: 'tx1' },
      fontFamily: '+mn-lt',
      fontSize: 20,
    },
  }],
  other: [],
  title: [],
}

const body: StructuredTextBody = {
  bodyProperties: {
    autoFit: { fontScale: 80, lineSpacingReduction: 10, type: 'normal' },
    insets: [2, 3, 4, 5],
  },
  listStyle: [{
    level: 0,
    paragraph: {
      defaultRun: { bold: true },
      spaceAfter: { unit: 'points', value: 6 },
    },
  }],
  paragraphs: [{
    level: 0,
    properties: {
      alignment: 'ctr',
      defaultTabSize: 24,
    },
    runs: [
      { kind: 'text', sourceId: 'p0.r0', text: 'Quarterly' },
      { kind: 'tab', sourceId: 'p0.r1' },
      {
        fieldId: 'field-1',
        fieldType: 'slidenum',
        kind: 'field',
        properties: {
          color: { type: 'scheme', value: 'accent1' },
          italic: true,
        },
        sourceId: 'p0.r2',
        text: '1',
      },
    ],
    sourceId: 'p0',
  }],
  scale: 2,
  schemaVersion: 1,
}

describe('structured PowerPoint text compilation', () => {
  it('compiles the hierarchy, theme tokens, list semantics, fitting, tabs, and fields', () => {
    const result = compileStructuredText(body, {
      colorMap: { tx1: 'dk1' },
      fallbackColor: '#000000',
      fallbackFontName: 'Arial',
      masterTextStyles,
      slideNumber: 7,
      textStyleKind: 'body',
      theme,
    })

    expect(result.defaultFontName).toBe('Aptos')
    expect(result.defaultColor).toBe('#101820')
    expect(result.bodyProperties.insets).toEqual([2, 3, 4, 5])
    expect(result.body.paragraphs[0]?.properties).toMatchObject({
      alignment: 'ctr',
      bullet: { character: '•', type: 'character' },
      defaultRun: {
        bold: true,
        color: { type: 'srgb', value: '#101820' },
        fontFamily: 'Aptos',
        fontSize: 20,
      },
      lineSpacing: { unit: 'percent', value: 120 },
      marginLeft: 18,
    })
    expect(result.body.paragraphs[0]?.runs[2]?.properties).toMatchObject({
      bold: true,
      color: { type: 'srgb', value: '#E2534D' },
      fontFamily: 'Aptos',
      fontSize: 20,
      italic: true,
    })
    expect(result.html).toContain('data-ppt-paragraph-id="p0"')
    expect(result.html).toContain('list-style-type:&quot;\u2022\u2002&quot;')
    expect(result.html).toContain('font-size:32px')
    expect(result.html).toContain('line-height:1.08')
    expect(result.html).toContain('width:48px')
    expect(result.html).toContain('data-ppt-field-type="slidenum"')
    expect(result.html).toContain('>7</span>')
  })

  it('serializes multi-level bullets as nested lists without losing paragraph identities', () => {
    const nested: StructuredTextBody = {
      listStyle: [],
      paragraphs: [
        {
          level: 0,
          properties: { bullet: { character: '•', type: 'character' } },
          runs: [{ kind: 'text', sourceId: 'p0.r0', text: 'Parent' }],
          sourceId: 'p0',
        },
        {
          level: 1,
          properties: { bullet: { character: '◦', type: 'character' } },
          runs: [{ kind: 'text', sourceId: 'p1.r0', text: 'Child' }],
          sourceId: 'p1',
        },
        {
          level: 0,
          properties: { bullet: { character: '•', type: 'character' } },
          runs: [{ kind: 'text', sourceId: 'p2.r0', text: 'Sibling' }],
          sourceId: 'p2',
        },
      ],
      scale: 1,
      schemaVersion: 1,
    }
    const result = compileStructuredText(nested, {
      fallbackColor: '#000000',
      fallbackFontName: 'Arial',
      slideNumber: 1,
      textStyleKind: 'body',
    })

    expect(result.html).toContain('<ul data-ppt-level="0"')
    expect(result.html).toContain('<ul data-ppt-level="1"')
    expect(result.html).toContain('</li></ul></li><li><p data-ppt-paragraph-id="p2"')
    expect(result.html.match(/data-ppt-paragraph-id=/g)).toHaveLength(3)
  })

  it('applies normal-autofit line-spacing reduction to authored point spacing', () => {
    const fixedSpacing: StructuredTextBody = {
      bodyProperties: {
        autoFit: { lineSpacingReduction: 25, type: 'normal' },
      },
      listStyle: [],
      paragraphs: [{
        level: 0,
        properties: {
          lineSpacing: { unit: 'points', value: 20 },
        },
        runs: [{ kind: 'text', sourceId: 'p0.r0', text: 'Measured' }],
        sourceId: 'p0',
      }],
      scale: 2,
      schemaVersion: 1,
    }
    const result = compileStructuredText(fixedSpacing, {
      fallbackColor: '#000000',
      fallbackFontName: 'Arial',
      slideNumber: 1,
      textStyleKind: 'body',
    })

    expect(result.html).toContain('line-height:30px')
  })

  it('keeps interior spaces breakable so PowerPoint text wraps at word boundaries', () => {
    const sentence: StructuredTextBody = {
      listStyle: [],
      paragraphs: [{
        level: 0,
        runs: [
          { kind: 'text', sourceId: 'p0.r0', text: '  Providing the latest in ' },
          { kind: 'text', properties: { bold: true }, sourceId: 'p0.r1', text: 'commercial products' },
        ],
        sourceId: 'p0',
      }],
      scale: 1,
      schemaVersion: 1,
    }
    const result = compileStructuredText(sentence, {
      fallbackColor: '#000000',
      fallbackFontName: 'Arial',
      slideNumber: 1,
      textStyleKind: 'body',
    })

    // Every space stays a real space: &nbsp; would leave the paragraph as one
    // unbreakable token and the browser would break it mid-word.
    expect(result.html).not.toContain('&nbsp;')
    expect(result.html).toContain('>  Providing the latest in <')
    expect(result.html).toContain('>commercial products<')
  })

  it('resolves supplemental script fonts from run language', () => {
    const japanese: StructuredTextBody = {
      listStyle: [],
      paragraphs: [{
        level: 0,
        runs: [{
          kind: 'text',
          properties: { fontFamily: '+mj-ea', language: 'ja-JP' },
          sourceId: 'jp.r0',
          text: '東京',
        }],
        sourceId: 'jp',
      }],
      scale: 1,
      schemaVersion: 1,
    }
    const result = compileStructuredText(japanese, {
      fallbackColor: '#000000',
      fallbackFontName: 'Arial',
      slideNumber: 1,
      textStyleKind: 'title',
      theme,
    })
    expect(result.defaultFontName).toBe('Yu Gothic')
    expect(result.html).toContain('font-family:&quot;Yu Gothic&quot;')
  })

  it('names a matching generic so an unavailable face does not fall back to the document serif', () => {
    const mixed: StructuredTextBody = {
      listStyle: [],
      paragraphs: [{
        level: 0,
        runs: [
          { kind: 'text', properties: { fontFamily: 'Segoe UI' }, sourceId: 'p0.r0', text: 'Sans' },
          { kind: 'text', properties: { fontFamily: 'Cambria' }, sourceId: 'p0.r1', text: 'Serif' },
          { kind: 'text', properties: { fontFamily: 'Consolas' }, sourceId: 'p0.r2', text: 'Mono' },
        ],
        sourceId: 'p0',
      }],
      scale: 1,
      schemaVersion: 1,
    }
    const result = compileStructuredText(mixed, {
      fallbackColor: '#000000',
      fallbackFontName: 'Arial',
      slideNumber: 1,
      textStyleKind: 'body',
    })

    expect(result.html).toContain('font-family:&quot;Segoe UI&quot;, sans-serif')
    expect(result.html).toContain('font-family:&quot;Cambria&quot;, serif')
    expect(result.html).toContain('font-family:&quot;Consolas&quot;, monospace')
  })

  it('keeps structured inheritance for geometry edits and detaches it for direct HTML edits', () => {
    const element: PPTTextElement = {
      content: '<p>Imported</p>',
      defaultColor: '#000000',
      defaultFontName: 'Arial',
      height: 50,
      id: 'text-1',
      left: 0,
      rotate: 0,
      structuredText: body,
      top: 0,
      type: 'text',
      width: 200,
    }
    const state: PresentationState = {
      slideIndex: 0,
      slides: [{ elements: [element], id: 'slide-1' }],
      sourcePackages: [],
      templates: [],
      theme: {
        backgroundColor: '#ffffff',
        fontColor: '#000000',
        fontName: 'Arial',
        outline: { color: '#000000', style: 'solid', width: 1 },
        shadow: { blur: 0, color: '#000000', h: 0, v: 0 },
        themeColors: [],
      },
      title: '',
      viewportRatio: 0.5625,
      viewportSize: 1000,
    }
    const moved = applyPresentationCommand(state, {
      payload: { id: element.id, props: { left: 20 } },
      type: 'element.update',
    }).state.slides[0]?.elements[0]
    expect(moved?.type === 'text' ? moved.structuredText : undefined).toBe(body)

    const edited = applyPresentationCommand(state, {
      payload: { id: element.id, props: { content: '<p>Edited</p>' } },
      type: 'element.update',
    }).state.slides[0]?.elements[0]
    expect(edited?.type === 'text' ? edited.structuredText : undefined).toBeUndefined()

    const shape: PPTShapeElement = {
      fill: '',
      fixedRatio: false,
      height: 50,
      id: 'shape-1',
      left: 0,
      path: 'M 0 0 L 100 0 L 100 100 Z',
      rotate: 0,
      text: {
        align: 'middle',
        content: '<p>Imported shape text</p>',
        defaultColor: '#000000',
        defaultFontName: 'Arial',
        structuredText: body,
      },
      top: 0,
      type: 'shape',
      viewBox: [100, 100],
      width: 200,
    }
    const shapeState: PresentationState = {
      ...state,
      slides: [{ elements: [shape], id: 'slide-1' }],
    }
    const editedShapeText = { ...shape.text!, content: '<p>Edited shape text</p>' }
    delete editedShapeText.structuredText
    const editedShape = applyPresentationCommand(shapeState, {
      payload: {
        id: shape.id,
        props: {
          text: editedShapeText,
        },
      },
      type: 'element.update',
    }).state.slides[0]?.elements[0]
    expect(editedShape?.type === 'shape' ? editedShape.text?.structuredText : body).toBeUndefined()
  })

  it('detaches only the table cell whose text was edited', () => {
    const cell = (id: string, text: string) => ({
      colspan: 1,
      id,
      rowspan: 1,
      structuredText: body,
      text,
    })
    const table = {
      cellMinHeight: 36,
      colWidths: [0.5, 0.5],
      data: [[cell('cell-0', '<p>First</p>'), cell('cell-1', '<p>Second</p>')]],
      height: 80,
      id: 'table-1',
      left: 0,
      outline: { color: '#cccccc', style: 'solid' as const, width: 1 },
      rotate: 0,
      rowHeights: [40],
      top: 0,
      type: 'table' as const,
      width: 400,
    }
    const state: PresentationState = {
      slideIndex: 0,
      slides: [{ elements: [table], id: 'slide-1' }],
      sourcePackages: [],
      templates: [],
      theme: {
        backgroundColor: '#ffffff',
        fontColor: '#000000',
        fontName: 'Arial',
        outline: { color: '#000000', style: 'solid', width: 1 },
        shadow: { blur: 0, color: '#000000', h: 0, v: 0 },
        themeColors: [],
      },
      title: '',
      viewportRatio: 0.5625,
      viewportSize: 1000,
    }

    // The editor sends the whole matrix back, so an untouched cell must keep
    // inheriting while the edited one becomes the authored source.
    const edited = applyPresentationCommand(state, {
      payload: {
        id: table.id,
        props: {
          data: [[
            { ...table.data[0]![0]!, text: '<p>Typed</p>' },
            table.data[0]![1]!,
          ]],
        },
      },
      type: 'element.update',
    }).state.slides[0]?.elements[0]
    const editedTable = edited?.type === 'table' ? edited : undefined
    expect(editedTable?.data[0]![0]!.structuredText).toBeUndefined()
    expect(editedTable?.data[0]![1]!.structuredText).toBe(body)
  })

  it('renders a bullet in its authored colour and size, and translates symbol faces', () => {
    const bullets: StructuredTextBody = {
      listStyle: [],
      paragraphs: [
        {
          level: 0,
          properties: {
            bullet: {
              character: '\uF0A7',
              color: { type: 'scheme', value: 'accent1' },
              fontFamily: 'Wingdings',
              size: { unit: 'percent', value: 45 },
              type: 'character',
            },
          },
          runs: [{ kind: 'text', sourceId: 'p0.r0', text: 'Squared' }],
          sourceId: 'p0',
        },
        {
          level: 0,
          properties: {
            bullet: { character: '\u2013', fontFamily: 'Arial', type: 'character' },
          },
          runs: [{ kind: 'text', sourceId: 'p1.r0', text: 'Dashed' }],
          sourceId: 'p1',
        },
      ],
      scale: 1,
      schemaVersion: 1,
    }
    const result = compileStructuredText(bullets, {
      fallbackColor: '#000000',
      fallbackFontName: 'Arial',
      slideNumber: 1,
      textStyleKind: 'body',
      theme,
    })

    // The Wingdings private-use codepoint becomes the Unicode glyph it draws,
    // and the symbol face is dropped so the body font renders it.
    expect(result.html).toContain('list-style-type:&quot;\u25aa\u2002&quot;')
    expect(result.html).not.toContain('font-family:&quot;Wingdings&quot;')
    // `::marker` inherits from its list item, so the marker's colour and size
    // are declared on the list rather than through a rule of their own.
    expect(result.html).toContain('color:#E2534D')
    expect(result.html).toContain('font-size:45%')
    // A face that is not a symbol font keeps its authored character and family.
    expect(result.html).toContain('list-style-type:&quot;\u2013\u2002&quot;')
    expect(result.html).toContain('font-family:&quot;Arial&quot;')
  })

  it('turns a hanging indent into a gap between the bullet and its text', () => {
    const hanging: StructuredTextBody = {
      listStyle: [],
      paragraphs: [{
        level: 0,
        properties: {
          bullet: { character: '\u2022', type: 'character' },
          // PowerPoint's hanging bullet: text at marL, marker at marL + indent.
          indent: -27,
          marginLeft: 27,
        },
        runs: [{ kind: 'text', sourceId: 'p0.r0', text: 'One technique' }],
        sourceId: 'p0',
      }],
      scale: 1,
      schemaVersion: 1,
    }
    const result = compileStructuredText(hanging, {
      fallbackColor: '#000000',
      fallbackFontName: 'Arial',
      slideNumber: 1,
      textStyleKind: 'body',
    })

    // The list owns the indent, which is the one declaration the editing
    // surface's schema preserves, and the item stays bare.
    expect(result.html).toContain('padding-left:27px')
    expect(result.html).toContain('<li>')
    // The paragraph must not re-apply the pair, which would cancel it out and
    // leave the bullet flush against the text.
    expect(result.html).not.toContain('text-indent:-27px')
    expect(result.html).not.toContain('padding-left:27px;')
  })

  it('sizes the line box from the runs, not the size they override', () => {
    const smallerThanDefault: StructuredTextBody = {
      listStyle: [],
      paragraphs: [{
        level: 0,
        properties: {
          // Inherited from the presentation defaults.
          defaultRun: { fontSize: 18 },
          lineSpacing: { unit: 'percent', value: 130 },
        },
        runs: [{ kind: 'text', properties: { fontSize: 13 }, sourceId: 'p0.r0', text: 'KV cache competes with weights' }],
        sourceId: 'p0',
      }],
      scale: 1,
      schemaVersion: 1,
    }
    const result = compileStructuredText(smallerThanDefault, {
      fallbackColor: '#000000',
      fallbackFontName: 'Arial',
      slideNumber: 1,
      textStyleKind: 'body',
    })

    // Percentage line spacing multiplies the element's own font size, so the
    // paragraph has to carry the size its runs render at. Left at the
    // inherited 18pt, every line would be spaced for text 38% taller than the
    // glyphs and a centre-anchored body would overflow its shape.
    const paragraph = result.html.slice(0, result.html.indexOf('>') + 1)
    expect(paragraph).toContain('font-size:13px')
    expect(paragraph).not.toContain('font-size:18px')
    expect(result.html).toContain('<span data-ppt-run-id="p0.r0" style="font-size:13px')
  })

  it('gives a blank spacer line the body\'s text size', () => {
    const spaced: StructuredTextBody = {
      listStyle: [],
      paragraphs: [
        {
          level: 0,
          runs: [{ kind: 'text', properties: { fontSize: 23 }, sourceId: 'p0.r0', text: 'Consider a company' }],
          sourceId: 'p0',
        },
        // Web editors space their layouts with empty paragraphs that declare
        // no size of their own.
        { level: 0, runs: [], sourceId: 'p1' },
        {
          level: 0,
          runs: [{ kind: 'text', properties: { fontSize: 23 }, sourceId: 'p2.r0', text: 'Standard Bags' }],
          sourceId: 'p2',
        },
      ],
      scale: 1,
      schemaVersion: 1,
    }
    const result = compileStructuredText(spaced, {
      fallbackColor: '#000000',
      fallbackFontName: 'Arial',
      slideNumber: 1,
      textStyleKind: 'body',
    })

    // Every paragraph, blank one included, holds a line of the body's text.
    // Left unsized the blank collapses to the browser default and drags the
    // content below it up the slide.
    expect(result.html.match(/font-size:23px/g)).toHaveLength(5)
    expect(result.html).toContain('<p data-ppt-paragraph-id="p1" data-ppt-level="0" style="font-size:23px"><br></p>')
  })
})
