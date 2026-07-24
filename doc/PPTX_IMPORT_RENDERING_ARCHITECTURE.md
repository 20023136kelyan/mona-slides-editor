# Mona PowerPoint import and rendering architecture

## Scope

This document compares Mona's PPTist-derived presentation pipeline with
ONLYOFFICE's presentation architecture and turns the comparison into an
incremental implementation order. It covers import and rendering. Export is a
later, independent phase.

The ONLYOFFICE comparison was made against `ONLYOFFICE/sdkjs` commit
`72b0421c0bbf9d01eed9cf14834ae47eb2df1b50`. The code is used as an
architectural reference; the implementation in Mona remains native to Mona's
TypeScript and React architecture.

## Current Mona pipeline

```text
.pptx ArrayBuffer
  -> @mona/pptx-parser.parse()
  -> ParsedPptxPresentation
  -> convertParsedPptxSlides()
  -> Slide[] / semantic PPTElement trees
  -> React renderer
```

The original conversion boundary was destructive. The remaining destructive
areas are tracked in the matrix below:

- Mona's maintained parser fork returns slide elements plus one flattened `layoutElements`
  collection.
- `convertParsedPptxSlides()` previously merged both collections immediately.
- masters, layouts, themes, relationship IDs, native shape IDs, unknown package
  parts, and most advanced object semantics were not stored in presentation
  state.
- nested groups previously became flat elements sharing `groupId`; native
  PowerPoint groups now retain local child coordinate trees, while `groupId`
  remains as the adapter for Mona-created legacy groups.
- rich text becomes HTML.
- charts become labels, legends, numeric series, a small chart-type union, and
  two options.
- equations become images.
- diagrams now retain a semantic group root and nested drawing children,
  although the complete SmartArt data/layout model is still future work.
- unsupported graphic frames now become source-backed opaque elements with a
  visible placeholder; unsupported-object coverage outside graphic frames is
  still incomplete.

Relevant Mona files:

- `apps/web/src/features/editor/editor-import.ts`
- `apps/web/src/features/editor/editor-pptx-import.ts`
- `packages/presentation-core/src/model.ts`
- `apps/web/src/features/presentation-renderer/SlideRenderer.tsx`

## ONLYOFFICE patterns worth adopting

ONLYOFFICE does not collapse an imported presentation into one flat slide
element list before rendering.

### Separate document hierarchy

`slide/Editor/Format/Presentation.js` retains slides, slide masters, notes
masters, notes, sections, default styles, slide size, view properties, custom
properties, comments, transitions, and other document-level state.

`slide/Editor/Format/SlideMaster.js`,
`slide/Editor/Format/Layout.js`, and
`slide/Editor/Format/Slide.js` are separate object types with explicit
references:

```text
Slide -> Layout -> Master -> Theme
```

### Layered rendering

`Slide.prototype.drawBgMasterAndLayout()` renders the background, master
shapes, and layout shapes before `Slide.prototype.draw()` renders the
slide-local shape tree. Placeholder visibility and `showMasterSp` remain
semantic properties instead of becoming duplicated slide objects.

### Retained shape trees

Slides, layouts, and masters keep `cSld.spTree`. Groups use nested shape trees
and parent transforms rather than a shared flat group identifier. See
`Common/Drawings/Format/GroupShape.js`.

### Structured text

`Common/Drawings/Format/TextBody.js` retains structured content, paragraph
objects, compiled properties, placeholder content, text fitting, measurements,
and recalculation. Text is not reduced to HTML before layout.

### First-class charts and graphic frames

`Common/Drawings/Format/ChartSpace.js`,
`Common/Drawings/Format/ChartFormat.js`, and
`Common/Drawings/Format/GraphicFrame.js` retain chart objects, axes, labels,
layout, transforms, styles, and table/chart content. Charts are not reduced to
only a few arrays before rendering.

### Explicit recalculation

Slides, layouts, masters, shapes, text, and charts retain recalculation flags
and cached bounds. A theme or master change invalidates dependent objects
instead of requiring the imported hierarchy to be flattened again.

### Notes, transitions, and timing remain semantic

Notes and notes masters have dedicated models. `slide/Editor/Format/Timing.js`
retains timing-node and build lists. Static rendering can ignore playback while
the document model still retains the information.

## Gap matrix and Mona implementation

