# Mona dependency upgrade research

> Historical snapshot. Package and architecture statements below describe
> commit `15dda24e` on 2026-07-25. In particular, `pi-ai` and its hosted provider
> stack were removed when Mona moved to Electron; consult the current manifests
> and `doc/RELEASE_HARDENING.md` for release decisions.

## Scope

This document is the research behind the dependency upgrades, not the upgrade
plan's execution log. It answers one question per package: **what does the
newer version give Mona that the installed version cannot**, and what does
taking it cost.

Every version number, publish date, engine constraint and package-layout claim
below was read from the npm registry or from the published tarball on
2026-07-25, against a working tree on `main` at `15dda24e`. Changelog prose
was read from each project's own `CHANGELOG.md` or releases page. Where a
claim could not be verified it is marked as such rather than inferred.

Items carry a `D`-prefixed ID so the upgrade work can cite them, in the same
spirit as the `X`-prefixed items in
`doc/PPTX_IMPORT_RENDERING_ARCHITECTURE.md`.

Local toolchain at time of writing:

| | |
|---|---|
| Node | `v24.13.1` |
| TypeScript | `7.0.2` |
| Vite / Vitest | `8.1.5` / `4.1.10` |
| React | `19.2.7` |
| Outdated packages | 37 |
| `npm audit` | 20 advisories — 15 moderate, 5 high |

## How old is "outdated" here

The user-visible framing was that some packages are more than three years
behind. That is true, but only for four of them, and the age of the *installed
release* matters more than the count of skipped versions:

| package | installed | published | latest | published | installed age |
|---|---|---|---|---|---|
| sortablejs | 1.14.0 | 2021-07-04 | 1.15.7 | 2026-02-11 | 5.1 yr |
| txml | 5.1.1 | 2021-12-03 | 6.0.0 | 2026-05-10 | 4.6 yr |
| husky | 8.0.3 | 2023-01-03 | 9.1.7 | 2024-11-18 | 3.6 yr |
| pptxgenjs | 4.0.1 | 2025-06-26 | 4.0.1 | 2025-06-26 | 1.1 yr |
| prosemirror-history | 1.3.2 | 2023-05-17 | 1.5.0 | 2025-11-13 | 3.2 yr |
| @commitlint/cli | 18.6.1 | 2024-02-13 | 21.2.1 | 2026-07-08 | 2.4 yr |
| prosemirror-view | 1.33.9 | 2024-07-18 | 1.42.2 | 2026-07-24 | 2.0 yr |
| prosemirror-model | 1.22.2 | 2024-07-18 | 1.25.11 | 2026-07-11 | 2.0 yr |
| svg-pathdata | 7.1.0 | 2024-08-30 | 9.0.0 | 2026-03-27 | 1.9 yr |
| image-size | 1.2.1 | 2025-04-02 | 2.0.2 | 2025-04-02 | 1.3 yr |
| nanoid | 5.1.16 | 2026-06-24 | 6.0.0 | 2026-07-12 | 0.1 yr |
| react-router | 8.2.0 | 2026-07-08 | 8.3.0 | 2026-07-22 | 0.0 yr |

The oldest four (`sortablejs`, `txml`, `husky`, `pptxgenjs`) are the ones where
the ecosystem moved under us. The ProseMirror cluster is only two years stale
by date but sits on the largest behavioural delta, because that project ships
small fixes constantly.

## Node floor — check before choosing targets

We run Node `v24.13.1`. Three candidate upgrades declare an `engines.node`
floor that interacts with that:

| package | version | requires | verdict |
|---|---|---|---|
| svg-pathdata | 9.0.0 | `>=24.14.0` | **blocked** — we are 0.0.1 short |
| svg-pathdata | 8.0.0 | `>=22.16.0` | ok |
| nanoid | 6.0.0 | `^22 \|\| ^24 \|\| >=26` | ok |
| txml | 6.0.0 | `>=18.0.0` | ok |
| @commitlint/cli | 21.2.1 | `>=22.12.0` | ok |
| husky | 9.1.7 | `>=18` | ok |

