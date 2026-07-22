# Gate 5 parity ledger

Status: **complete**. Gate 6 is unblocked.

Gate 5 ports complete element-editing vertical slices. A row is complete only
when its Vue implementation has been reviewed through every branch in scope and
the same browser contract passes against Vue and React for document state,
selection/editor state, history, geometry, focus/native-event behavior, computed
style, and isolated pixels where visible. React-only presence or a small text
mutation test is not parity evidence.

## Slice 1 — text and ProseMirror

| Contract | Vue source inventory | React/shared destination | Status |
| --- | --- | --- | --- |
| ProseMirror schema, plugins, parse/serialize, value synchronization | `views/components/element/ProsemirrorEditor.vue`; `utils/prosemirror/{schema,plugins,index}.ts` | `@mona/rich-text`; `EditorRichText.tsx` | complete |
| Rich-text command engine | `ProsemirrorEditor.vue`; `utils/prosemirror/utils.ts`; `commands/{setTextAlign,setTextIndent,toggleList,setListStyle,replaceText}.ts` | framework-neutral command controller in `@mona/rich-text` | complete |
| Selection-derived rich-text attributes | `getTextAttrs()`, editor click/keydown debounce, store `richTextAttrs` | editor session plus live ProseMirror controller | complete |
| Text element editable/static modes | `TextElement/{index,BaseTextElement}.vue`; `TextElementOperate.vue` | shared renderer plus `EditorRichText` and selection overlay | complete |
| Inspector chassis and exact tabs | `Toolbar/index.vue`; `ElementStylePanel/index.vue`; `TextStylePanel.vue` | React inspector | complete |
| Six preset styles | `TextStylePanel.vue` | React text inspector | complete |
| Font family/size, foreground/highlight, size increment/decrement | `RichTextBase.vue`; localized font hook | React text inspector + command engine | complete |
| Bold, italic, underline, strike, super/subscript, code, quote | `RichTextBase.vue`; `ProsemirrorEditor.vue` | React text inspector + command engine | complete |
| Clear formatting, text format painter, text hyperlink popover | `RichTextBase.vue`; `useTextFormatPainter.ts` | React text inspector + command engine | complete |
| Horizontal alignment, bullet/ordered styles, paragraph/first-line indent | `RichTextBase.vue`; list/align/indent commands | React text inspector + command engine | complete |
| Line, paragraph, and letter spacing; box fill and insets | `TextStylePanel.vue` | React text inspector + presentation transactions | complete |
| Fixed-height toggle and vertical alignment | `TextStylePanel.vue`; text renderer/resize branches | React text inspector + renderer/selection overlay | complete |
| Text outline, shadow, and opacity | `ElementOutline.vue`; `ElementShadow.vue`; `ElementOpacity.vue` | React text inspector + shared renderer | complete |
| Floating text toolbar | `ElementFloatLayer/FloatingToolbar/{index,TextToolbar,TextStyleControls}.vue` | React canvas floating layer | complete |
| AI-writing control behavior | `RichTextBase.vue`; legacy `AI_Writing` service | compatibility contract only; no new comment-command architecture | complete |
| Focus, keyboard, local/global history, auto-size, vertical text, empty cleanup | text element/editor hooks and global hotkeys | `EditorRichText`, runtime, overlay | complete |
| Text slice visual parity | all files above plus custom Button/Select/Popover/Input/ColorPicker/Divider styles | React equivalents | complete |

Text-slice evidence: `tests/gate5/text-inspector-parity.spec.ts` passes 27/27
two-sided contracts. The Style and Animation inspector plus the settled effect
pool rasters are exact at the canonical viewport. The Position inspector has
exact raw control geometry, background, border, and radius; its threshold-zero
capture differs at only 16 samples across the four independently composited
rounded number-input corners, with a maximum channel delta of 2. The floating
toolbar matches all geometry and computed rendering properties; its capture
contract permits only three pixels to differ by at most one 8-bit channel value
for Chromium's cross-page SVG/shadow compositing quantization. Gate 4 also
passes 46/46 after the shared operation layer was moved to PPTist's screen-space
architecture.

## Slice 2 — shapes, lines, and drawing tools

