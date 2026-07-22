# Mona Slides

[简体中文](./README_zh.md) | English

Mona Slides is an open-source, browser-based presentation editor. It preserves
PowerPoint-style editable objects—text, images, shapes, lines, tables, charts,
media, and equations—rather than flattening a deck into generated images.

The current repository is the completed React re-platform of the PPTist editor.
The editor, mobile surfaces, slideshow, presenter tools, import/export flows,
and English/Chinese interface have been ported to React and verified against a
frozen build of the original implementation. The frozen Vue build under
`tests/oracle/vue/` is test evidence only; it is not a production application.

## Current product boundary

This milestone establishes the exact editor foundation for Mona's later agentic
workflow. The planned AI presentation SDK, hosted-model adapters, and
Excalidraw drawing-first input are not implemented in this milestone. When
added, they must edit the same native presentation model used by the human
editor; screenshots remain inspection evidence, not slide data.

## Technology

- React 19.2, TypeScript 7, Vite 8
- Tailwind CSS 4 with source-owned shadcn/Radix primitives
- React Router, i18next/react-i18next, Vitest, and Playwright
- Framework-neutral presentation, state, rich-text, and interaction packages

Exact tested versions are pinned in `apps/web/package.json` and the lockfile.

## Run locally

Node.js 20.19+ or 22.12+ is required.

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:5173/>. The root `dev`, `build`, and `preview` commands
all target the React application in `apps/web`.

## Verification

```sh
npm run type-check
npm run lint
npm run test:gate2
npm run test:react
npm run e2e:react
npm run build
npm run parity:gate8
```

The complete two-sided parity suites are intentionally more expensive. Their
commands and final evidence are recorded in
[`tests/parity/PARITY_MATRIX.md`](./tests/parity/PARITY_MATRIX.md) and the Gate
4–8 ledgers under [`doc/`](./doc/).

## Repository layout

```text
apps/web/                    React production application
packages/presentation-core/ presentation model and domain behavior
packages/editor-state/      canonical state, transactions, and selectors
packages/editor-interactions/ geometry and gesture behavior
packages/rich-text/         framework-neutral rich-text behavior
packages/parity-fixtures/   shared deterministic fixtures
tests/oracle/vue/           immutable compiled test oracle only
tests/gate*/                two-sided parity and stabilization suites
```

UI localization uses English as the canonical source and fallback. Simplified
Chinese is also supported; French, Spanish, Italian, German, and Japanese are
planned. Presentation titles and user-authored slide content are document data
and are never translated automatically. See [`doc/I18N.md`](./doc/I18N.md).

## Attribution and license

Mona Slides is derived from [PPTist](https://github.com/pipipi-pikachu/PPTist)
and retains its copyright and license notices. See [`LICENSE`](./LICENSE) for
the repository's licensing terms.
