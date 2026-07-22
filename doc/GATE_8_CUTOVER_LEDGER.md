# Gate 8 cutover ledger

Status: **complete, 2026-07-21**.

Gate 8 removes the migration topology without weakening the evidence that made
the cutover safe. `apps/web` is the sole production frontend. The root commands
serve and build React, the former root Vue source tree and framework packages
are gone, and the old implementation survives only as an immutable compiled
test oracle.

## Cutover contracts

| Contract | Evidence | Status |
| --- | --- | --- |
| One production frontend | Root `dev`, `build`, and `preview` route to `@mona/web`; `apps/web/index.html` mounts `/src/main.tsx`. | complete |
| Vue source removed | No `.vue` file exists under `src`, `apps`, or `packages`; the retired root entries and 342-file Vue `src/` tree are removed. | complete |
| Vue runtime/build ownership removed | No manifest, lockfile installation, or `node_modules` entry remains for Vue, Pinia, Vue I18n, Vue TSC, `@vitejs/plugin-vue`, or `@vue/compiler-sfc`. | complete |
| Test oracle isolated | `tests/oracle/vue/` contains the final compiled reference, fonts, provenance, and SHA-256 checksums. `scripts/serve-vue-oracle.mjs` is test-only. | complete |
| Migration fixtures excluded | `rendererFixture` routing is development-only. Its helper module and `gate3-renderer.json` are absent from production JavaScript/output. | complete |
| Private/test data excluded | Production output recursively rejects PPTX, corpus, private, frozen-oracle, and bridge artifacts. | complete |
| Production bridge removed | Production JavaScript contains no Mona test bridge, Vue I18n, fixture name, or migration-router marker. | complete |
| Documentation current | Root/app readmes and i18n documentation describe React as current; migration-era records carry explicit historical labels. | complete |

`npm run parity:gate8` enforces these contracts. It checks production source,
every workspace manifest, the lockfile and installed packages, oracle checksums,
the React entry, and a freshly built production artifact. It fails with all
detected violations rather than stopping after the first one.

## Final parity evidence

The cutover is based on the complete two-sided board, not on component presence:

- Gate 2: boundaries/types plus **38/38** domain and performance contracts.
- Gate 3: **2/2** complete renderer journeys.
- Gate 4: **46/46** editor interaction journeys in one zero-retry run.
- Gate 5: **97/97** editable-element journeys in one clean run.
- Gate 6: **74/74** workflow journeys in one zero-retry run.
- React unit/browser tests: **63/63**; React E2E: **6/6**.
- Gate 7: corpus **9/9**, Chromium/Firefox/WebKit **3/3**, production stability
  **2/2**, and passing production build/runtime budgets.
- Final stability: listeners **164 -> 164**, forced-GC heap **15.2 MB -> 15.2
  MB**, navigation p95 **25.40 ms**, zero long tasks, and preserved thumbnail
  DOM identity.

Gate 4–6 evidence compares normalized document state, selection/history,
geometry, focus, controls, lifecycle, and raster output on both implementations.
Gate 7 adds real PPTX packages, editable round trips, cross-browser execution,
production artifacts, memory/listener behavior, and performance. Exact evidence
and interpretation rules remain in the corresponding ledgers and
`tests/parity/PARITY_MATRIX.md`.

## Frozen oracle policy

The oracle is not a fallback application. It has no source ownership, package
dependency, build path, or production route. Do not regenerate it after
cutover. Intentional future product changes must either continue to satisfy the
immutable contract or record an approved divergence with new product-specific
tests; the oracle itself must never be edited to make a regression disappear.

## Post-migration architecture

```text
root scripts
    -> apps/web (React production application)
        -> editor-state / editor-interactions / rich-text
        -> presentation-core (native editable document model)

parity commands only
    -> apps/web development fixture surface
    -> tests/oracle/vue (immutable compiled reference)
```

The next Mona phase—JavaScript presentation SDK, hosted model adapters, and
Excalidraw drawing-first intent—is separate from the completed framework port.
It must build on `presentation-core` instead of introducing a second document
model or commanding the React UI.

## Dependency audit note

The final `npm audit --omit=dev` reports no critical advisories: two high and
two moderate advisories remain in the current production tree. They affect
Lodash directly, `image-size` transitively, ECharts directly, and Nano ID
directly. These are recorded rather than silently force-updated during cutover;
their fixes require a separate compatibility change with import, export, chart,
document, and full parity regression coverage.
