import { afterEach, expect, test } from 'vitest'

import { initProsemirrorEditor, normalizeRichTextHtml } from '@mona/rich-text'

/**
 * Characterization of the rich-text serialization, pinned before a
 * ProseMirror upgrade.
 *
 * How to read a failure here:
 *
 * - **A red snapshot means the serialization moved.** Read the diff and, if
 *   the new output is acceptable, re-bless it. Snapshots record what the
 *   editor happens to emit today; they are evidence, not a specification.
 * - **A red structural assertion means content was lost.** Stop. Those pin
 *   properties that must survive any serialization change, and no upstream
 *   release is entitled to break them.
 *
 * Why the exact strings matter: what Mona persists for a text element is the
 * editor's own `view.dom.innerHTML`, read straight off the live
 * contenteditable (`EditorRichText.tsx`). The serialized string *is* the
 * saved format, so a stray attribute or an inserted `<br>` is a change to
 * every deck saved afterwards. A structural assertion cannot see that; only a
 * string comparison can.
 *
 * Three serializations exist here and they are deliberately not assumed to
 * agree:
 *
 * 1. `normalizeRichTextHtml` — pure `DOMSerializer`, no view. Moves with
 *    prosemirror-model.
 * 2. `view.dom.innerHTML` at mount — what `restoreAuthoredBaseline` compares
 *    against. Moves with prosemirror-view's editable-DOM rendering.
 * 3. The round-trip ledger below — which fixtures survive
 *    `serialize(parse(x)) === x` unchanged.
 *
 * The gap between (1) and (2) is the reason `EditorRichText.tsx` keeps a
 * `lastCommittedDom` gate at all.
 */

/** Splits adjacent tags onto their own lines so a diff is one line, not one column. */
const pretty = (html: string) => html.replace(/></g, '>\n<')

/**
 * The app compares stored markup against re-serialized markup after stripping
 * empty style attributes, because every `toDOM` in the schema emits a `style`
 * attribute whether or not it built one. Mirrored from `EditorRichText.tsx`
 * so that if upstream stops emitting the empty attribute, the raw snapshot
 * moves while the normalized one does not — which is the signal that the
 * workaround has become dead code.
 */
const withoutEmptyStyle = (html: string) => html.replace(/ style=""/g, '')

const mounts: HTMLElement[] = []

/** Mounts a real editor and returns what it renders into the contenteditable. */
const mountedDom = (content: string) => {
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  mounts.push(mount)
  const view = initProsemirrorEditor(mount, content, { editable: () => true })
  const html = view.dom.innerHTML
  view.destroy()
  return html
}

afterEach(() => {
  for (const mount of mounts.splice(0)) mount.remove()
})

/**
 * One fixture per schema feature, so a moved snapshot names the feature that
 * moved rather than dumping the whole document.
 */