This explains a discrepancy worth recording: `npm outdated` reports
svg-pathdata's latest as **8.0.0**, but the registry `latest` dist-tag is
**9.0.0**. npm filtered 9.0.0 out on engine incompatibility. Any decision to
take svg-pathdata 9 is really a decision to bump Node first — a patch bump of
Node, but it should be deliberate rather than incidental.

The repo declares no `engines` field and no `packageManager` field at the root.
Adding both would make this class of surprise explicit instead of emergent.

---

## D01 — txml 5.1.1 → 6.0.0 (pptx-parser) — **highest value, has a real breaking change**

Used at exactly one site: `packages/pptx-parser/src/readXmlFile.js`. Every
OOXML part in the import pipeline flows through it.

### What it gives us

**It deletes code we wrote today.** v6 adds a `decodeEntities` parse option.
Reading the published `dist/txml.mjs`, its decoder handles the five
XML-predefined named entities plus decimal and hex numeric character
references, bounds-checks the codepoint at `0x10FFFF`, and applies in a single
`String.replace` pass to both text nodes and attribute values.

That is a feature-for-feature match with the `decodeXmlEscapes` and
`decodeAttributes` helpers currently in `readXmlFile.js` — including the
subtle part. The single pass is what keeps `&amp;#x2022;` resolving to the
literal text `&#x2022;` rather than to a bullet, and CDATA sections are pushed
to the output without passing through the decoder, so escaped content inside
CDATA stays literal. Both behaviours match what we implemented.

One genuine difference: txml's named-entity match is case-sensitive
(`/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g`, no `i` flag); ours uses
`/gi`. XML named entities *are* case-sensitive per spec — `&AMP;` is not valid
XML — so txml's behaviour is the more correct of the two and ours is the more
forgiving. Moving to the library means slightly stricter parsing of malformed
input. Worth a fixture before switching, because generated decks are exactly
the population that emits malformed input.

Also gained:
- **Zero dependencies.** `through2` is gone; transform streams use native
  Node streams. Smaller install, one less audit surface.
- **Real TypeScript definitions**, hand-written, replacing `any`.
- Web Streams support (`transformWebStream`) — not useful to us today, but it
  is the shape that would matter if part parsing ever moved to a worker.
- Marginally faster per the maintainer; not independently measured.

### What it costs

**Our import breaks.** Current line 1 of `readXmlFile.js`:

```js
import * as txml from 'txml/dist/txml.mjs'
```

v5's exports map contained a `"./*": "./*"` wildcard that permitted deep paths
into `dist/`. v6's exports map does not:

```
".", "./txml", "./transform-stream", "./package.json"
```

So the deep import must become `txml/txml` (parser only, no Node
dependencies, tree-shakeable) or plain `txml`. This is a one-line change but
it is a hard failure, not a deprecation — worth knowing before the upgrade
rather than during it.

Confirmed still present in v6, so no other call-site changes: `keepWhitespace`
(we pass it), `simplifyLostLess` (we call it), `parse`.

The package is now `"type": "module"` with dual `.mjs`/`.cjs` builds; our
consumer is already ESM, so this is neutral.

v5 receives security fixes for 12 months from v6's release — until roughly
2027-05. There is no urgency, only accumulating drift.

### Verdict

Take it. It is the only upgrade in this document that *removes* Mona code
rather than adding capability we then have to wire up.

---

## D02 — ProseMirror cluster, all in-range (rich-text) — **free by semver, largest behavioural delta**

Eleven packages, every one declared with `^` in
`packages/rich-text/package.json`, every one with `wanted > current`. A plain
`npm update` moves them with no manifest edit.