| Area | Mona before this work | ONLYOFFICE reference pattern | Mona direction |
| --- | --- | --- | --- |
| Original package | Discarded after parsing | Conversion retains complete document structures | Retain exact package bytes outside Redux and address them by content hash |
| Part graph | Not represented | Explicit document object graph | Inventory every part and relationship, including unknown extensions |
| Slides, layouts, masters | Layout/master content flattened into slides | Separate objects with references | Add first-class Mona theme, master, layout, and slide records |
| Render order | Merged element collection | Background -> master -> layout -> slide | Keep inherited and local layers separate |
| Identity | New random Mona IDs only | Persistent IDs and object table | Retain package, part, slide, relationship, and later native shape IDs as provenance |
| Groups | Flat `groupId` | Nested shape trees and transforms | Introduce nested `PPTGroupElement`; retain flat adapter during migration |
| Text | HTML string | Paragraph/run document model | Introduce structured rich text and derive HTML only for the current editing surface |
| Charts | Simplified arrays and type | Full chart-space model | Retain native chart semantics and embedded-workbook references |
| Tables | Simplified cells and common outline | Graphic frame and cell/table styles | Add per-side borders, merge continuations, grid semantics, and styles |
| Equations and diagrams | Flattened or rasterized | Dedicated semantic objects | Add equation and diagram elements with preview fallback |
| Unsupported objects | Silently absent | Retained by conversion/model | Add opaque elements backed by their original part/XML and a preview |
| Recalculation | Mostly React re-rendering | Dependency-aware recalculation flags | Add a derived render graph with invalidation by theme/master/layout/slide |

## Foundation implemented

The first compatibility foundation now exists:

1. `editor-pptx-package.ts` retains an exact byte copy of the imported package.
2. The package receives a stable SHA-256 ID.
3. Every package part is inventoried and classified without excluding unknown
   parts.
4. Every relationship is retained, including external relationships.
5. Presentation slide order is resolved through `presentation.xml` relationship
   IDs rather than inferred from filenames.
6. Slide -> layout -> master -> theme dependencies are recorded.
7. Presentation state stores small serializable package references while the
   potentially large archive bytes remain in a dedicated backing store.
8. Slides and converted elements now retain PowerPoint source provenance.
9. Inherited objects are kept beneath slide-local objects during rendering.
10. Source archives are persisted in a versioned IndexedDB store and re-hashed
    before hydration after reload.
11. Working-copy saves prune unreferenced source packages, while discard clears
    the retained package store.
12. OOXML content types, relationships, slide order, native object identity,
    and hierarchy metadata are parsed with a real XML parser with entity
    processing disabled.
13. Package diagnostics report missing relationship targets, duplicate
    relationship IDs, missing content types, and incomplete slide dependency
    chains.
14. Import diagnostics distinguish modeled, approximated, opaque, and dropped
    source objects per capability and per slide.
15. Native nonvisual drawing IDs, creation IDs, names, descriptions, and
    placeholder type/index are inventoried. Mona's workspace parser fork
    carries the OOXML part and `cNvPr` ID from the converting node into every
    supported parsed element. The importer resolves that pair against the
    package inventory and never uses a name or parser-order fallback as an
    exact source identity. Malformed duplicate or missing IDs are reported and
    deliberately remain ineligible for exact source patching.
16. PPTX inventory and conversion parsing run in a cancellable worker with
    progress stages; the main-thread implementation remains as a compatibility
    fallback.
17. Element and slide edits add source-part/object entries to a dirty-part
    journal without cloning the retained archive.
18. Themes, masters, layouts, placeholder catalogs, and typed slide dependency
   IDs now exist in the source hierarchy, and the renderer consumes a derived
   master -> layout -> unresolved inherited -> slide render graph.
19. Master and layout shape trees are stored once per source part rather than
    copied into every slide. Canvas, thumbnails, read-only view, slideshow,
    mobile, export previews, and agent previews consume the same derived graph.
20. Slide- and layout-level `showMasterSp` suppression is retained, so hidden
    master artwork is not painted by Mona.
21. OPC relationship targets are resolved according to the package rules for
    both package-absolute and relative targets. The native public bar, line,
    and pie fixtures therefore import and render instead of disappearing.
22. VML preview images for embedded OLE objects are resolved and rendered while
    the original embedded payload and relationships remain preserved.
23. Native PowerPoint groups and nested groups are represented by recursive
    `PPTGroupElement` trees. Their children stay in local coordinates and
    `coordinateWidth`/`coordinateHeight` preserve proportional rendering when
    a group is resized.
