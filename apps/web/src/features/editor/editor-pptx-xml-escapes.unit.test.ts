import { readFile } from 'node:fs/promises'

import { parse, type Element as ParsedElement, type StructuredTextBody } from '@mona/pptx-parser'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

const corpusFile = (name: string) => new URL(
  `../../../../../tests/corpus/public/${name}`,
  import.meta.url,
)

const parseFixture = async (name: string) => {
  const file = await readFile(corpusFile(name))
  const source = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
  return parse(source, { audioMode: 'none', imageMode: 'none', videoMode: 'none' })
}

const bodies = (elements: ParsedElement[]): StructuredTextBody[] => elements.flatMap(element => {
  if (element.type === 'group' || element.type === 'diagram') return bodies(element.elements)
  const body = 'textBody' in element ? element.textBody : undefined
  return body ? [body] : []
})

// An unresolved reference reaches the canvas as its own source text, so a
// bullet renders as the literal characters `&#x2022;`.
const unresolvedEscape = /&(?:#\d+|#x[\da-f]+|amp|apos|gt|lt|quot);/i

describe('OOXML escape handling', () => {
  it('resolves character references in attributes and text', async () => {
    const parsed = await parseFixture('corpus-01-text.pptx')
    const parsedBodies = parsed.slides.flatMap(slide => bodies(slide.elements))
    expect(parsedBodies.length).toBeGreaterThan(0)

    const bullets = parsedBodies
      .flatMap(body => body.paragraphs)
      .map(paragraph => paragraph.properties?.bullet?.character)
      .filter((character): character is string => Boolean(character))

    // This deck writes its bullets as `<a:buChar char="&#x2022;"/>`.
    expect(bullets.length).toBeGreaterThan(0)
    expect(bullets).toContain('•')
    for (const character of bullets) {
      expect(character).not.toMatch(unresolvedEscape)
    }

    const runText = parsedBodies
      .flatMap(body => body.paragraphs)
      .flatMap(paragraph => paragraph.runs)
      .map(run => run.text)
      .filter((text): text is string => Boolean(text))
    expect(runText.filter(text => unresolvedEscape.test(text))).toEqual([])
  })
})

/**
 * Characterization of the decoder itself, pinned before txml moves from 5 to
 * 6 and the hand-written decoder in `readXmlFile.js` is replaced by the
 * library's own `decodeEntities` option.
 *
 * The two implementations agree on the five predefined entities, on decimal
 * and hex character references, on the codepoint ceiling, and on decoding a
 * source only once. They disagree on case: the current regex carries the `i`
 * flag, so it accepts `&AMP;` and `&#X2022;`, both of which XML makes errors —
 * named entities are case-sensitive and the `x` of a hex reference must be
 * lowercase. txml is the stricter and more correct of the two.
 *
 * The cases marked below as leniency are therefore expected to change when
 * the upgrade lands. They are pinned here so that the change is a visible,
 * intentional edit to this file rather than a silent difference in output.
 */
describe('OOXML entity decoding', () => {
  /**
   * Rewrites the first run of a real deck's first slide, so the decoder is
   * exercised over genuine package structure rather than a hand-built archive.
   * Returns the text of that run as the parser produced it.
   */
  const decodeInFirstRun = async (source: string) => {
    const file = await readFile(corpusFile('corpus-01-text.pptx'))
    const zip = await JSZip.loadAsync(file)
    const slidePath = 'ppt/slides/slide1.xml'
    const slide = await zip.file(slidePath)!.async('string')

    const replaced = slide.replace(/<a:t>[\s\S]*?<\/a:t>/, `<a:t>${source}</a:t>`)
    expect(replaced).not.toBe(slide)
    zip.file(slidePath, replaced)

    const patched = await zip.generateAsync({ type: 'arraybuffer' })
    const parsed = await parse(patched, { audioMode: 'none', imageMode: 'none', videoMode: 'none' })
    const [text] = parsed.slides
      .flatMap(slide => bodies(slide.elements))
      .flatMap(body => body.paragraphs)
      .flatMap(paragraph => paragraph.runs)
      .map(run => run.text)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
    return text
  }

  it('resolves the five predefined entities', async () => {
    expect(await decodeInFirstRun('a&amp;b&lt;c&gt;d&quot;e&apos;f')).toBe('a&b<c>d"e\'f')
  })

  it('resolves decimal and hexadecimal character references', async () => {
    expect(await decodeInFirstRun('&#8226;and&#x2022;')).toBe('•and•')
  })

  it('decodes the source exactly once', async () => {
    // A deck that wants the literal text `&#x2022;` writes `&amp;#x2022;`. A
    // second decoding pass would turn that into a bullet and silently corrupt
    // authored content, so this is the property that matters most.
    expect(await decodeInFirstRun('&amp;#x2022;')).toBe('&#x2022;')
  })

  it('leaves a character reference above the Unicode ceiling alone', async () => {
    // 0x110000, one past the highest valid codepoint.
    expect(await decodeInFirstRun('&#1114112;')).toBe('&#1114112;')
  })

  it('leaves an uppercase named entity alone, because XML is case-sensitive', async () => {
    // `&AMP;` is not a valid XML entity — the five predefined names are
    // lowercase — so it is text, not an escape. The decoder this replaced
    // carried an `i` flag and resolved it to `&`.
    expect(await decodeInFirstRun('&AMP;')).toBe('&AMP;')
  })

  it('leaves an uppercase hex marker alone, because XML requires a lowercase x', async () => {
    // Same reason: a conforming hex reference is `&#x2022;`. `&#X2022;` is
    // text. The previous decoder resolved it to a bullet.
    expect(await decodeInFirstRun('&#X2022;')).toBe('&#X2022;')
  })
})
