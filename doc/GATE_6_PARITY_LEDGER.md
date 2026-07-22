# Gate 6 parity ledger

Status: **complete**. Gate 7 is unblocked.

Gate 6 ports complete presentation workflows and secondary surfaces. A row is
complete only after the Vue source, store/hooks, DOM lifecycle, styling, and
third-party behavior have been reviewed and substantive browser journeys pass
against both Vue and React. Presence, labels, or a React-only smoke test are not
parity evidence.

## Slice 1 — thumbnails, templates, sections, and slide actions

| Contract | Vue source inventory | React/shared destination | Status |
| --- | --- | --- | --- |
| Thumbnail rail chassis, add-slide split button, list, numbering, active/multi-selected state, note flags, page count | `Editor/Thumbnails/index.vue`; `ThumbnailSlide/*` | `EditorThumbnails.tsx`; shared renderer | complete |
| Focus ownership, ordinary/Ctrl/Shift selection, active-slide handoff, auto-scroll | `Thumbnails/index.vue`; main/keyboard stores | editor session plus `EditorThumbnails.tsx` | complete |
| Drag reorder, autoscroll, disabled section-edit state, and section-marker transfer rules | `vuedraggable`; `useSlideHandler.ts`; SortableJS 1.14.0 | same SortableJS 1.14.0 engine/options plus framework-neutral reorder operation | complete |
| Create, duplicate, delete/reset-last, cut/copy/paste, select-all, and keyboard/context-menu routes | `useSlideHandler.ts`; thumbnail/global hotkeys | editor runtime plus React rail/context menu | complete |
| Section create, rename, remove, remove-with-slides, remove-all, default section, and section context menu | `useSectionHandler.ts`; `Thumbnails/index.vue` | framework-neutral section operations plus React rail | complete |
| Template catalog/type filtering, loading/error state, insert one/all, empty-deck theme replacement | `Thumbnails/Templates.vue`; mock-data service | React template popover and runtime transactions | complete |
| Thumbnail/section/template visual parity | all files above plus Popover, Contextmenu, Loading and Button styles | source-sized React equivalents | complete |

Slice 1 evidence: `tests/gate6/thumbnail-workflows-parity.spec.ts` runs 14
two-sided journeys against ports 5173 and 5174. It compares the complete
presentation graph (generated IDs are pairwise canonicalized while preserving
references), selection/focus state, exact history cursor/length, rail and panel
geometry, catalogs/types/note inventories, loading pseudo-element styles, and
real clipboard/template/section transactions. Context menus are zero-pixel
different. Catalog and template headers are zero-pixel different. The add and
page bars have exact geometry/content and only independent Chromium text/icon
antialiasing remains (198/159 pixels respectively, maximum raw channel delta
6). The destination uses the source SortableJS version and exact animation,
scroll, scroll-sensitivity, scroll-speed, and disabled options; edge dragging,
edit-time suppression, both section-transfer branches, and non-history reorder
behavior run in both applications. Full slice result: **14/14 passed**.

## Slice 2 — notes, speaker remarks, search, selection, and markup

| Contract | Vue source inventory | React/shared destination | Status |
| --- | --- | --- | --- |
| Slide notes panel, replies, selection, edit/delete, element targeting, drag and lifecycle | `Editor/NotesPanel.vue`; notes store fields and emitter routes | `EditorNotesPanel.tsx`; shared no-history slide transactions | complete |
| Speaker remark editor, resize gesture, local editor state and persistence | `Editor/Remark/{index,Editor}.vue`; `Editor/index.vue` | `EditorRemark.tsx`; shared `@mona/rich-text` ProseMirror engine | complete |
| Search panel query/navigation/replace behavior and keyboard lifecycle | `Editor/SearchPanel.vue`; `useSearch.ts` | `EditorSearchPanel.tsx`; shared rich-text schema normalization | complete |
| Selection panel inventory, element visibility/lock/selection/order interactions | `Editor/SelectPanel.vue`; element hooks/stores | `EditorSelectionPanel.tsx`; canonical session/transaction state | complete |
| Markup panel slide/text/shape-text/image type inventories, source select, menu route, and no-history updates/removals | `Editor/MarkupPanel.vue`; `EditorHeader/index.vue`; `Select.vue`; slide model | `EditorMarkupPanel.tsx`; `EditorPptistSelect.tsx`; shared editor runtime/header route | complete |
| Panel geometry, dragging, masks, focus and visual parity | MoveablePanel/Drawer/common component styles | `EditorMoveablePanel.tsx`; source-sized panel CSS | complete |

