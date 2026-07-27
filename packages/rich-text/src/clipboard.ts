import { Fragment, Slice, type Node, type Schema } from 'prosemirror-model'

/**
 * What happens to content on its way into the editor.
 *
 * Two things need doing, and neither is sanitisation. ProseMirror parses
 * pasted HTML with `DOMParser.fromSchema`, so only nodes and marks the schema
 * declares a `parseDOM` rule for survive at all — the schema is the allowlist,
 * and `<script>` has no rule. The one exception is `href`, which does have a
 * rule and so needs a policy; that policy belongs to the application, and
 * arrives as an option rather than being duplicated here.
 */

/** Attributes that identify a run, paragraph or list in the source package. */
const PROVENANCE_ATTRIBUTES = ['pptLevel', 'pptParagraphId', 'pptRunId'] as const

const withoutProvenance = (node: Node) => {
  const cleared: Record<string, unknown> = {}
  for (const name of PROVENANCE_ATTRIBUTES) {
    if (name in node.attrs && node.attrs[name] !== '') cleared[name] = ''
  }
  return Object.keys(cleared).length ? { ...node.attrs, ...cleared } : node.attrs
}

/**
 * Rebuilds a fragment, applying `transform` to every node in it.
 *
 * ProseMirror has no built-in deep map, and `Fragment` is immutable, so the
 * tree is reconstructed bottom-up.
 */
const mapFragment = (fragment: Fragment, transform: (node: Node, children: Fragment) => Node): Fragment => {
  const mapped: Node[] = []
  fragment.forEach(node => {
    mapped.push(transform(node, mapFragment(node.content, transform)))
  })
  return Fragment.fromArray(mapped)
}

export interface PasteOptions {
  /** Applied to every `href` that survives parsing. Defaults to leaving it alone. */
  sanitizeHref?: (href: string) => string
  schema: Schema
}

/**
 * Cleans a pasted slice.
 *
 * Provenance is dropped because pasted content is new authored content. Its
 * run and paragraph identifiers belong to whichever element it was copied
 * from, and carrying them in would put duplicates inside one text body —
 * which the compiler treats as unique — and change the serialized markup that
 * `restoreAuthoredBaseline` compares against.
 *
 * `plainText` is true when the clipboard held no HTML, or when the user asked
 * for an unformatted paste. Then every mark and every block attribute goes,
 * so the text adopts the formatting of wherever it lands. Without this there
 * is no way to paste unformatted text into Mona at all.
 */
export const cleanPastedSlice = (slice: Slice, plainText: boolean, options: PasteOptions): Slice => {
  const { link, pptSource } = options.schema.marks
  const sanitizeHref = options.sanitizeHref ?? ((href: string) => href)

  const content = mapFragment(slice.content, (node, children) => {
    const marks = plainText
      ? []
      : node.marks
        .filter(mark => mark.type !== pptSource)
        .map(mark => (mark.type === link && typeof mark.attrs.href === 'string'
          ? mark.type.create({ ...mark.attrs, href: sanitizeHref(mark.attrs.href) })
          : mark))
    // `null` restores the schema's defaults, which is what an unformatted
    // paste wants: no authored size, colour, alignment or indent.
    if (node.isText) return options.schema.text(node.text ?? '', marks)
    return node.type.create(plainText ? null : withoutProvenance(node), children, marks)
  })

  return new Slice(content, slice.openStart, slice.openEnd)
}
