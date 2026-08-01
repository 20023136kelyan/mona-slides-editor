---
name: mona-deck
description: Read and edit a Mona deck laid out as files - deck/deck.json, deck/slides/NN.json, deck/assets/. Use for any request that inspects or changes the open presentation.
---

# Editing a Mona deck

The deck is a directory, laid out the way a PPTX package is:

```
deck/deck.json        title, theme, slide order
deck/slides/01.json   one slide per file, zero-padded so lexical order is deck order
deck/assets/          images; slides reference them as "assets/image-1.png"
deck/powerpoint/shared-layers.json  explicit imported PPTX masters/layouts, when present
```

Edit with `Read`, `Edit`, `Write`, `Grep`, `Glob` and `Bash`. Nothing you write
reaches the user until you call **`apply`**, which reads `deck/` back, validates it,
and commits it as one undoable change.

## The loop

1. **Find it.** `Grep` for the text you were asked about — it is faster and more
   certain than reading slides in order. `deck/deck.json` maps slide order to files.
2. **Change it.** `Edit` the slide file. Keep every `id` exactly as you found it;
   ids are how the editor matches your version to the live one.
3. **`apply`.** Read the error if there is one — they name the fix.
4. **`look`** once, if the change was visual. Then stop.

**Stop when it is done.** `apply` returning success means the change is committed.
Re-reading the file to confirm, applying again, or looking a second time costs the
user a turn and finds nothing. Look once when geometry, colour or layout changed —
where you cannot judge the result from JSON. Do not look after a text change you
can verify by reading.

## The slide format

Every element has `id`, `type`, `left`, `top`, `width`, `height`, `rotate`.
Geometry is in the slide coordinate system: `deck.json` carries
`viewport.size` (the width, usually 1000) and `viewport.ratio` (height ÷ width,
usually 0.5625). So a 1000×562.5 canvas. Keep elements inside it.

An imported PowerPoint slide can also contain `powerPointInheritedElements`.
Those are the effective objects coming from its layout or master. They are
ordinary editable JSON in the workspace, but Mona treats an edit as a
slide-local copy-on-write override; it never mutates every slide that shares
the source layout. Removing an entry hides that inherited object only on this
slide. Keep its `source` and `id` while editing it.

`powerpoint/shared-layers.json` is a separate, deliberate deck-wide surface.
Edit it only when the user asks for a master/layout change that should affect
every slide using that layer. It contains exact `masters` and `layouts`, grouped
by retained package. Keep package ids, part paths, layer identity fields, existing
element ids, and every `source` object unchanged. You may edit/delete existing
source-backed elements or add normal source-free Mona elements to a layer. Never
copy a slide's `powerPointInheritedElements` into this file.

```jsonc
// text — the copy lives in `content`, as HTML
{ "type": "text", "content": "<p>Revenue</p>", "defaultFontName": "Arial",
  "defaultColor": "#18181b", "lineHeight": 1.2 }

// shape — `path` in `viewBox` units, `fill` a hex colour
{ "type": "shape", "viewBox": [200, 200], "path": "M 0 0 L 200 0 L 200 200 L 0 200 Z",
  "fill": "#6d5dfc", "fixedRatio": false,
  "text": { "content": "<p>TEAM 5</p>", "align": "middle",
            "defaultColor": "#ffffff", "defaultFontName": "Arial" } }

// image — `src` is a path into deck/assets/
{ "type": "image", "src": "assets/image-1.png", "fixedRatio": true }
```

**A shape's `text` is an object, not a string.** Writing `"text": "TEAM FIVE"` is
the single most common mistake here: it applies cleanly and renders a shape with
nothing on it. Set `text.content`. (A *text* element is the other way round — its
copy is `content`, a plain string field, and it has no `text`.)

Text content is HTML. Wrap paragraphs in `<p>`; `<strong>` and `<em>` work. One
`<p>` per line — a newline in a string is not a line break.

## Assets

Reference images by relative path (`assets/name.png`). To add one, write the file
into `deck/assets/` and point a new element at it — `apply` ingests any file it did
not itself write.

Never point `src` at an `http(s)` URL. It renders only while that host is up and
leaks the reader's IP to it. Download it first:

```bash
curl -sL "https://example.com/photo.jpg" -o deck/assets/photo.jpg
```

## Adding and removing slides

Write a new `deck/slides/NN.json` **and** add it to the `slides` array in
`deck.json` — that array is the deck order, and a file missing from it is ignored.
Give a new slide an id nothing else uses. To reorder, reorder that array. To
delete, remove the entry.

To duplicate an imported element, copy its whole JSON object and give the copy
a new `id` (and new ids for every nested child). Keep `source`: Mona converts it
to a retained native-copy reference during `apply`, so the duplicate can never
overwrite the original PowerPoint object. Do not invent or modify `source`
fields; they are immutable package addresses.

To duplicate an imported slide, copy its slide file, give the slide and every
local element a new `id`, add the file to the `slides` index, and keep every
`source` field exactly as read. Mona converts the slide source into a native
clone origin, keeps its layout/master hierarchy, and gives mutable linked parts
such as notes, charts, and embedded workbooks independent package identities at
PowerPoint export. You may edit `powerPointInheritedElements` in the new slide
during the same run; those changes become slide-local overrides.

Imported PowerPoint slides and explicit shared layers also accept new source-free
Mona elements. Text, shapes (including gradients and picture fills), images,
native connectors, charts with embedded workbooks, tables, groups, equations,
audio, and video are serialized into the retained `.pptx`; they are not flattened
to a slide image. Put new media in `deck/assets/` first. Changing an existing
image's `src` replaces its native picture payload, and an image background may
reference an asset path the same way. Opaque objects remain the sole exception:
they can only exist when backed by retained native XML.

## When the deck moves underneath you

`apply` refuses if the user edited the deck while you were working, because your
copy cannot be reconciled with edits it never saw. Call **`sync`** to re-read the
deck — this discards your uncommitted file changes — then redo them.
