# React migration Gate 4: editing substrate

Status: complete, interaction and parity gates passed 2026-07-19.

Gate 4 adds the framework-neutral editing substrate on top of the Gate 3 React renderer. The renderer still owns the only presentation element tree. Selection handles and hit targets are an overlay; there is no React-only document model and no second visual implementation for editable mode.

## Delivered interaction surface

The React editor now supports:

- current-slide focus, element selection, group selection, additive selection, and lasso selection;
- fit scaling, zoom, pan, coordinate conversion, canvas focus, ruler, and grid sizes;
- pointer capture for drag, resize, rotation, cropping, lasso, pan, and create gestures;
- group-preserving drag, rotated-element bounds, anchored resize, 45-degree rotation snapping, alignment guides, and canvas/element snapping;
- text, rectangle, and line creation from keyboard tools, plus double-click text creation;
- image crop mode with independent crop handles;
- arrow-key nudging, Shift nudging, select all, cut/copy/paste, quick duplicate, delete, grouping, ungrouping, locking, layer movement, zoom reset, undo, and redo;
- a versioned Mona clipboard payload that assigns fresh element and group IDs when pasted;
- one history entry per semantic edit, including multi-element operations.

High-frequency pointer coordinates live in `editor-interactions` and are exposed to React through `useSyncExternalStore`. They do not dispatch presentation or Redux updates. A completed gesture produces one `presentation-core` transaction through the editor runtime.

## Context-menu parity correction

The first Gate 4 menu was an explicit test scaffold and exposed invented insert actions. It has been removed. The React menus now follow PPTist's common action structure and all visible actions have working transaction handlers:

- canvas: Paste, Select all, ruler, grid toggle and sizes, and Reset slide;
- unlocked element: Cut, Copy, Paste, horizontal/vertical canvas-alignment submenus, front/back layer submenus, web/slide Set link, Group/Ungroup, Select all, Lock, and Delete;
- locked element: Unlock only.

The corrected menu preserves PPTist's submenu and shortcut-label shape. Group alignment uses the complete selected bounds so members keep their relative positions. Grouping makes selected layers contiguous before assigning the group ID. Layer controls are disabled for an ungrouped multi-selection, locking clears selection, unlocking restores the group selection, and link-dialog or menu completion restores canvas keyboard focus.

The canvas bubble-menu preference and slideshow command are intentionally absent rather than mocked: both belong to the Gate 6 workflow surfaces. Element-specific floating toolbars, rich-text editing, image controls, and chart/table editors belong to Gate 5. Those boundaries are recorded here so a test placeholder cannot silently become product behavior.

## Architecture and browser contracts

The common geometry functions are framework-neutral and unit-tested in `packages/editor-interactions/src/geometry.ts`. `EditorRuntime` owns clipboard state, transactions, selection commands, and undo/redo snapshots. Redux owns canonical presentation/session state; component-local state is limited to transient menu and link-dialog drafts.

React reads the pointer controller through the official external-store contract. Pointer capture follows the browser API so a gesture completes even when the pointer leaves its handle. Clipboard writes use the native Clipboard API when permitted and retain an in-memory Mona payload as the deterministic editor fallback; clipboard parsing accepts only the versioned Mona shape.

Relevant implementation references:

- [React `useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore)
- [React event handling](https://react.dev/learn/responding-to-events)
- [MDN pointer capture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture)
- [MDN Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API)
- [MDN KeyboardEvent key values](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key)

## Verification record

The Gate 4 suite covers state output as well as visible UI:

- geometry unit tests cover group bounds, rotated bounds, snapping, resize anchoring, lasso containment, rotation angles, and coordinate conversion;
- runtime tests cover atomic commit/undo/redo, group-safe clipboard IDs, cut/select-all, and 10,000 pointer updates with zero Redux notifications followed by one commit notification;
- browser-component tests prove the renderer remains the same element tree beneath the editable overlay and verify keyboard tool activation;
- E2E tests cover selection, drag, resize, rotate, group alignment, group/ungroup, layer eligibility, lock/unlock, web and slide link persistence, native keyboard clipboard, delete/undo, create gestures, grid/ruler, image crop, lasso, zoom, and spacebar pan;
- Gate 3 structural and pixel comparisons remain unchanged and green because editing is an overlay;
- live in-app browser inspection confirms the corrected menu inventory, submenu chrome, selection overlay, and zero console errors.

All of the following pass:

- `npm run check:gate2-boundaries` and `npm run type-check:gate2`;
- `npm run test:gate2` — 34 framework-neutral core, state, interaction, and geometry tests;
- `npm run lint:react` and `npm run build:react`;
- `npm run test:react` — 23 unit and browser-component tests;
- `npm run e2e:react` — 5 React browser journeys, including 3 Gate 4 editing journeys;
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
| Complete build | 2,662,612 B / 542,249 B gzip |
| JavaScript | 1,173,821 B / 387,540 B gzip |
| Application CSS | 45,914 B / 9,113 B gzip |
| Complete fixture transfer | 388,729 B |
| First contentful paint, median | 48 ms |
| Full fixture chart-ready, median | 845.0 ms |
| Used JavaScript heap, median | 10 MB |

Against the Gate 3 read-only build, Gate 4 adds 79,660 raw bytes and 26,125 gzip bytes across the full artifact. The representative chart-ready median changes from 830.8 ms to 845.0 ms (1.7%); first contentful paint changes from 44 ms to 48 ms, and measured heap remains unchanged. The existing 531,460 B lazy ECharts chunk remains the largest file and is still loaded only for chart decks.

## Scope boundary and go decision

Gate 4 proves the common editor mechanics and transaction boundary. It does not claim that text, shapes, images, tables, charts, equations, audio, or video have their complete property editors. It also does not claim thumbnail reordering, templates, notes, animations, import/export dialogs, slideshow, or mobile parity.

Go to Gate 5 after the recorded suite and performance baselines are green. Gate 5 can port one complete editable element flow at a time without replacing the common interaction system or creating another mutation path.
