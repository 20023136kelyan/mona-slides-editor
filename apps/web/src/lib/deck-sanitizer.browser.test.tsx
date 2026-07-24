import { describe, expect, test } from 'vitest'

import type { PPTImageElement, PPTTableElement, PPTTextElement, PPTVideoElement, Slide } from '@mona/presentation-core/model'

import {
  sanitizeElement,
  sanitizeMediaUrl,
  sanitizeNavigationUrl,
  sanitizeRichHtml,
  sanitizeSlides,
} from '@/lib/deck-sanitizer'

const textElement = (content: string): PPTTextElement => ({
  id: 'text-1',
  type: 'text',
  content,
  defaultFontName: '',
  defaultColor: '#333',
  left: 0,
  top: 0,
  width: 100,
  height: 50,
  rotate: 0,
})

describe('sanitizeRichHtml', () => {
  test('keeps benign the source editor markup byte-identical', () => {
    const benign = [
      '<p style="text-align: justify;"><strong><span style="font-size: 18px;">易开发：</span></strong>基于 <code>React 19</code>&nbsp;构建</p>',
      '<ul><li><p>one<br/>two</p></li></ul>',
      '<p><a href="https://example.com" target="_blank">link</a></p>',
      '',
    ]
    for (const html of benign) expect(sanitizeRichHtml(html)).toBe(html)
  })

  test('strips scripts, event handlers, and javascript: URLs', () => {
    expect(sanitizeRichHtml('<p>hi<script>alert(1)</script></p>')).not.toContain('script')
    expect(sanitizeRichHtml('<img src="x" onerror="alert(1)">')).not.toContain('onerror')
    expect(sanitizeRichHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:')
    expect(sanitizeRichHtml('<iframe src="https://evil.example"></iframe>')).not.toContain('iframe')
  })
})

describe('url sanitizers', () => {
  test('media allows http(s)/data/blob/relative, blocks executable schemes', () => {
    for (const url of ['https://a/b.png', 'http://a/b.png', 'data:image/png;base64,AAA', 'blob:http://x/1', '/local.png', 'relative.png']) {
      expect(sanitizeMediaUrl(url)).toBe(url)
    }
    expect(sanitizeMediaUrl('javascript:alert(1)')).toBe('')
    expect(sanitizeMediaUrl(' JAVASCRIPT:alert(1)')).toBe('')
    expect(sanitizeMediaUrl('vbscript:x')).toBe('')
  })

  test('navigation allows only http(s)/mailto', () => {
    expect(sanitizeNavigationUrl('https://example.com')).toBe('https://example.com')
    expect(sanitizeNavigationUrl('mailto:a@b.c')).toBe('mailto:a@b.c')
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'blob:http://x/1', 'relative']) {
      expect(sanitizeNavigationUrl(url)).toBe('')
    }
  })
})

describe('sanitizeElement / sanitizeSlides', () => {
  test('returns the same references when nothing changes', () => {
    const element = textElement('<p>safe</p>')
    const slide: Slide = { id: 's1', elements: [element], remark: '<p>note</p>' }
    const slides = [slide]
    expect(sanitizeElement(element)).toBe(element)
    expect(sanitizeSlides(slides)).toBe(slides)
  })

  test('rewrites hostile text, table cells, media urls, remarks, backgrounds, and links', () => {
    const table: PPTTableElement = {
      id: 'table-1', type: 'table', left: 0, top: 0, width: 100, height: 50, rotate: 0,
      outline: {}, colWidths: [1], cellMinHeight: 36,
      data: [[{ id: 'c1', colspan: 1, rowspan: 1, text: '<em onclick="alert(1)">x</em>' }]],
    }
    const image: PPTImageElement = {
      id: 'image-1', type: 'image', fixedRatio: true, src: 'javascript:alert(1)',
      left: 0, top: 0, width: 10, height: 10, rotate: 0,
    }
    const video: PPTVideoElement = {
      id: 'video-1', type: 'video', src: 'vbscript:x', poster: 'javascript:y', autoplay: false,
      left: 0, top: 0, width: 10, height: 10, rotate: 0,
    }
    const linked: PPTTextElement = { ...textElement('<p>x</p>'), link: { type: 'web', target: 'javascript:alert(1)' } }
    const slide: Slide = {
      id: 's1',
      elements: [textElement('<p><script>alert(1)</script>hi</p>'), table, image, video, linked],
      remark: '<img src=x onerror=alert(1)>',
      background: { type: 'image', image: { src: 'javascript:alert(1)', size: 'cover' } },
    }

    const [clean] = sanitizeSlides([slide])
    const [text, cleanTable, cleanImage, cleanVideo, cleanLinked] = clean!.elements as [PPTTextElement, PPTTableElement, PPTImageElement, PPTVideoElement, PPTTextElement]
    expect(text.content).not.toContain('script')
    expect(cleanTable.data[0]![0]!.text).not.toContain('onclick')
    expect(cleanImage.src).toBe('')
    expect(cleanVideo.src).toBe('')
    expect(cleanVideo.poster).toBe('')
    expect(cleanLinked.link).toBeUndefined()
    expect(clean!.remark).not.toContain('onerror')
    expect(clean!.background?.image?.src).toBe('')
  })

  test('sanitizes imported structured-run hyperlinks without changing safe runs', () => {
    const element: PPTTextElement = {
      ...textElement('<p>linked text</p>'),
      structuredText: {
        listStyle: [],
        paragraphs: [{
          level: 0,
          runs: [
            { hyperlink: 'javascript:alert(1)', kind: 'text', sourceId: 'p0.r0', text: 'unsafe' },
            { hyperlink: 'https://example.com', kind: 'text', sourceId: 'p0.r1', text: 'safe' },
          ],
          sourceId: 'p0',
        }],
        scale: 1,
        schemaVersion: 1,
      },
    }

    const clean = sanitizeElement(element) as PPTTextElement
    expect(clean).not.toBe(element)
    expect(clean.structuredText?.paragraphs[0]?.runs[0]?.hyperlink).toBeUndefined()
    expect(clean.structuredText?.paragraphs[0]?.runs[1]).toBe(element.structuredText?.paragraphs[0]?.runs[1])
    expect(clean.structuredText?.paragraphs[0]?.runs[1]?.hyperlink).toBe('https://example.com')
  })
})
