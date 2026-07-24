import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { parse } from '@mona/pptx-parser'
import { describe, expect, it } from 'vitest'

const corpusFile = (name: string) => new URL(
  `../../../../../tests/corpus/public/${name}`,
  import.meta.url,
)

const privateCorporateFixture = new URL(
  '../../../../../tests/corpus/private/real-03-nasa-sewp-corporate.pptx',
  import.meta.url,
)

const parseFixture = async (location: URL) => {
  const file = await readFile(location)
  const source = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
  return parse(source, { audioMode: 'none', imageMode: 'none', videoMode: 'none' })
}

describe('PowerPoint font collection', () => {
  it('reports the typefaces a deck actually references', async () => {
    const parsed = await parseFixture(corpusFile('corpus-01-text.pptx'))

    expect(parsed.usedFonts.length).toBeGreaterThan(0)
    // Theme tokens are resolved during rendering, never requested as families.
    expect(parsed.usedFonts.some(font => font.startsWith('+'))).toBe(false)
    expect(parsed.usedFonts.every(font => font.trim() === font && font.length > 0)).toBe(true)
  })

  it('reports no embedded payload for a deck that embeds no fonts', async () => {
    const parsed = await parseFixture(corpusFile('corpus-01-text.pptx'))

    expect(parsed.embeddedFonts).toEqual([])
  })

  it.skipIf(!existsSync(privateCorporateFixture))(
    'collects real body and theme faces without the theme script fallback list',
    async () => {
      const parsed = await parseFixture(privateCorporateFixture)

      // The faces this deck actually paints with. Before this collection
      // existed the list was empty for every deck without an embedded font
      // list, so nothing was ever preloaded.
      expect(parsed.usedFonts).toContain('Segoe UI')
      expect(parsed.usedFonts).toContain('Gotham Rounded Book')

      // Every Office theme declares ~40 supplemental script fallbacks. They are
      // not used by the deck and must not cost a request each.
      expect(parsed.usedFonts).not.toContain('Nyala')
      expect(parsed.usedFonts).not.toContain('Vrinda')
      expect(parsed.usedFonts).not.toContain('MoolBoran')
      expect(parsed.usedFonts.length).toBeLessThanOrEqual(64)
    },
  )
})
