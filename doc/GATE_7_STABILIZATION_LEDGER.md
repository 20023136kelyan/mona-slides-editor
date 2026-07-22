# Gate 7 corpus, performance, and stabilization ledger

Status: **complete**. Gate 8 subsequently completed the production cutover.

Gate 7 is not a feature-presence gate. It exercises real imported documents,
production artifacts, repeated lifecycle transitions, sustained navigation,
and multiple browser engines. A shared Vue/React defect is recorded as a
compatibility loss rather than silently counted as React parity.

## Corpus and import/export fidelity

| Contract | Evidence | Status |
| --- | --- | --- |
| Test-only corpus ownership | `tests/corpus/public/` contains five redistributable synthetic PPTX fixtures and manifests. Four externally sourced real decks live in gitignored `tests/corpus/private/`. Both locations are outside every Vite public directory. | complete |
| Independent OOXML ground truth | `scripts/inspect-pptx-corpus.mjs` inspects package parts and relationships without using the application parser and writes `tests/corpus/corpus-ground-truth.json`, including slides, masters, layouts, themes, charts, tables, merges, groups, SmartArt, notes, links, crops, effects, timing, transitions, and media counts. Fixture SHA-256 values are verified before every test. | complete |
| Import state and history | All nine fixtures are imported through each product's real menu and file input. Complete presentation graphs are compared exactly after generated ID/time canonicalization; exact history cursor/length is also required. | complete |
| Lazy/navigation stability | The complete presentation graph is compared again after navigating to the first, middle, and last representative slides, preventing text/table auto-measure mutations from hiding after the initial import assertion. | complete |
| Render fidelity | Representative Vue and React slide canvases are rasterized in the same Chromium/font environment. Every checked-in ratio is below the 3.5% gate; the highest observed ratio is 0.4776% on the NASA corporate deck. | complete |
| Editable PPTX round trip | Both products export the imported deck through the real editable-PPTX dialog. The files are reopened by `pptxtojson`; normalized parser output and slide/chart/media/notes package counts must match exactly. | complete |
| Compatibility baselines | Per-fixture reports in `tests/corpus/baselines/` freeze imported element inventories, parser gaps, package counts, round-trip summaries, and visual ratios. Baselines are never rewritten by the normal test command. | complete |
| Integrated corpus result | `npm run parity:gate7:corpus`: **9/9 passed** in one serial run after the final text/table measurement fixes. | complete |

### Real-deck coverage and known compatibility losses

The four private fixtures provide 81 real slides in total. They cover native
PowerPoint bar/line/3-D/multi-series charts, a pie chart and legends, 4:3 and
widescreen documents, masters/layouts/themes, corporate logos, slide numbers,
hyperlinks, merged tables, crops, shadows, transparency, rotations, notes,
transitions, timing markup, grouped objects, and SmartArt.

The ground-truth comparison records the following shared PPTist/parser losses;
these are not caused by the React port:

- All 8 native charts in the 34-slide PowerPoint stress deck and the native pie
  chart in the control deck import as editable chart elements. The synthetic
  PptxGenJS chart fixture still loses all 3 native charts, confirming a
  generator/parser compatibility difference rather than universal chart loss.
- OOXML groups are flattened: 3 groups in the synthetic group fixture, 5 in the
  NASA deck, and 1 in the design-heavy deck are not represented as editable
  Mona groups.
- The design-heavy deck's 4 SmartArt objects are not editable SmartArt objects;
  their surviving visual content is represented through ordinary imported
  elements.
- Native table counts and notes-slide counts match the package ground truth for
  all real fixtures. The checked-in reports preserve the exact remaining type
  and round-trip inventories.

## Production performance and bundle budgets

| Metric | Vue production reference | React production result | Gate |
| --- | ---: | ---: | --- |
| Total JavaScript | 3,246,379 B | 3,349,995 B (+3.19%) | <= 105% of Vue |
| Gzipped JavaScript | 1,043,263 B | 1,074,384 B (+2.98%) | <= 105% of Vue |
| Largest JavaScript chunk | 3,192,793 B | 1,840,017 B (-42.37%) | smaller than Vue |
| Total CSS | 250,565 B | 232,615 B | <= 105% of Vue |
| Gzipped CSS | 38,087 B | 39,402 B | <= 110% of Vue |
| Editor ready, median of 7 | 182.0 ms | 137.4 ms | no slower than Vue |
| DOMContentLoaded, median of 7 | 125.9 ms | 21.4 ms | no slower than Vue |
| Load, median of 7 | 126.0 ms | 26.3 ms | no slower than Vue |
| First contentful paint, median of 7 | 28 ms | 40 ms | within one 60 Hz frame |
| Critical-path transfer | 1,125,447 B | 799,069 B | no larger than Vue |
| Critical-path decoded body | 3,506,980 B | 2,597,277 B | no larger than Vue |
| Used JavaScript heap | 16.1 MB | 10.6 MB | no larger than Vue |

