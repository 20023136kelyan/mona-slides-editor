# React migration Gate 2: domain and state boundaries

Status: complete, go decision recorded 2026-07-19.

Gate 2 changes no intended pixels or editor behavior. It moves the existing presentation schema and mutations behind framework-neutral contracts, proves the Vue oracle can consume them unchanged, and measures the state design intended for React and the future agent SDK.

## Delivered boundaries

| Package | Ownership | Framework dependencies |
| --- | --- | --- |
| `@mona/presentation-core` | persisted slide/element model, queries, IDs, validation, immutable commands, atomic transactions, history contract, normalization | none |
| `@mona/editor-state` | isolated Redux Toolkit adapter, editor-session state, transaction reducer, fine-grained selectors, derived element index | no React or Vue |
| `@mona/editor-interactions` | pointer-frequency gesture snapshots and semantic completion result | none |
| `@mona/parity-fixtures` | deterministic operation fixtures and representative large deck | none |

`src/types/slides.ts` remains as a compatibility export so the Vue code keeps its established import path while the actual persisted schema is owned by `presentation-core`. The schema itself was moved without redesign.

Every existing `useSlidesStore` action now delegates to a named core command. Current Vue callers, Pinia state shape, history timing, import/export engines, renderers, component CSS, and canvas geometry remain unchanged. The primary slide, element, group, table-cell, animation, import, and section ID paths also use the core ID policy while preserving their existing lengths.

## Transaction and history rules

Core commands are immutable and return explicit affected-slide/affected-element metadata. A `PresentationTransaction` has an ID, label, origin, and ordered commands. The transaction runner applies commands to a candidate state, validates the result, and either returns the entire new document or rejects it with the original document untouched.

The isolated Redux reducer accepts only complete presentation transactions. This is the future boundary for user actions and agent-generated JavaScript changes. The Vue adapter uses the same commands directly so Gate 2 does not change current history timing or add validation failures to existing user flows.

The `PresentationHistoryAdapter` contract wraps initialize, commit, undo, and redo responsibilities. The existing Dexie snapshot implementation remains in place during the port; replacing history storage while replacing the framework is explicitly deferred.

## State ownership proof

The Redux adapter keeps persisted presentation data separate from editor-session state. Selectors subscribe to the smallest stable inputs, and the derived element index is not serialized. Tests prove:

- a target element update changes only its slide while unrelated slide and element references remain stable;
- title-only changes do not rebuild the element index;
- an invalid transaction does not change the live presentation;
- selection and handle state remain session data rather than document data.

Pointer-frequency state never enters Redux. `editor-interactions` exposes cached `getSnapshot()` and `subscribe()` functions compatible with React's external-store contract, then returns one semantic completion at gesture end. This follows the official React [`useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore) contract. Redux Toolkit uses the official [`configureStore`](https://redux-toolkit.js.org/api/configureStore), [`createSlice`](https://redux-toolkit.js.org/api/createSlice), and memoized-selector guidance from [Deriving Data with Selectors](https://redux.js.org/usage/deriving-data-selectors).

## Contract and parity evidence

`npm run test:gate2` runs 25 tests:

- 5 presentation-core mutation/query/validation/transaction tests;
- 15 shared operations executed through both the pure core and the public Vue store actions;
- 3 Redux adapter/reference-stability tests;
- 1 interaction-controller contract test;
- 1 large-deck state/interaction budget test.

The shared Vue/core scenarios cover title, theme, viewport size/ratio, slide replacement, templates, slide add/update/property removal/deletion/focus, and element add/delete/update/property removal. Normalized output must match exactly.

The frozen seven-test Vue Playwright suite passes without updating snapshots. It includes the exact initial editor screenshot, settings screenshot and interaction, slide-navigation screenshot, normalized initial document state, title editing, and slide creation. Browser QA at `http://127.0.0.1:5173/` also found no warning/error logs. The visual mismatch ledger is empty.

## Performance evidence

Measured on Node 24.13.1 with a deterministic 120-slide, 4,800-element deck:

| Measurement | Budget | Result |
| --- | ---: | ---: |
| 300 semantic element transactions, p95 | less than 8 ms | 0.779 ms |
| 20,000 pointer snapshot updates, p95 | less than 0.5 ms | below timer resolution |
| Redux dispatches during pointer gesture | 0 | 0 |
| Unrelated slide reference stability | required | preserved |

Machine-readable evidence is in `tests/parity/baselines/gate2-state-performance.json`.

The Vue production JavaScript changed from 3,230,085 to 3,233,797 raw bytes and from 1,040,047 to 1,041,268 gzip bytes: +3,712 raw / +1,221 gzip, approximately 0.12%. CSS bytes are unchanged. See `gate2-vue-build.json`.

Five fresh production-preview samples produced these medians versus the frozen Vue baseline:

| Metric | Frozen Vue | Gate 2 Vue |
| --- | ---: | ---: |
| Editor ready | 187.8 ms | 182.0 ms |
| DOM content loaded | 126.7 ms | 125.2 ms |
| First contentful paint | 28 ms | 24 ms |
| Resource requests | 4 | 4 |
| Used JavaScript heap | 16.1 MB | 16.1 MB |

Transferred/decoded JavaScript increases by the same 1,224/3,712 bytes recorded by the build. Local timing remains comparison evidence rather than a universal SLA. See `gate2-vue-runtime.json`.

## Verification commands

```sh
npm run type-check:gate2
npm run test:gate2
npm run benchmark:gate2
npm run build
npm run parity:reference
npm run build:react
npm run lint:react
npm run test:react
npm run e2e:react
```

All pass. `npm audit --omit=dev` still reports the seven previously recorded inherited Vue/PPTist advisories; Redux Toolkit and the Gate 2 workspace packages add no production advisory.

## Gate decision

Go to Gate 3. The read-only React renderer can consume the frozen model and selectors without importing Vue/Pinia or inventing a second presentation representation. Vue remains only as the executable visual/behavioral oracle until the later cutover gate.