24. SmartArt drawing children are retained beneath a semantic diagram group
    instead of being flattened into unrelated slide-level shapes.
25. Unsupported graphic frames, including embedded objects without a usable
    preview, become `PPTOpaqueElement` records with native identity,
    relationship IDs, bounds, a visible neutral placeholder, and an explicit
    import diagnostic.
26. Core queries, validation, dirty-part journaling, duplication, clipboard
    remapping, editor commands, and agent addressing traverse semantic element
    trees. UI selection and transforms operate on the group root; agent edits
    may address a stable nested child ID without flattening the group.
27. Authored slide, layout, and master backgrounds are retained independently.
    The compatibility `slide.background` remains the effective visual fallback,
    while the shared render state resolves the semantic source layer.
28. Theme color schemes, major/minor script font schemes, master color maps,
    layout/slide color-map overrides, format-scheme names, nine-level master
    text-style summaries, and header/footer policies are retained in the source
    hierarchy.
29. Slide placeholders record exact layout and master object ancestry by
    native object ID. Matching uses placeholder index first and normalized type
    only when an indexed match is unavailable.
30. Canvas, thumbnails, read-only view, slideshow, mobile, export previews, and
    agent previews now consume the same resolved hierarchy background and
    slide-specific PowerPoint theme.
31. Enabled date, footer, header, and slide-number placeholders render through
    the selected layout without making inherited objects editable. Slide
    numbers are materialized from retained presentation order, and a layout can
    suppress a master field by omitting its placeholder.
32. A human or agent background edit converts inherited background state into
    a slide-local override and journals the source slide part as dirty.
33. Text and shape text bodies retain typed paragraphs, runs, fields, explicit
    breaks and tabs, end-paragraph properties, nine-level list styles, body
    geometry, autofit metadata, run hyperlinks, and stable source IDs. Imported
    HTML is now a compatibility adapter rather than the source of truth.
34. The render graph compiles effective text properties through presentation
    defaults, master styles, master/layout placeholder bodies, the local text
    body, paragraph defaults, and individual runs. Theme font and color tokens
    resolve at render time, including script-specific supplemental fonts.
35. The compiled adapter preserves nested bullet levels, numbering schemes,
    paragraph spacing/alignment/RTL metadata, relative line spacing, columns,
    insets, body anchoring, vertical modes, autofit scaling, fields, and links
    across every surface that consumes the shared render graph.
36. Direct rich-text edits deliberately detach the imported structured body,
    while geometry-only edits preserve it. This prevents inherited PowerPoint
    formatting from overwriting a human or agent's explicit text edit. Undoing
    back to the mounted import baseline restores the exact authored body and
    compatibility HTML instead of leaving a visually reverted but semantically
    detached object.

The backing store is deliberately independent of PptxGenJS. PptxGenJS is an
export generator and cannot improve import fidelity.

## What “import fixed” means

Import, rendering, editing, and export are separate compatibility claims. A
feature is not imported correctly merely because some visual approximation
appears on the canvas.

Mona will track five gates for every PowerPoint capability:

1. **Preserved** — the original OOXML parts, relationships, IDs, and assets are
   retained without mutation.
2. **Modeled** — supported semantics are represented in a typed Mona model.
   Unsupported semantics have an explicit opaque object rather than
   disappearing.
3. **Rendered** — the editor canvas, thumbnails, read-only view, and hit-testing
   agree on the static visual result.
4. **Editable** — a user or agent can modify the supported semantics without
   flattening unrelated or inherited content.
5. **Exported** — edits are serialized while untouched source content remains
   intact.

“Import fixed” means gates 1 and 2 are complete for the declared compatibility
scope, every unsupported object has a visible or diagnostic fallback, and the
importer has no known silent-loss path. It does **not** mean rendering or export
is automatically complete.

The work should be delivered as vertical slices:

```text
retain source -> parse one capability -> model it -> render it -> exercise it
-> compare against PowerPoint/LibreOffice reference output -> add corpus test
```

This catches incorrect interpretation while the relevant importer code is
still small. Export remains behind the import/render gates, but each model is
designed to be serializable from the beginning.

## Complete actionable gap matrix

Status in this table refers to Mona today:

- **Done** — implemented and directly tested.
- **Partial** — some data or visuals exist, but the compatibility gate is not
  satisfied.
- **Missing** — no durable semantic implementation exists.