Both builds are measured from fresh production output. The build guard also
recursively rejects any `.pptx`, `corpus`, or `private` path in either output.
Parser/import code and ECharts are split from the main React chunk; parity-
critical inspectors and workflow surfaces remain eagerly available because a
measured lazy-shell experiment introduced first-use interaction jank.

Evidence:

- `tests/parity/baselines/{vue,react}-gate7-build.json`
- `tests/parity/baselines/{vue,react}-gate7-runtime.json`
- `npm run parity:gate7:build`
- `npm run parity:gate7:runtime`

The implementation follows Vite's documented production build and dynamic
import behavior: [Building for Production](https://vite.dev/guide/build) and
[Dynamic Import](https://vite.dev/guide/features#dynamic-import).

## Runtime stabilization

| Contract | Evidence | Status |
| --- | --- | --- |
| Listener cleanup | Global window/document/body listener registrations are instrumented before React loads. After 3 warm-up cycles and 20 additional real export/comments/settings open-close cycles, no listener group may exceed its warmed baseline. | complete |
| Retained heap | Forced-GC heap growth across the same repeated lifecycle is limited to the greater of 1.5 MB or 10% of the warmed heap. | complete |
| Navigation frame budget | 45 real thumbnail navigations are measured over two animation frames; p95 must be <= 40 ms and the browser Long Tasks buffer must remain empty. | complete |
| Avoid broad replacement | A marked thumbnail DOM node must retain identity through all 45 navigations. `EditorThumbnails` is memoized and subscribes only to presentation, selected-slide indexes, and thumbnail focus; callbacks from the deck are stable. | complete |
| Runtime errors | Production stability cycles and browser-parity journeys require an empty page-error list. | complete |
| Strict lifecycle regression | A WebKit-only table auto-height feedback loop was fixed by deferring the store write outside the `ResizeObserver` delivery cycle; the full table editing suite remains green. | complete |

`npm run parity:gate7:stability` runs these checks against production previews,
not Vite HMR. The final run recorded listeners **164 -> 164**, forced-GC heap
**15.2 MB -> 15.2 MB**, navigation p95 **25.40 ms**, zero long tasks, and
preserved thumbnail DOM identity. Traces are retained on failure under `.artifacts/` according to
Playwright's [tracing](https://playwright.dev/docs/api/class-tracing) and
[browser-context isolation](https://playwright.dev/docs/browser-contexts)
model.

## Browser compatibility

`tests/gate7/browser-smoke-parity.spec.ts` runs the same shared workflow in
Chromium, Firefox, and WebKit. Each engine must prove:

- exact initial presentation and history state;
- exact state again after real thumbnail navigation;
- exact selection and handle state after selecting a text element;
- Vue/React canvas raster difference at or below 3.5%; and
- no page error at initial mount, navigation, selection, or capture.

Result: `npm run parity:gate7:browsers`: **3/3 passed**.

## Defects found by the Gate 7 evidence

1. The React development bridge used `structuredClone`, while the Vue bridge
   exposed the source's JSON-clone semantics. It now returns JSON-serialized
   state so `undefined` behavior and comparison contracts match.
2. Tailwind's default `sup`/`sub` line-height changed auto-sized imported text.
   The ProseMirror renderer now explicitly inherits line height like PPTist.
3. Text auto-sizing has two source paths: fractional content-box sizing for
   default insets, and rounded DOM offset sizing after an explicit-inset update.
   React now mirrors both instead of globally rounding or globally preserving
   fractions.
4. Group-rotation arithmetic used equivalent mathematics in a different
   operation order, producing observable IEEE-754 differences. The import
   helper now mirrors the source parentheses and cached trigonometric values.
5. Table auto-height writes inside the observer callback caused WebKit's
   `ResizeObserver loop completed with undelivered notifications` error. The
   write is now frame-deferred without changing the measured content-box value.
6. Broad thumbnail-store subscription and unstable callbacks caused avoidable
   rerenders. They were replaced with narrow selectors, a memoized rail, and
   stable callbacks; sustained navigation now verifies node identity and frame
   behavior.

## Exit rule

Gate 7 closes only when the corpus, all three browser engines, fresh production
build/runtime/stability checks, type/lint/build checks, and complete Gates 1–6
regressions are green together. Final exit evidence:

- Gate 4: **46/46** two-sided interaction journeys.
- Gate 5: **97/97** two-sided editable-element journeys in one clean run.
- Gate 6: **74/74** two-sided workflow journeys in one clean run.
- Gate 3: **2/2** complete renderer journeys.
- Gate 2: boundary/type audits plus **38/38** unit and performance contracts.
- React unit/browser: **63/63** with no application warning; React E2E: **6/6**.
- Gate 7 corpus: **9/9**; browsers: **3/3**; production stability: **2/2**;
  production build and runtime budget assertions passed.

Gate 8 was unblocked by this evidence and subsequently completed.

The final corpus comparison keeps structural state and round-trip reports exact.
For raster ratios it permits only a `0.0001` absolute increase over the reviewed
baseline because Chromium's warmed glyph cache changes subpixel
anti-aliasing—the NASA slide measured `0.004776` cold and `0.004719` warm.
Improvements are allowed; the global 3.5% visual ceiling remains unchanged.