Slice 2 evidence: `tests/gate6/secondary-surfaces-parity.spec.ts` runs seven
two-sided product journeys. It compares complete presentation graphs,
selection/handle/group/hidden/hotkey state, exact history cursor/length,
independent panel visibility and z-index lifecycle, drag/viewport clamps, resize
bounds, close/reopen reset, comments/replies/targeted creation/delete/clear,
ProseMirror debounce/focus/slide switching/north resize, selection grouping,
hide/show, unlock, rename and layer order, and search navigation plus single/all
replacement across text, shape and table content. Search evidence preserves the
source's ProseMirror serialization, boundary-mark behavior, case-sensitive table
replace-all quirk, and unchanged-cell mark lifecycle. The markup journey opens
the panel through each product's actual header menu, verifies exact panel
geometry/content and a four-pixel/raw-five-channel raster bound, exercises the
source-style popup select, and mutates/removes slide, text, shape-text, and image
labels while proving the history cursor remains unchanged. It also caught and
closed the source's single-selected active-member lifecycle after image unlock.
Full slice result: **7/7 passed**.

## Slice 3 — slide design, themes, viewport, and transitions

| Contract | Vue source inventory | React/shared destination | Status |
| --- | --- | --- | --- |
| Slide background solid/image/gradient modes, gradient-stop add/drag/remove, image sizing/upload, and background application scope | `Toolbar/SlideDesignPanel/index.vue`; `GradientBar.vue`; slide theme/background hooks | `SlideDesignPanel.tsx`; `EditorGradientBar.tsx`; shared transactions | complete |
| Theme fonts/colors, extended outline/shadow editing, theme-color modal/reorder, presets/application scopes, font propagation, and theme extraction | `SlideDesignPanel/{index,ThemeColorsSetting,ThemeStylesExtract}.vue`; `useSlideTheme.ts` | `SlideDesignPanel.tsx`; `editor-slide-theme.ts`; source-compatible modal/controls | complete |
| Viewport preset/custom size, validation, Enter/confirm/close lifecycle, and ratio conversion | `SlideDesignPanel/ViewportSizeSetting.vue`; canvas viewport hook | `SlideDesignPanel.tsx`; `EditorModal.tsx`; shared viewport commands | complete |
| Slide transition inventory, source default, selection, apply-to-all semantics, success notice, and history | `Toolbar/SlideAnimationPanel.vue`; animation config | `SlideAnimationPanel.tsx`; shared slide transactions | complete |
| Design/transition inspector geometry, state, history, modal animation, and visual parity | all files above and shared controls | source-sized React equivalents | complete |

Slice 3 evidence: `tests/gate6/design-transitions-parity.spec.ts` runs eight
two-sided journeys against ports 5173 and 5174. It verifies the complete panel
inventory, all 16 presets and all 12 transition modes; exact presentation graphs
after every background type, gradient-stop gesture, color edit, image upload,
viewport change, theme edit/application, font propagation, extraction choice,
and transition command; and exact history cursor/length including the source's
no-history theme and viewport edits. It also proves the source's JSON-clone
semantics, table-font extraction quirk, six-color warning, modal fade/zoom and
close lifecycle, local theme-color editing plus animated drag reorder, and
background/transition apply-to-all behavior. Geometry and text inventories are
exact. The transition panel is zero-pixel different; the viewport dialog differs
by one anti-aliased pixel (raw delta two); the theme extraction dialog leaves ten
glyph/SVG edge pixels (raw delta 33); and the complete design panel and
theme-color dialog remain within documented framework text/icon anti-aliasing
bounds after all opaque fills, borders, controls, row heights, and alignment were
made exact. Full slice result: **8/8 passed**.

