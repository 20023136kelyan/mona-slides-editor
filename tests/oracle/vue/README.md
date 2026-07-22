# Frozen Vue parity oracle

This directory contains the final compiled Vue reference used by the two-sided
Mona Slides parity suites after the React cutover. It is a test artifact, not a
second production application and not a supported source tree.

The artifact was built from the last Gate 7-complete Vue source with:

```sh
VITE_ORACLE_BUILD=1 npx vite build --mode development --outDir .artifacts/vue-oracle-build
```

`mode=development` preserves the deterministic Gate 3–7 fixture routing. The
explicit `VITE_ORACLE_BUILD` flag preserves only the read-only state bridge used
by parity tests. Neither feature is exposed by the React production build.

The JavaScript, CSS, and HTML are frozen here. The test-only server resolves the
hashed font requests to the byte-identical archived fonts in `fonts/`, and
serves fixture JSON and images from `public/`. The oracle is therefore
self-contained with respect to every retired Vue-compiled asset.

Do not regenerate this artifact after Vue source removal. Any intentional React
behavior change must be approved against this immutable reference or recorded
as an explicit product divergence.
