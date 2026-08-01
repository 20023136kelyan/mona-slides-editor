import { describe, expect, it } from 'vitest'

import { parseAuthoredText } from './authored-text'

describe('source-preserving authored text parser', () => {
  it('retains PowerPoint identities, list metadata, formatting, links, and entities', () => {
    const [paragraph] = parseAuthoredText(`
      <ol start="3">
        <li>
          <p data-ppt-paragraph-id="shape/text/p0" data-ppt-level="2" style="text-align: right; direction: rtl">
            <a href="https://example.com?a=1&amp;b=2">
              <span data-ppt-run-id="shape/text/p0/r0" style="color: rgb(18, 52, 86); font-size: 24px"><strong>A &amp; B</strong></span>
            </a>
            <br data-ppt-run-id="shape/text/p0/r1">
          </p>
        </li>
      </ol>
    `)

    expect(paragraph).toMatchObject({
      level: 2,
      list: { startAt: 3, type: 'number' },
      sourceId: 'shape/text/p0',
      style: { direction: 'rtl', 'text-align': 'right' },
    })
    expect(paragraph?.runs).toEqual([
      expect.objectContaining({
        hyperlink: 'https://example.com?a=1&b=2',
        kind: 'text',
        sourceId: 'shape/text/p0/r0',
        style: expect.objectContaining({
          color: 'rgb(18, 52, 86)',
          'font-size': '24px',
          'font-weight': '700',
        }),
        text: 'A & B',
      }),
      expect.objectContaining({
        kind: 'break',
        sourceId: 'shape/text/p0/r1',
      }),
    ])
  })

  it('treats plain AI HTML as editable paragraphs without inventing source identities', () => {
    expect(parseAuthoredText('<p>First</p><p><em>Second</em></p>')).toEqual([
      {
        level: 0,
        runs: [{ kind: 'text', style: {}, text: 'First' }],
        style: {},
      },
      {
        level: 0,
        runs: [{ kind: 'text', style: { 'font-style': 'italic' }, text: 'Second' }],
        style: {},
      },
    ])
  })
})
