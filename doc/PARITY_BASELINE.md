# Vue parity baseline

Captured on 2026-07-19 from the Mona-localized Vue/PPTist application on macOS with Chromium 149.0.7827.55 at a fixed 1440 × 900 CSS-pixel viewport and device scale factor 1.

This is the executable oracle for the React migration. It is not a claim that every editor behavior is covered yet. A React editor slice cannot replace Vue until its rows in `tests/parity/PARITY_MATRIX.md` have reference contracts and matching React evidence.

## Automated reference contract

Run:

```sh
npm run parity:reference
```

The current suite checks:

- complete desktop shell and three-slide default document;
- zero browser warnings, console errors, and uncaught page errors;
- deterministic initial full-page pixels;
- settings open/close behavior and settings-menu pixels;
- slide-thumbnail navigation and selected-slide pixels;
- presentation-title editing in both the UI and native document state;
- slide creation, selection, and native document state;
- the normalized initial Pinia state contract.

The test-only state bridge is installed through a development-only dynamic import. It exposes deep-cloned serializable state and no mutation functions, and it is absent from the production bundle.

Visual snapshots use light color scheme, English UI, UTC, reduced motion, fixed fonts, hidden carets, and a maximum 0.1% pixel-difference ratio. CI may compare snapshots but must never update them automatically.

## Production build baseline

Generated with `npm run build` followed by:

```sh
npm run parity:measure:build -- --write tests/parity/baselines/vue-build.json
```

| Asset group | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| JavaScript | 3,230,085 | 1,040,047 |
| CSS | 250,565 | 38,089 |
| Fonts | 44,230,564 | 44,168,673 |
| Complete `dist` | 49,269,094 | 45,513,567 |

The main JavaScript chunk is 3,176,499 raw bytes / 1,027,778 gzip bytes. Vite reports the existing greater-than-500 kB chunk warning. Fonts dominate the complete build and must be compared separately from application JavaScript.

## Production runtime baseline

Generated from `vite preview`, not the development server, using five fresh isolated browser contexts:

```sh
MONA_REFERENCE_URL=http://127.0.0.1:4173/ \
MONA_SERVER_MODE=production-preview \
npm run parity:measure:runtime -- --write tests/parity/baselines/vue-runtime.json
```

| Median | Baseline |
| --- | ---: |
| Editor ready | 187.8 ms |
| DOM content loaded | 126.7 ms |
| Load event | 126.9 ms |
| First contentful paint | 28 ms |
| Resource requests | 4 |
| Transferred | 1,122,233 bytes |
| Decoded bodies | 3,490,686 bytes |
| Used JavaScript heap | 16,100,000 bytes |

These local timings are comparison values, not universal service-level objectives. React and Vue must be measured consecutively on the same machine, Chromium build, viewport, fixture, and production-serving mode. A noisy result is rerun; a material regression needs an approved explanation rather than a rebaseline.

## Dependency risk recorded at freeze

`npm audit --omit=dev` reports eight production-tree advisories: four moderate, three high, and one critical. Direct affected packages include Axios, ECharts, Lodash, and Nano ID; transitive affected packages include `form-data`, `follow-redirects`, `image-size`, and PostCSS.

This is inherited/reference risk, not accepted product security posture. It is recorded so the React migration does not silently hide it. Dependency remediation must be isolated from framework-parity slices because version changes can alter import, export, chart, or document behavior.

## Evidence files

- `tests/reference/editor.spec.ts`
- `tests/reference/state.spec.ts`
- `tests/reference/editor.spec.ts-snapshots/`
- `tests/reference/state.spec.ts-snapshots/`
- `tests/parity/baselines/vue-build.json`
- `tests/parity/baselines/vue-runtime.json`
- `tests/parity/PARITY_MATRIX.md`

## Known open coverage

Element manipulation, advanced editor panels, import/export, slideshow, mobile, Chinese UI, accessibility journeys, and corpus/stress scenarios remain explicit rows in the parity matrix. They are blockers for replacing their corresponding Vue slices, not hidden assumptions.
