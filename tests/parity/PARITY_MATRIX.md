# Vue to React parity matrix

Status: **Gates 1–8 complete**. React is the sole production frontend. No row
was closed from presence checks or React-only tests.

`Reference` means the frozen compiled Vue oracle has a repeatable contract.
The oracle is test-only and immutable; it is not a source tree or production
application.

| Priority | Surface | Reference contract | React parity | Evidence |
| --- | --- | --- | --- | --- |
| P0 | Desktop app loads | Automated | Automated | Vue shell assertions/console guard plus complete React desktop workflow and production-preview suites |
| P0 | Initial document state | Automated | Core/state adapter automated | normalized development bridge snapshot; 15 Vue/core operation contracts; transaction tests |
| P0 | Settings opens/closes | Automated | Foundation automated | Vue interaction/component screenshot; React browser component + E2E |
| P0 | Slide navigation | Automated | Read-only automated | Vue reference selection; React four-slide selection E2E/browser test |
| P0 | Read-only slide rendering | Automated | Automated | exact element inventories and 3.5% anti-aliasing pixel gate across 7 shared slides |
| P0 | Presentation title editing | Automated | Automated | Gate 6 real header edit/fallback flow, exact document state, history, geometry, focus, and raster |
| P0 | Slide creation | Automated | Automated | Gate 6 thumbnail add/split-menu/template/duplicate/delete journeys with exact state, selection, history, and rail geometry |
| P0 | Text create/edit | Automated | Automated | Gate 4 substrate plus Gate 5's complete ProseMirror, inspector, floating-toolbar, style, position, animation, focus, AI-writing compatibility, state, history and visual contracts |
| P0 | Shape/image/line create/edit | Automated | Automated | Gate 4 substrate plus Gate 5 exhaustive creation, drawing, crop, replacement, inspector, floating-toolbar, painter, state, history and visual contracts |
| P0 | Select, drag, resize, rotate | Automated | Automated | shared contracts cover source selection state machine, every Gate 4 handle inventory, per-type geometry, snapping, guide chrome, modifier timing, state, history, and raster evidence |
| P0 | Multi-select/group/align/layer | Automated | Automated | shared contracts cover active group members, multi transforms, all canvas align/layer commands, group atomicity, grouping/ungrouping/locking, keyboard/menu eligibility, state, and history |
| P0 | Clipboard and undo/redo | Automated | Automated | exact AES element payload passes Vue→React and React→Vue; slide/text/URL/SVG/image/audio/video inputs, IDs/groups, native routing, 300ms keyed history, cap, truncation, and restoration are shared contracts |
| P0 | PPTX import/export | Automated + corpus | Automated + corpus | Gate 6 real native PPTX import and editable/image PPTX export; Gate 7 nine-deck exact state/render/package/round-trip corpus |
| P0 | JSON/native import/export | Automated | Automated | Gate 6 append/replace/error imports and exact JSON/encrypted-PPTIST payload exports through real dialogs |
| P1 | Tables/charts/LaTeX | Automated | Automated | shared renderer fixtures plus complete Gate 5 table, chart, equation and symbol editing contracts |
| P1 | Audio/video | Automated | Automated | shared static media fixture plus complete Gate 5 creation, playback, inspector and history contracts |
| P1 | Notes/search/selection/markup panels | Automated | Automated | Gate 6 comments/replies/targeting, remarks, search/replace, selection/layer, markup and panel lifecycle/state/visual journeys |
| P1 | Theme/design/viewport | Automated | Automated | Gate 6 backgrounds, gradients, theme colors/fonts/extraction, viewport presets/custom validation, application scopes, history and rasters |
| P1 | Animations/transitions | Automated | Automated | Gate 5 complete element-animation editing plus Gate 6 all slide transitions, slideshow timing and source quirks |
| P1 | Slideshow/presenter | Automated | Automated | Gate 6 full screening, presenter/audience window, navigation, media, links, countdown, writing board, lifecycle and zero-pixel journeys |
| P1 | Mobile editor/preview | Automated | Automated | Gate 6 iPhone preview/player/editor, gestures, element operations, delayed reorder, device routing and responsive lifecycle journeys |
| P1 | English/Chinese UI | Automated | Automated | shared catalogs plus Gate 6 header/settings/shortcut locale switching, persistence, document-language, complete English/Chinese chrome |
| P1 | Keyboard/focus/accessibility | Automated | Automated | Gates 4–6 canvas, rich-text, panel, modal, menu, slideshow and mobile shortcut/focus/semantic-control contracts |
| P1 | Large-deck performance | Automated | Automated + production | Gate 2 120 slides/4,800 elements and 10,000 pointer updates; Gate 7 production startup/bundle/heap/listener/45-navigation budgets |

The frozen build and production-runtime measurements live in
`tests/parity/baselines/`. Gate 7 adds complete-product Vue/React production
reports, while the earlier foundation/Gate 2/Gate 3/Gate 4 reports retain their
historical slice scope. See `doc/PARITY_BASELINE.md`,
`doc/REACT_FOUNDATION.md`, `doc/REACT_GATE_2.md`, `doc/REACT_GATE_3.md`,
`doc/REACT_GATE_4.md`, the Gate 4–6 ledgers, and
`doc/GATE_7_STABILIZATION_LEDGER.md`, and
`doc/GATE_8_CUTOVER_LEDGER.md` for evidence and interpretation rules.

## Evidence rules

- State contracts normalize only generated identifiers and timestamps explicitly named by the test.
- Visual changes require reviewed screenshot diffs; snapshot updates are never automatic in CI.
- A UI assertion alone does not prove document parity. Editing flows need the resulting normalized document state.
- Import/export parity also requires element counts/types, warnings, and round-trip checks against the PPTX corpus.
- Performance is compared at the same viewport, browser, font set, production mode, and representative deck.