| package | installed | in-range target |
|---|---|---|
| prosemirror-view | 1.33.9 | 1.42.2 |
| prosemirror-model | 1.22.2 | 1.25.11 |
| prosemirror-history | 1.3.2 | 1.5.0 |
| prosemirror-inputrules | 1.4.0 | 1.5.1 |
| prosemirror-commands | 1.6.0 | 1.7.1 |
| prosemirror-schema-list | 1.4.1 | 1.5.1 |
| prosemirror-gapcursor | 1.3.2 | 1.4.1 |
| prosemirror-dropcursor | 1.8.1 | 1.8.3 |
| prosemirror-state | 1.4.3 | 1.4.4 |
| prosemirror-schema-basic | 1.2.3 | 1.2.4 |
| prosemirror-keymap | 1.2.2 | 1.2.3 |

### Why this matters more than the version numbers suggest

The editor's schema acting as a lossy filter over compiled HTML is the root
cause of several bugs already fixed by hand this month — the lost bullet
indent that prompted adding an `indent` attribute to `bulletList`/`orderedList`
in `packages/rich-text/src/schema/nodes.ts`, and the grouped-vs-ungrouped
divergence in text layout. Four upstream fixes land directly on that seam:

- **`prosemirror-model` 1.25.1** — "DOM parser no longer discards nodes whose
  document representation cannot fit within parent DOM node representations."
  This is precisely the failure class we have been patching around: content
  silently dropped at parse time because the schema could not place it.
- **`prosemirror-model` 1.25.4** — the DOM parser now uses the schema's own
  line-break replacement when preserving whitespace, instead of substituting
  spaces for newlines. `structured-text.ts` emits `<br>` for hard line breaks;
  this is the code path that decides what happens to them.
- **`prosemirror-model` 1.24.1** — whitespace is preserved inside `<pre>` and
  `white-space: pre` elements automatically.
- **`prosemirror-schema-list` 1.5.1** — `liftListItem` no longer joins lists of
  different types that end up at the same level. Bullet lists of mixed
  character types are the norm in imported decks.

Two more worth knowing about, one of which is a latent CSP issue:

- **`prosemirror-model` 1.25.2** — avoids `setAttribute("style", ...)`, which
  is what breaks under a `require-trusted-types-for` / strict-CSP policy.
  Paired with **`prosemirror-view` 1.34.2**, which fixed Chrome clipboard
  pasting under that same CSP directive, and **1.39.2**, which defaults to
  `trustedTypes.defaultPolicy` for clipboard input. If Mona ever ships a strict
  CSP, staying on 1.33.9 means paste breaks in Chrome.

New capability we could actually use:

- **`view` 1.38.0** — `serializeToClipboard` exposed as a view method. Direct
  relevance to copying slide text out of Mona with formatting intact.
- **`view` 1.41.0** — `transformPasted` now receives a plain-text indicator and
  handles code blocks. Relevant to pasting PowerPoint content *into* Mona,
  where knowing whether the source was rich or plain changes how much we
  should trust the markup.
- **`view` 1.39.0** — `dragCopies` prop to configure copy-vs-move on drag.
- **`view` 1.40.0** — widget decoration `relaxedSide`; `handleTextInput`
  receives a default transaction; `dispatch` became a property.
- **`schema-list` 1.5.0** — `wrapRangeInList`, a more flexible function form of
  the `wrapInList` command.
- **`schema-list` 1.4.0** — `splitListItemKeepMarks`, preserving active marks
  when splitting a list item. Directly useful for imported runs that carry
  colour and size.
- **`history` 1.4.0 / 1.5.0** — `undoNoScroll`/`redoNoScroll`, plus
  `isHistoryTransaction` and a fix stopping undo/redo firing from
  `beforeinput` when the view is not editable.

And roughly two years of browser-quirk fixes that we would otherwise have to
discover ourselves: Chrome inserting stray `<br>` on backspace before widgets
(1.41.7), Safari composition displacing text in empty table cells (1.41.5),
`posAtCoords` confusion inside table cells (1.40.1), Android/GBoard and
SwiftKey backspace and Enter handling (1.34.1, 1.39.1, 1.41.2), Firefox
multi-range drag-selection (1.34.3), shadow-DOM selection on Safari (1.37.0,
1.41.0), and `display: contents` breaking position calculations (1.37.1).