| Contract | Vue source inventory | React/shared destination | Status |
| --- | --- | --- | --- |
| Canvas toolbar chassis, notes strip, insert inventory, and zoom/history controls | `CanvasTool/index.vue`; `Canvas/index.vue` | `EditorCanvasTool`; `EditorCanvas`; runtime history | complete |
| Shape and line preset pools | `CanvasTool/{ShapePool,ShapeItemThumbnail,LinePool}.vue`; shape/line configs | shared `SHAPE_LIST`/`LINE_LIST`; React pool thumbnails | complete |
| All preset shape and line creation gestures | `ElementCreateSelection.vue`; `useCreateElement.ts`; shape/line configs | `editor-create-tool`; `EditorCanvas` creation interaction | complete |
| Horizontal and vertical text creation gestures | `ElementCreateSelection.vue`; canvas insertion hooks | React creation interaction and auto-size measurement | complete |
| Freehand/open/closed custom shape drawing | `Canvas/ShapeCreateCanvas.vue`; custom-shape insertion hook | `EditorCustomShapeCreator`; React notice and insertion transaction | complete |
| SVG path editor | `CanvasTool/SVGPathEditor.vue`; Modal/NumberInput/Checkbox/Button/context menu | `EditorSvgPathEditor`; inspector primitives; context menu | complete |
| Shape inspector including fill, gradients, outline, shadow, opacity, flip, and keypoints | `ShapeStylePanel.vue`; shared style controls | `ShapeStylePanel`; renderer and selection overlay | complete |
| Line inspector including presets, styles, width, endpoints, orthogonal direction, reverse, and shadow | `LineStylePanel.vue`; shared line/style controls | `LineStylePanel`; shared line presets and renderer | complete |
| Editable shape text and shared rich-text controls | shape editor plus `RichTextBase.vue` | `EditorRichText`; shape inspector | complete |
| Shape/line floating toolbars and format painter | `FloatingToolbar/{ShapeToolbar,LineToolbar,TextStyleControls}.vue`; `useShapeFormatPainter.ts` | `EditorFloatingElementToolbar`; runtime shape painter | complete |
| Shape/line creation and inspector visual parity | all files above and PPTist component styles | React equivalents | complete |

Shape/line evidence: `tests/gate5/creation-tools-parity.spec.ts` passes 8/8,
including real toolbar and canvas interactions for all 150 shape presets, all 9
line presets, both text directions, open/closed freehand paths, and the full SVG
path editor. Pool, custom-drawing notice, custom overlay, and isolated path
rasters are exact. The toolbar has identical geometry and SVG boxes; all 64
raw changed pixels are bounded inside source-identical SVG boxes with a maximum
six-channel quantization delta (13 visible pixels). The SVG path context menu
differs only at four two-pixel compositor-shadow corners, bounded to four
channel values. `tests/gate5/shape-line-parity.spec.ts` passes 14/14, including
exhaustive replacement, style, rich-text, gradient, painter, and floating-toolbar
transactions. React lint and TypeScript checks pass without warnings.

The floating-toolbar transaction contract switches both inspectors to Position
before driving the floating controls. This is deliberate isolation, not a
reduced assertion: when both Vue style controls are left mounted, PPTist's
`NumberInput` prop watcher re-emits the floating width into the inspector and
starts two concurrent IndexedDB snapshot writes. Their final cursor is
nondeterministically one or two identical undo entries depending on database
completion order. The inspector and floating controls are each tested
separately with exact state/history; the paired transaction test excludes that
source-only race and still compares every resulting document and history
boundary exactly.

## Slice 3 — images, crop, replacement, and image library

