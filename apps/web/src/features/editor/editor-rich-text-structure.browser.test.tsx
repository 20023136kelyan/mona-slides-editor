import { expect, test } from 'vitest'

import { normalizeRichTextHtml } from '@mona/rich-text'

test('the editable rich-text schema preserves compiled PowerPoint structure and metrics', () => {
  const html = [
    '<ul data-ppt-level="0" style="list-style-type:&quot;•&quot;">',
    '<li><p data-ppt-paragraph-id="ppt/slides/slide1.xml#2.p0" data-ppt-level="0" ',
    'style="text-align:center;direction:rtl;unicode-bidi:plaintext;padding-left:24px;',
    'text-indent:-12px;line-height:1.2;margin-top:6px;margin-bottom:8px;',
    'font-family:&quot;Aptos&quot;;font-size:36px;color:#123456;font-weight:700">',
    '<span data-ppt-run-id="ppt/slides/slide1.xml#2.p0.r0" ',
    'style="font-family:&quot;Aptos&quot;;font-size:36px;color:#123456">Title</span>',
    '<span data-ppt-run-id="ppt/slides/slide1.xml#2.p0.r1" data-ppt-run-kind="tab" ',
    'style="display:inline-block;width:48px"></span>',
    '<br data-ppt-run-id="ppt/slides/slide1.xml#2.p0.r2">',
    '<span data-ppt-run-id="ppt/slides/slide1.xml#2.p0.r3" ',
    'data-ppt-field-id="field-1" data-ppt-field-type="slidenum">7</span>',
    '</p></li></ul>',
  ].join('')

  const normalized = normalizeRichTextHtml(html)
  const document = new DOMParser().parseFromString(normalized, 'text/html')
  const paragraph = document.querySelector<HTMLElement>('[data-ppt-paragraph-id]')
  const runs = document.querySelectorAll<HTMLElement>('[data-ppt-run-id]')

  expect(document.querySelector('ul')?.dataset.pptLevel).toBe('0')
  expect(paragraph?.dataset.pptParagraphId).toBe('ppt/slides/slide1.xml#2.p0')
  expect(paragraph?.style.lineHeight).toBe('1.2')
  expect(paragraph?.style.fontSize).toBe('36px')
  expect(paragraph?.style.paddingLeft).toBe('24px')
  expect(paragraph?.style.marginBottom).toBe('8px')
  expect(paragraph?.style.direction).toBe('rtl')
  expect(runs).toHaveLength(4)
  expect(document.querySelector('[data-ppt-run-kind="tab"]')).not.toBeNull()
  expect(document.querySelector('br')?.dataset.pptRunId).toBe('ppt/slides/slide1.xml#2.p0.r2')
  expect(document.querySelector('[data-ppt-field-type="slidenum"]')?.textContent).toBe('7')
})