## Slice 4 — application chrome, import/export, and settings

| Contract | Vue source inventory | React/shared destination | Status |
| --- | --- | --- | --- |
| Header geometry, title editing/fallback, menu lifecycle and screening controls | `EditorHeader/index.vue`; `Editor/index.vue` | `EditorHeader.tsx`; shared runtime routes | complete |
| Main menu import/reset/markup/hotkey/help surfaces | `EditorHeader/index.vue`; FileInput/Popover/Drawer | `EditorHeader.tsx`; `EditorHotkeyDrawer.tsx`; React file routes | complete |
| PPTX, JSON and native import plus progress/error/partial-state behavior | `useImport.ts`; header import routes; loading/message surfaces | `editor-import.ts`; `editor-pptx-import.ts`; `EditorFullscreenSpin.tsx` | complete |
| PPTX, PDF, image, JSON and native export dialogs, options, progress and errors | `ExportDialog/*`; `useExport.ts`; print/raster helpers | `EditorExportDialog.tsx`; `editor-export.ts`; shared renderer | complete |
| Keyboard-shortcut drawer | `EditorHeader/HotkeyDoc.vue` | `EditorHotkeyDrawer.tsx` | complete |
| Settings/locale behavior and complete English/Chinese localized chrome | `LocaleSwitcher.vue`; Vue catalogs; settings product change | React settings plus shared catalogs | complete |
| Chrome/dialog geometry, focus, accessibility structure and visual parity | all files above and common UI primitives | source-sized React equivalents | complete |

Slice 4 evidence is split across three substantive two-sided suites. The five
journeys in `tests/gate6/chrome-parity.spec.ts` prove the complete header,
editable-title/fallback/history contract, main/screen/settings popover lifecycle,
reset and markup routes, every shortcut group and key, close animation, and
English/Chinese locale persistence. Header pixels are exact; popover geometry
and content are exact with only documented Chromium glyph/icon antialiasing.
The shortcut comparison exposed a real source `vue-i18n` message-AST rendering
bug; the source drawer now resolves `tm()` leaves with `rt()`, so both products
render the actual shortcut catalog rather than object strings.

`tests/gate6/import-parity.spec.ts` runs five real file journeys: JSON append,
empty-deck replacement, encrypted PPTIST append, a generated native PPTX with
notes/table/shape/chart content, and malformed input. It compares the complete
presentation graph, viewport/theme/title/focus behavior, ID/reference remapping,
exact history timing, loading mutation lifecycle, and error state. The real PPTX
fixture also documents the shared `pptxtojson` 2.1.0 gap in which its generated
two-series chart is silently omitted; this is an upstream parser limitation in
both products, not a React-only fidelity claim.

The eight journeys in `tests/gate6/export-parity.spec.ts` cover every tab,
control/default/transition, custom range and quality gesture, modal dismissal,
exact JSON payload, encrypted native payload, editable and image-only PPTX,
PNG, and PDF print. Editable PPTX output is reopened and compared for chart,
merged-table, equation, text, geometry, and speaker-note semantics; the ZIP
package is also inspected for native chart, table, SVG, and notes parts. The
image-only deck embeds the identical JPEG. Lossless 1600×900 PNG output is
zero-pixel different. PDF page dimensions, margins, two-per-page breaks, and
current-slide mode are exact. Native and JSON dialogs are zero-pixel different;
the remaining dialogs leave only 3–21 independent antialiased glyph pixels in
their complete 680×500 surfaces. The raster journey exposed and fixed a shared
renderer defect: removing hidden merged cells changed `:first-child` theme
inheritance; React now preserves those cells with source-equivalent `display:
none`, yielding an exact exported table raster. Full slice result: **18/18
passed** (5 chrome + 5 import + 8 export).