| Contract | Vue source inventory | React/shared destination | Status |
| --- | --- | --- | --- |
| Image inspector chassis and origin preview | `ElementStylePanel/ImageStylePanel.vue`; shared panel primitives | `ImageStylePanel`; inspector primitives | complete |
| Flip, radius, color mask, filter toggle, nine presets, nine filter sliders | `ImageStylePanel.vue`; `Element{Flip,ColorMask,Filter}.vue`; image filter hook | `ImageStylePanel`; shared renderer | complete |
| Outline, shadow, reset, and set-as-background | shared style controls; `ImageStylePanel.vue` | `ImageStylePanel`; presentation transactions | complete |
| Crop preset popover: all 20 shapes and all 11 ratios | `ImageStylePanel.vue`; `configs/imageClip.ts` | `ImageStylePanel`; shared clip configuration and crop commands | complete |
| Crop editor move, eight resize handles, modifier ratio locking, rotation math, Enter/Escape/outside lifecycle | `ImageClipHandler.vue`; `ImageElement/index.vue`; `useClipImage.ts` | `EditorImageCropEditor`; `editor-geometry`; canvas crop transaction | complete |
| Inspector and floating-toolbar replacement | `useImageHandler.ts`; `FloatingToolbar/ImageToolbar.vue` | `editor-image`; `ImageStylePanel`; `EditorFloatingImageToolbar` | complete |
| Main toolbar upload and Image menu | `CanvasTool/index.vue`; `useCreateElement.ts`; `FileInput.vue` | `EditorCanvasTool`; `EditorDeck` insertion flow | complete |
| Online image search request protocol, orientation, pagination, waterfall, drag clamp, and insertion | `ImageLibPanel.vue`; `ImageWaterfallViewer.vue`; `MoveablePanel.vue`; image-search service | `EditorImageLibraryPanel`; `EditorDeck` insertion flow | complete |
| Image surfaces visual parity | all image files above plus PPTist popover, number-input, loading, and moveable-panel styles | React equivalents | complete |

Image evidence: `tests/gate5/image-parity.spec.ts` passes 10/10 substantive
two-sided contracts. It executes every crop shape, ratio, handle, modifier and
lifecycle branch; every filter preset and slider; exact replacement/upload
placement; online search mount, typed query, orientation and page-two request
bodies; waterfall geometry; drag bounds; editable element state; selection;
undo history; and the floating toolbar. The initial inspector is pixel exact.
The crop-preset residual is 48 sub-threshold pixels, all inside identical
CSS-clipped shape-preview boxes. Rotated crop DOM geometry and computed styles
are exact; Chromium's separate-tree rotated-image interpolation is fixed at 13
pixels with the perceptual threshold. The main Image menu differs at only 12
corner-edge antialiasing pixels, the floating image toolbar only along its
fractional border/shadow edge, and the image-library residual is confined to
three source-identical SVG boxes. All residuals have fixed pixel/channel budgets
and bounding-box assertions; none are unbounded screenshot tolerances.

## Slice 4 — tables and merged/styled cells

| Contract | Vue source inventory | React/shared destination | Status |
| --- | --- | --- | --- |
| 10×10 hover generator, custom dimensions, exact table defaults and placement | `CanvasTool/TableGenerator.vue`; table insertion hook | `EditorTableGenerator`; `createTableElement`; `EditorDeck` | complete |
| Static and editable table renderers, theme classes, row/column spans, hidden cells, measured height | `TableElement/{index,EditableTable,useHideCells,useSubThemeColor,utils}.vue` | shared `TableElement`; `editor-table`; renderer utilities | complete |
| Edit-mask lifecycle, lock behavior, active cell, drag selection and editor-session ownership | `TableElement/index.vue`; `EditableTable.vue`; main store table state | `TableElement`; `EditorCanvas`; editor-state table selection | complete |
| Plain-text, Excel/TSV, HTML-table and encrypted PPTist clipboard handling | `CustomTextarea.vue`; `utils/clipboard.ts` | `EditableCellText`; `editor-table`; `editor-clipboard` | complete |
| Debounced contenteditable input, multi-cell Delete, Tab traversal/append and all arrow/Ctrl+arrow branches | `CustomTextarea.vue`; `EditableTable.vue` keyboard listener | `TableElement`; framework-neutral table operations | complete |
| Insert/delete row/column, select row/column/all, merge/split and merged-owner repair | `EditableTable.vue` commands and context menu | `editor-table`; `EditorContextMenu`; `EditorCanvas` transactions | complete |
| Column drag preview/commit, minimum width and normalized widths | `EditableTable.vue` drag handlers | `TableElement`; `resizeTableColumn` | complete |
| Complete table inspector: typography, fill, alignment, outline, theme and every row/column split command | `TableStylePanel.vue`; shared style components | `TableStylePanel`; inspector primitives; shared renderer | complete |
| Floating table toolbar: fill, exact border panel, structural menus and delete warnings | `FloatingToolbar/{TableToolbar,BorderPanel}.vue` | `EditorFloatingTableToolbar`; exact popover lifecycle | complete |
| Last-effective-axis warnings and stacked-message lifecycle | `EditableTable.vue`; `utils/message.ts`; `Message.vue` | table commands; `EditorNoticeStack` | complete |
| Table surface visual parity | table generator, static/editable table, edit mask, context menu, inspector, floating toolbar, border panel and warnings | React equivalents | complete |