### What it costs

Nothing by semver — but "free" and "safe" are different claims. This lands on
the exact layer we have been modifying by hand, so the fixes above could
plausibly make some of our workarounds redundant or, less happily, conflict
with them. It needs the full browser suite plus a visual pass on the two decks
we have been using as references, not just a green unit run.

### Verdict

Take it, but on its own commit, and re-check the imported bullets afterwards.
This is the upgrade most likely to silently *fix* something we had planned to
fix by hand.

---

## D03 — pptxgenjs 3.12.0 → 4.0.1 (export) — **complete**

Tracked as **X04** in `doc/PPTX_IMPORT_RENDERING_ARCHITECTURE.md` and completed
with the source-preserving export workstream. It remains imported through
`apps/web/src/features/editor/editor-export.ts` in the export feature chunk, so
it stays outside the initial bundle.

What 4.0 brings:

- **An `exports` field and completely new Node-detection logic**, fixing Vite
  and Web Worker compatibility. Node-specific imports were removed from the
  `browser` field. This is the change that matters for us — we are a Vite app
  and export is a natural candidate for a worker.
- **`textDirection`**, enabling vertical text rotation in text objects and
  table cells. OOXML expresses this as `bodyPr/@vert`; without it, a
  vertically-set text body cannot round-trip on export at all.
- Table auto-paging and hyperlink fixes for the "needs repair" dialog — the
  failure mode where PowerPoint refuses a generated file outright.
- `defineSlideMaster()` fixed when a config object is reused.
- Scheme colors accepted as `dataBorder`.

The `exports` field is the principal breaking change because it forecloses deep
imports. Mona uses the supported default import. Type-check, production build,
editable-generation round trip, imported-deck source writeback, and packaged
Electron smoke all pass on 4.0.1.

### Verdict

Completed as X04. PptxGenJS remains the Mona-native generation path; imported
decks use the retained-package writer and therefore do not mistake generator
coverage for source-preservation coverage.

---

## D04 — svg-pathdata 7.1.0 → 7.2.0 (free) / 8.0.0 (major)

Used in two places: `editor-export.ts` and `editor-pptx-import.ts`, both via
`SVGPathData` and `SVGPathDataTransformer`, for shape geometry.

**7.2.0 is in range** (`^7.1.0`) and is mostly correctness work on the exact
operations we perform on imported geometry:

- Zero-radius arcs now convert to line segments instead of producing degenerate
  output.
- Collinearity detection now verifies the middle point actually lies on the
  segment.
- Skew now uses `Math.tan` correctly.
- Arc rotation values are correctly converted to radians.
- Fixed relative arcs producing multiple Bézier curves.

Those are bug fixes in arc and skew handling, which is what OOXML preset
geometry is full of. This is a free upgrade with a plausible visual payoff on
imported shapes.

**8.0.0** adds `removeCollinear` for path optimisation and `SVGShapes`
utilities for constructing primitives. `removeCollinear` is of some interest
for export path size, but nothing in the current pipeline needs it. Note that
7.0.0 — already installed — was the release that required Node 20+ and ESM, so
that pain is behind us; 8.0.0's floor is Node ≥22.16.0, which we clear.

**9.0.0 is blocked** on Node ≥24.14.0 (see the Node floor section).

### Verdict

Take 7.2.0 now, effectively free and possibly a visual fix. Treat 8.0.0 as
optional — it adds tools we have no use for yet.

---

## D05 — nanoid 5.1.16 → 6.0.0 (presentation-core)

One call site: `packages/presentation-core/src/ids.ts`.

6.0.0 makes `nanoid()` and `customAlphabet()` roughly **4× faster** and drops
Node 18 and 20 support. There is no API change.

