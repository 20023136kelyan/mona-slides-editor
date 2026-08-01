---
name: mona-project
description: Read and edit several attached Mona presentations as ordinary deck files, then commit them through a durable multi-document job.
---

# Working across project documents

Read `project.json` first. It lists every attached document, whether it is
editable, and the directory containing its deck. Readable presentations use:

```
documents/<id>/deck/deck.json
documents/<id>/deck/slides/NN.json
documents/<id>/deck/assets/
```

Each deck has the same format as the `mona-deck` skill. Use `Grep`, `Read`,
`Edit`, `Write`, and `Bash` across the document directories. Keep existing slide
and element ids and every `source` object unchanged.

Native `.mona` decks may add images to their own `deck/assets/` directory and
reference them as `assets/<name>`. Imported `.pptx` decks use source-preserving
OOXML writeback. On existing slide-local source-backed non-line elements you may:

- modify `left`, `top`, `width`, `height`, `rotate`, `flipH`, and `flipV`;
- delete the element;
- rewrite a text element's `content`, or a shape's `text.content`, with the same
  inert rich-text HTML used in `deck.json`; remove the sibling `structuredText`
  field when replacing the authored HTML;
- use paragraphs/lists and spans with font family, font size, solid text color,
  bold, italic, underline, strike, subscript/superscript, letter spacing,
  alignment, RTL direction, indentation, line spacing, and paragraph spacing;
- change text-body `inset`, `columns`, `columnGap`, `lineHeight`, `wordSpace`,
  `paragraphSpace`, vertical alignment, and fixed-height autofit properties; and
- change a text box or shape to a solid `fill`, or edit/remove its simple
  `outline` (`color`, `width`, and `solid`/`dashed`/`dotted` style). Remove an
  existing shape's `gradient`, `pattern`, `patternFit`, and `powerPointPattern`
  fields when intentionally replacing that complex fill with a solid fill.

On existing slide-local source-backed `line` elements you may change `color`,
`width`, `style` (`solid`, `dashed`, or `dotted`), and `points` (start/end
markers). Straight lines may also change `left`, `top`, `start`, and `end`.
PowerPoint connection-site relationships are retained. If `source.connector`
names a connected `start` or `end`, do not move that endpoint: doing so requires
an explicit attach/detach command and the validator will reject an implicit
detach. Bent and curved lines may receive style changes, but do not change their
endpoints, route type, or control points yet.

Keep all element ids and every `source` object unchanged. Do not add elements or
assets, add/remove/change hyperlinks, edit fields, author gradients/patterns,
edit shadows/effects/opacity, rename the deck, change slide order/count, edit
connector relationships or bent/curved routes, or edit inherited layout/master
objects. The writeback validator rejects unsupported changes instead of
flattening them.

When all requested documents are ready, call `apply_changes` once. It creates a
durable ordered job, validates every changed deck, checks that no source changed
underneath the workspace, and writes each successful step through its provider.
The result names partial failures. Never say a document changed unless its step
succeeded.

If a source changed underneath the workspace, call `sync_documents`, then redo
the edit against the fresh files. A PowerPoint deck is editable only within the
source-preserving operations listed above. A document marked read-only is
context only; do not attempt to bypass that capability.
