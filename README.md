# Mona

[简体中文](./README_zh.md) | English

Mona is an open-source desktop presentation editor. It preserves
PowerPoint-style editable objects—text, images, shapes, lines, tables, charts,
media, and equations—rather than flattening a deck into generated images.

It runs as an Electron application: a React renderer inside a shell that hosts
the agent in its own process. Nothing listens on a port and nothing is sent
anywhere. Decks are files in an application-managed library, and the agent runs
on your machine under the Claude login already there.

The editor, mobile surfaces, slideshow, presenter tools, import/export flows,
and English/Chinese interface are implemented in React. The repository now
uses Mona-owned product tests and fixtures rather than retaining a second
framework implementation as a reference runtime.

## Agentic editing

Mona includes a drawing-first and text-first presentation agent workflow.
Excalidraw sketches are stored per slide and can be handed to Mona as visual
intent. The agent is given the deck as files in a workspace and edits them with
ordinary tools; the result is validated once on the way back in and applied as
one undoable transaction, however many turns it took. It creates ordinary
editable presentation elements; screenshots are inspection evidence, never
slide data.

The agent runs through the Claude Agent SDK, in the desktop shell's own
process, using the `claude` login already on the machine. There is no
credential for Mona to hold and nowhere for a deck to be sent.

## Technology

- Electron 43, with the renderer served from a custom `mona://` scheme
- React 19.2, TypeScript 7, Vite 8
- Tailwind CSS 4 with source-owned shadcn/Radix primitives
- React Router, i18next/react-i18next, Vitest, and Playwright
- Framework-neutral presentation, state, rich-text, and interaction packages

Exact tested versions are pinned in `apps/web/package.json` and the lockfile.

## Run locally

Node.js 24.13.1+ and npm 11+ are required, as pinned in `engines`.

```sh
npm install
npm run dev
```

The application window opens by itself. `dev` starts Vite for the renderer and
Electron for the shell, and the window loads Vite's URL so hot reload works;
a packaged build serves the same renderer from `mona://app` instead. There is
no page to open in a browser — the editor needs the shell's bridge, and a plain
browser tab has none.

## Packaging

```sh
npm run package -w @mona/desktop
```

Builds the renderer, bundles the shell, and writes an installer to
`.artifacts/desktop/`. The result is unsigned: signing and notarization need an
Apple Developer identity, so macOS will warn on first launch.

The application is large — around 600 MB — and most of that is the `claude`
binary the Agent SDK ships as a platform-specific dependency. It is unpacked
beside the archive rather than inside it, because a subprocess cannot be run out
of an asar.

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
apps/desktop/                Electron shell: windows, menus, files, protocol
apps/agent-server/           agent runtime: sessions, workspace, tools, streaming
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
