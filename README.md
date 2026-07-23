# Mona

[简体中文](./README_zh.md) | English

Mona is an open-source, browser-based presentation editor. It preserves
PowerPoint-style editable objects—text, images, shapes, lines, tables, charts,
media, and equations—rather than flattening a deck into generated images.

The editor, mobile surfaces, slideshow, presenter tools, import/export flows,
and English/Chinese interface are implemented in React. The repository now
uses Mona-owned product tests and fixtures rather than retaining a second
framework implementation as a reference runtime.

## Agentic editing

Mona includes a drawing-first and text-first presentation agent workflow.
Excalidraw sketches are stored per slide and can be handed to Mona as visual
intent. The agent receives both the native presentation structure and rendered
slide pixels, generates a bounded JavaScript presentation program, previews
the result, validates its commands, and applies the accepted edit as one
undoable transaction. It creates ordinary editable presentation elements;
screenshots are inspection evidence, never slide data.

Provider paths currently include OpenAI account sign-in, Anthropic account
sign-in, a Google AI Studio bring-your-own-key adapter, and a local reference
engine for testing the complete edit pipeline without a model. OAuth
credentials stay encrypted in the agent server and never enter the editor or
generated presentation code.

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

Open <http://127.0.0.1:5173/>. The root `dev` command starts both the React
application and the local agent server. See
[`apps/agent-server/README.md`](./apps/agent-server/README.md) for hosted
provider and production-secret requirements.

## Verification

```sh
npm run type-check
npm run check:architecture
npm run lint
npm run test:core
npm run test:react
npm run e2e:react
npm run build
```

## Repository layout

```text
apps/web/                    React production application
apps/agent-server/           hosted provider, credential, and managed-asset boundary
packages/agent-protocol/     shared agent program and review protocol
packages/presentation-core/ presentation model and domain behavior
packages/editor-state/      canonical state, transactions, and selectors
packages/editor-interactions/ geometry and gesture behavior
packages/rich-text/         framework-neutral rich-text behavior
packages/test-fixtures/     shared deterministic fixtures
tests/core/                 framework-neutral integration contracts
tests/performance/          state and interaction performance budgets
tests/stability/            production runtime stability checks
tests/corpus/               real-world PowerPoint fixture metadata
```

UI localization uses English as the canonical source and fallback. Simplified
Chinese is also supported; French, Spanish, Italian, German, and Japanese are
planned. Presentation titles and user-authored slide content are document data
and are never translated automatically. See [`doc/I18N.md`](./doc/I18N.md).

## Attribution and license

Mona preserves the copyright and license notices of the open-source software it
builds on. See [`NOTICE.md`](./NOTICE.md) for attribution and [`LICENSE`](./LICENSE)
for the repository's licensing terms.
