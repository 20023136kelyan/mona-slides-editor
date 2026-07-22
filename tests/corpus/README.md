# PPTX fidelity corpus

This test-only directory is for presentation fixtures used to compare the Vue reference application with the React migration. It deliberately lives outside Vite's `public/` tree so no corpus deck can enter a production build.

- `public/` contains redistribution-safe test decks that may be committed.
- `private/` is gitignored. Put confidential or personally owned decks there for local fidelity testing.

Real decks do not need manifests. The probe records element/type survival, warnings, round-trip behavior, and before/after renders. Never move a private deck into the public fixture directory without confirming redistribution permission.

`corpus-ground-truth.json` is generated directly from the OOXML packages by `npm run corpus:inspect`. Its raw package counts make parser losses visible even when Vue and React happen to lose the same unsupported feature.
