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

## When the deck moves underneath you

`apply` refuses if the user edited the deck while you were working, because your
copy cannot be reconciled with edits it never saw. Call **`sync`** to re-read the
deck — this discards your uncommitted file changes — then redo them.
