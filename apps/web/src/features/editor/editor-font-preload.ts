import { preload } from 'react-dom'

import { flattenElementTree, type PresentationState } from '@mona/presentation-core'
import type { PPTElement, StructuredTextBody } from '@mona/presentation-core/model'

// Vite resolves every bundled deck font to its hashed production URL.
const fontUrls = import.meta.glob('/src/assets/fonts/*.woff2', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>

// CJK families ship as unicode-range slices; warming their base band (Latin,
// punctuation, kana) is what makes font-display: swap invisible — ideograph
// bands are fetched on demand by codepoint anyway.
const slicedBaseUrls = import.meta.glob('/src/assets/fonts/sliced/*/base.woff2', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>

const urlByFamily = new Map([
  ...Object.entries(fontUrls).map(([path, url]) => [path.split('/').pop()!.replace('.woff2', ''), url] as const),
  ...Object.entries(slicedBaseUrls).map(([path, url]) => [path.split('/').at(-2)!, url] as const),
])

/**
 * Hints the browser to fetch the deck's referenced bundled fonts ahead of
 * first paint, so `font-display: swap` has nothing left to swap by the time
 * text renders. preload() dedupes by URL, so calling per render is safe.
 */
export const preloadDeckFonts = (presentation: PresentationState) => {
  const families = new Set<string>()
  const addFamily = (family: string | undefined) => {
    if (family && !family.startsWith('+')) families.add(family)
  }
  const addStructuredFonts = (body: StructuredTextBody | undefined) => {
    if (!body) return
    const runProperties = [
      ...body.listStyle.flatMap(style => style.paragraph?.defaultRun ? [style.paragraph.defaultRun] : []),
      ...body.paragraphs.flatMap(paragraph => [
        ...(paragraph.properties?.defaultRun ? [paragraph.properties.defaultRun] : []),
        ...(paragraph.endProperties ? [paragraph.endProperties] : []),
        ...paragraph.runs.flatMap(run => run.properties ? [run.properties] : []),
      ]),
    ]
    for (const properties of runProperties) {
      addFamily(properties.fontFamily)
      addFamily(properties.eastAsianFontFamily)
      addFamily(properties.complexScriptFontFamily)
    }
  }
  const addElementFonts = (elements: readonly PPTElement[]) => {
    for (const element of flattenElementTree(elements)) {
      if (element.type === 'text') {
        addFamily(element.defaultFontName)
        addStructuredFonts(element.structuredText)
      }
      else if (element.type === 'shape') {
        addFamily(element.text?.defaultFontName)
        addStructuredFonts(element.text?.structuredText)
      }
    }
  }
  if (presentation.theme.fontName) families.add(presentation.theme.fontName)
  for (const slide of presentation.slides) addElementFonts(slide.elements)
  for (const sourcePackage of presentation.sourcePackages ?? []) {
    for (const theme of sourcePackage.hierarchy?.themes ?? []) {
      for (const scheme of [theme.majorFont, theme.minorFont]) {
        addFamily(scheme?.latin)
        addFamily(scheme?.eastAsian)
        addFamily(scheme?.complexScript)
        for (const supplemental of scheme?.supplemental ?? []) addFamily(supplemental.typeface)
      }
    }
    for (const layout of sourcePackage.hierarchy?.layouts ?? []) addElementFonts(layout.elements ?? [])
    for (const master of sourcePackage.hierarchy?.masters ?? []) addElementFonts(master.elements ?? [])
  }
  for (const family of families) {
    const url = urlByFamily.get(family)
    // Font preloads are CORS-mode fetches even same-origin.
    if (url) preload(url, { as: 'font', crossOrigin: 'anonymous', type: 'font/woff2' })
  }
}
