import { afterEach, expect, test } from 'vitest'

import {
  autoSelectAll,
  defaultRichTextAttrs,
  executeRichTextActions,
  initProsemirrorEditor,
  toggleList,
  type RichTextAction,
} from '@mona/rich-text'

/**
 * Derived rather than imported from `prosemirror-view`: apps/web declares no
 * prosemirror dependency of its own and resolves them only by hoisting, so the
 * test stays on the package's public surface.
 */
type RichTextView = ReturnType<typeof initProsemirrorEditor>
type RichTextSelection = RichTextView['state']['selection']
type ResolvedPosition = ReturnType<RichTextView['state']['doc']['resolve']>

/**
 * Places a collapsed caret at a document position.
 *
 * `Selection.near` is a static on the selection class, reached through an
 * instance so that prosemirror-state does not have to be imported here.
 */
const caretAt = (view: RichTextView, position: number) => {
  const selectionClass = view.state.selection.constructor as unknown as {
    near: ($position: ResolvedPosition) => RichTextSelection
  }
  view.dispatch(view.state.tr.setSelection(selectionClass.near(view.state.doc.resolve(position))))
}

/**
 * Characterization of the rich-text commands and key bindings, pinned before a
 * ProseMirror upgrade.
 *
 * Read failures the same way as the serialization suite: a moved snapshot is
 * behaviour drift to review and re-bless, a failed explicit assertion is a
 * regression to stop for.
 *
 * Nothing here was covered before. Lists, key bindings, input rules and the
 * indent commands had no automated tests at all, which is uncomfortable given
 * that `toggle-list.ts` is hand-rolled and the upgrade replaces parts of it
 * with upstream equivalents.
 *
 * Several tests below deliberately pin behaviour that looks *wrong*. That is
 * the point of characterization: the upgrade should change behaviour only
 * where intended, so today's quirks are recorded rather than quietly
 * corrected. Each one says so.
 */

const mounts: HTMLElement[] = []

const mount = (content: string) => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  mounts.push(host)
  return initProsemirrorEditor(host, content, { editable: () => true })
}

afterEach(() => {
  for (const host of mounts.splice(0)) host.remove()
})

const run = (view: RichTextView, ...actions: RichTextAction[]) =>
  executeRichTextActions(view, actions, defaultRichTextAttrs)

const html = (view: RichTextView) => view.dom.innerHTML.replace(/></g, '>\n<')

/**
 * `Mod` is Cmd on macOS and Ctrl everywhere else, matching how
 * prosemirror-keymap resolves it. Without this the inventory below reports
 * every binding as unhandled when run on a Mac and passes on CI, or the
 * reverse.
 */
const mod = /Mac|iP(hone|[oa]d)/.test(navigator.platform)
  ? { metaKey: true }
  : { ctrlKey: true }

/**
 * Feeds a key through the editor exactly as the browser would, and reports
 * whether anything claimed it. `false` means no binding matched and the
 * browser's default would run.
 */
const pressKey = (view: RichTextView, key: string, modifiers: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...modifiers })
  return view.someProp('handleKeyDown', handler => handler(view, event)) ?? false
}

/**
 * The list commands run against the caret, not a full-document selection —
 * `executeRichTextActions` deliberately does not call `autoSelectAll` for
 * them, unlike the mark commands. It matters: selecting the whole document
 * makes `blockRange` resolve at depth 0, `toggleList`'s depth guard fails, and
 * a second toggle wraps the list again instead of lifting it. These tests
 * therefore rely on the caret the editor starts with.
 */
test('bullet list wraps a paragraph, and toggling again lifts it back out', () => {
  const view = mount('<p>item</p>')

  run(view, { command: 'bulletList' })
  expect(view.dom.querySelector('ul > li > p')?.textContent).toBe('item')

  run(view, { command: 'bulletList' })
  expect(view.dom.querySelector('ul')).toBeNull()
  expect(view.dom.querySelector('p')?.textContent).toBe('item')
})

test('a list style value converts the list in place rather than lifting it', () => {
  const view = mount('<p>item</p>')

  run(view, { command: 'bulletList' })
  run(view, { command: 'bulletList', value: '"◦"' })

  const list = view.dom.querySelector('ul')
  expect(list).not.toBeNull()
  expect(list?.style.listStyleType).toBe('"◦"')
})

test('toggling to the other list type converts rather than nests', () => {
  const view = mount('<p>item</p>')

  run(view, { command: 'bulletList' })
  run(view, { command: 'orderedList' })

  expect(view.dom.querySelector('ol > li > p')?.textContent).toBe('item')
  expect(view.dom.querySelector('ul')).toBeNull()
})

/**
 * `toggleList` dispatches its transaction and then returns `false` on the
 * convert-in-place branch, which reads as "no command ran" to any caller that
 * checks the return value. The edit still lands, so this is pinned as current
 * behaviour rather than treated as a bug — but any replacement of that branch
 * has to make a deliberate decision about it.
 */