Table evidence: `tests/gate5/table-parity.spec.ts` passes 13/13 substantive
two-sided contracts. The suite covers exact creation state and undo history;
every text/alignment/outline/theme inspector control; every inspector, context,
keyboard and floating-toolbar structural command; both merge axes and their
rowspan/colspan deletion-repair branches; every caret-boundary direction;
merged-cell fallback and hidden-cell Tab traversal; column live-preview and
commit; ordinary text, TSV, HTML-table and arbitrary encrypted-object clipboard
branches; and last-row/column warning behavior. Generator, created table,
edit-mask, editable table, context menu, inspector, floating toolbar, border
panel and warning captures use exact geometry and isolated pixel comparisons.
The inspector's only permitted residual remains the previously documented 27
subpixel samples (maximum channel delta 2) on the independently rendered right
inspector clipping edge; the table content and controls themselves are exact.
React lint and TypeScript checks pass without warnings.

## Slice 5 — charts, data editor, and theme controls

| Contract | Vue source inventory | React/shared destination | Status |
| --- | --- | --- | --- |
| All eight chart types, default data, insertion placement, type-specific legends, and ECharts SVG output | `CanvasTool/ChartPool.vue`; `hooks/useCreateElement.ts`; `configs/chart.ts`; `ChartElement/{Chart,BaseChartElement,index}.vue`; `chartOption.ts` | `EditorCanvasTool`; `editor-chart`; shared chart renderer and option builder | complete |
| ECharts lifecycle, theme-color supplementation, resize, and terminal rendering | `Chart.vue`; `chartOption.ts` | `ChartElement.tsx`; `chart-options.ts` | complete |
| Data-editor modal, exact 31×7 matrix, headers, selected range, focus, Enter navigation, clear/cancel/confirm, mask, and Escape lifecycle | `ChartDataEditorDialog.vue`; `components/{ChartDataEditor,Modal}.vue` | `EditorChartDataEditor`; `EditorDeck` | complete |
| Plain text, Excel/TSV, HTML-table, and encrypted PPTist clipboard branches | `ChartDataEditor.vue`; `utils/clipboard.ts`; document paste listener | `EditorChartDataEditor`; `editor-table`; `editor-clipboard`; `EditorCanvas` | complete |
| Range-resize live geometry, legal minima, half-cell rounding, and expanded range defaults | `ChartDataEditor.vue` | `EditorChartDataEditor` | complete |
| Pie/ring one-series and scatter minimum-two-series normalization | `ChartDataEditor.vue` | `EditorChartDataEditor` | complete |
| Complete chart inspector: conditional stack/smooth controls, fill, axes/text, grid, themes, and outline | `ChartStylePanel/index.vue`; shared style controls | `ChartStylePanel`; inspector primitives; shared renderer | complete |
| Twelve preset themes, slide theme, custom color editing/deletion, one-to-ten color limits, and draft/confirm semantics | `ChartStylePanel/{index,ThemeColorsSetting}.vue`; `configs/chart.ts` | `ChartStylePanel`; `editor-chart` | complete |
| Floating toolbar, persistent type popover, all eight type commands, and data-editor entry point | `FloatingToolbar/ChartToolbar.vue`; `components/Popover.vue` | `EditorFloatingChartToolbar`; `EditorChartDataEditor` | complete |
| Chart surface visual parity | chart pool, all render modes, data editor, conditional inspectors, theme popover/modal, outline controls, and floating toolbar | React equivalents | complete |

