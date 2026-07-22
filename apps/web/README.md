# Mona Slides web application

`apps/web` is the sole production frontend. It is a React 19, TypeScript 7,
Vite 8 client application containing the desktop editor, mobile editor and
preview, slideshow/presenter surfaces, settings, and import/export workflows.

Use the repository-root commands so workspace checks run consistently:

```sh
npm run dev
npm run type-check
npm run lint
npm run test:react
npm run e2e:react
npm run build
```

Development-only deterministic decks are selected by the parity suites through
`rendererFixture`. That router and its fixture deck are compile-time excluded
from production. The retired compiled Vue implementation lives only in
`tests/oracle/vue/` and is served only by the parity harness.

See [`doc/REACT_MIGRATION_BLUEPRINT.md`](../../doc/REACT_MIGRATION_BLUEPRINT.md),
[`tests/parity/PARITY_MATRIX.md`](../../tests/parity/PARITY_MATRIX.md), and
[`doc/GATE_8_CUTOVER_LEDGER.md`](../../doc/GATE_8_CUTOVER_LEDGER.md).