The legacy PPTist AIPPT service/dialog is not a Gate 6 migration target. Mona's
agent and drawing-first architecture is Gate 9 and must use the JavaScript
presentation SDK; Gate 6 must not introduce a temporary service-specific AI
pipeline or comment-command architecture.

## Slice 5 — slideshow, presenter, audience, countdown, and writing board

| Contract | Vue source inventory | React/shared destination | Status |
| --- | --- | --- | --- |
| Screening entry/exit/from-current/from-start and fullscreen lifecycle | `useScreening.ts`; `Screen/index.vue`; fullscreen hooks | `ScreenView.tsx`; `use-screen-playback.ts`; source-compatible fullscreen lifecycle | complete |
| Base slideshow navigation, transitions, element animations, media and links | `Screen/{BaseView,ScreenSlide,ScreenElement,ScreenSlideList}.vue`; screen hooks | `ScreenViews.tsx`; `ScreenSlideList.tsx`; shared renderer/media elements | complete |
| Presenter layout, thumbnails, notes, preview and cross-window audience state | `Screen/{PresenterView,AudienceView,BottomThumbnails,SlideThumbnails}.vue`; screen store | `ScreenViews.tsx`; `ScreenThumbnails.tsx`; `ScreenView.tsx`; broadcast-channel protocol | complete |
| Countdown timer behavior and lifecycle | `Screen/CountdownTimer.vue` | `ScreenCountdownTimer.tsx`; source-sized moveable panel | complete |
| Writing board tools, drawing, clear/undo and overlay lifecycle | `Screen/WritingBoardTool.vue`; `components/WritingBoard.vue` | `ScreenWritingBoard.tsx`; Dexie-backed per-slide storage | complete |
| Fullscreen/presenter/audience geometry, keyboard, focus, cleanup and visual parity | all files above | source-sized screen CSS, tooltip/context-menu primitives, exact two-window lifecycle | complete |

Slice 5 evidence: `tests/gate6/slideshow-parity.spec.ts` runs 13 substantive
two-sided journeys against the Vue and React products. It proves every editor
launch route and its from-start/from-current semantics; manual, Escape and
external fullscreen teardown; all transition modes including the source's
fresh random-mode resolution; keyboard, wheel and touch navigation; autoplay,
looping and throttled boundary notices; grouped/meantime/automatic element
animations, out-state persistence, recursive attention revocation and the
played/unplayed previous-slide rule. The 63-slide fixture exercises the
source's 50/+20/600ms staged renderer in all-slide, bottom-strip and presenter
surfaces.

The presenter, notes, context menu, timer and pen positions are compared at
exact geometry. Timer evidence covers editable countdown fields, validation,
reset-at-zero, the 600:01 count-up stop, pause state, close and viewport drag
clamps. Drawing evidence opens and raster-compares every manual popover,
changes modes/colors/blackboard, draws deterministic shape pixels, compares
the complete canvas data URL, proves per-slide Dexie restore, then clears and
closes. A real popup audience window receives the complete deck and animation
state, navigation, identical drawing bytes and blackboard state, the exact
laser bitmap/coordinates, and the exit broadcast.

Link evidence covers slide links, bound web links and native anchors while
checking fullscreen ownership. Media evidence mounts native audio/video only
for the current slide, exercises autoplay, play/pause, duration/time, speed,
loop, touch volume, ended-loop restart, error UI/notices, unmount and remount.
All asserted slideshow, toolbar, context-menu, presenter, audience, timer,
popover, canvas, media-control, laser and notice rasters are zero-pixel
different. The journeys exposed and closed an audience full-height wrapper
omission, Strict-Mode-only initial presenter auto-scroll, the writing-board
divider color, and the native video loop-label alignment. Full slice result:
**13/13 passed**. Presentation-core and web TypeScript checks, type-aware lint,
and the production build pass after the slice.