Chart evidence: `tests/gate5/chart-parity.spec.ts` passes 9/9 substantive
two-sided contracts. The suite creates and renders every chart family, compares
every type-specific inspector, exercises the complete matrix clipboard and
range-resize decision tree, proves pie and scatter normalization, and compares
document state, selection/history boundaries, undo/redo, focus, modal dismissal,
geometry, computed styles, and isolated pixels. It also drives all outline and
color controls, all twelve preset themes, the slide theme, and custom theme
drafts at one, six, and ten colors. The floating popover remains open after
each type selection exactly as in PPTist and every one of its eight commands is
followed by state, history, and terminal ECharts-render comparison. Fixed
residuals are limited to separately asserted native/SVG glyph and rounded-edge
antialiasing: chart canvases themselves are exact after the single documented
outer compositing-pixel crop. React lint and TypeScript checks pass without
warnings.

## Element slices

| Slice | Vue source roots | Status |
| --- | --- | --- |
| Shapes, lines, and drawing tools | shape/line elements, floating toolbars, style panels, SVG path editor, canvas tools | complete |
| Images, crop/filter/mask, image library | image elements, crop handlers, image toolbar/panel/library | complete |
| Tables including merged/styled cells | table editor, custom textarea, table toolbar/panel | complete |
| Charts, data editor, and theme controls | chart element/options, chart toolbar/panel/data editor | complete |
| LaTeX and symbols | LaTeX element/toolbar/panel, formula and symbol surfaces | complete |
| Audio and video | audio/video editors, players, toolbars/panels | complete |
| Groups, layers, alignment/distribution, format painter | multi/group toolbars and panels, ordering/alignment/distribution, format painters | complete |

LaTeX/symbol evidence: `tests/gate5/latex-symbol-parity.spec.ts` passes 7/7
substantive two-sided contracts. The suite compares every equation preset and
symbol inventory item, all six symbol tabs and all eight emoji categories,
equation creation and editing from inspector/floating-toolbar/double-click entry
points, invalid-input behavior, every modal dismissal path, color and geometry
controls, full document/session/history state, undo/redo, symbol insertion into
text, shape text, a non-editing shape fallback, an active table cell, and the
no-target fallback. Formula modal, inspector, floating toolbar, and every symbol
panel view are compared with exact geometry and isolated pixels. The draggable
symbol panel is also exercised through both movement and all four viewport clamp
edges. The only source behaviors treated as contracts despite being awkward are
PPTist's clipped emoji tab hit area and its delayed duplicate shape-rich-text
history boundary; React reproduces both observable behaviors.

Audio/video evidence: `tests/gate5/media-parity.spec.ts` passes 5/5
substantive two-sided contracts. It covers both media-input tabs, the canonical
URL defaults, URL and local-file insertion, the full MIME-extension map branches
for representative video/audio uploads, invalid-input notices, cancellation,
selection, exact defaults and placement, history, undo and redo. The editor
tests compare the complete custom video and audio player trees, player/native
media geometry, empty-source failure state, volume/play controls, all six video
rates, the persistent rate menu, loop, controller and audio-player placement,
and PPTist's special video contract where the content selects but only the four
edge strips drag. Both media inspectors are covered through audio icon color,
autoplay and loop, plus video poster upload, reset, first-frame failure and
autoplay. Player, popover and inspector geometry, text, SVG paths, model state,
selection and history are exact. Fixed raster residuals are bounded to the
source-identical native poster and glyph boxes where Chromium composites two
separate framework trees by one-channel values; the corresponding boxes,
computed structure, content and paths are asserted independently.

Multi-selection/group evidence: `tests/gate5/multi-group-parity.spec.ts`
passes 4/4 substantive two-sided contracts. It compares the complete
MultiPosition surface in both conditional states; all six mutual alignments and
both distribution directions across rotated elements, lines, and exact groups;
group creation, exact-group canvas alignment, ungroup selection reset; and every
compatible MultiStyle branch for text, shape, table, chart, image, line, LaTeX,
and audio. Geometry/group commands compare exact document, selection, and
history state. Multi-font operations reproduce PPTist's component-local
debounced writers and compare the complete document after every control; the
source's independent concurrent IndexedDB completion order is not converted
into a false deterministic cursor assertion. `editor-geometry.unit.test.ts`
also pins exact IEEE-754 results for all six alignments and both distributions,
including PPTist's operation order rather than rounded approximations.

## Exit rule

Gate 5 is closed: all 97 substantive two-sided browser contracts pass together
with one worker, covering every native element type and all rows above. The web
unit suite, TypeScript build, and type-aware lint are also required to stay
green. Gate 4 contracts remain mandatory regression tests throughout the work.