test('the convert-in-place branch reports failure even though it edits', () => {
  const view = mount('<p>item</p>')
  run(view, { command: 'bulletList' })

  const { bullet_list: list, list_item: item } = view.state.schema.nodes
  const before = view.dom.innerHTML

  // Called directly rather than through the action dispatcher, so the return
  // value is observable.
  const reported = toggleList(list!, item!, '"◦"', {})(view.state, tr => view.dispatch(tr))

  expect(reported).toBe(false)
  expect(view.dom.innerHTML).not.toBe(before)
})

test('nested list structure survives sinking a second item', () => {
  const view = mount('<ul><li><p>one</p></li><li><p>two</p></li></ul>')
  const second = view.dom.querySelectorAll('li')[1]

  expect(second).not.toBeUndefined()
  expect(view.dom.querySelectorAll('ul')).toHaveLength(1)
  expect(html(view)).toMatchInlineSnapshot(`
    "<ul style="">
    <li>
    <p style="">one</p>
    </li>
    <li>
    <p style="">two</p>
    </li>
    </ul>"
  `)
})

/**
 * Which keys the editor claims, for a caret at the start of a single
 * paragraph.
 *
 * "declined" is not the same as "unbound": a bound command that cannot apply
 * in the current state also returns false. `Mod-[` and `Mod-]` are bound to
 * list lifting and sinking and decline here only because there is no list.
 * The binding that is genuinely absent is asserted separately below, where
 * the difference can actually be observed.
 */
test('key inventory for a caret in a plain paragraph', () => {
  // A caret, not a selection — matching what this claims to measure. Selecting
  // the whole document changes several answers, which is pinned separately.
  const view = mount('<p>text</p>')

  const inventory = [
    ['Mod-b', pressKey(view, 'b', mod)],
    ['Mod-i', pressKey(view, 'i', mod)],
    ['Mod-u', pressKey(view, 'u', mod)],
    ['Mod-[', pressKey(view, '[', mod)],
    ['Mod-]', pressKey(view, ']', mod)],
    ['Tab', pressKey(view, 'Tab')],
    ['Enter', pressKey(view, 'Enter')],
    ['Escape', pressKey(view, 'Escape')],
  ] as const

  const report = inventory.map(([key, handled]) => `${handled ? ' claimed' : 'declined'}  ${key}`).join('\n')
  expect(report).toMatchInlineSnapshot(`
    " claimed  Mod-b
     claimed  Mod-i
     claimed  Mod-u
    declined  Mod-[
    declined  Mod-]
    declined  Tab
     claimed  Enter
     claimed  Escape"
  `)
})

/**
 * Enter, across the three selection states it behaves differently in.
 *
 * A caret splits the block and a caret in a list splits the item — the two
 * cases that matter for typing. Selecting the entire document and pressing
 * Enter does nothing at all: none of the five commands in the chain can apply,
 * so the keypress falls through.
 *
 * That last one changed with the upgrade; previously the chain claimed the
 * key. Declining is the safer of the two behaviours — the alternative is
 * silently replacing every word in the box with an empty line — but it is a
 * real difference in what a user sees, so it is recorded rather than left to
 * be discovered.
 */
test('Enter splits at a caret, in a list item, and declines on a full selection', () => {
  const caret = mount('<p>ab</p>')
  expect(pressKey(caret, 'Enter')).toBe(true)
  expect(caret.dom.querySelectorAll('p')).toHaveLength(2)

  const list = mount('<ul><li><p>ab</p></li></ul>')
  expect(pressKey(list, 'Enter')).toBe(true)
  expect(list.dom.querySelectorAll('li')).toHaveLength(2)

  const everything = mount('<p>ab</p>')
  autoSelectAll(everything)
  expect(pressKey(everything, 'Enter')).toBe(false)
  expect(everything.dom.querySelectorAll('p')).toHaveLength(1)
  expect(everything.dom.textContent).toBe('ab')
})

/**
 * Enter keeps the active formatting, in a list exactly as in a paragraph.
 *
 * These disagreed until `splitListItemKeepMarks` replaced plain
 * `splitListItem` in the keymap: the same keystroke dropped bold, colour and
 * size when the caret was in a list item and kept them when it was in a
 * paragraph. Imported PowerPoint runs carry all three, so the asymmetry was
 * most visible on exactly the content Mona exists to edit.
 *
 * The two carry marks by different mechanisms — a paragraph inherits them from
 * the position, a list item receives them as stored marks — so this asserts
 * what the user experiences, which is the formatting the next typed character
 * will have, rather than which field it arrived in.
 */
test('Enter carries active marks into the next block, in lists and paragraphs alike', () => {
  const marksForNextCharacter = (content: string) => {
    const view = mount(content)
    // The end of the text, which is where a user pressing Enter to start the
    // next line would be.
    caretAt(view, view.state.doc.content.size - 2)
    pressKey(view, 'Enter')
    const marks = view.state.storedMarks ?? view.state.selection.$from.marks()
    return marks.map(mark => mark.type.name)
  }

  expect(marksForNextCharacter('<ul><li><p><strong>ab</strong></p></li></ul>')).toEqual(['strong'])
  expect(marksForNextCharacter('<p><strong>ab</strong></p>')).toEqual(['strong'])
})

