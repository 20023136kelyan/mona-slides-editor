# Mona PowerPoint import and rendering architecture

## Scope

This document compares Mona's PPTist-derived presentation pipeline with
ONLYOFFICE's presentation architecture and turns the comparison into an
incremental implementation order. It covers import, rendering, and the
source-preserving inverse serializers that now protect supported edits.

The ONLYOFFICE comparison was made against `ONLYOFFICE/sdkjs` commit
`72b0421c0bbf9d01eed9cf14834ae47eb2df1b50`. The code is used as an
architectural reference; the implementation in Mona remains native to Mona's
TypeScript and React architecture.

## Current Mona pipeline

```text
.pptx provider bytes
  -> Electron main process
  -> @mona/pptx-ingestion
       -> exact OOXML package inventory/backing
       -> @mona/pptx-parser.parse()
       -> DOM-free semantic Mona conversion
       -> content-addressed asset set
  -> document-owned recovery files and retained source package
  -> PresentationState over IPC (never a second archive copy)
  -> shared React production renderer
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
- charts retain native chart-space families, series, axes, caches, formulas,
  options, workbook addresses, and theme overrides; the current editor adapter
  intentionally exposes a smaller common subset.
- equations retain OMML semantics beside their generated visual preview.
- diagrams retain a semantic group root, nested drawing children, and their
  data/layout/style/color/drawing resources; native SmartArt authoring remains
  future work.
- unsupported graphic frames now become source-backed opaque elements with a
  visible placeholder; unsupported-object coverage outside graphic frames is
  still incomplete.

Relevant Mona files:

- `packages/pptx-ingestion/src/index.ts`
- `packages/pptx-ingestion/src/package-backing.ts`
- `packages/pptx-ingestion/src/conversion.ts`
- `apps/desktop/src/powerpoint-ingestion.ts`
- `apps/desktop/src/deck-store.ts`
- `apps/web/src/features/editor/editor-import.ts`
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

1. `@mona/pptx-ingestion/package-backing` retains an exact byte copy of the imported package.
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
10. Source archives are persisted as versioned document-owned desktop records
    and re-hashed before renderer hydration after reload. IndexedDB is only a
    one-time legacy migration source.
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
16. PPTX inventory, parsing, conversion, media materialization, and source
    retention run in the Electron main process as one cancellable operation.
    The renderer receives the semantic result and loads the retained backing
    record from disk; there is no production browser/worker parser path.
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
37. Conversion is framework- and DOM-free. The old `DOMParser` list/table
    adapters were replaced by a deterministic fragment reader for the bounded
    HTML emitted by the parser.
38. Media conversion returns an explicit content-addressed asset set. The
    desktop host writes every asset before the model becomes reachable, removing
    the old module-global pending queue and active-document dependency.
39. Local-folder and project data-source PowerPoint files use the same desktop
    ingestion contract. A project agent receives slide JSON and extracted media
    as readable context. Source-preserving writeback is enabled for existing
    slide-local non-line object transforms/deletions, rich text, text-body
    layout, and solid fill/outline edits; every other mutation fails capability
    validation before provider write.
40. Native tables retain and write back grid dimensions, row heights, merged
    topology, banding/style flags, per-cell structured text, margins, fills,
    vertical alignment, and per-side/diagonal borders.
41. Native chart spaces retain families, series, caches, formulas, axes,
    titles, legends, labels, external-data provenance, theme overrides, and
    embedded workbook addresses. Supported edits patch caches and their
    declared embedded-workbook ranges together.
42. Speaker-notes and comments are modeled and shown through Mona's
    notes/comment surfaces. Existing parts receive source-preserving edits, and
    missing notes slides/masters plus legacy comment authors, threads, and
    replies are allocated with relationships and content types.
43. Alt text, accessibility title, decorative state, and hidden state are
    editable semantic properties and write back through native nonvisual
    drawing properties.
44. External and internal-slide run hyperlinks can be added, removed, or
    retargeted with collision-free relationship IDs. Relationship-free
    slideshow actions remain distinct and round-trip as `ppaction` values.
45. Solid, gradient, and pattern slide-local backgrounds can be written over an
    inherited background without modifying the shared layout or master.
46. The dirty journal records the actual owner parts for chart/workbook,
    notes, and comments edits instead of conservatively dirtying the slide.

The backing store is deliberately independent of PptxGenJS. PptxGenJS is an
export generator and cannot improve import fidelity. Mona-native generation now
uses PptxGenJS 4.0.1, while imported-deck preservation uses the retained-package
writer.

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
| A01 | Exact source package retention | Done | Persist the content-addressed backing store in the document-owned desktop recovery package, hydrate it on deck load, and garbage-collect unreferenced packages | Restarting the app produces the same SHA-256 and byte-for-byte package |
| A02 | OPC part and relationship graph | Done | Replace the regex-only inventory reader with a namespace-aware XML/OPC reader; retain content types, internal/external relationships, and relationship IDs as indexed records | Every relationship target in the corpus resolves or produces a typed diagnostic |
| A03 | Unknown and extension parts | Done for preservation | Keep every unrecognized part and relationship; add an `opaque` semantic record when an unknown object is referenced by a slide | Unknown parts survive and referenced unknown objects are reported rather than silently dropped |
| A04 | Package safety and resource limits | Done for configured limits | Archive, expanded-package, part, XML-part, part-count, compression-ratio, XML-depth, and entity/DOCTYPE limits are enforced; adversarial entity/depth cases are tested | Adversarial ZIP/XML fixtures fail safely without blocking the UI |
| A05 | Import diagnostics | Done | Produce a structured per-package/per-slide report with preserved, modeled, approximated, opaque, and dropped counts | The report can prove that the dropped count is zero for a successful import |
| A06 | Dirty-part journal | Done for supported writeback | Track exact object parts plus chart/workbook, notes, and comment owner parts; leave all other parts immutable | A one-element edit marks only its dependent parts dirty |
| A07 | Desktop ingestion and cancellation | Done | Run ZIP/XML parsing, conversion, and media writes in Electron main with operation-scoped cancellation and progress | Large-corpus import never blocks the renderer; cancellation prevents presentation commit and retained-package publication |
| A08 | Stable package and object addressing | Done | Keep package hashes, part IDs, native shape IDs, creation IDs, and relationship IDs; carry `(part, cNvPr id)` through the maintained parser fork and refuse ambiguous identities | Reimporting the same file maps valid source objects to the same provenance keys; duplicate/malformed IDs receive a diagnostic rather than a false patch target |

### B. Presentation hierarchy, themes, and inheritance

| ID | Capability | Status | Action | Acceptance gate |
| --- | --- | --- | --- | --- |
| B01 | First-class themes | Partial | Color/font schemes, typed fill/line/effect/background matrices, extra color schemes, theme overrides, and color-map overrides are retained. Shape `effectRef` indices now resolve through the active theme effect matrix, including `phClr`, and presentation font/background/foreground/accent edits patch every retained base theme; complete matrix editing and dependency invalidation remain | A theme-only change updates dependent slides without rewriting their objects |
| B02 | Slide masters | Partial | Master background, shape tree, text-style levels, color map, placeholders, header/footer policy, and theme reference are stored once; complete structured style/effect inheritance | Master objects are stored once and used by every dependent layout |
| B03 | Slide layouts | Partial | Layout records retain master reference, matching name/type, authored background, placeholder tree, visibility flags, and color-map overrides; remove the remaining parser compatibility adapter | Slides reference a layout instead of owning copied `layoutElements` |
| B04 | Slide-to-layout-to-master graph | Done | Replace candidate paths with typed IDs and validated references; recover gracefully from broken relationships | Corpus slides resolve the same hierarchy as the OOXML relationship graph |
| B05 | Placeholder matching and inheritance | Partial | Exact slide → layout → master object ancestry, parser-compiled geometry, and master text-style levels are retained; replace HTML text with structured property compilation | Title/body/date/footer/slide-number placeholders match reference output |
| B06 | Layer and visibility semantics | Done for static import rendering | Preserve background → master → layout → slide ordering, `showMasterSp`, non-painting prompt placeholders, layout field suppression, and local overrides | Layering tests cover hidden master/layout shapes and local overrides |
| B07 | Slide backgrounds | Done for imported static backgrounds | Preserve authored solid, gradient, pattern, and picture backgrounds independently at slide/layout/master layers and resolve one effective background | Backgrounds render without converting patterns to white or losing transforms |
| B08 | Presentation and slide properties | Partial | Model slide size, order, hidden state, sections, names, default text styles, custom shows, tags, and presentation/view properties | Nonvisual deck structure matches the source manifest |
| B09 | Headers, footers, date, and slide numbers | Partial | Master policy and layout field placeholders render in inherited positions; add typed field content/date formats and explicit per-slide field editing | Dynamic/static footer fields display in the correct inherited position |
| B10 | Notes hierarchy | Done for speaker-note authoring | Notes masters/slides, relationships, placeholders, paragraphs/runs, and the editor remark adapter are retained; missing notes slide/master structures are allocated natively | Speaker notes and notes-page objects survive independently |
| B11 | Comments and authors | Partial | Modern/legacy comment records, authors, replies, positions, timestamps, and relationships are modeled. Existing records edit in place; new legacy authors, threads, and threaded replies are allocated. Complete modern-comment authoring remains | Comment threads retain identity and slide/object anchoring |

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
| C01 | Native nonvisual identity | Done for modeled drawing objects | Parse `cNvPr` IDs/names, creation IDs, relationship IDs, descriptions, titles, hidden/decorative state, locks, and visual-extension metadata; supported accessibility edits serialize back | Selection and export address the original object identity |
| C02 | Native nested shape tree | Partial | Native groups, nested groups, diagram drawing children, and opaque graphic frames now form ordered trees; extend this to every content-part/object family | No object is flattened merely to fit `Slide.elements` |
| C03 | Nested group transforms | Done for imported groups | Preserve parent/child coordinate spaces, `off/ext`, `chOff/chExt`, rotation, flips, locks, and recursive composition | Deeply nested group fixtures match reference bounds and hit-testing |
| C04 | Z-order | Partial | Retain native tree order independently within master, layout, and slide layers | Overlapping objects match reference compositing order |
| C05 | Preset and custom geometry | Partial | Preset types and native adjustment values are retained and editable; custom paths remain source-preserved and explicitly reject unsafe preset replacement | Adjustable shapes remain native; custom geometry is never silently replaced |
| C06 | Connectors | Done for supported native routes; partial breadth | Endpoint IDs/sites, explicit attach/detach, straight/bent/curved route controls, rotation/flip canonicalization, width, dash, color, and arrowheads write back natively; uncommon custom/effect cases remain explicit | Style edits retain connections; implicit endpoint detachment fails; supported routes round-trip |
| C07 | Fills | Partial | Solid, native gradients, preset patterns, and retained picture-fill tile/stretch are modeled and write back; complete scheme transforms and picture-media replacement | No gradient is averaged and no pattern is replaced with white |
| C08 | Lines | Partial | Model per-line width, dash, compound, cap, join, alignment, head/tail type and size, transparency, and theme references | Line styles match reference output at normal and zoomed scales |
| C09 | Effects and 3D | Partial | Outer shadow plus editable glow, inner shadow, reflection, and soft edge import, render, validate, and write as DrawingML effects. Direct effects and theme-inherited `effectRef` styles resolve into the same semantic render state; editing an inherited effect materializes a local native effect list without dropping inherited shadow, alpha, or 3D. Existing supported nodes inside an `effectDag` are edited in place without flattening or disturbing names/compositors; topology changes and ambiguous repeated nodes are refused. Camera/light rotations and presets plus top/bottom bevel, extrusion, contour, material, and z-depth import into editable `threeD`, render with a non-raster Electron approximation, and write as native `scene3d`/`sp3d`. Remaining breadth is complex graph topology, 3D backdrop/transform details, color transforms, and pixel-identical Office lighting | Supported effects render; unsupported ones show a diagnostic/preview |
| C10 | Hyperlinks and actions | Partial | External and internal-slide run hyperlinks support relationship-aware add/remove/retarget; slideshow actions remain relationship-free. Complete element/hover actions and sounds | Internal slide links and external links remain distinguishable |
| C11 | Images and SVG | Partial | Source media part/relationship, crop/mask, opacity, luminance/saturation, outline, and outer shadow are retained and editable; complete media replacement, SVG fallback switching, and remaining transforms | Cropped/rotated/transformed images match source without destructive re-encoding |
| C12 | Audio and video | Partial | Preserve media relationship, poster frame, trims, volume, looping, autoplay, and external media references | Static poster and supported playback metadata survive import |
| C13 | OLE, ActiveX, 3D models, and unsupported objects | Partial | OLE previews and opaque graphic frames now retain identity, relationships, bounds, placeholder, and diagnostics; add typed coverage for ActiveX, 3D, and content parts | Unsupported objects remain visible and survive later export untouched |

### D. Structured text and PowerPoint text layout

| ID | Capability | Status | Action | Acceptance gate |
| --- | --- | --- | --- | --- |
| D01 | Paragraph/run model | Done for text and shape bodies | Extend the typed model to table cells, chart text, notes, and future content-part text without parsing generated HTML | Structured content round-trips internally without parsing generated HTML |
| D02 | Style cascade | Done for imported text and shapes | Extend the same compiler to table/chart/notes text and add dependency-aware invalidation | Theme font/color changes update all inheriting text |
| D03 | Bullets and numbering | Partial | Retained and rendered: character/autonumber type, scheme/start, level, margins, indents, tabs, and 9-level styles. Add picture-bullet assets and exact marker font/color/size layout | Three-plus-level lists match numbering and indentation |
| D04 | Paragraph layout | Partial | Retained and rendered: alignment, RTL, East Asian/Latin rules, line and before/after spacing, tabs, indents, and default run properties. Add Office-compatible line breaking and keep/widow behavior | Mixed-language paragraphs match reference line and paragraph breaks |
| D05 | Text-body geometry | Partial | Retained and rendered: insets, columns/gap, wrap metadata, vertical anchor/writing, rotation metadata, autofit mode, and native text-warp preset/adjustments. Add exact overflow, shape text rectangles, and vertical/rotated clipping | Vertical/column/rotated text uses the correct clipping and bounds |
| D06 | Autofit and measurement | Partial | Imported shrink factors and line-spacing reduction render consistently; add dynamic no-fit/shrink/resize measurement with deterministic font metrics and invalidation | Text fits the same bounds at editor, thumbnail, and read-only scales |
| D07 | Fonts and substitution | Partial | Theme/document/script fonts, language metadata, and supplemental mappings are retained, resolved, and preloaded. Add embedded fonts, deterministic missing-font substitution, and diagnostics | Missing fonts are reported and fallback is deterministic by script |
| D08 | Text color/effects and WordArt | Partial | Preserve scheme colors/transforms, gradient/picture text fills, outlines, shadows, and text warp | Styled display text is not reduced to an averaged solid color |
| D09 | Fields and links | Partial | Fields and run-level hyperlinks remain typed; slide numbers materialize from presentation order; external run links allocate/update relationships. Add dynamic date/time/header/footer/custom field evaluation and action links | Field semantics remain distinct from their current displayed string |

HTML remains an editing-surface adapter until the rich-text editor consumes the
structured model directly. It is not the PowerPoint source of truth.

### E. Graphic frames and advanced content

| ID | Capability | Status | Action | Acceptance gate |
| --- | --- | --- | --- | --- |
| E01 | Complete table grid | Done for current table model | Grid widths, row heights, spans, merge continuations, banding/direction flags, and table style ID are retained and source-patched | Merged-cell topology and dimensions match the source |
| E02 | Table cell semantics | Done for current table model; partial effects | Per-side/inside/diagonal borders, fills, margins, vertical alignment, and structured text are retained and editable; uncommon cell effects remain source-only | Styled headers and asymmetric borders are retained per cell |
| E03 | Chart-space model | Partial | Typed chart-space retains plot families, series, axes, titles, legends, labels, options, formatting metadata, and extensions; Mona's editable chart adapter still exposes a smaller common subset | Multiple chart types/axes/series remain distinguishable in the native model |
| E04 | Chart data sources | Done for cached/embedded sources; partial external links | Formulas, string/number caches, category/date/value axes, external-data provenance, and workbook relationships are retained | Charts render from cached data and retain workbook/formula provenance |
| E05 | Chart rendering | Partial | The adapter renders supported combo series and primary/secondary value axes without collapsing assignments; uncommon families/options remain explicit fallbacks | Native bar/line/pie and multi-series fixtures visually match reference output |
| E06 | Embedded workbooks | Done for supported chart ranges | Workbook bytes remain untouched on no-op export; edited chart data updates the declared worksheet ranges, dimensions, caches, and series headers together | An unedited workbook remains byte-identical and an edited chart updates its declared range |
| E07 | SmartArt/diagrams | Partial | Diagram data/layout/style/color/drawing part addresses and relationships plus parsed semantic data are retained; drawing children render as a semantic group | SmartArt is not silently converted into unrelated flat shapes |
| E08 | Equations | Done for supported LaTeX/OMML authoring | OMML is retained as a semantic tree beside the editable preview. LaTeX is converted to native editable OMML inside `mc:AlternateContent`, with a visual fallback; imported equation edits replace the native equation object | Equation source and visual preview both survive |
| E09 | Embedded/linked objects | Partial | Embedded graphic frames without a semantic renderer are opaque objects with relationship provenance; add payload metadata and linked-state UI | Embedded content survives and external-link state is visible |

### F. Rendering, recalculation, and fidelity validation

| ID | Capability | Status | Action | Acceptance gate |
| --- | --- | --- | --- | --- |
| F01 | Derived render graph | Done | Resolve effective theme/master/layout/slide nodes without mutating or duplicating source objects | Canvas receives a deterministic ordered render graph |
| F02 | Dependency-aware invalidation | Missing | Add dirty flags/caches for theme, master, layout, slide, shape, text, chart, and asset dependencies | A theme/master edit recalculates only dependent objects |
| F03 | Unified render geometry | Partial | Use the same transforms, bounds, clipping, and text metrics for canvas, thumbnails, read-only view, selection, snapping, and export previews | No selection jump or thumbnail/editor geometry divergence |
| F04 | Transitions and timing | Partial | Slide/layout/master transition inheritance, builds, timing nodes, conditions, triggers, and targets are retained. Mona's fade/zoom/rotate/directional-slide/pulse/swing effects and fade/push/random transitions author native timing and play through the existing semantic animation surface; complete Office preset/condition breadth remains | Supported effects reimport with target, trigger, type, and duration intact |
| F05 | Accessibility and nonvisual data | Partial | Reading order, alt text/title/description, language, decorative/hidden state, and locks are retained; object accessibility edits write back. Add table-header authoring and a dedicated inspector | Accessibility metadata survives and reading order follows the shape tree |
| F06 | Diagnostics and visible fallback | Partial | Opaque graphic frames render a bounded preview or neutral placeholder and expose their reason in the import report; extend the fallback to every unsupported object family | No referenced slide object disappears without a visible/reportable explanation |
| F07 | Performance and memory | Partial | Keep parsing and conversion in the Electron main process; add lazy part decoding, asset deduplication, render caching, slide virtualization, and backing-store lifecycle | The 30+ slide stress deck stays within agreed import time/memory/interaction budgets without putting parser work in the renderer |
| F08 | Reference rendering harness | Partial | Mona screenshot/structural baselines and round-trip PPTX artifacts are deterministic; `pptx:reference-open` ZIP-validates them, converts every slide through LibreOffice when available, and otherwise requires macOS Quick Look to open and render a system thumbnail | Every compatibility slice adds deterministic visual and structural baselines |
| F09 | Corpus coverage | Partial | Maintain native PowerPoint, Google Slides export, Keynote export, corporate master, design-heavy, tables/text, SmartArt, equations, RTL/CJK, 4:3, and stress fixtures | The matrix maps each row to at least one public or private fixture |

### G. Editing semantics required before export

| ID | Capability | Status | Action | Acceptance gate |
| --- | --- | --- | --- | --- |
| G01 | Provenance-aware editing | Done for the editing boundary | Stable identities, immutable provenance, exact object/part routing, and property/owner-part journaling cover direct commands and full-deck JSON replacement; unsupported mutations fail before write | Editing an imported object does not detach unrelated source data |
| G02 | Inherited-object editing | Done | Human selection and agent slide JSON materialize copy-on-write slide overrides or slide-local hide intent. Explicit deck-wide master/layout edits live separately in `deck/powerpoint/shared-layers.json`, record authored part paths, and patch those retained shared parts directly | A slide-local change does not mutate every slide sharing a master; an explicit shared edit does |
| G03 | Agent JSON surface | Done | The filesystem agent reads and edits complete semantic slide JSON with stable IDs. Apply validates immutable package provenance, consumes the virtual inherited layer, sanitizes the deck, journals exact changes, and commits the full run as one transaction | Agent JSON edits use the same semantic state as direct UI editing and remain one-step undoable |
| G04 | Unsupported-object protection | Done for retained native copies | Existing opaque/native objects remain transformable and deletable. Element/slide duplication retains a copy-on-write pointer to the original native payload; forged or payload-free opaque JSON is rejected. Export clones the exact native drawing or slide subtree, gives it independent drawing/part identities, and refuses edits to unaddressable descendants instead of guessing | Moving or copying an opaque object retains its source payload without aliasing the original |
| G05 | Undo/history boundaries | Done | Package bytes and immutable hierarchy parts remain outside history; semantic commands and compact dirty references undo without archive cloning | Undo does not clone archives and restores the exact previous semantic state |

Part 7 deliberately preserves the JSON-agent architecture. It does not replace
the agent with a fixed command vocabulary: the model still edits
`deck/deck.json` and `deck/slides/NN.json`, and one validated apply becomes one
normal editor transaction. Imported slides expose effective layout/master roots
as `powerPointInheritedElements`. Editing an entry creates a local override;
removing an exactly addressed entry hides it only on that slide; unaddressable
inherited content remains readable but immutable. Human and agent slide
duplication keeps the retained hierarchy and records a native slide clone origin,
instead of flattening shared content into local elements.

The native writer now serializes retained object copies, inherited overrides,
slide-local inherited hides, copied slides, source-free semantic elements and
explicit shared master/layout changes. It allocates collision-free
drawing IDs, slide/layout/master/relationship IDs, relationship parts, and
content-type overrides. Slide-owned mutable dependencies — notes, comments,
charts, embedded workbooks, SmartArt data, OLE payloads and chart user shapes —
are recursively cloned, while immutable layouts/themes and media bytes remain
shared. Generated text, shapes, picture fills, images, native connectors,
charts/workbooks, tables, groups, native OMML equations and audio/video are built in a small
standards-compliant donor package and transplanted into the retained package;
image replacement and image backgrounds use the same document-owned asset
resolver. Mona formula sources export as editable native OMML in
`mc:AlternateContent` with an SVG fallback. Opaque objects still require
retained native payloads.

## Export architecture after import and rendering

Export is split around the retained package. Rebuilding every imported deck
solely through PptxGenJS would discard
OOXML that PptxGenJS does not model, undoing the preservation work.

Mona therefore needs two export paths:

1. **Imported-deck patch export** — clone the retained package, serialize only
   dirty semantic objects/parts, update affected relationships/content types,
   and copy every untouched part byte-for-byte.
2. **New-deck generation export** — use an updated PptxGenJS adapter for decks
   created entirely in Mona, with Mona-native serializers for capabilities that
   PptxGenJS cannot express.

| ID | Capability | Status | Action | Acceptance gate |
| --- | --- | --- | --- | --- |
| X01 | Hybrid export coordinator | Partial | Full-deck, single-source standard export uses retained-package writeback; Mona-native and partial/raster exports use generation | Export path is explicit and testable |
| X02 | Package patch writer | Partial | Exact no-ops return the retained archive; dirty slide XML is patched by source identity and every untouched package part remains byte-identical | Untouched parts remain byte-identical |
| X03 | Semantic serializers | Partial | Implemented: backgrounds; transforms/deletions; retained object/slide cloning; private hierarchy overrides/hides; explicit master/layout drawing authoring; source-free text/shapes/picture fills/images/connectors/charts/tables/groups/native OMML equations/audio/video; image replacement; rich text/text body; external/internal/action links; picture crop/filters/outline/outer shadow; direct, theme-inherited, and topology-preserving `effectDag` edits for glow/inner shadow/reflection/soft edge; common native camera/light/bevel/extrusion/contour/material 3D; accessibility; chart caches/workbooks; theme colors/fonts; supported timing/transitions; existing and new speaker notes/comments. Remaining: effect-graph topology authoring/ambiguous graphs, full Office 3D/backdrop semantics, complete Office animation/theme semantics, modern-comment creation, and other matrix rows still marked partial | Each completed import/model slice gains an inverse serializer |
| X04 | PptxGenJS upgrade and adapter | Complete | Mona-native generation uses PptxGenJS 4.0.1; imported decks never rely on it for source preservation | Existing export fixtures remain valid and new supported features improve |
| X05 | Relationship/content-type repair | Done for current serializers | External run hyperlinks and generated assets allocate collision-free relationship IDs. Copied/generated objects and slides allocate relationships and content types, recursively clone or transplant chart/workbook/diagram/OLE/notes/comment/media dependencies, register slides/private masters, and retarget every internal relationship relative to its new owner part | PowerPoint opens output without repair warnings |
| X06 | Round-trip harness | Partial | Public/private exact no-op tests and serializer re-import tests cover the supported edit matrix; round-trip artifacts receive ZIP integrity checks plus LibreOffice full-deck or macOS Quick Look first-slide reference-open rendering. Add installed Office/LibreOffice visual comparison in CI | No-op export preserves untouched parts and edited output remains stable |

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
   embedded fonts, and substitution diagnostics;
3. reuse the same structured-text compiler for table cells, chart text, notes,
   and other content parts rather than introducing another HTML-only path.

The original flat `Slide.elements` collection remains a compatibility adapter,
not the long-term source of truth.

## Verified import and static-rendering gate

The August 1, 2026 verification pass establishes the following:

- The five public corpus decks pass headless desktop-ingestion tests and
  structural renderer tests.
- The public groups/freeform deck now retains three semantic native groups,
  including a nested group, rather than six flattened `groupId` children.
  Browser coverage selects one group root, moves and resizes it while preserving
  child-local geometry, duplicates it with entirely new nested IDs, and deletes
  the duplicate atomically.
- The synthetic chart/table deck imports all three native PowerPoint charts
  (bar, line, and pie) plus its table. Each chart produces a non-empty SVG
  render; the old baseline that accepted three missing charts was removed.
- The four private real-world decks pass a serial Electron-renderer gate:
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
- The complete workspace verification runs core, ingestion, writeback, web,
  desktop, agent, project/document packages, the production build, and real
  Electron journeys. Retained-PowerPoint desktop coverage includes human and
  agent JSON duplicate/edit paths plus an agent-created editable object that is
  exported and re-imported through the production Electron bridge. The packaged
  `mona://` smoke also generates and re-imports a source-free object, proving the
  donor runtime is present inside the production application bundle.
