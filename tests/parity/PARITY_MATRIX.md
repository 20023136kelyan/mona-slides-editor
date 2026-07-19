# Vue to React parity matrix

Status: Gate 0 harness operational; reference coverage expands before each React editor slice.

`Reference` means the Vue behavior has a repeatable contract. `React` remains empty until the corresponding migration slice begins.

| Priority | Surface | Reference contract | React parity | Evidence |
| --- | --- | --- | --- | --- |
| P0 | Desktop app loads | Automated | — | shell assertions, console guard, initial screenshot |
| P0 | Initial document state | Automated | — | normalized development bridge snapshot |
| P0 | Settings opens/closes | Automated | — | interaction assertion and component screenshot |
| P0 | Slide navigation | Automated | — | thumbnail selection assertion and screenshot |
| P0 | Presentation title editing | Automated | — | UI interaction and resulting document-state assertion |
| P0 | Slide creation | Automated | — | thumbnail/UI assertion and resulting document-state assertion |
| P0 | Text create/edit | Pending | — | — |
| P0 | Shape/image/line create/edit | Pending | — | — |
| P0 | Select, drag, resize, rotate | Pending | — | — |
| P0 | Multi-select/group/align/layer | Pending | — | — |
| P0 | Clipboard and undo/redo | Pending | — | — |
| P0 | PPTX import/export | Corpus pending | — | — |
| P0 | JSON/native import/export | Pending | — | — |
| P1 | Tables/charts/LaTeX | Pending | — | — |
| P1 | Audio/video | Pending | — | — |
| P1 | Notes/search/selection/markup panels | Pending | — | — |
| P1 | Theme/design/viewport | Pending | — | — |
| P1 | Animations/transitions | Pending | — | — |
| P1 | Slideshow/presenter | Pending | — | — |
| P1 | Mobile editor/preview | Pending | — | — |
| P1 | English/Chinese UI | English shell automated; Chinese pending | — | — |
| P1 | Keyboard/focus/accessibility | Pending | — | — |
| P1 | Large-deck performance | Fixture pending | — | — |

The frozen build and production-runtime measurements live in `tests/parity/baselines/`. The current screenshots and normalized state snapshot live beside the reference specs. See `doc/PARITY_BASELINE.md` for the environment and interpretation rules.

## Evidence rules

- State contracts normalize only generated identifiers and timestamps explicitly named by the test.
- Visual changes require reviewed screenshot diffs; snapshot updates are never automatic in CI.
- A UI assertion alone does not prove document parity. Editing flows need the resulting normalized document state.
- Import/export parity also requires element counts/types, warnings, and round-trip checks against the PPTX corpus.
- Performance is compared at the same viewport, browser, font set, production mode, and representative deck.
