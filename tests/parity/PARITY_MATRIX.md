# Vue to React parity matrix

Status: Gate 3 complete; reference coverage expands before each React editor slice.

`Reference` means the Vue behavior has a repeatable contract. `React` remains empty until the corresponding migration slice begins.

| Priority | Surface | Reference contract | React parity | Evidence |
| --- | --- | --- | --- | --- |
| P0 | Desktop app loads | Automated | Foundation only | Vue shell assertions/console guard/screenshot; React foundation E2E |
| P0 | Initial document state | Automated | Core/state adapter automated | normalized development bridge snapshot; 15 Vue/core operation contracts; transaction tests |
| P0 | Settings opens/closes | Automated | Foundation automated | Vue interaction/component screenshot; React browser component + E2E |
| P0 | Slide navigation | Automated | Read-only automated | Vue reference selection; React four-slide selection E2E/browser test |
| P0 | Read-only slide rendering | Automated | Automated | exact element inventories and 3.5% anti-aliasing pixel gate across 7 shared slides |
| P0 | Presentation title editing | Automated | — | UI interaction and resulting document-state assertion |
| P0 | Slide creation | Automated | — | thumbnail/UI assertion and resulting document-state assertion |
| P0 | Text create/edit | Pending | — | — |
| P0 | Shape/image/line create/edit | Pending | — | — |
| P0 | Select, drag, resize, rotate | Pending | — | — |
| P0 | Multi-select/group/align/layer | Pending | — | — |
| P0 | Clipboard and undo/redo | Pending | — | — |
| P0 | PPTX import/export | Corpus pending | — | — |
| P0 | JSON/native import/export | Pending | — | — |
| P1 | Tables/charts/LaTeX | Read-only automated | Read-only automated | shared merged-table/two-series-chart/LaTeX fixture; editing pending |
| P1 | Audio/video | Read-only automated | Read-only automated | shared static media fixture; playback/editing pending |
| P1 | Notes/search/selection/markup panels | Pending | — | — |
| P1 | Theme/design/viewport | Pending | — | — |
| P1 | Animations/transitions | Pending | — | — |
| P1 | Slideshow/presenter | Pending | — | — |
| P1 | Mobile editor/preview | Pending | — | — |
| P1 | English/Chinese UI | English shell automated; Chinese pending | Foundation automated | shared-catalog unit test; React browser locale switch/document language/storage contract |
| P1 | Keyboard/focus/accessibility | Pending | — | — |
| P1 | Large-deck performance | State fixture automated | State/interaction prototype automated | 120 slides / 4,800 elements; semantic transaction and pointer-frequency budgets |

The frozen build and production-runtime measurements live in `tests/parity/baselines/`, including separate React-foundation, Gate 2, and Gate 3 reports that are not yet complete-editor comparisons. The current screenshots and normalized state snapshot live beside the reference specs. See `doc/PARITY_BASELINE.md`, `doc/REACT_FOUNDATION.md`, `doc/REACT_GATE_2.md`, and `doc/REACT_GATE_3.md` for the environment and interpretation rules.

## Evidence rules

- State contracts normalize only generated identifiers and timestamps explicitly named by the test.
- Visual changes require reviewed screenshot diffs; snapshot updates are never automatic in CI.
- A UI assertion alone does not prove document parity. Editing flows need the resulting normalized document state.
- Import/export parity also requires element counts/types, warnings, and round-trip checks against the PPTX corpus.
- Performance is compared at the same viewport, browser, font set, production mode, and representative deck.