const FIXTURES: { name: string, html: string }[] = [
  // What `structured-text.ts` emits for an authored empty paragraph. The
  // highest-risk fixture in the set: prosemirror-model 1.25.4 changed how the
  // DOM parser substitutes line breaks when preserving whitespace.
  { html: '<p><br></p>', name: 'empty-paragraph' },
  { html: '<p>plain</p>', name: 'plain-text' },
  {
    html: '<p data-ppt-paragraph-id="s1#2.p0" data-ppt-level="1" style="text-align:center;'
      + 'direction:rtl;unicode-bidi:plaintext;padding-left:24px;text-indent:-12px;line-height:1.2;'
      + 'margin-top:6px;margin-bottom:8px;font-family:&quot;Aptos&quot;;font-size:36px;color:#123456;'
      + 'font-weight:700;font-style:italic;text-decoration-line:underline;letter-spacing:2px;'
      + 'text-transform:uppercase;font-variant-caps:small-caps">every attribute</p>',
    name: 'paragraph-every-attribute',
  },
  { html: '<p>before<br data-ppt-run-id="s1#2.p0.r1">after</p>', name: 'hard-break-with-run-id' },
  {
    html: '<p><span data-ppt-run-id="s1#2.p0.r0" data-ppt-run-kind="tab" style="display:inline-block;width:48px"></span></p>',
    name: 'ppt-tab',
  },
  {
    html: '<ul style="list-style-type:&quot;•&quot;;padding-left:24px"><li><p>one</p>'
      + '<ul style="list-style-type:&quot;◦&quot;"><li><p>nested</p></li></ul></li></ul>',
    name: 'nested-bullet-list',
  },
  { html: '<ol start="3"><li><p>third</p></li></ol>', name: 'ordered-list-start' },
  // prosemirror-schema-list 1.5.1 changed whether `liftListItem` joins lists
  // of different types that land at the same level.
  {
    html: '<ul><li><p>bullet</p></li></ul><ol><li><p>number</p></li></ol>',
    name: 'adjacent-ul-and-ol',
  },
  // The paragraph spec carries `{ tag: 'pre', skip: true }`, and
  // prosemirror-model 1.24.1 changed whitespace handling inside `pre`. This
  // pair is a genuine collision, so it is pinned before the bump rather than
  // discovered after.
  { html: '<pre>  two  spaces\nand a newline</pre>', name: 'pre-skip-rule' },
  { html: '<blockquote><p>quoted</p></blockquote>', name: 'blockquote' },
  { html: '<p><a href="https://example.com" title="t">link</a></p>', name: 'link' },
  {
    html: '<p><strong>b</strong><em>i</em><u>u</u><strike>s</strike><code>c</code>'
      + '<sub>sub</sub><sup>sup</sup></p>',
    name: 'basic-marks',
  },
  {
    html: '<p><span style="font-size:24px">size</span><span style="font-family:Aptos">name</span>'
      + '<span style="color:#ff0000">fore</span><span style="background-color:#00ff00">back</span>'
      + '<mark data-index="2">marked</mark></p>',
    name: 'style-marks',
  },
  {
    html: '<p><span data-ppt-run-id="s1#2.p0.r0" data-ppt-field-id="f1" data-ppt-field-type="slidenum">7</span></p>',
    name: 'ppt-source-field',
  },
]

/**
 * Real compiled PowerPoint markup, frozen as a literal rather than produced by
 * calling the compiler. If the test called `structured-text.ts`, a later
 * change there would silently move this baseline and it would stop
 * characterizing ProseMirror, which is the only thing it is here to watch.
 */
