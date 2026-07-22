# React migration Gate 4: editing substrate

Status: **complete — 46 shared Vue/React contracts green**.

The earlier 2026-07-19 completion claim was withdrawn because it used React-only
functional tests as parity evidence. Gate 4 was subsequently re-audited from the
Vue source, corrected, and closed on 2026-07-20 only after the same 46 contracts
passed against both applications. The authoritative row-by-row evidence is in
[GATE_4_PARITY_LEDGER.md](./GATE_4_PARITY_LEDGER.md).

Gate 4 adds the framework-neutral editing substrate on top of the Gate 3 React renderer. The renderer still owns the only presentation element tree. Selection handles and hit targets are an overlay; there is no React-only document model and no second visual implementation for editable mode.

## Delivered interaction surface

The React editor now supports:

- current-slide focus, element selection, group selection, additive selection, and lasso selection;
- fit scaling, zoom, pan, coordinate conversion, canvas focus, ruler, and grid sizes;
- pointer capture for drag, resize, rotation, cropping, lasso, pan, and create gestures;
- group-preserving drag, a five-unit drag activation dead zone, rotated-element bounds, anchored resize, 45-degree rotation snapping, alignment guides, and canvas/element snapping;
- text, rectangle, and line creation from keyboard tools, plus double-click text creation;
- image crop mode with independent crop handles;
- arrow-key nudging, Shift nudging, select all, cut/copy/paste, quick duplicate, delete, grouping, ungrouping, locking, layer movement, zoom reset, undo, and redo;
- PPTist's exact AES-encrypted element and slide clipboard payloads, including cross-runtime Vue→React and React→Vue reads and fresh IDs/groups on paste;
- one history entry per semantic edit, including multi-element operations;
- a real ProseMirror editing surface backed by the same framework-neutral schema and plugins as Vue, with source-equivalent focus, drag, local-history, debounce, and empty-text behavior.

High-frequency pointer coordinates live in `editor-interactions` and are exposed to React through `useSyncExternalStore`. They do not dispatch presentation or Redux updates. A completed gesture produces one `presentation-core` transaction through the editor runtime.

## Context-menu parity correction

The first Gate 4 menu was an explicit test scaffold and exposed invented insert actions. It has been removed. The React menus now follow PPTist's common action structure and all visible actions have working transaction handlers:

- canvas: Paste, Select all, ruler, grid toggle and sizes, and Reset slide;
- unlocked element: Cut, Copy, Paste, horizontal/vertical canvas-alignment submenus, front/back layer submenus, web/slide Set link, Group/Ungroup, Select all, Lock, and Delete;
- locked element: Unlock only.

The corrected menu preserves PPTist's submenu and shortcut-label shape. Group alignment uses the complete selected bounds so members keep their relative positions. Grouping makes selected layers contiguous before assigning the group ID. Layer controls are disabled for an ungrouped multi-selection, locking clears selection, unlocking restores the group selection, and link-dialog or menu completion restores canvas keyboard focus.

The canvas bubble-menu preference and slideshow command are intentionally absent rather than mocked: both belong to the Gate 6 workflow surfaces. Element-specific floating toolbars, complete rich-text/property controls, image controls, and chart/table editors belong to Gate 5. Those boundaries are recorded here so a test placeholder cannot silently become product behavior.

## Architecture and browser contracts

The common geometry functions are framework-neutral and unit-tested in `packages/editor-interactions/src/geometry.ts`. `EditorRuntime` owns clipboard state, transactions, selection commands, and undo/redo snapshots. Redux owns canonical presentation/session state; component-local state is limited to transient menu and link-dialog drafts.

React reads the pointer controller through the official external-store contract.
Pointer capture follows the browser API so a gesture completes even when the
pointer leaves its handle. Clipboard writes use the native Clipboard API when
permitted and retain an in-memory copy as the deterministic editor fallback.
Parsing follows PPTist's source order and accepts its exact encrypted
element/slide format plus the same plain-text, URL, SVG, image, audio, and video
inputs.

Relevant implementation references:

- [React `useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore)
- [React event handling](https://react.dev/learn/responding-to-events)
- [MDN pointer capture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture)
- [MDN Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API)
- [MDN KeyboardEvent key values](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key)

## Verification record

`npm run parity:gate4` is the Gate 4 exit suite. Its 46 Playwright contracts use
one fixture and equivalent browser inputs against the Vue reference and React
port. They compare normalized presentation/session state, raw source geometry,
DOM/control inventories, computed style, focus and native-event routing,
clipboard/history state, and isolated raster captures. The suite passed 46/46 in
2.8 minutes after the final live-state interaction correction.

The following prerequisite and maintenance checks are also green. They guard the
port but do not replace the two-sided exit suite:

- `npm run check:gate2-boundaries` and `npm run type-check:gate2`;
- `npm run test:gate2` — 38 framework-neutral core, state, interaction, and geometry tests;
- `npm run lint:react` and `npm run build:react`;
- `npm run test:react` — 59 unit and browser-component tests;
- `npm run e2e:react` — 6 React browser journeys, including 4 Gate 4 editing journeys;
- `npm run parity:gate3` — both frozen structural/pixel parity decks;
- `npm run parity:reference` — 7 Vue oracle tests and screenshots;
- `npm run build` — Vue type-check, localization check, and production oracle build;
- `git diff --check`.

`npm audit --omit=dev` reports the same seven inherited production dependency families (Axios, ECharts, follow-redirects, form-data, image-size, Lodash, and Nano ID). Gate 4 adds no third-party production package. Those advisories require isolated dependency/output-parity work rather than being silently mixed into the framework port.

## Performance and bundle evidence

Production evidence is frozen in:

- `tests/parity/baselines/react-gate4-build.json`
- `tests/parity/baselines/react-gate4-runtime.json`

At the final production build:

| Metric | Gate 4 result |
| --- | ---: |
| Complete build | 3,033,311 B / 657,908 B gzip |
| JavaScript | 1,531,079 B / 500,936 B gzip |
| Application CSS | 59,198 B / 11,333 B gzip |
| Complete fixture transfer | 504,812 B |
| First contentful paint, median | 40 ms |
| Full fixture chart-ready, median | 844.6 ms |
| Used JavaScript heap, median | 11.9 MB |

Against the Gate 3 read-only build, the completed Gate 4 adds 450,359 raw bytes
and 141,784 gzip bytes across the full artifact, including the actual ProseMirror
engine and complete editor substrate. The representative chart-ready median
changes from 830.8 ms to 844.6 ms (1.7%), while first contentful paint changes
from 44 ms to 40 ms. Measured heap rises from 10 MB to 11.9 MB. The 531,466 B
lazy ECharts chunk remains separately loaded for chart decks; the 566,688 B
editor page chunk is now the largest file and is a Gate 7 code-splitting target.

## Scope boundary and current decision

Gate 4 proves the common editor mechanics and transaction boundary. It does not claim that text, shapes, images, tables, charts, equations, audio, or video have their complete property editors. It also does not claim thumbnail reordering, templates, notes, animations, import/export dialogs, slideshow, or mobile parity.

**Go for Gate 5.** Every Gate 4 ledger row is backed by a passing shared
Vue/React contract, with reviewed geometry/computed-style/raster evidence for
visual surfaces. This decision does not pre-approve any Gate 5 element toolbar,
property panel, or Gate 6 workflow.