### A. Package preservation and import infrastructure

| ID | Capability | Status | Action | Acceptance gate |
| --- | --- | --- | --- | --- |
| A01 | Exact source package retention | Done | Persist the content-addressed backing store in IndexedDB, hydrate it on deck load, and garbage-collect unreferenced packages | Reloading the browser produces the same SHA-256 and byte-for-byte package |
| A02 | OPC part and relationship graph | Done | Replace the regex-only inventory reader with a namespace-aware XML/OPC reader; retain content types, internal/external relationships, and relationship IDs as indexed records | Every relationship target in the corpus resolves or produces a typed diagnostic |
| A03 | Unknown and extension parts | Done for preservation | Keep every unrecognized part and relationship; add an `opaque` semantic record when an unknown object is referenced by a slide | Unknown parts survive and referenced unknown objects are reported rather than silently dropped |
| A04 | Package safety and resource limits | Partial | Add decompressed-size, compression-ratio, XML-depth, entity, media-size, and per-part limits in addition to archive byte/part-count limits | Adversarial ZIP/XML fixtures fail safely without blocking the UI |
| A05 | Import diagnostics | Done | Produce a structured per-package/per-slide report with preserved, modeled, approximated, opaque, and dropped counts | The report can prove that the dropped count is zero for a successful import |
| A06 | Dirty-part journal | Partial | Track which OOXML semantic objects and package parts an edit changes; leave all other parts immutable | A one-element edit marks only its dependent parts dirty |
| A07 | Import worker and cancellation | Done | Move ZIP/XML parsing and heavy asset decoding off the main thread; support cancellation and progress | Large-corpus import remains responsive and cancellation releases memory |
| A08 | Stable package and object addressing | Done | Keep package hashes, part IDs, native shape IDs, creation IDs, and relationship IDs; carry `(part, cNvPr id)` through the maintained parser fork and refuse ambiguous identities | Reimporting the same file maps valid source objects to the same provenance keys; duplicate/malformed IDs receive a diagnostic rather than a false patch target |

### B. Presentation hierarchy, themes, and inheritance

| ID | Capability | Status | Action | Acceptance gate |
| --- | --- | --- | --- | --- |
| B01 | First-class themes | Partial | Color schemes, script font schemes, format-scheme names, and color-map overrides are typed and rendered; add typed fill/line/effect schemes, extra color schemes, and theme overrides | A theme-only change updates dependent slides without rewriting their objects |
| B02 | Slide masters | Partial | Master background, shape tree, text-style levels, color map, placeholders, header/footer policy, and theme reference are stored once; complete structured style/effect inheritance | Master objects are stored once and used by every dependent layout |
| B03 | Slide layouts | Partial | Layout records retain master reference, matching name/type, authored background, placeholder tree, visibility flags, and color-map overrides; remove the remaining parser compatibility adapter | Slides reference a layout instead of owning copied `layoutElements` |
| B04 | Slide-to-layout-to-master graph | Done | Replace candidate paths with typed IDs and validated references; recover gracefully from broken relationships | Corpus slides resolve the same hierarchy as the OOXML relationship graph |
| B05 | Placeholder matching and inheritance | Partial | Exact slide → layout → master object ancestry, parser-compiled geometry, and master text-style levels are retained; replace HTML text with structured property compilation | Title/body/date/footer/slide-number placeholders match reference output |
| B06 | Layer and visibility semantics | Done for static import rendering | Preserve background → master → layout → slide ordering, `showMasterSp`, non-painting prompt placeholders, layout field suppression, and local overrides | Layering tests cover hidden master/layout shapes and local overrides |
| B07 | Slide backgrounds | Done for imported static backgrounds | Preserve authored solid, gradient, pattern, and picture backgrounds independently at slide/layout/master layers and resolve one effective background | Backgrounds render without converting patterns to white or losing transforms |
| B08 | Presentation and slide properties | Partial | Model slide size, order, hidden state, sections, names, default text styles, custom shows, tags, and presentation/view properties | Nonvisual deck structure matches the source manifest |
| B09 | Headers, footers, date, and slide numbers | Partial | Master policy and layout field placeholders render in inherited positions; add typed field content/date formats and explicit per-slide field editing | Dynamic/static footer fields display in the correct inherited position |
| B10 | Notes hierarchy | Partial | Add notes masters and notes slides, relationships, placeholders, and rich note content; do not reduce notes to one string | Speaker notes and notes-page objects survive independently |
| B11 | Comments and authors | Missing | Model modern/legacy comments, authors, replies, positions, timestamps, and relationships | Comment threads retain identity and slide/object anchoring |

