# React migration inventory

Status: updated through Gate 3, 2026-07-19. Update this document at every migration gate.

## Baseline identity

- Repository: PPTist-based Mona Slides restart
- Branch at audit: `codex/restart-foundation`
- Upstream reference commit: `2bfd88fe`
- Current build system: Vue 3.5, Pinia 3, Vite 5, TypeScript 5.3, SCSS
- Current tests: no unit, component, E2E, visual, or performance suite
- Current product delta: broad English/Chinese localization work plus settings/language UI, currently uncommitted at the time of this audit

The upstream commit and the intended localized state need separate tags in Gate 0. Upstream answers “what PPTist did”; the localized tag answers “what Mona did immediately before React.”

## Measured source surface

| Metric | Count |
| --- | ---: |
| `.vue` files | 197 |
| lines across `.vue` files | 32,539 |
| `.ts` files | 138 |
| `.ts` files directly importing Vue or Pinia | 70 |
| editor-view Vue files | 93 |
| shared component Vue files | 44 |
| Vue files with any style block | 180 |
| Vue files with scoped styles | 177 |
| source files with direct DOM/browser manipulation | 79 |
| source files containing emitter/mitt usage | 20 |

### Vue reactivity/lifecycle footprint

| API | Occurrences |
| --- | ---: |
| `ref` | 519 |
| `computed` | 414 |
| `watch` | 125 |
| `useTemplateRef` | 110 |
| `onMounted` | 100 |
| `onUnmounted` | 72 |
| `nextTick` | 53 |
| `watchEffect` | 10 |
| `provide` | 10 |
| `inject` | 8 |

These are navigation numbers, not automatic component-conversion estimates. Every watcher must be classified as derived state, event reaction, or external-system synchronization before translating it to React. Most should not become `useEffect` mechanically.

### Store coupling

| Store | Occurrences | Responsibility |
| --- | ---: | --- |
| `useSlidesStore` | 235 | title, theme, slides, current slide, elements, templates, document mutations |
| `useMainStore` | 212 | selection, active handle/group, canvas scale/focus, creation modes, panel/dialog state |
| `useKeyboardStore` | 29 | keyboard modifiers/hotkey state |
| `useSnapshotStore` | 11 | history snapshots and IndexedDB integration |
| `useScreenStore` | 7 | slideshow/presenter runtime state |

The current `main` store mixes durable editor-session state with transient interaction flags. Gate 2 splits those ownership classes without changing user behavior.

## Framework-neutral candidates

The following areas are candidates for extraction and reuse, not rewrite:

- `src/types/**`
- most of `src/configs/**` after translation access is injected
- geometry, SVG path, color, number, clipboard normalization, and element utilities in `src/utils/**`
- raw ProseMirror schema/plugins/utilities
- import/export transformation logic inside the large hooks after browser/UI concerns are separated
- ECharts option construction
- Dexie database schema and persistence operations
- PptxGenJS export mapping
- `pptxtojson` import normalization
- HTML/image render helpers
- existing JSON mocks and templates

The initial audit found 68 TypeScript files that do not directly import Vue or Pinia. They still require side-effect and browser-dependency review before being labeled portable.

## Framework-bound areas

- every Vue single-file component and directive
- Pinia store definitions and cross-store getters
- Vue I18n runtime and Vue-specific lint/build plugins
- Vue lifecycle/reactivity wrappers around ProseMirror, ECharts, media, and canvas DOM
- `vuedraggable`
- `unplugin-vue-components` and the Vue icon resolver
- component-scoped SCSS compilation behavior
- template refs and imperative DOM lookup assumptions
- `provide`/`inject` editor context

Framework-bound does not mean “discard.” It means preserve behavior while replacing the adapter.

## High-risk hotspots