Worth being precise about the security angle, because the audit output is
misleading here: the `nanoid` "predictable results" advisory in `npm audit`
reaches us **through `@excalidraw/excalidraw`**, not through our own
dependency. Our direct `nanoid@5.1.16` (published 2026-06-24) is not the
affected version. Upgrading our nanoid does not clear that advisory, and the
advisory is not a reason to upgrade.

The performance claim deserves proportion: we mint IDs per element on import.
A 134 MB Canva deck with a few thousand elements is a few thousand calls —
this will not be measurable. Take it because it is trivially safe and keeps
the floor current, not because it will speed anything up.

### Verdict

Take it, low priority, no expected user-visible effect.

---

## D06 — react-router 8.2.0 → 8.3.0 — **the one direct high advisory, and it does not reach us**

`GHSA-qwww-vcr4-c8h2`, CVSS 7.1 high: a CSRF bypass allowing action execution
before a 400 response. Affects 7.12.0 through 8.2.x; fixed in 8.3.0. It is a
follow-up to CVE-2026-22030.

**It only affects applications using the unstable RSC APIs.** Mona uses
`createBrowserRouter` and `RouterProvider` (`apps/web/src/app/router.tsx`,
`apps/web/src/main.tsx`) with `useLoaderData` and `useRouteError` — the classic
data-router path. There is no RSC usage in `apps/web/src`. The vulnerability is
therefore not exploitable in Mona as it stands.

That does not make the upgrade pointless — it is a patch-level bump with a
non-major fix, it clears the only genuine red line in `npm audit`, and it
removes the need to re-derive this analysis every time someone runs the audit.
But it should be taken as hygiene, not as an incident.

### Verdict

Take it. Cheap, and it silences a high-severity report that would otherwise
keep demanding attention.

---

## D07 — the rest of `npm audit`, honestly characterised

20 advisories: 15 moderate, 5 high. My earlier reading — that react-router was
the only direct dependency involved — was wrong. There are four direct ones,
but the other three have no genuine forward fix:

| package | severity | `fixAvailable` | reality |
|---|---|---|---|
| react-router | high | 8.3.0, non-major | a real fix — see D06 |
| @excalidraw/excalidraw | moderate | 0.17.6, "semver-major" | a **downgrade** from 0.18.1; not a fix |
| shadcn | moderate | 3.8.3, "semver-major" | a **downgrade** from 4.13.1; not a fix |
| @earendil-works/pi-ai | moderate | none | no fix published |

npm reporting a downgrade as `fixAvailable` is a known rough edge; running
`npm audit fix --force` would take those downgrades and regress two working
dependencies. It should not be run.

The five high-severity entries are react-router plus four transitive ones —
`brace-expansion` (DoS via unbounded expansion), `lodash-es` (code injection
and prototype pollution), `rollup` (arbitrary file write via path traversal),
and `vite` (path traversal, plus an NTLMv2 hash disclosure via
`launch-editor`). All four report `fixAvailable: true` within existing ranges,
so a plain `npm audit fix` resolves them without touching any declared version.

Of the moderate transitives, the `esbuild` pair and the `vite` entries are
dev-server-only exposure, which is a materially lower risk for a local
development tool than the raw count suggests. `@hono/node-server` path
traversal and `@google/genai` arrive via `@modelcontextprotocol/sdk` and have
no fix available.

### Verdict

Run plain `npm audit fix` (never `--force`). Accept the four unfixable
moderates and record why.

---

## D08 — oxlint 1.74.0 → 1.75.0 with oxlint-tsgolint 0.25.0 → 7.0.2001 — **coupled, not optional**

I previously suggested leaving `oxlint-tsgolint` pinned on the grounds that
`7.0.2001` looked like a version scheme unrelated to semver. The scheme is
indeed unusual — it tracks the TypeScript-native (`typescript-go`) version
rather than the tool's own history, and the published version list jumps
straight from `0.25.0` to `7.0.2000` — but the conclusion was wrong.