The hierarchy model begins with:

```typescript
interface MonaPowerPointHierarchy {
  themes: PowerPointTheme[]
  masters: PowerPointSlideMaster[]
  layouts: PowerPointSlideLayout[]
  notesMasters: PowerPointNotesMaster[]
}
```

Each slide references a layout. The existing flat `Slide.elements` path remains
only as a migration adapter while the renderer moves to the derived hierarchy.

### C. Shape tree, geometry, and visual properties

| ID | Capability | Status | Action | Acceptance gate |
| --- | --- | --- | --- | --- |
| C01 | Native nonvisual identity | Partial | Parse `cNvPr` IDs/names, creation IDs, descriptions, titles, hidden/print flags, locks, and extension metadata | Selection and later export address the original object identity |
| C02 | Native nested shape tree | Partial | Native groups, nested groups, diagram drawing children, and opaque graphic frames now form ordered trees; extend this to every content-part/object family | No object is flattened merely to fit `Slide.elements` |
| C03 | Nested group transforms | Done for imported groups | Preserve parent/child coordinate spaces, `off/ext`, `chOff/chExt`, rotation, flips, locks, and recursive composition | Deeply nested group fixtures match reference bounds and hit-testing |
| C04 | Z-order | Partial | Retain native tree order independently within master, layout, and slide layers | Overlapping objects match reference compositing order |
| C05 | Preset and custom geometry | Partial | Preserve preset type, adjustments, guides, handles, connection sites, text rectangles, and custom paths | Adjustable and custom shapes remain editable without path approximation |
| C06 | Connectors | Partial | Preserve connector geometry, endpoint shape IDs/sites, routing, arrowheads, and line transforms | Moving a connected object keeps its connector attached |
| C07 | Fills | Partial | Model solid, scheme, gradient stops/paths, pattern, picture, transparency, tile/stretch, and color transforms | No gradient is averaged and no pattern is replaced with white |
| C08 | Lines | Partial | Model per-line width, dash, compound, cap, join, alignment, head/tail type and size, transparency, and theme references | Line styles match reference output at normal and zoomed scales |
| C09 | Effects and 3D | Partial | Model shadows, glow, soft edges, reflection, bevel, scene/shape 3D, and effect inheritance; use explicit fallback for unsupported effects | Supported effects render; unsupported ones show a diagnostic/preview |
| C10 | Hyperlinks and actions | Partial | Preserve web/file/email/slide links, action verbs, hover actions, sounds, and relationship IDs | Internal slide links and external links remain distinguishable |
| C11 | Images and SVG | Partial | Preserve source media part, crop, shape mask, alpha/color transforms, DPI, SVG fallback, tiling, outline, and effects | Cropped/rotated/transformed images match source without destructive re-encoding |
| C12 | Audio and video | Partial | Preserve media relationship, poster frame, trims, volume, looping, autoplay, and external media references | Static poster and supported playback metadata survive import |
| C13 | OLE, ActiveX, 3D models, and unsupported objects | Partial | OLE previews and opaque graphic frames now retain identity, relationships, bounds, placeholder, and diagnostics; add typed coverage for ActiveX, 3D, and content parts | Unsupported objects remain visible and survive later export untouched |

### D. Structured text and PowerPoint text layout