const COMPILED_POWERPOINT = [
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

const report = (render: (html: string) => string) =>
  FIXTURES.map(fixture => `### ${fixture.name}\n${pretty(render(fixture.html))}`).join('\n\n')

test('DOMSerializer output is unchanged', () => {
  expect(report(normalizeRichTextHtml)).toMatchInlineSnapshot(`
    "### empty-paragraph
    <p style="">
    <br>
    </p>

    ### plain-text
    <p style="">plain</p>

    ### paragraph-every-attribute
    <p style="text-align: center;direction: rtl;unicode-bidi: plaintext;padding-left: 24px;text-indent: -12px;line-height: 1.2;margin-top: 6px;margin-bottom: 8px;font-family: Aptos;font-size: 36px;color: rgb(18, 52, 86);font-weight: 700;font-style: italic;text-decoration-line: underline;letter-spacing: 2px;text-transform: uppercase;font-variant-caps: small-caps;" data-ppt-level="1" data-ppt-paragraph-id="s1#2.p0">
    <em>
    <strong>
    <span style="font-size: 36px;">
    <span style="font-family: Aptos;">
    <span style="color: rgb(18, 52, 86);">
    <span style="text-decoration: underline;">every attribute</span>
    </span>
    </span>
    </span>
    </strong>
    </em>
    </p>

    ### hard-break-with-run-id
    <p style="">before<br data-ppt-run-id="s1#2.p0.r1">after</p>

    ### ppt-tab
    <p style="">
    <span data-ppt-run-id="s1#2.p0.r0" data-ppt-run-kind="tab" style="display: inline-block; width: 48px;">
    </span>
    </p>

    ### nested-bullet-list
    <ul style="list-style-type: &quot;•&quot;;padding-left: 24px;">
    <li>
    <p style="">one</p>
    <ul style="list-style-type: &quot;◦&quot;;">
    <li>
    <p style="">nested</p>
    </li>
    </ul>
    </li>
    </ul>

    ### ordered-list-start
    <ol style="" start="3">
    <li>
    <p style="">third</p>
    </li>
    </ol>

    ### adjacent-ul-and-ol
    <ul style="">
    <li>
    <p style="">bullet</p>
    </li>
    </ul>
    <ol style="">
    <li>
    <p style="">number</p>
    </li>
    </ol>

    ### pre-skip-rule
    <p style="">two spaces and a newline</p>

    ### blockquote
    <blockquote>
    <p style="">quoted</p>
    </blockquote>

    ### link
    <p style="">
    <a href="https://example.com" title="t" target="_blank">link</a>
    </p>

    ### basic-marks
    <p style="">
    <strong>b</strong>
    <em>i</em>
    <span style="text-decoration: underline;">u</span>
    <span style="text-decoration-line: line-through;">s</span>
    <code>c</code>
    <sub>sub</sub>
    <sup>sup</sup>
    </p>

    ### style-marks
    <p style="">
    <span style="font-size: 24px;">size</span>
    <span style="font-family: Aptos;">name</span>
    <span style="color: rgb(255, 0, 0);">fore</span>
    <span style="background-color: rgb(0, 255, 0);">back</span>
    <mark data-index="2">marked</mark>
    </p>

    ### ppt-source-field
    <p style="">
    <span data-ppt-field-id="f1" data-ppt-field-type="slidenum" data-ppt-run-id="s1#2.p0.r0">7</span>
    </p>"
  `)
})

test('the mounted editor renders the same markup it serializes', () => {
  expect(report(mountedDom)).toMatchInlineSnapshot(`
    "### empty-paragraph
    <p style="">
    <br>
    <br class="ProseMirror-trailingBreak">
    </p>

    ### plain-text
    <p style="">plain</p>

    ### paragraph-every-attribute
    <p style="text-align: center;direction: rtl;unicode-bidi: plaintext;padding-left: 24px;text-indent: -12px;line-height: 1.2;margin-top: 6px;margin-bottom: 8px;font-family: Aptos;font-size: 36px;color: rgb(18, 52, 86);font-weight: 700;font-style: italic;text-decoration-line: underline;letter-spacing: 2px;text-transform: uppercase;font-variant-caps: small-caps;" data-ppt-level="1" data-ppt-paragraph-id="s1#2.p0">
    <em>
    <strong>
    <span style="font-size: 36px;">
    <span style="font-family: Aptos;">
    <span style="color: rgb(18, 52, 86);">
    <span style="text-decoration: underline;">every attribute</span>
    </span>
    </span>
    </span>
    </strong>
    </em>
    </p>

    ### hard-break-with-run-id
    <p style="">before<br data-ppt-run-id="s1#2.p0.r1">after</p>

    ### ppt-tab
    <p style="">
    <span data-ppt-run-id="s1#2.p0.r0" data-ppt-run-kind="tab" style="display: inline-block; width: 48px;" contenteditable="false">
    </span>
    <img class="ProseMirror-separator" alt="">
    <br class="ProseMirror-trailingBreak">
    </p>

    ### nested-bullet-list
    <ul style="list-style-type: &quot;•&quot;;padding-left: 24px;">
    <li>
    <p style="">one</p>
    <ul style="list-style-type: &quot;◦&quot;;">
    <li>
    <p style="">nested</p>
    </li>
    </ul>
    </li>
    </ul>

    ### ordered-list-start
    <ol style="" start="3">
    <li>
    <p style="">third</p>
    </li>
    </ol>

    ### adjacent-ul-and-ol
    <ul style="">
    <li>
    <p style="">bullet</p>
    </li>
    </ul>
    <ol style="">
    <li>
    <p style="">number</p>
    </li>
    </ol>

    ### pre-skip-rule
    <p style="">two spaces and a newline</p>

    ### blockquote
    <blockquote>
    <p style="">quoted</p>
    </blockquote>

    ### link
    <p style="">
    <a href="https://example.com" title="t" target="_blank">link</a>
    </p>

    ### basic-marks
    <p style="">
    <strong>b</strong>
    <em>i</em>
    <span style="text-decoration: underline;">u</span>
    <span style="text-decoration-line: line-through;">s</span>
    <code>c</code>
    <sub>sub</sub>
    <sup>sup</sup>
    </p>

    ### style-marks
    <p style="">
    <span style="font-size: 24px;">size</span>
    <span style="font-family: Aptos;">name</span>
    <span style="color: rgb(255, 0, 0);">fore</span>
    <span style="background-color: rgb(0, 255, 0);">back</span>
    <mark data-index="2">marked</mark>
    </p>

    ### ppt-source-field
    <p style="">
    <span data-ppt-field-id="f1" data-ppt-field-type="slidenum" data-ppt-run-id="s1#2.p0.r0">7</span>
    </p>"
  `)
})

test('compiled PowerPoint markup survives a serializer round trip', () => {
  expect(pretty(normalizeRichTextHtml(COMPILED_POWERPOINT))).toMatchInlineSnapshot(`
    "<ul style="list-style-type: &quot;•&quot;;" data-ppt-level="0">
    <li>
    <p style="text-align: center;direction: rtl;unicode-bidi: plaintext;padding-left: 24px;text-indent: -12px;line-height: 1.2;margin-top: 6px;margin-bottom: 8px;font-family: Aptos;font-size: 36px;color: rgb(18, 52, 86);font-weight: 700;" data-ppt-level="0" data-ppt-paragraph-id="ppt/slides/slide1.xml#2.p0">
    <strong>
    <span style="font-size: 36px;">
    <span style="font-family: Aptos;">
    <span style="color: rgb(18, 52, 86);">
    <span data-ppt-run-id="ppt/slides/slide1.xml#2.p0.r0">Title</span>
    <span data-ppt-run-id="ppt/slides/slide1.xml#2.p0.r1" data-ppt-run-kind="tab" style="display: inline-block; width: 48px;">
    </span>
    <br data-ppt-run-id="ppt/slides/slide1.xml#2.p0.r2">
    <span data-ppt-field-id="field-1" data-ppt-field-type="slidenum" data-ppt-run-id="ppt/slides/slide1.xml#2.p0.r3">7</span>
    </span>
    </span>
    </span>
    </strong>
    </p>
    </li>
    </ul>"
  `)
})

test('compiled PowerPoint markup renders in a mounted editor', () => {
  expect(pretty(mountedDom(COMPILED_POWERPOINT))).toMatchInlineSnapshot(`
    "<ul style="list-style-type: &quot;•&quot;;" data-ppt-level="0">
    <li>
    <p style="text-align: center;direction: rtl;unicode-bidi: plaintext;padding-left: 24px;text-indent: -12px;line-height: 1.2;margin-top: 6px;margin-bottom: 8px;font-family: Aptos;font-size: 36px;color: rgb(18, 52, 86);font-weight: 700;" data-ppt-level="0" data-ppt-paragraph-id="ppt/slides/slide1.xml#2.p0">
    <strong>
    <span style="font-size: 36px;">
    <span style="font-family: Aptos;">
    <span style="color: rgb(18, 52, 86);">
    <span data-ppt-run-id="ppt/slides/slide1.xml#2.p0.r0">Title</span>
    <span data-ppt-run-id="ppt/slides/slide1.xml#2.p0.r1" data-ppt-run-kind="tab" style="display: inline-block; width: 48px;" contenteditable="false">
    </span>
    <br data-ppt-run-id="ppt/slides/slide1.xml#2.p0.r2">
    <span data-ppt-field-id="field-1" data-ppt-field-type="slidenum" data-ppt-run-id="ppt/slides/slide1.xml#2.p0.r3">7</span>
    </span>
    </span>
    </span>
    </strong>
    </p>
    </li>
    </ul>"
  `)
})

/**
 * Two round-trip properties per fixture.
 *
 * `verbatim` — does one pass return the authored string byte for byte? Almost
 * nothing does, because the serializer always emits a `style` attribute and
 * respells CSS (`a:b` becomes `a: b;`). That gap is why authored markup and
 * editor markup are not interchangeable, and why `restoreAuthoredBaseline`
 * exists to hand back the original when nothing was genuinely edited.
 *
 * `idempotent` — does a second pass change what the first produced? This is
 * the load-bearing one. Mona persists `view.dom.innerHTML`, so if
 * re-serializing drifts the string, merely opening an element and clicking
 * away would rewrite the stored document. Suppressing exactly that is what
 * the `lastCommittedDom` gate is for.
 *
 * If an upgrade turns a `no` into a `yes` in the idempotent column, the
 * corresponding guard has a real chance of being retired — on evidence rather
 * than by intuition.
 */
test('round-trip ledger: verbatim and idempotent per fixture', () => {
  const ledger = FIXTURES.map(fixture => {
    const once = normalizeRichTextHtml(fixture.html)
    const twice = normalizeRichTextHtml(once)
    const flag = (value: boolean) => (value ? 'yes' : ' no')
    return `verbatim:${flag(once === fixture.html)}  idempotent:${flag(once === twice)}  ${fixture.name}`
  }).join('\n')
  expect(ledger).toMatchInlineSnapshot(`
    "verbatim: no  idempotent:yes  empty-paragraph
    verbatim: no  idempotent:yes  plain-text
    verbatim: no  idempotent:yes  paragraph-every-attribute
    verbatim: no  idempotent:yes  hard-break-with-run-id
    verbatim: no  idempotent:yes  ppt-tab
    verbatim: no  idempotent:yes  nested-bullet-list
    verbatim: no  idempotent:yes  ordered-list-start
    verbatim: no  idempotent:yes  adjacent-ul-and-ol
    verbatim: no  idempotent:yes  pre-skip-rule
    verbatim: no  idempotent:yes  blockquote
    verbatim: no  idempotent:yes  link
    verbatim: no  idempotent:yes  basic-marks
    verbatim: no  idempotent:yes  style-marks
    verbatim: no  idempotent:yes  ppt-source-field"
  `)
})

test('the empty style attribute is still emitted, so the app workaround is still needed', () => {
  const raw = normalizeRichTextHtml('<p>plain</p>')
  expect(raw).toContain(' style=""')
  expect(withoutEmptyStyle(raw)).not.toContain(' style=""')
})

/**
 * Invariants that must hold regardless of how the serializer formats its
 * output. A failure here is content loss, not cosmetic drift.
 */
test('every run identifier and structural property survives serialization', () => {
  const serialized = normalizeRichTextHtml(COMPILED_POWERPOINT)
  const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html')
  const before = parse(COMPILED_POWERPOINT)
  const after = parse(serialized)

  const runIds = (document: Document) =>
    [...document.querySelectorAll<HTMLElement>('[data-ppt-run-id]')].map(node => node.dataset.pptRunId)

  expect(runIds(after)).toEqual(runIds(before))
  expect(after.querySelectorAll('[data-ppt-run-id]')).toHaveLength(4)
  expect(after.querySelector('[data-ppt-run-kind="tab"]')).not.toBeNull()
  expect(after.querySelector('br')?.dataset.pptRunId).toBe('ppt/slides/slide1.xml#2.p0.r2')
  expect(after.querySelector('[data-ppt-field-type="slidenum"]')?.textContent).toBe('7')
  expect(after.body.textContent).toBe(before.body.textContent)
  expect(after.querySelector('ul > li > p')).not.toBeNull()
})

test('nested list depth survives serialization', () => {
  const nested = FIXTURES.find(fixture => fixture.name === 'nested-bullet-list')!
  const after = new DOMParser().parseFromString(normalizeRichTextHtml(nested.html), 'text/html')

  expect(after.querySelectorAll('ul')).toHaveLength(2)
  expect(after.querySelector('ul ul')).not.toBeNull()
  expect(after.body.textContent).toBe('onenested')
})

test('paragraph metrics survive serialization', () => {
  const fixture = FIXTURES.find(entry => entry.name === 'paragraph-every-attribute')!
  const after = new DOMParser().parseFromString(normalizeRichTextHtml(fixture.html), 'text/html')
  const paragraph = after.querySelector<HTMLElement>('p')!

  expect(paragraph.dataset.pptParagraphId).toBe('s1#2.p0')
  expect(paragraph.dataset.pptLevel).toBe('1')
  expect(paragraph.style.textAlign).toBe('center')
  expect(paragraph.style.direction).toBe('rtl')
  expect(paragraph.style.paddingLeft).toBe('24px')
  expect(paragraph.style.lineHeight).toBe('1.2')
  expect(paragraph.style.marginBottom).toBe('8px')
  expect(paragraph.style.fontSize).toBe('36px')
  expect(paragraph.style.letterSpacing).toBe('2px')
  expect(paragraph.style.textTransform).toBe('uppercase')
})