`oxlint@1.75.0` declares:

```
peerDependencies: { "oxlint-tsgolint": ">=7.0.2001", "vite-plus": "*" }
```

So the two move together: taking oxlint 1.75.0 *requires* tsgolint 7.0.2001.
And the `7.0.x` line corresponds to TypeScript 7, which is already what this
repo builds with (`typescript 7.0.2` in every workspace). Far from being a
risky preview, it is the version aligned with our compiler.

Note the second peer, `vite-plus: "*"`, which we do not have — worth checking
whether npm treats that as unmet noise or a real install problem before
committing.

### Verdict

Take both together, or neither.

---

## D09 — tooling with real migration steps

**husky 8.0.3 → 9.1.7.** Our root `package.json` has `"prepare": "husky
install"`. v9 deprecated `husky install` in favour of bare `husky`, and it is
scheduled for removal in v10 — so this is a required edit, not a cosmetic one.
v9 also deprecates the `#!/usr/bin/env sh` shebang and the
`. "$(dirname -- "$0")/_/husky.sh"` sourcing line in hook files; the `husky`
command removes them automatically. `~/.huskyrc` content moves to
`.config/husky/init.sh`. Gains: hooks can call package binaries directly
without `npx`, about 0.2 s faster per hook invocation.

**@commitlint/cli 18.6.1 → 21.2.1** (and `config-conventional` to match). v21
requires Node ≥22.12.0 — fine for us. The behavioural break is that output now
shows the input on a new line; `--legacy-output` restores the old single-line
format but is explicitly transitional and slated for removal. If anything
parses commitlint output, it needs updating. v22 will make the new format the
only option. Three majors of accumulated rule and parser fixes come along;
none is individually load-bearing for us.

**image-size 1.2.1 → 2.0.2** (`apps/agent-server/src/assets.ts`). v2 ships a
proper dual ESM/CJS `exports` map. `imageSize` remains a named export, so our
`import { imageSize } from 'image-size'` still resolves. The breaking change is
that reading directly from a *file path* moved to a separate `image-size/fromFile`
entry point — we pass a buffer, so we are unaffected. Engine floor Node ≥16.

**sortablejs 1.14.0 → 1.15.7**, in range (`^1.14.0`), used in
`EditorPageGrid.tsx` and `EditorThumbnails.tsx`. Five years of fixes; the
installed release predates a lot of pointer-event and mobile handling work.
Free, and touches slide reordering, so it wants a manual drag test rather than
just a green suite.

**@types/crypto-js 4.2.1 → 4.2.2** and **@vitejs/plugin-react 6.0.3 → 6.0.4** —
in-range patches, no research warranted.

**unplugin-icons 22.5.0 → 23.0.1** is a major, but the break does not touch us.
Comparing the two manifests, v23 drops the Vue 2 peers —
`vue-template-compiler`, `vue-template-es2015-compiler`, and the `^2.7.0`
branch of `@vue/compiler-sfc`. That is the whole breaking change: Vue 2 support
removed. We consume it through `unplugin-icons/vite` and
`unplugin-icons/loaders` in `apps/web/vite.config.ts` with `~icons/*` virtual
imports, against `@svgr/core` 8.1.0 which satisfies the unchanged `>=7.0.0`
peer. A no-op for a React codebase.

**Remaining minors**, none with breaking notes: `@playwright/test` 1.61.1 →
1.62.0, `react`/`react-dom` 19.2.7 → 19.2.8, `radix-ui` 1.6.2 → 1.6.7,
`lucide-react` 1.25.0 → 1.26.0, `shadcn` 4.13.1 → 4.14.1, `react-i18next`
17.0.10 → 17.0.11, `tsx` 4.21.0 → 4.23.1, `pixelmatch` 7.1.0 → 7.2.0,
`@types/node` 24.13.2 → 26.1.1, `@earendil-works/pi-ai` 0.81.1 → 0.82.0.