| ID | Capability | Status | Action | Acceptance gate |
| --- | --- | --- | --- | --- |
| D01 | Paragraph/run model | Done for text and shape bodies | Extend the typed model to table cells, chart text, notes, and future content-part text without parsing generated HTML | Structured content round-trips internally without parsing generated HTML |
| D02 | Style cascade | Done for imported text and shapes | Extend the same compiler to table/chart/notes text and add dependency-aware invalidation | Theme font/color changes update all inheriting text |
| D03 | Bullets and numbering | Partial | Retained and rendered: character/autonumber type, scheme/start, level, margins, indents, tabs, and 9-level styles. Add picture-bullet assets and exact marker font/color/size layout | Three-plus-level lists match numbering and indentation |
| D04 | Paragraph layout | Partial | Retained and rendered: alignment, RTL, East Asian/Latin rules, line and before/after spacing, tabs, indents, and default run properties. Add Office-compatible line breaking and keep/widow behavior | Mixed-language paragraphs match reference line and paragraph breaks |
| D05 | Text-body geometry | Partial | Retained and rendered: insets, columns/gap, wrap metadata, vertical anchor/writing, rotation metadata, and autofit mode. Add overflow, text warp, shape text rectangles, and exact vertical/rotated clipping | Vertical/column/rotated text uses the correct clipping and bounds |
| D06 | Autofit and measurement | Partial | Imported shrink factors and line-spacing reduction render consistently; add dynamic no-fit/shrink/resize measurement with deterministic font metrics and invalidation | Text fits the same bounds at editor, thumbnail, and read-only scales |
| D07 | Fonts and substitution | Partial | Theme/document/script fonts, language metadata, and supplemental mappings are retained, resolved, and preloaded. Add embedded fonts, deterministic missing-font substitution, and diagnostics | Missing fonts are reported and fallback is deterministic by script |
| D08 | Text color/effects and WordArt | Partial | Preserve scheme colors/transforms, gradient/picture text fills, outlines, shadows, and text warp | Styled display text is not reduced to an averaged solid color |
| D09 | Fields and links | Partial | Fields and run-level hyperlinks remain typed; slide numbers materialize from presentation order. Add dynamic date/time/header/footer/custom field evaluation and run-level actions | Field semantics remain distinct from their current displayed string |

HTML remains an editing-surface adapter until the rich-text editor consumes the
structured model directly. It is not the PowerPoint source of truth.

### E. Graphic frames and advanced content

| ID | Capability | Status | Action | Acceptance gate |
| --- | --- | --- | --- | --- |
| E01 | Complete table grid | Partial | Preserve grid widths, row heights, cell spans, `hMerge`/`vMerge` continuations, banding, direction, and table style ID | Merged-cell topology and dimensions match the source |
| E02 | Table cell semantics | Partial | Model per-side/inside borders, diagonal borders, fills, margins, vertical alignment, text body, and cell effects | Styled headers and asymmetric borders are retained per cell |
| E03 | Chart-space model | Missing | Retain the chart part as typed chart-space: plot areas, chart families, series, axes, titles, legends, labels, layout, formatting, and extensions | Multiple chart types/axes/series do not collapse to the small Mona chart union |
| E04 | Chart data sources | Missing | Preserve formulas, string/number caches, category/date/value axes, external data links, and embedded workbook relationships | Charts render from cached data and retain workbook/formula provenance |
| E05 | Chart rendering | Partial | Add a renderer/adapter for the typed chart model with explicit fallback for unsupported chart features | Native bar/line/pie and multi-series fixtures visually match reference output |
| E06 | Embedded workbooks | Missing | Retain workbook bytes and relationship graph; parse only the ranges needed for editing without rewriting the workbook | An unedited workbook remains byte-identical and an edited chart updates its declared range |
| E07 | SmartArt/diagrams | Partial | Model diagram data/layout/style/colors/drawing parts and relationships; render semantic diagram or source preview | SmartArt is not silently converted into unrelated flat shapes |
| E08 | Equations | Partial | Preserve OMML semantics plus generated preview; add a typed equation element instead of importing only an image | Equation source and visual preview both survive |
| E09 | Embedded/linked objects | Partial | Embedded graphic frames without a semantic renderer are opaque objects with relationship provenance; add payload metadata and linked-state UI | Embedded content survives and external-link state is visible |

### F. Rendering, recalculation, and fidelity validation

