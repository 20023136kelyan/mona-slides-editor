# React migration Gate 3: read-only renderer

Status: complete, oracle and regression gates passed 2026-07-19.

Gate 3 ports the complete native presentation element tree into React without enabling editing. The Vue application remains the executable visual oracle. React consumes the frozen `presentation-core` schema directly; there is no React-specific slide model and no mutation path hidden in the renderer.

## Delivered surface

The React renderer now owns:

- solid, image, linear-gradient, and radial-gradient slide backgrounds;
- rich HTML text and shape text using the existing static ProseMirror markup contract;
- SVG shapes, patterns, gradients, outlines, opacity, flips, rotation, and drop shadows;
- cropped/masked images, polygon/ellipse/rounded outlines, filters, color masks, flips, and shadows;
- solid, dashed, dotted, straight, broken, quadratic, and cubic lines with arrow/dot markers;
- native ECharts bar, column, line, area, pie, ring, radar, and scatter charts;
- tables including row/column spans, themed headers/footers, styled text, and merged-cell hiding;
- LaTeX SVG paths and static audio/video presentation states;
- source-order layering, group metadata preservation, responsive main-canvas scaling, 120 px thumbnails, and read-only slide selection.

`SlideRenderer` is the natural-size 1000-unit rendering boundary. `ScaledSlide` applies one outer scale for the main canvas or thumbnail, so element geometry stays in document coordinates. `ElementRenderer` is an exhaustive discriminated-union switch. ECharts is dynamically imported and its `ResizeObserver` and chart instance are both disposed on unmount.

The React TypeScript project keeps strict checking but disables `erasableSyntaxOnly` because the frozen Gate 2 model exports `const enum` values. An attempted schema rewrite was rejected by the Gate 2 boundary audit and reverted; compatibility belongs in the consuming compiler configuration until a separately approved schema migration.

The renderer intentionally contains no editor inputs, content-editable nodes, pointer mutations, selection handles, or presentation transactions. Those begin at Gate 4.

## Shared oracle fixtures

Two decks now run through both applications:

| Fixture | Slides | Purpose |
| --- | ---: | --- |
| `slides.json` | 3 | Preserve the original PPTist/Mona development deck. |
| `gate3-renderer.json` | 4 | Exercise every native element discriminant and difficult rendering properties. |

The Gate 3 fixture contains 18 editable model elements: 3 shapes, 5 text elements, 2 lines, 3 images, and one each of chart, table, LaTeX, video, and audio. It includes two-series chart data, a merged table, image crops and masks, gradients, a pattern, flips, rotation, shadows, group IDs, and both static media states.

The Vue fixture override is development-only and accepts only `gate3-renderer`; arbitrary mock paths are not exposed. The React loader independently allowlists `slides` and `gate3-renderer` and validates the assembled `PresentationState` before rendering. React's Vite public source is restricted to `public/mocks/`, so locally gitignored corpus/private decks cannot be copied into a production build.

## Parity gate

`npm run parity:gate3` launches Vue and React together at the same 1440 × 900 Chromium viewport. It:

1. verifies the same slide count and exact per-slide element-type inventory;
2. waits for both ECharts SVG renderers to finish;
3. captures the same natural thumbnail surface in both applications;
4. normalizes only the single fractional edge pixel introduced by the Vue rail's 159 px content width;
5. compares every slide with Pixelmatch at a 0.1 color threshold and a maximum 3.5% differing-pixel allowance, excluding anti-aliasing pixels;
6. writes Vue, React, and diff PNGs into ignored test artifacts when the limit is exceeded.

There are no approved design differences. The tolerance exists for raster anti-aliasing, not layout drift. React's rail geometry was aligned to Vue's exact 120 px thumbnail width and 77.5 px vertical cadence after the oracle exposed a half-pixel placement difference.

During live browser verification, the fixture produced all nine element types, four thumbnail slides, one completed ECharts SVG, zero editable controls, and zero console warnings/errors. Selecting slide 3 changed the main canvas to `gate3-slide-data`, with chart, table, LaTeX, and text elements present.

## Inherited renderer correction

The oracle audit found missing closing parentheses in Vue's background-image, radial-gradient, and linear-gradient CSS strings. Gate 3 corrected those strings in `useSlideBackgroundStyle`. The existing three-slide screenshot baseline remained byte-stable because it does not exercise those broken branches; the new gradient fixture now validates the corrected behavior in both frameworks.

## Performance and bundle evidence

Production evidence is frozen in:

- `tests/parity/baselines/react-gate3-build.json`
- `tests/parity/baselines/react-gate3-runtime.json`

At the measured production build:

| Metric | Gate 3 result |
| --- | ---: |
| JavaScript | 1,101,275 B / 362,852 B gzip |
| Application CSS | 38,800 B / 7,677 B gzip |
| Complete fixture transfer | 363,495 B |
| First contentful paint, median | 44 ms |
| Full fixture chart-ready, median | 830.8 ms |
| Used JavaScript heap, median | 10 MB |

The 531,460 B ECharts module is a separate lazy chunk (177,274 B gzip). It retains all eight chart modes supported by the existing schema and is absent until a rendered deck contains a chart. The raw chunk exceeds Vite's default 500 kB warning, but it does not block the initial application route and dropping chart families would violate parity.

## Verification record

All of the following pass:

- `npm run build` — Vue type-check, i18n check, and production build;
- `npm run parity:reference` — 7 Vue reference tests and frozen screenshots;
- `npm run test:gate2` — 27 core/state/interaction tests;
- `npm run check:gate2-boundaries` and `npm run type-check:gate2`;
- `npm run lint:react`;
- `npm run test:react` — 17 unit and browser-component tests;
- `npm run e2e:react` — 2 React browser journeys;
- `npm run parity:gate3` — original three-slide deck plus complete four-slide renderer deck;
- `npm run build:react` and `git diff --check`.

`npm audit --omit=dev` still reports the same seven inherited Vue/PPTist production advisories recorded at Gate 2. ECharts and tinycolor were already production dependencies of the reference application; Gate 3 adds no new production advisory. Pixelmatch and PNGJS are development-only parity tools.

## Scope boundary and go decision

This gate proves fidelity after content has entered Mona's canonical `Slide[]` model. It does not change or re-test the PPTX parser, export pipeline, animations, speaker notes, or master/theme inheritance; those remain corpus/workflow work in Gates 6 and 7. The restarted repository currently contains no committed PPTX corpus, so Gate 3 makes no new parser-fidelity claim.

Go to Gate 4. The React canvas can now display the frozen document schema with equivalent structure and reviewed visual parity while Vue remains available as the oracle. Gate 4 can add selection and interaction state on top of this renderer without altering its document representation.