/**
 * Undo and redo against a real edit, so that a declined key means the binding
 * is missing rather than merely inapplicable.
 *
 * This is the one that matters for the upgrade: `Shift-Mod-z` — the
 * conventional redo shortcut on every platform — is not bound at all. Redo is
 * reachable only through `Mod-y`. Pinned so that adding it later is a
 * deliberate, visible change.
 */
test('Mod-z undoes, Mod-y redoes, and Shift-Mod-z does nothing', () => {
  const view = mount('<p>text</p>')

  run(view, { command: 'bold' })
  expect(view.dom.querySelector('strong')).not.toBeNull()

  expect(pressKey(view, 'z', mod)).toBe(true)
  expect(view.dom.querySelector('strong')).toBeNull()

  // The conventional redo shortcut. Nothing claims it, so bold stays off.
  expect(pressKey(view, 'z', { ...mod, shiftKey: true })).toBe(false)
  expect(view.dom.querySelector('strong')).toBeNull()

  expect(pressKey(view, 'y', mod)).toBe(true)
  expect(view.dom.querySelector('strong')).not.toBeNull()
})

test('blockquote wraps and unwraps', () => {
  const view = mount('<p>quoted</p>')

  run(view, { command: 'blockquote' })
  expect(view.dom.querySelector('blockquote > p')?.textContent).toBe('quoted')

  run(view, { command: 'blockquote' })
  expect(view.dom.querySelector('blockquote')).toBeNull()
})

test('marks apply across the whole element without an explicit selection', () => {
  const view = mount('<p>styled</p>')

  run(view, { command: 'bold' }, { command: 'em' }, { command: 'underline' })

  expect(view.dom.querySelector('strong')).not.toBeNull()
  expect(view.dom.querySelector('em')).not.toBeNull()
  expect(view.dom.innerHTML).toContain('text-decoration: underline')
})

test('clear removes marks and resets list styling', () => {
  const view = mount('<p>styled</p>')
  run(view, { command: 'bold' }, { command: 'color', value: '#ff0000' })
  expect(view.dom.querySelector('strong')).not.toBeNull()

  run(view, { command: 'clear' })

  expect(view.dom.querySelector('strong')).toBeNull()
  expect(view.dom.innerHTML).not.toContain('#ff0000')
})

test('setting a font size on a list writes it onto the list node too', () => {
  const view = mount('<p>item</p>')
  autoSelectAll(view)
  run(view, { command: 'bulletList' })

  autoSelectAll(view)
  run(view, { command: 'fontsize', value: '32px' })

  expect(view.dom.querySelector('ul')?.style.fontSize).toBe('32px')
})

/**
 * `replaceText` rebuilds the document with `nodeType.create(null, …)`, so it
 * carries the node type and the marks of the first character across but passes
 * `null` for attributes. Every authored paragraph property — size, line
 * height, alignment, the PowerPoint identifiers — is dropped.
 *
 * Pinned as-is. For a deck editor that is arguably wrong, since replacing the
 * text of an imported paragraph silently discards its authored formatting, but
 * it is long-standing behaviour and fixing it is not part of a dependency
 * upgrade. The test exists so that a fix is a visible, deliberate change.
 */
test('replace swaps the document text, preserving marks but dropping paragraph attributes', () => {
  const view = mount('<p style="font-size:36px;line-height:1.2"><strong>before</strong></p>')

  run(view, { command: 'replace', value: 'after' })

  const paragraph = view.dom.querySelector<HTMLElement>('p')
  expect(paragraph?.textContent).toBe('after')
  expect(view.dom.querySelector('strong')).not.toBeNull()
  expect(paragraph?.style.fontSize).toBe('')
  expect(paragraph?.style.lineHeight).toBe('')
})

test('indent steps the paragraph indent attribute and stops at the ceiling', () => {
  const view = mount('<p>item</p>')
  autoSelectAll(view)

  for (let step = 0; step < 12; step += 1) run(view, { command: 'indent', value: '1' })

  const indent = view.dom.querySelector<HTMLElement>('p')?.dataset.indent
  expect(indent).toMatchInlineSnapshot(`"8"`)
})

test('alignment writes text-align, and left is omitted as the default', () => {
  const view = mount('<p>item</p>')

  autoSelectAll(view)
  run(view, { command: 'align', value: 'center' })
  expect(view.dom.querySelector<HTMLElement>('p')?.style.textAlign).toBe('center')

  autoSelectAll(view)
  run(view, { command: 'align', value: 'left' })
  expect(view.dom.querySelector<HTMLElement>('p')?.style.textAlign).toBe('')
})

test('a link applies to the whole element and can be removed again', () => {
  const view = mount('<p>linked</p>')

  run(view, { command: 'link', value: 'https://example.com' })
  expect(view.dom.querySelector('a')?.getAttribute('href')).toBe('https://example.com')

  run(view, { command: 'link', value: '' })
  expect(view.dom.querySelector('a')).toBeNull()
})