| ID | Capability | Status | Action | Acceptance gate |
| --- | --- | --- | --- | --- |
| F01 | Derived render graph | Done | Resolve effective theme/master/layout/slide nodes without mutating or duplicating source objects | Canvas receives a deterministic ordered render graph |
| F02 | Dependency-aware invalidation | Missing | Add dirty flags/caches for theme, master, layout, slide, shape, text, chart, and asset dependencies | A theme/master edit recalculates only dependent objects |
| F03 | Unified render geometry | Partial | Use the same transforms, bounds, clipping, and text metrics for canvas, thumbnails, read-only view, selection, snapping, and export previews | No selection jump or thumbnail/editor geometry divergence |
| F04 | Static transitions and timing retention | Missing | Parse and retain transitions, builds, timing tree, triggers, targets, and media commands while initially rendering the static end state | Animation-bearing decks retain all static content and report retained playback data |
| F05 | Accessibility and nonvisual data | Missing | Surface reading order, alt text, titles/descriptions, language, decorative/hidden state, and table headers | Accessibility metadata survives and reading order follows the shape tree |
| F06 | Diagnostics and visible fallback | Partial | Opaque graphic frames render a bounded preview or neutral placeholder and expose their reason in the import report; extend the fallback to every unsupported object family | No referenced slide object disappears without a visible/reportable explanation |
| F07 | Performance and memory | Partial | Add worker parsing, lazy part decoding, asset deduplication, render caching, slide virtualization, and backing-store lifecycle | The 30+ slide stress deck stays within agreed import time/memory/interaction budgets |
| F08 | Reference rendering harness | Partial | Render source decks through PowerPoint/LibreOffice reference output and Mona at fixed dimensions; compare screenshots and structural manifests | Every compatibility slice adds deterministic visual and structural baselines |
| F09 | Corpus coverage | Partial | Maintain native PowerPoint, Google Slides export, Keynote export, corporate master, design-heavy, tables/text, SmartArt, equations, RTL/CJK, 4:3, and stress fixtures | The matrix maps each row to at least one public or private fixture |

### G. Editing semantics required before export

| ID | Capability | Status | Action | Acceptance gate |
| --- | --- | --- | --- | --- |
| G01 | Provenance-aware editing | Partial | Route edits to the semantic source object and keep source provenance on derived render nodes | Editing an imported object does not detach unrelated source data |
| G02 | Inherited-object editing | Missing | Implement explicit “edit master/layout” and copy-on-write slide overrides for inherited placeholders/shapes | A slide-local change does not mutate every slide sharing a master |
| G03 | Agent command surface | Partial | Make agent tools operate on stable semantic IDs and typed properties rather than canvas approximations or comments | Agent edits produce the same commands as direct UI editing and remain undoable |
| G04 | Unsupported-object protection | Partial | Generic move, resize, duplicate, delete, and agent operations retain opaque provenance and nested child parts; source-package patch export remains pending | Moving an opaque object changes its transform while retaining its source payload |
| G05 | Undo/history boundaries | Partial | Keep package bytes and immutable source parts outside history; store only semantic edit commands and dirty-part references | Undo does not clone archives and restores the exact previous semantic state |

## Export architecture after import and rendering

Export is a later workstream, but it must be designed around the retained
package. Rebuilding every imported deck solely through PptxGenJS would discard
OOXML that PptxGenJS does not model, undoing the preservation work.

Mona therefore needs two export paths:

1. **Imported-deck patch export** — clone the retained package, serialize only
   dirty semantic objects/parts, update affected relationships/content types,
   and copy every untouched part byte-for-byte.
2. **New-deck generation export** — use an updated PptxGenJS adapter for decks
   created entirely in Mona, with Mona-native serializers for capabilities that
   PptxGenJS cannot express.

| ID | Capability | Action | Acceptance gate |
| --- | --- | --- | --- |
| X01 | Hybrid export coordinator | Choose patch export for source-backed decks and generation export for Mona-native decks | Export path is explicit and testable |
| X02 | Package patch writer | Copy source package and rewrite only dirty XML/assets/relationships | Untouched parts remain byte-identical |
| X03 | Semantic serializers | Serialize hierarchy, shapes, text, tables, charts, notes, comments, timing, and relationships incrementally | Each completed import/model slice gains an inverse serializer |
| X04 | PptxGenJS upgrade and adapter | Upgrade from current PptxGenJS 3.12 after an isolated compatibility test; use it for new-deck generation, not source preservation | Existing export fixtures remain valid and new supported features improve |
| X05 | Relationship/content-type repair | Allocate collision-free part names and relationship IDs and maintain `[Content_Types].xml` | PowerPoint opens output without repair warnings |
| X06 | Round-trip harness | Import → no-op export → reimport, and import → edit → export → reimport, with package/semantic/visual comparisons | No-op export preserves untouched parts and edited output remains stable |

## Implementation order and release gates

The complete work should proceed in this order:

1. **Foundation completion — A01–A08.** Make source preservation durable,
   safe, observable, cancellable, and addressable. No silent loss is permitted.
2. **Hierarchy vertical slice — B01–B09 plus F01–F03.** Introduce themes,
   masters, layouts, placeholders, and the layered render graph. Remove
   `layoutElements` as a source of truth.
3. **Shape-tree vertical slice — C01–C13.** Introduce native identity, nested
   groups, transforms, geometry, fills, effects, media, and opaque objects.