| Hotspot | Approximate size | Risk |
| --- | ---: | --- |
| `src/hooks/useImport.ts` | 1,377 lines | parser normalization, browser files, theme/element fidelity |
| `src/hooks/useExport.ts` | 1,010 lines | PPTX/PDF/image behavior and element-specific mapping |
| `src/configs/shapes.ts` | 972 lines | large but mostly data; avoid accidental rewrite |
| `src/views/components/element/TableElement/EditableTable.vue` | 886 lines | merged cells, selection, resizing, rich interaction |
| `src/types/slides.ts` | 805 lines | central persisted contract; freeze during port |
| `src/views/Editor/CanvasTool/SVGPathEditor.vue` | 766 lines | geometry plus high-frequency pointer behavior |
| `src/views/components/element/VideoElement/VideoPlayer/index.vue` | 723 lines | lifecycle, media events, cleanup |
| `src/utils/element.ts` | 654 lines | cross-feature geometry and mutation helpers |
| `src/hooks/useScaleElement.ts` | 653 lines | critical resize/scale semantics and performance |
| `src/views/Editor/Canvas/ElementFloatLayer/ImageClipHandler.vue` | 646 lines | crop transforms and gesture behavior |
| `src/views/Editor/Toolbar/SlideDesignPanel/index.vue` | 613 lines | theme/design state and many controls |
| `src/components/ChartDataEditor.vue` | 563 lines | table-like editing plus chart lifecycle |
| `src/views/Editor/Thumbnails/index.vue` | 544 lines | drag/reorder, virtual/scroll behavior, selection |

## Engine disposition

| Dependency/capability | First-port decision | Later review |
| --- | --- | --- |
| ProseMirror packages | retain | upgrade independently after rich-text parity |
| ECharts | retain | upgrade only with chart fixtures |
| Dexie | retain | isolate behind persistence interface |
| PptxGenJS | retain | upgrade only with export corpus |
| `pptxtojson` | retain | replace only if corpus proves a parser blocker |
| `html-to-image` | retain | benchmark after visual parity |
| `mitt` | contain behind adapters | remove global event channels where direct ownership exists |
| Pinia | temporary Vue oracle only | remove at React cutover |
| Vue I18n | temporary Vue oracle only | React uses i18next/react-i18next |
| `vuedraggable` | replace in thumbnail slice | select React library after interaction contract exists |
| Vue icon tooling | retain for oracle | new surfaces use chosen shadcn icon setup; preserve parity icons first |

## Required parity ownership map

Before a feature starts, add its exact files and tests to this table.

| Domain | Vue reference | React target | Contract status |
| --- | --- | --- | --- |
| app shell/settings/i18n | `src/App.vue`, header/settings, `src/i18n/**` | `apps/web` shell | localization behavior exists; React contract pending |
| document model | `src/types/slides.ts` compatibility export, `src/store/slides.ts` Vue adapter | `presentation-core`, `editor-state` | Gate 2 core/Vue operation contract automated; renderer pending |
| selection/canvas session | `src/store/main.ts`, canvas hooks/components | `editor-state`, `editor-interactions` | Gate 2 isolated state/gesture prototypes automated; Vue UI port pending |
| history | `src/store/snapshot.ts` | `PresentationHistoryAdapter` | contract defined; existing Dexie implementation intentionally retained |
| slide renderer | Vue thumbnail/base element components remain the oracle | `apps/web/src/features/presentation-renderer/**` | Gate 3 read-only parity automated for all nine element types; editing pending |
| thumbnails | `ThumbnailSlide` and `Thumbnails` remain the oracle | React read-only rail and shared `ScaledSlide` | Gate 3 rendering/selection automated; drag, sections, notes, and editing pending |
| import | `src/hooks/useImport.ts` | runtime adapter | corpus required |
| export | `src/hooks/useExport.ts`, export dialogs | runtime adapter + React dialogs | corpus required |
| slideshow/presenter | `src/views/Screen/**` | React screen application | pending |
| mobile | `src/views/Mobile/**` | React responsive/mobile surfaces | pending |

## Audit commands

Repeatable examples used for this inventory:

```sh
find src -name '*.vue' -type f | wc -l
find src -name '*.vue' -type f -print0 | xargs -0 wc -l | tail -1
find src -name '*.ts' -type f | wc -l
rg -l "from ['\"]vue['\"]|from ['\"]pinia['\"]" src --glob '*.ts' | wc -l
rg -l '<style' src --glob '*.vue' | wc -l
rg -l '<style[^>]*scoped' src --glob '*.vue' | wc -l
rg -l 'document\.|window\.|querySelector|getBoundingClientRect|addEventListener|removeEventListener' src | wc -l
```

Counts must be refreshed after every gate and are expected to decrease only when a complete surface is replaced.