- Source-package round trips now cover native table topology/cell styles,
  chart caches and embedded workbook ranges, chart colors/options, notes,
  comment text, external hyperlink relationship allocation, accessibility,
  picture treatments, complex shape fills, preset geometry, connectors, and
  slide-local backgrounds. Generated-object round trips additionally cover
  text, images, picture-filled shapes, semantic groups/connectors, native
  tables, charts with independent workbooks, native OMML equations, audio,
  video, image replacement, image backgrounds, and explicit master/layout
  drawing edits.
- `MONA_WRITE_PPTX_ROUNDTRIP_ARTIFACTS=1` emits deterministic edited decks to
  `.artifacts/pptx-roundtrip/`. `npm run pptx:reference-open` validates their ZIP
  packages and uses LibreOffice for full-deck PDF reference-open checks when a
  working executable is installed. On macOS without LibreOffice, it uses Quick
  Look as an independent system open/render check for the first slide of every
  artifact. Quick Look is smoke evidence only; it is not counted as a
  pixel-identical, all-slide comparison.

This is a strong static-rendering result for the current corpus, not a claim
that the entire ECMA-376 presentation specification is complete. The remaining
high-value compatibility work is still explicit in the matrix: deterministic
PowerPoint text measurement/fitting, advanced text and pixel-identical complex
effect/3D rendering, opaque
coverage beyond graphic frames, typed header/footer/date field content,
dependency-aware recalculation, full theme-matrix editing, modern-comment
creation, complete Office animation playback/editing, element/hover action
sounds, and installed reference-engine visual comparison.