## Slice 6 — mobile editor and preview

| Contract | Vue source inventory | React/shared destination | Status |
| --- | --- | --- | --- |
| Mobile route/device switching and preview/editor mode lifecycle | `Mobile/index.vue`; `App.vue`; device detection | `MobileView.tsx`; `mobile-device.ts`; `FoundationPage.tsx` | complete |
| Mobile thumbnails, preview, player and navigation | `Mobile/{MobileThumbnails,MobilePreview,MobilePlayer}.vue`; `useLoadSlides.ts` | `Mobile{Thumbnails,Preview,Player}.tsx`; staged renderer hook | complete |
| Mobile editor header, slide toolbar, element toolbar and editing operations | `Mobile/MobileEditor/*`; shared element components and hooks | `MobileEditor.tsx`; `MobileElementToolbar.tsx`; shared editor runtime and rich-text engine | complete |
| Touch gestures, selection/operate layer, media, keyboard and viewport behavior | mobile files plus shared drag/scale/rotate hooks | mobile interaction profile in `EditorCanvas.tsx`; shared renderer/selection geometry | complete |
| Mobile geometry, state, cleanup, responsive breakpoints and visual parity | all files above plus Button/Tabs/Popover/ColorPicker/Sortable styles | source-sized mobile CSS, exact mount-time sizing and two-sided raster/state journeys | complete |

Slice 6 evidence: `tests/gate6/mobile-parity.spec.ts` runs 14 substantive
two-sided journeys under an emulated iPhone touch/user-agent contract. It proves
the complete preview and menu raster, the source 50/+20/600ms staged-loading
schedule, rotated player geometry, transition classes, overlay lifecycle,
thumbnail navigation, horizontal and vertical swipe semantics, and exit/re-entry
state reset. It also proves that device routing depends on the source user-agent
regular expression rather than viewport width.

The editor journeys compare the fitted canvas and every rendered element,
header, notes, action toolbar and thumbnails; exact document/selection/history
state after notes, slide create/duplicate/delete, text/shape/image insertion,
undo/redo, selection, copy/delete, all four layer commands and all six slide
alignments; and trusted-touch drag with live alignment guides, resize and
rotation. Text evidence executes every mobile rich-text toggle, font-size and
alignment command plus preset/custom text and fill colors. The custom color
popover has exact geometry and differs by at most one independently
antialiased border pixel (maximum raw channel delta six); its saturation, hue,
alpha, field, theme, gradient and standard-preset surfaces are otherwise
zero-pixel different.

Element-type coverage separately exercises line, image, chart, table, equation,
video and audio enablement, resize/rotation handles, no-properties states, text
color/fill mutations and history. It exposed and closed the missing 2.1px color
grid row spacing and the shared table handle error (the source allows only left
and right resize). A real 800ms delayed touch drag proves Sortable DOM order,
focused slide, section-compatible presentation order, unchanged history,
numbering and post-drop raster. Adversarial journeys prove the source's
mount-time preview/player/canvas sizing through viewport changes and prevent
desktop Delete, paste, wheel, blank-double-click and custom context-menu routes
from leaking into mobile while retaining native ProseMirror keyboard input.
Full slice result: **14/14 passed**.

Gate 6 exit regression: all **74/74** two-sided Playwright journeys passed in
one deterministic worker. The web TypeScript build, 31 editor-geometry unit
tests, type-aware lint, production build, and `git diff --check` also pass.

## Exit rule

Gate 6 closes only after every row above is complete, all reference journeys run
against both applications, React is sufficient for daily development without a
Vue workflow fallback, and Gates 1–5 remain green. Gate 7 may not begin before
that evidence exists.
