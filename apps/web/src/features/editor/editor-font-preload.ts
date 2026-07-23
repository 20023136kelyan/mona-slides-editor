import { preload } from 'react-dom'

import type { PresentationState } from '@mona/presentation-core'

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
  if (presentation.theme.fontName) families.add(presentation.theme.fontName)
  for (const slide of presentation.slides) {
    for (const element of slide.elements) {
      if (element.type === 'text' && element.defaultFontName) families.add(element.defaultFontName)
      else if (element.type === 'shape' && element.text?.defaultFontName) families.add(element.text.defaultFontName)
    }
  }
  for (const family of families) {
    const url = urlByFamily.get(family)
    // Font preloads are CORS-mode fetches even same-origin.
    if (url) preload(url, { as: 'font', crossOrigin: 'anonymous', type: 'font/woff2' })
  }
}
