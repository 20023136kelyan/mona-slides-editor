# React foundation

Status: Gate 1 complete, 2026-07-19 (`07b6b42b`).

The React application lives in `apps/web` and runs beside the untouched Vue reference. Vue remains at port 5173; React uses port 5174. Nothing in Gate 1 replaces editor behavior.

## Selected toolchain

All versions are exact in `apps/web/package.json` and were checked against their official documentation and npm releases on 2026-07-19.

| Layer | Selection |
| --- | --- |
| Runtime | React / React DOM 19.2.7 |
| Build | Vite 8.1.5 and `@vitejs/plugin-react` 6.0.3 |
| Language | TypeScript 7.0.2 native compiler |
| Lint | Oxlint 1.74.0 + `oxlint-tsgolint` 0.25.0 |
| Styling | Tailwind CSS / Vite plugin 4.3.3 |
| Components | shadcn 4.13.1, Radix Nova preset, Radix base |
| Routing | React Router 8.2.0 Data Mode |
| Localization | i18next 26.3.6 / react-i18next 17.0.10 |
| Unit/browser tests | Vitest 4.1.10, Playwright provider, `vitest-browser-react` 2.2.0 |
| E2E/visual | Playwright 1.61.1 |

### TypeScript 7 decision

TypeScript 7 is the native Go compiler. Microsoft reports typical full-build improvements of 8–12× and lower aggregate memory use on large projects: [TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).

The first install deliberately tested `typescript-eslint` 8.64.0. Its current peer range is `typescript >=4.8.4 <6.1.0`, so forcing it would make the toolchain unsupported. Mona instead uses Oxlint's native TypeScript, React Hooks, accessibility, import, Vitest, and experimental React Compiler analysis. Oxlint's type-aware path uses the TypeScript 7 type system: [Oxlint guide](https://oxc.rs/docs/guide/usage/linter/), [built-in plugin coverage](https://oxc.rs/docs/guide/usage/linter/plugins.html).

`tsc -b` runs with TypeScript 7.0.2 and passes. TypeScript 7 removed `baseUrl`, so aliases use `paths` plus Vite's explicit `resolve.alias` with no legacy option.

## Framework choices

The app is a client-side Vite SPA. React Router is used in Data Mode with the router created once outside the React tree and the first page loaded through `route.lazy`. This preserves a small bootstrap boundary and leaves room for route loaders and error boundaries without introducing a server framework.

React Compiler 1.0 is enabled through Vite 8's documented `reactCompilerPreset()` and `@rolldown/plugin-babel`. React Strict Mode is enabled from the first render. References: [Vite plugin-react 6 release](https://github.com/vitejs/vite-plugin-react/releases/tag/plugin-react%406.0.0), [React Compiler](https://react.dev/learn/react-compiler/introduction).

Production source maps are explicitly disabled at this gate. They may be enabled only alongside a defined private error-reporting upload and retention policy; public hosted `.map` files are not an accidental default. Vite's development console forwarding is enabled so browser errors are also visible to the local development process.

Tailwind uses its first-party Vite plugin and CSS-first v4 configuration. shadcn is source-owned with the Radix Nova preset and Radix primitive base. The generated Geist font was removed and the UI token uses the existing system font stack so the framework change does not silently change editor typography.

## Current proof surface

The first React page intentionally contains no editor implementation. It proves:

- workspace and side-by-side dev/build scripts;
- lazy routing and a route error boundary;
- Strict Mode and React Compiler build integration;
- Tailwind v4 and reviewed shadcn Button, Popover, and Select source;
- the same English/Chinese JSON catalogs and `mona:ui-locale` storage contract as Vue;
- document language/direction updates;
- an accessible settings button and working language switch;
- Node catalog parity and real-browser component tests.

The temporary foundation shell uses the current editor geometry only to make side-by-side review easy. It is not counted as an editor slice and cannot replace Vue.

## Commands

```sh
npm run dev:react
npm run build:react
npm run lint:react
npm run test:react
```

The initial production foundation build is 30.20 kB CSS / 6.08 kB gzip, a 363.11 kB bootstrap JavaScript chunk / 116.68 kB gzip, a lazy 125.47 kB foundation chunk / 40.91 kB gzip, and 28.88 kB of lazy Chinese catalog chunks / 12.00 kB gzip. These are tracked as foundation measurements, not compared directly with the complete Vue editor.

Five isolated Chromium runs against `vite preview` produce a 64.9 ms median foundation-ready time, 22.5 ms DOM-content-loaded time, 40 ms first contentful paint, three resource requests, 162,938 transferred bytes, and a 10.0 MB used-JavaScript-heap sample. The machine-readable reports are `tests/parity/baselines/react-foundation-build.json` and `react-foundation-runtime.json`.

`npm audit --omit=dev` reports seven advisories after the workspace lockfile is resolved: three moderate, three high, and one critical. They remain in the inherited Vue/PPTist dependency tree (`axios`, ECharts, `follow-redirects`, `form-data`, `image-size`, Lodash, and Nano ID); no React-foundation runtime dependency adds a production advisory. The shadcn CLI is intentionally a development dependency.
