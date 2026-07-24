# PPTX fidelity corpus

This test-only directory is for presentation fixtures used to compare the Vue reference application with the React migration. It deliberately lives outside Vite's `public/` tree so no corpus deck can enter a production build.

- `public/` contains redistribution-safe test decks that may be committed.
- `private/` is gitignored. Put confidential or personally owned decks there for local fidelity testing.

Real decks do not need manifests. The probe records element/type survival, warnings, round-trip behavior, and before/after renders. Never move a private deck into the public fixture directory without confirming redistribution permission.

`corpus-ground-truth.json` is generated directly from the OOXML packages by `npm run corpus:inspect`. Its raw package counts make parser losses visible even when Vue and React happen to lose the same unsupported feature.

The five redistribution-safe decks are also executable browser fixtures. Run:

```bash
npm run e2e --workspace=@mona/web -- e2e/pptx-corpus.spec.ts
```

That test imports each real `.pptx` through Mona's hidden File input and
compares live presentation state with the checked-in baseline: slide and
element counts, element types, hyperlinks, notes, groups, rotation, and
viewport geometry. The files remain outside Vite's `public/` tree and never
enter a production build.

The baseline is a regression floor, not a claim that every source feature is
supported. Known limitations remain visible in each baseline's `parserGaps`:

- `corpus-04-chart-table.pptx` now imports and renders its native bar, line,
  and pie charts. Its package-absolute relationship targets are a regression
  fixture for the OPC resolver;
- the synthetic group fixture retains its native recursive group tree,
  including the third nested level, without relying on Mona's legacy
  single-level `groupId` membership adapter;
- the real corporate fixture now preserves all five source groups as
  actionable Mona groups;
- SmartArt in the real design fixture is not editable SmartArt after import,
  although its converted child elements remain grouped for manipulation.

When the private fixtures are present, run the real-deck rendering gate with:

```bash
npm run e2e --workspace=@mona/web -- pptx-private-rendering.spec.ts
```

It requires zero dropped modeled objects and exercises chart SVG output, table
cells, loaded image pixels, and shared master/layout layers. Set
`MONA_WRITE_FIDELITY_SCREENSHOTS=1` to write representative canvases to
`.artifacts/pptx-fidelity/`.

Do not change a baseline merely to make the executable test pass. Investigate
the parser/rendering change, update the relevant `parserGaps`, and record why
the new result is better or intentionally different.