`@types/node` 26 deserves one note: bumping the *types* two majors past the
*runtime* we actually run (Node 24) invites the compiler to accept APIs that do
not exist at runtime. Match the types to the runtime — stay on 24.x until Node
itself moves.

---

## Two observations outside the version question

**We ship two XML parsers.** `txml 5.1.1` in `packages/pptx-parser` and
`fast-xml-parser 5.10.1` in `apps/web`. Both are current-ish and neither is
broken, but the import pipeline having two independent notions of how XML
becomes JavaScript objects is a latent source of exactly the entity-decoding
class of bug we just fixed. Worth a consolidation decision at some point; not
urgent, and not part of this upgrade.

**ECharts 6.1.0 is already a direct dependency of `apps/web`, and current.**
This settles a scoping question for chart slice 4 (E05): building the chart
renderer over ECharts adds no new dependency and no new bundle cost beyond
what we already pay. There is nothing to install and nothing to upgrade first.

---

## Recommended sequencing

Five commits, in this order, each independently verifiable and revertable.

**1. Security hygiene.** `npm audit fix` (never `--force` — see D07) plus
react-router 8.3.0. Smallest change, clears every fixable advisory.

**2. svg-pathdata 7.2.0 + sortablejs 1.15.7 + the in-range patches.** All
inside declared ranges. Manually drag-reorder slides afterwards; look at an
imported deck with curved shapes.

**3. The ProseMirror cluster (D02).** Alone, because it is the one most likely
to change behaviour. Full browser suite, then a visual pass on the two
reference decks with attention to bullets and list indentation.

**4. txml 6 (D01).** Includes the `txml/txml` import fix, switching to
`decodeEntities: true`, and deleting `decodeXmlEscapes`/`decodeAttributes`
from `readXmlFile.js`. Add a fixture for a malformed-case entity
(`&AMP;`) first, since v6 is stricter than our hand-rolled decoder.

**5. Tooling (D08, D09).** husky 9 with the `prepare` script edit, commitlint
21, image-size 2, oxlint + tsgolint together, remaining minors. Hold
`@types/node` at 24.

Completed separately with the export workstream: **pptxgenjs 4** (D03/X04).
Still deferred: **svg-pathdata 9** and **nanoid 6**'s Node implications until
we choose to move the Node floor.

Verification after each step, per the root scripts:

```bash
npm run lint && npm run type-check && npm run test:core && npm run test:react
```

An earlier draft of this document recorded `npm run type-check` as red on the
web workspace, from in-flight work in `EditorCanvas.tsx` and
`editor-canvas-gesture-commit.ts`. That is no longer true — the work landed in
`dbfc88ff` and the check exits 0. Nothing blocks the sequence.

Four further corrections were found while turning this research into an
execution plan, each verified against the installed tree rather than inferred:

- **`txml/txml` already resolves under the installed 5.1.1.** Its exports map
  carries an explicit `"./txml"` entry alongside the `"./*"` wildcard that v6
  removes, so the import-path fix in D01 is version-independent and can land
  ahead of the version bump.
- **The `image-size` root override exists for pptxgenjs, which declares
  `^1.0.0`.** 1.2.1 is the terminal 1.x, so the override must be **deleted**,
  not repointed — repointing it to 2.0.2 would force pptxgenjs onto a major
  whose path-read API moved, putting export at risk. See D09.
- **Both of oxlint's peers are optional** (`peerDependenciesMeta` marks
  `oxlint-tsgolint` and `vite-plus` optional), so the `vite-plus` caveat in D08
  is not an install gate.
- **The only automated coverage of ProseMirror undo never runs in CI.**
  `apps/web/e2e/pptx-private-rendering.spec.ts:42` is `test.skip`-gated on
  fixtures that `.gitignore:28` excludes. Green CI is therefore not sufficient
  acceptance for the D02 upgrade; a manual private-deck pass is required.
