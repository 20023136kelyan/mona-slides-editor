# React migration blueprint

Status: accepted product direction and implementation plan, 2026-07-19.

## Decision

Mona Slides will become a React application. The existing Vue/PPTist application remains available during the migration as the behavioral and visual oracle, but it is not part of the final runtime.

This is an incremental replacement, not a big-bang rewrite and not a permanent Vue/React hybrid. A React slice replaces its Vue counterpart only after the slice passes the same structural, behavioral, visual, accessibility, import/export, and performance checks.

The product architecture remains unchanged by the framework migration:

- presentation data stays native and editable;
- the current PPTist document model and third-party engines are retained first;
- Excalidraw becomes the drawing-first intent surface;
- the agent edits through a versioned JavaScript presentation SDK, never through React state or UI automation;
- screenshots are inspection evidence, not presentation data.

## Why this procedure

React officially supports gradual adoption inside an existing project and describes moving React roots upward until a page is entirely React. The migration follows that incremental principle, combined with a side-by-side reference application and explicit replacement gates. See [Add React to an Existing Project](https://react.dev/learn/add-react-to-an-existing-project) and Martin Fowler's [Strangler Fig Application](https://martinfowler.com/bliki/StranglerFigApplication.html).

A direct `.vue` to `.tsx` translation would preserve the current framework coupling and provide no trustworthy way to detect behavioral drift. Instead, the migration separates presentation-domain behavior from framework adapters, establishes the tests that the current project is missing, and then replaces complete vertical slices.

## Non-negotiable constraints

1. **Parity before replacement.** The Vue implementation remains runnable until its React replacement passes the gate.
2. **One major variable at a time.** Do not change the UI framework, editor behavior, document schema, rendering engine, and styles in the same slice.
3. **No schema rewrite during the port.** Preserve the current `Slide`, `PPTElement`, and ordering semantics. Derived indexes are allowed; changing persisted data shape is a later project.
4. **No framework state in the domain.** Presentation mutations, validation, transactions, import/export, and the future agent SDK must be callable without Vue or React.
5. **No pointer-frequency React updates.** Raw pointer coordinates and drag frames stay in an interaction controller/ref-backed store. Canonical document state is committed at meaningful transaction boundaries.
6. **No Tailwind rewrite of proven canvas geometry until visual parity.** Tailwind and shadcn/ui are used immediately for the React shell and new surfaces. Ported editor styles initially preserve the existing CSS and class geometry.
7. **Stable releases only in production.** “Latest” means the newest compatible stable release that passes the complete gate, not an unpinned prerelease.
8. **No silent snapshot acceptance.** Visual baselines and parity fixtures are reviewed; CI never updates them automatically.
9. **The AI layer never depends on React internals.** It works through presentation-core transactions and the JavaScript SDK.
10. **Vue deletion is a deliverable, not an assumption.** It happens only at the cutover gate.

## Current migration surface

The repository is still close to upstream PPTist (`2bfd88fe`), which gives us a clean oracle. The current localization work is an intentional product change and becomes part of the reference behavior once it is committed.

Measured on 2026-07-19:

| Surface | Size |
| --- | ---: |
| Vue single-file components | 197 |
| Lines in Vue single-file components | 32,539 |
| Vue components under `src/views/Editor` | 93 |
| Shared Vue components under `src/components` | 44 |
| TypeScript files | 138 |
| TypeScript files directly importing Vue or Pinia | 70 |
| Vue components with style blocks | 180 |
| Vue components with scoped styles | 177 |
| Files with direct DOM/browser manipulation | 79 |
| Files using the global emitter pattern | 20 |
| Existing unit, component, E2E, or visual test suites | 0 |

The reactivity footprint is substantial: 519 `ref`, 414 `computed`, 125 `watch`, 110 `useTemplateRef`, 100 `onMounted`, and 72 `onUnmounted` occurrences. This is why the migration needs an explicit interaction and lifecycle audit instead of a mechanical syntax conversion.

The five Pinia stores are also deeply connected to the UI. `useSlidesStore` appears 235 times and `useMainStore` 212 times. Store replacement must therefore follow a domain boundary and selectors; it must not be a global search-and-replace.

See [REACT_MIGRATION_INVENTORY.md](./REACT_MIGRATION_INVENTORY.md) for the detailed dependency classification and risk map.

## Target platform

The target is a client-side React + TypeScript application built with Vite. The presentation editor does not benefit from server rendering, and its browser-only engines make a Vite SPA the simpler and more reliable boundary. A marketing site or hosted API may use a separate framework later without coupling the editor to it.

Version observations below are from the npm registry on 2026-07-19. They are candidates for the scaffold gate, not dependencies already installed in this repository.

| Layer | Candidate baseline | Rule |
| --- | --- | --- |
| Runtime | React and React DOM 19.2.7 | Use the latest stable React release, never `next`/canary in production. |
| Build | Vite 8.1.5 and `@vitejs/plugin-react` 6.0.3 | Use the current supported Vite minor; review every major migration guide. |
| Language | TypeScript 7.0.2 | Selected after the Gate 1 type/build check passed. Use Oxlint's TypeScript-7-native analysis instead of forcing the currently incompatible `typescript-eslint` parser. |
| Styling | Tailwind CSS and `@tailwindcss/vite` 4.3.3 | Use the first-party Vite plugin and CSS-first tokens. |
| Components | shadcn 4.13.1 | Components are copied source that Mona owns and reviews. Add only components the product uses. |
| Unit/component tests | Vitest 4.1.10 | Node tests for pure code; Browser Mode with the Playwright provider for browser components. |
| E2E/visual tests | Playwright 1.61.1 | Cross-browser journeys, traces, screenshots, and accessibility snapshots. |
| Localization | i18next 26.3.6 and react-i18next 17.0.10 | Reuse the current catalogs and locale behavior with typed selectors. |

Vite 8 requires Node 20.19+ or 22.12+ and supports modern React/TypeScript templates. The current development machine uses Node 24.13.1. See the [Vite guide](https://vite.dev/guide/) and [Vite releases policy](https://vite.dev/releases).

Tailwind v4 uses modern browser features and officially targets Chrome 111+, Safari 16.4+, and Firefox 128+. These become Mona's minimum editor browser versions unless product requirements later require a legacy build. See [Tailwind compatibility](https://tailwindcss.com/docs/compatibility) and the official [Vite installation](https://tailwindcss.com/docs/installation/using-vite).

shadcn/ui officially supports React 19, Tailwind v4, Vite, monorepos, and source-owned components. See the [Vite installation](https://ui.shadcn.com/docs/installation/vite) and [Tailwind v4 guide](https://ui.shadcn.com/docs/tailwind-v4).

### Dependency freshness policy

“Always current” is a process, not a floating version range:

1. At the start of every migration gate, check the official React, Vite, Tailwind, shadcn, TypeScript, Vitest, and Playwright release/migration documentation.
2. Record the date, selected versions, rejected prereleases, and compatibility exceptions in the gate pull request or ADR.
3. Install exact tested versions and commit the lockfile.
4. Let Dependabot or Renovate propose isolated updates after the scaffold exists.
5. Run the full parity and performance suite for infrastructure upgrades.
6. Merge patch/minor updates only after the gate passes; major upgrades require their migration guide and an explicit ADR.
7. Keep canary experiments on a separate non-production branch.

This follows Vite's own recommendation to update regularly while locking the current TypeScript-compatible minor rather than floating blindly.

## Repository shape during migration

Use npm workspaces without moving the Vue application on day one. This minimizes the first diff and preserves the current dev server as the oracle.

```text
mona-slides/
  src/                         current Vue reference application (temporary)
  apps/
    web/                       new React application
  packages/
    presentation-core/        document types, commands, transactions, validation
    presentation-runtime/     import/export, render and persistence adapters
    editor-state/             canonical state and framework-neutral selectors
    editor-interactions/      pointer/keyboard gesture controllers
    parity-fixtures/          shared decks, scenarios and normalization helpers
  tests/
    reference/                 Vue behavioral baselines
    parity/                    Vue-versus-React comparisons
    e2e/                       product journeys
```

During migration:

- the existing Vue application keeps its current root scripts;
- `apps/web` runs on a separate port and loads the same fixtures;
- packages are consumed by Vue first where practical, proving that extraction did not change behavior;
- feature flags or dedicated routes select a complete React slice for testing;
- the two frameworks do not share ownership of the same DOM subtree.

At cutover, the root becomes a workspace-only package, `apps/web` becomes the production application, and the Vue source/dependencies are removed. The temporary reference layout must not survive as production complexity.

## Target architecture

```text
React application shell
  | React Router, react-i18next, Tailwind tokens, shadcn/ui
  |
  +-- Editor React views
  |     | fine-grained selectors
  |     v
  +-- Canonical editor state (serializable)
  |     | typed domain transactions
  |     v
  +-- presentation-core (framework-free TypeScript)
  |     | validate / inspect / mutate cloned document
  |     +-- presentation-runtime adapters
  |     |     import, export, render, assets, Dexie
  |     +-- interaction controller
  |           transient pointer/drag/keyboard state
  |
  +-- Excalidraw (native React dependency)
  |     scene JSON + PNG
  v
Hosted agent service
  | JavaScript against the versioned Mona presentation SDK
  v
presentation-core transaction on a cloned deck
  | render / inspect / revise
  v
Apply one atomic editable-document transaction
```

### Presentation core

`presentation-core` is the most important migration boundary. It owns:

- the existing slide and element types, initially without schema changes;
- pure queries and derived indexes;
- typed mutation commands such as add/update/delete/group/align;
- explicit transaction boundaries and change metadata;
- validation and structural inspection;
- stable ID rules;
- serialization normalization for tests;
- a public adapter surface for the future JavaScript presentation SDK.

It does not own React components, DOM nodes, browser APIs, Pinia, Redux, model providers, or network calls.

The Vue app must consume extracted core operations before React does wherever feasible. If the Vue behavior changes after extraction, the extraction is not complete.

### Canonical state

Use Redux Toolkit as the initial canonical editor-state adapter, subject to the Gate 2 performance spike. It fits this product because presentation changes should be serializable, named, inspectable, reproducible, and testable; those same properties are useful for undo, bug reports, agent transactions, and DevTools. Redux Toolkit's Immer-backed reducers permit concise nested updates while producing immutable state. See the official [Redux Toolkit guidance](https://redux-toolkit.js.org/introduction/why-rtk-is-redux-today) and [Immer reducer documentation](https://redux-toolkit.js.org/usage/immer-reducers).

This does **not** mean that every value belongs in Redux:

| State kind | Owner | Examples |
| --- | --- | --- |
| Persisted presentation document | canonical store through domain transactions | slides, elements, theme, notes, animations |
| Editor session state | canonical store with narrow selectors | current slide ID, selection IDs, active tool, panel state |
| Transient gesture state | interaction controller and refs | current pointer, resize frame, lasso path, auto-scroll velocity |
| Component-local state | React component | an unopened menu's local highlight, draft input before commit |
| Server state | dedicated API/query adapter later | account, saved deck metadata, model jobs |

Do not normalize or redesign the persisted slide schema during the port. If selectors need fast element lookup, maintain derived `id -> element` indexes outside serialized deck data. React components subscribe only to the smallest required selector. The [React external-store API](https://react.dev/reference/react/useSyncExternalStore) is used for framework-neutral controllers that emit snapshots.

The Gate 2 spike must prove that Redux Toolkit can update a representative large deck without broad rerenders. If it fails the measured budget, change the adapter—not `presentation-core`—and record the replacement in an ADR.

### Transactions and undo

Every semantic operation has an explicit transaction boundary:

- a click selection is session state, not document history;
- a completed drag/resize/rotate gesture commits one document transaction;
- a multi-step toolbar edit is one transaction when the current behavior treats it as one action;
- an imported deck load is one replacement transaction;
- applying an AI result is one atomic transaction;
- discarding an AI result changes no live document state.

During extraction, retain the existing snapshot/Dexie history behind an adapter. Do not rewrite history and the UI framework in the same slice. A later history implementation may use domain changes or patches once parity exists.

### Interaction and rendering rules

Canvas code has stricter rules than ordinary React forms:

- event listeners must have stable cleanup and be covered by Strict Mode;
- do not attach one global listener per element;
- use passive wheel/touch listeners only when `preventDefault()` is not required;
- pointer-move handlers update refs/controller snapshots, not the presentation document on every event;
- commit semantic state at the end of a gesture;
- split independent subscriptions so one toolbar flag cannot rerender the whole canvas;
- dynamically import heavy, conditionally used surfaces such as Excalidraw, chart editors, export dialogs, and slideshow tools;
- profile before adding manual memoization; use the React Compiler for ordinary component memoization and explicit escape hatches only when measurements justify them.

React components and Hooks must remain pure, with side effects used only to synchronize external systems. The baseline is React [Rules](https://react.dev/reference/rules), [Strict Mode](https://react.dev/reference/react/StrictMode), and [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect).

### React Compiler

The React Compiler is stable and works with React 19. Vite 8's React plugin provides an explicit compiler integration. Enable it in the new React application from Gate 1 in default inference mode, with Oxlint's native Hooks/React Compiler analysis and Strict Mode enabled. This keeps TypeScript 7's native toolchain instead of forcing the unsupported `typescript-eslint <6.1` peer range. See the [React Compiler introduction](https://react.dev/learn/react-compiler/introduction), [Vite 8 React integration](https://vite.dev/blog/announcing-vite8), and [Oxlint built-in plugins](https://oxc.rs/docs/guide/usage/linter/plugins.html).

Compiler rules:

- write idiomatic, pure React first;
- do not blanket the port with `useMemo`, `useCallback`, or `memo` copied from automated advice;
- keep any `"use no memo"` escape hatch local, documented, and backed by a profiler trace;
- keep compiler rollout behind a build switch until the canvas performance gate passes;
- compare compiler-on and compiler-off traces for the first editing slice.

### Styling and component system

Tailwind and shadcn/ui expand Mona's component ecosystem, but they do not replace the specialized slide canvas.

Use shadcn/ui for:

- menus, popovers, tooltips, dialogs, sheets, drawers, settings, and account UI;
- form fields and validation;
- command palette and future agent chat controls;
- accessible base composition and semantic design tokens.

Keep custom editor primitives for:

- slide rendering and editable element layers;
- selection boxes, guides, rulers, resize/rotate handles, and lasso tools;
- rich-text, table, chart, media, and equation editor adapters;
- thumbnail rendering and slideshow composition.

Port existing editor SCSS/CSS with the same class names and computed geometry for the parity pass. New shell components use Tailwind v4 and CSS variables from the beginning. After the editor reaches visual parity, convert stable areas to Tailwind in small visual-regression-guarded changes.

Every shadcn component is source code in the repository. Before adding or updating one, inspect the official component docs and CLI diff, add only required components, and review the generated code. Preserve the current icon appearance during the parity port; choose the new default icon library only for new product surfaces until an intentional icon migration.

### Internationalization

Keep the current product rules:

- `en-US` remains the source and fallback locale;
- `zh-CN` remains the first secondary locale;
- French, Spanish, Italian, German, and Japanese remain planned;
- locale choice stays under `mona:ui-locale`;
- browser detection, lazy loading, `<html lang>`, and direction updates remain;
- presentation titles, slide text, notes, and imported document content are never auto-translated as UI.

Move the existing JSON catalogs unchanged into a framework-neutral package or `apps/web` resources. Replace Vue I18n with typed i18next/react-i18next integration and retain the catalog parity/static-string checks. Enable i18next's typed selector API so invalid keys fail TypeScript. See [i18next TypeScript](https://www.i18next.com/overview/typescript).

### Third-party engines

Do not replace proven engines while replacing Vue:

| Capability | Migration rule |
| --- | --- |
| Rich text | Keep raw ProseMirror packages and custom schema/plugins; replace only the Vue adapter. |
| Charts | Keep ECharts; replace only component lifecycle and resize bindings. |
| Persistence | Keep Dexie; move database calls behind runtime interfaces. |
| PPTX export | Keep PptxGenJS and current export behavior. |
| PPTX import | Keep `pptxtojson` and current normalization behavior. |
| Rasterization | Keep `html-to-image` until a separate, measured rendering decision. |
| Geometry/SVG/math | Extract existing framework-free utilities instead of rewriting them. |
| Drag/reorder | Replace `vuedraggable` only in the slice that owns thumbnails/reordering. |
| Icons | Preserve current visual output first; remove Vue icon tooling at cutover. |

Library upgrades that alter deck output need a separate fixture-based change after framework parity.

## Parity harness

No editor port begins until Gate 0 installs a trustworthy harness around Vue.

### Fixture layers

1. **Deterministic JSON fixtures:** one fixture per element type and interaction edge case.
2. **Real PPTX corpus:** native charts, corporate masters/themes, design-heavy slides, text/tables/notes, and stress decks.
3. **Operation scenarios:** normalized starting deck + named operation + normalized expected deck.
4. **Screenshot fixtures:** fixed viewport, fonts, browser, locale, scale, and disabled motion.
5. **Export fixtures:** PPTX/PDF/image output plus structural survival reports.

Private decks stay under a gitignored corpus directory. Public fixtures must have redistribution-safe provenance.

### Test layers

| Layer | Tool | Purpose |
| --- | --- | --- |
| Pure unit/contract | Vitest in Node | geometry, commands, validators, import/export normalization, transactions |
| Browser component | Vitest Browser Mode + Playwright provider | real DOM, CSS, focus, pointer and keyboard behavior for bounded components |
| E2E behavior | Playwright | complete user journeys against Vue and React |
| Visual | Playwright screenshots | deterministic Vue baseline and React comparison |
| Accessibility structure | Playwright ARIA snapshots + targeted assertions | roles, names, focus order, keyboard operability |
| Performance | Playwright traces + browser performance marks | launch, interaction, rendering, export, memory and bundle budgets |

Vitest recommends Browser Mode for accurate DOM/CSS/event behavior, and Playwright provides deterministic screenshot comparison and trace inspection. See [Vitest Browser Mode](https://vitest.dev/guide/browser/), [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots), and [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer).

### Required reference journeys

Gate 0 must capture at least:

- launch from the default deck and restore from persistence;
- create, duplicate, reorder, and delete slides;
- select one/many/grouped elements and clear selection;
- create and edit text, shape, image, line, table, chart, LaTeX, audio, and video;
- drag, resize, rotate, crop, align, distribute, group, ungroup, layer, lock, and hide;
- clipboard, undo/redo, keyboard shortcuts, context menus, and focus transitions;
- zoom, pan, ruler, guides, grid, thumbnails, notes, search, and settings;
- theme, viewport ratio, animations, transitions, and slideshow/presenter behavior;
- import JSON/PPTX and export PPTX/PDF/images/JSON;
- English and Chinese UI, mobile preview/editor, and error/empty states.

Each journey uses stable test hooks where roles or labels cannot identify canvas-only affordances. Test hooks describe product concepts, not component implementation.

### Gate thresholds

Initial thresholds are calibrated from Gate 0 measurements and then frozen in CI:

- normalized state after a scenario must match exactly, excluding explicitly normalized IDs/timestamps;
- element counts, types, order, IDs, theme, notes, animations, and warnings must match exactly for import/export fixtures unless an approved compatibility delta is recorded;
- screenshots use a fixed container image/browser/font environment and a small reviewed pixel tolerance; no full-slide difference is auto-approved;
- pointer interaction must remain visually continuous and meet the baseline p95 event/frame budget;
- launch, first-canvas render, thumbnail generation, import, export, memory, and production bundle budgets may not regress beyond the slice's approved allowance;
- no new console error, unhandled rejection, listener leak, or Strict Mode cleanup warning;
- keyboard shortcuts, focus order, accessible names, and disabled states must remain equivalent.

“Looks right on my machine” is not a gate.

## Migration gates

Only one gate is active at a time. A gate ends with a runnable artifact, tests, measurements, and an explicit go/no-go decision.

### Gate 0 — freeze and measure the oracle

Status: **complete** (`2c155c25`, tag `mona-vue-baseline-2026-07-19`).

Deliverables:

1. Commit the current intended Vue/localization state after review.
2. Tag upstream `2bfd88fe` and the Mona Vue baseline separately.
3. Add the fixture directories and private-corpus ignore rule.
4. Add Playwright reference journeys and deterministic screenshot setup.
5. Add operation-state capture/normalization helpers.
6. Record current bundle sizes and performance traces.
7. Publish the initial parity matrix.

Exit: the current Vue product can be rebuilt and its critical behavior is reproducibly measured. **This is the first implementation step.**

### Gate 1 — React foundation, no editor replacement

Status: **complete** (`07b6b42b`).

Deliverables:

1. Add npm workspaces and `apps/web` without relocating Vue.
2. Scaffold React 19 + TypeScript + Vite with Strict Mode, type-aware Oxlint, and React Compiler.
3. Add Tailwind v4 tokens and initialize shadcn/ui with a documented preset/base choice.
4. Add React routing/error boundaries/lazy boundaries.
5. Port i18n runtime and render a small shell/settings surface from the same catalogs.
6. Add Vitest Node, Vitest Browser Mode, and Playwright projects.
7. Add bundle analysis and production source-map policy.

Exit: both applications run, build, type-check, lint, and test; no editor behavior has moved.

### Gate 2 — extract domain and state boundaries

Status: **complete**, including the pre-Gate 3 boundary and visual audit. Evidence and go decision: [REACT_GATE_2.md](./REACT_GATE_2.md).

Deliverables:

1. Extract slide types, pure queries, validation, IDs, and mutations into `presentation-core`.
2. Make Vue consume the extracted operations with no state/visual delta.
3. Define named document transactions and history adapter contracts.
4. Add Redux Toolkit adapter and fine-grained selectors in isolation.
5. Add transient interaction-controller prototype.
6. Benchmark a representative large deck and a high-frequency drag prototype.

Exit: the same operation fixtures pass through Vue and the new core; state architecture meets performance budgets.

### Gate 3 — read-only React renderer

Port in dependency order:

1. slide background and viewport;
2. text and shape elements;
3. images and lines;
4. tables, charts, LaTeX, audio, and video;
5. groups, transforms, shadows, gradients, masks/crops;
6. thumbnails.

Reuse existing render engines and styles. Compare each element fixture against Vue before moving to the next type.

Exit: representative JSON and imported decks render within the approved visual tolerance with equivalent structure and no editing enabled.

### Gate 4 — editing substrate

Port the common interaction system before feature panels:

1. current slide and selection model;
2. zoom, pan, coordinate conversion, and canvas focus;
3. pointer capture, lasso, guides, snapping, ruler, and grid;
4. drag, resize, rotate, crop, and multi-selection transforms;
5. keyboard shortcuts, clipboard, context menu, and undo/redo;
6. create-element gesture controller.

Exit: the interaction fixture deck can be edited with state, visual, keyboard, and performance parity.

### Gate 5 — editable element vertical slices

Port complete user flows, not component folders:

1. text + ProseMirror + text toolbar;
2. shapes + lines + drawing tools;
3. images + crop/filter/mask + image library;
4. tables + merged/styled cells;
5. charts + data editor + theme controls;
6. LaTeX + symbols;
7. audio/video;
8. groups, layers, alignment, distribution, format painter.

Each slice includes renderer, editor, toolbar/panels, commands, history, tests, and exports.

Exit: every native element type is editable and passes its full parity row.

### Gate 6 — presentation workflows and secondary surfaces

Port:

- thumbnails, templates, sections, notes, selection/search/markup panels;
- slide design, theme extraction, viewport size, transitions, and animations;
- all import/export dialogs and progress/error states;
- slideshow, presenter view, countdown, writing board, and mobile surfaces;
- settings and localized application chrome.

Exit: all reference journeys run against React and the Vue fallback is no longer needed for daily development.

### Gate 7 — corpus, performance, and stabilization

Run the full real-deck corpus and stress fixtures. Fix fidelity regressions, listener leaks, long tasks, broad rerenders, chunking problems, memory growth, and browser differences. Exercise production builds, not only HMR.

Exit: React meets or improves the frozen Vue budgets and no P0/P1 parity row is open.

### Gate 8 — cutover and Vue removal

1. Make `apps/web` the production entry.
2. Keep a release-level fallback only for the agreed stabilization window.
3. Remove Vue, Pinia, Vue I18n, Vue plugins, `.vue` sources, and migration-only bridges.
4. Remove the fallback after telemetry and regression tests are clean.
5. Rebaseline documentation and dependency ownership.

Exit: one React production application remains; the complete parity suite continues to run without Vue.

### Gate 9 — Mona agent and drawing-first product loop

The migration creates the correct foundation for the product novelty:

1. integrate Excalidraw directly in React;
2. implement the framework-free `PresentationSession` clone/validate/apply flow;
3. expose the JavaScript presentation SDK over `presentation-core`;
4. add render/inspect/revise agent tools;
5. add Text/Draw input switching and before/apply/discard UI;
6. connect supported hosted model-provider adapters.

The agent work can begin earlier only when the required core/render/editing gates already exist; it must not create a second document model or temporary comment-command pipeline.

## Per-slice operating procedure

Every slice uses the same loop the user requested: research, implement, verify, record.

1. **Inventory:** identify the Vue components, stores, utilities, DOM assumptions, styles, and third-party APIs in the slice.
2. **Research:** read the current official React and dependency documentation relevant to that slice. Record links and version assumptions in the issue/ADR.
3. **Contract:** write or extend reference behavior, operation, visual, accessibility, and performance tests before the React implementation.
4. **Extract:** move framework-free behavior into a package and make Vue use it first when practical.
5. **Implement:** port one vertical capability using idiomatic React and the existing engines.
6. **Verify locally:** type-check, lint, unit, browser component, E2E, visual, import/export, and performance checks as applicable.
7. **Compare:** run Vue and React on the same fixture and inspect both the pixels and normalized state.
8. **Review dependencies:** inspect generated shadcn source, bundle impact, licenses, and new transitive packages.
9. **Record:** update the parity matrix, inventory, migration notes, and any ADR.
10. **Replace:** route users to the React slice only after the gate is green.

No slice is considered finished because it compiles.

## Pull-request and commit discipline

- Do not mix a dependency major upgrade with a feature port.
- Do not mix large style conversion with lifecycle/state conversion.
- Keep extraction commits behavior-preserving and independently revertible.
- Keep generated shadcn additions separate from product customization when practical.
- Attach before/after screenshots, normalized state diffs, and performance traces to editor-slice reviews.
- Require a parity-matrix update for every replaced Vue surface.
- Keep production dependency additions justified in the migration inventory.

## Definition of complete

The React migration is complete only when:

- all production routes and surfaces run in React;
- every critical reference journey is green;
- real-deck import/export reports are equal or have approved documented improvements;
- visual differences are reviewed and accepted intentionally;
- interaction and launch performance meet the frozen budgets;
- English and Chinese catalogs and behavior match the reference;
- mobile, slideshow, presenter, and export surfaces are covered;
- Vue, Pinia, Vue-specific build plugins, and migration bridges are removed;
- the AI/Excalidraw architecture can call the same framework-free presentation core used by the editor.

Until then, this is an active migration, not a finished rewrite.
