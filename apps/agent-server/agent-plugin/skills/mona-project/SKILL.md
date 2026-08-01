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
documents/<id>/deck/powerpoint/shared-layers.json  # imported PPTX only
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

Keep all existing element ids and every `source` object unchanged. You may add
source-free text, shapes, images, native connectors (including bent/curved
routes), charts with embedded workbooks, tables, groups, equations, audio, and
video. Put their media in that document's `deck/assets/` directory. New objects
are serialized into the retained `.pptx` as editable native objects rather than
flattened slide images. Changing an existing image's `src` performs a native
media replacement; image backgrounds use the same asset mechanism.

Do not add source metadata to a new object. Do not create an opaque object from
scratch. Existing hyperlinks and fields retain their source-preserving rules.
Slide count/order changes still require retained native slide clone provenance.

An imported deck may have `deck/powerpoint/shared-layers.json`. This is the only
surface that edits a shared master or layout for every slide using it. Use it
only for an explicit deck-wide request; otherwise edit a slide's virtual
`powerPointInheritedElements`, which produces a slide-local override. Keep all
package/layer identity fields and existing `source` objects unchanged. You may
edit/delete source-backed layer objects and add ordinary source-free Mona objects.

When all requested documents are ready, call `apply_changes` once. It creates a
durable ordered job, validates every changed deck, checks that no source changed
underneath the workspace, and writes each successful step through its provider.
The result names partial failures. Never say a document changed unless its step
succeeded.

If a source changed underneath the workspace, call `sync_documents`, then redo
the edit against the fresh files. A document marked read-only is context only;
do not attempt to bypass that capability.