4. **Text vertical slice — D01–D09.** Add structured text, inheritance,
   PowerPoint layout, lists, scripts, and deterministic fitting.
5. **Graphic-frame vertical slices — E01–E09.** Implement tables first, then
   charts/workbooks, then SmartArt/equations/embedded content.
6. **Document semantics and fidelity — B10–B11 and F04–F09.** Complete notes,
   comments, timing retention, accessibility, diagnostics, performance, and
   corpus proof.
7. **Editing hardening — G01–G05.** Ensure human and agent edits operate on the
   same semantic model without destroying inherited or opaque data.
8. **Import/render compatibility gate.** Declare import complete only when the
   supported matrix has preservation/model evidence, unsupported content has
   an opaque fallback, and the corpus has zero unexplained losses. Declare
   rendering complete separately from screenshot and geometry evidence.
9. **Export — X01–X06.** Add source-package patch export, update PptxGenJS for
   Mona-native generation, and require no-op/edit round-trip proof.

The typed-text and inheritance portion of the structured-text vertical slice is
now complete for ordinary text and shape bodies. The next text-layout work is:

1. add deterministic Office-compatible font measurement, line breaking,
   overflow, shrink-text, and resize-shape behavior;
2. complete picture bullets, exact marker styling, vertical/rotated clipping,
   text warp, embedded fonts, and substitution diagnostics;
3. reuse the same structured-text compiler for table cells, chart text, notes,
   and other content parts rather than introducing another HTML-only path.

The original flat `Slide.elements` collection remains a compatibility adapter,
not the long-term source of truth.

## Verified import and static-rendering gate

The July 24, 2026 verification pass establishes the following:

- The five public corpus decks pass structural browser import tests.
- The public groups/freeform deck now retains three semantic native groups,
  including a nested group, rather than six flattened `groupId` children.
  Browser coverage selects one group root, moves and resizes it while preserving
  child-local geometry, duplicates it with entirely new nested IDs, and deletes
  the duplicate atomically.
- The synthetic chart/table deck imports all three native PowerPoint charts
  (bar, line, and pie) plus its table. Each chart produces a non-empty SVG
  render; the old baseline that accepted three missing charts was removed.
- The four private real-world decks pass a serial browser rendering gate:
  a 34-slide native-chart stress deck, a native pie-chart deck, an 18-slide
  corporate master/template deck, and a 28-slide design/SmartArt/notes deck.
- Every chart-bearing slide in those decks produces rendered vector marks.
  Every table-bearing slide produces table cells, representative image slides
  load real image pixels, and representative shared master/layout layers render
  the exact number of effective non-placeholder objects.
- Import reports contain zero dropped modeled objects for all four private
  decks.
- Comparing the parser's exact `(partPath, cNvPr id)` output with every source
  object in the layouts, masters, and slides actually used by those decks
  produces no missing source-tree object: `325/325`, `11/11`, `187/187`, and
  `113/113`. SmartArt drawing children add identities from their diagram parts
  in addition to those counts.
- Representative screenshots are produced on demand with
  `MONA_WRITE_FIDELITY_SCREENSHOTS=1` and are written to
  `.artifacts/pptx-fidelity/`.
- The real corporate deck retains authored hierarchy backgrounds, theme font
  schemes, master text-style levels, header/footer policy, placeholder element
  IDs, and slide-local links to their exact layout/master placeholder objects.
- Inherited field placeholders are rendered through the selected layout and
  slide-number fields use retained presentation order rather than the cached
  number embedded in a template.
- Ordinary text and shape text from the corporate fixture retain typed
  paragraphs/runs and stable source IDs. Browser coverage verifies compiled
  master/layout/local inheritance, theme font/color resolution, relative line
  spacing, columns, and safe hyperlinks; core coverage verifies nested list
  structure, script-specific fonts, field materialization, and edit detachment.

This is a strong static-rendering result for the current corpus, not a claim
that the entire ECMA-376 presentation specification is complete. The remaining
high-value compatibility work is still explicit in the matrix: deterministic
PowerPoint text measurement/fitting and advanced text effects, a full native
chart-space/workbook model, opaque coverage for unsupported object families
beyond graphic frames, typed header/footer/date field content beyond the
current resolved placeholders,
notes/comments/timing semantics, advanced effects/3D, dependency-aware
recalculation, and source-package patch export.
