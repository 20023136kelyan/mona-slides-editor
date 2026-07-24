import { readFile } from 'node:fs/promises'

import { parse, type Element as ParsedElement, type StructuredTextBody } from '@mona/pptx-parser'
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
