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
    expect(result.html).toContain('list-style-type:&quot;•&quot;')
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
})
