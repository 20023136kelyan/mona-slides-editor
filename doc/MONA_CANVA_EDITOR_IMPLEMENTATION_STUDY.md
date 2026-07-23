# Mona editor implementation study

**Status:** living implementation blueprint and release-evidence record

**Date:** 2026-07-24

**Scope:** map the observed Canva editor behavior and global header model onto the current Mona React codebase, end to end.

This document combines:

- the live Canva editor behavior study in `doc/CANVA_EDITOR_BEHAVIOR_STUDY.md`;
- the live Canva global-header study in `doc/CANVA_GLOBAL_HEADER_STUDY.md`;
- a source-level audit of Mona's current editor, state, rendering, persistence, presentation, AI, and overlay code;
- a live measurement of the current Mona editor at 1357 × 988.

It does not propose copying Canva's brand, source code, colors, icons, or proprietary assets. The goal is to reproduce the interaction grammar users already understand while preserving Mona's neutral visual language and making the drawing-first AI workflow the product's unique capability.

---

## 1. Executive conclusion

Mona does **not** need another editor rewrite.

The presentation model, command transaction layer, canvas renderer, element interactions, import/export paths, rich-text runtime, slide thumbnails, presentation mode, and much of the element-specific editing UI are useful foundations. The main problem is the application shell around them:

- the header, rail, task panels, contextual controls, bottom workflow, and overlays do not share one state model;
- several visually present features are only partial workflows;
- comments and speaker notes use confusingly overlapping names and separate panel systems;
- autosave works but cannot report its real state to the UI;
- history stores only slides and the active index, not the complete document state;
- the current AI dialog opens, but its generation request has no consumer;
- local window events coordinate core application behavior that should be typed React services;
- selection controls are assembled with component-local type checks rather than a capability model;
- the rail owns the full viewport height, while the target editor requires a full-width global header above the rail and workspace.

The correct migration is therefore:

1. preserve the editor engine;
2. introduce typed shell, application-action, persistence, and overlay contracts without changing behavior;
3. move the global header above the workspace;
4. unify left-side work into one shared task panel;
5. make contextual controls capability-driven;
6. complete the bottom page workflow;
7. add a genuine drawing mode;
8. connect AI through validated presentation transactions and an agent-safe JavaScript SDK.

Each stage must be independently complete and testable before the next begins. A control being visible is not evidence that its workflow is complete.

---

## 2. Evidence from the current application

At a 1357 × 988 viewport, the current live Mona shell measured:

| Surface | Current geometry |
| --- | --- |
| Persistent rail | x 0, y 0, 72 × 988 |
| Header | x 72, y 0, 1285 × 40 |
| Editor body | x 72, y 40, 1285 × 948 |
| Contextual bar | x 72, y 60, 1285 × 40 when the task panel is closed |
| Filmstrip | x 72, y 854, 1285 × 90 when the task panel is closed |
| Status bar | x 72, y 944, 1285 × 44 when the task panel is closed |

With the Templates panel open:

| Surface | Open-panel geometry |
| --- | --- |
| Task drawer | x 72, y 40, 292 × 948 |
| Editor stage | x 364, y 40, 993 × 814 |
| Slide frame | x 413.65, y 195.64, 893.70 × 502.70 |

With it closed:

| Surface | Closed geometry |
| --- | --- |
| Editor stage | x 72, y 40, 1285 × 814 |
| Slide frame | x 136.25, y 121.73, 1156.50 × 650.53 |

This confirms that the existing drawer already refits the workspace rather than covering it. That behavior should be retained. Its ownership, width, routing, and relationship to the header need to change.

### 2.1 Current shell ownership

`EditorDeck.tsx` currently owns:

- creation-tool state;
- path editor state;
- image-library state;
- chart and LaTeX editor state;
- rail-panel state;
- contextual-inspector state;
- speaker-note visibility and height;
- rendering of session panels such as comments, search, selection, and markup.

`FoundationPage.tsx` separately owns:

- the AI dialog;
- export UI;
- slideshow/presentation mode;
- persistence lifetime;
- restoration UI.

`EditorHeader.tsx` separately owns:

- its open popover;
- title editing;
- File, View, Tools, Present, AI, Export, and Settings entry points.

This distribution is why exclusivity, focus return, closing behavior, and cross-surface actions are inconsistent.

### 2.2 Current model strengths

The existing presentation model already supports:

- editable slides and elements;
- element groups;
- comments through `Slide.notes`;
- speaker notes through `Slide.remark`;
- element animations;
- slide transitions through `Slide.turningMode`;
- slide sections;
- theme and viewport information;
- merged table cells through row/column spans;
- multiple element types, including charts, tables, equations, audio, and video.

The editor session already supports:

- element and multi-element selection;
- group drill-in via `activeGroupElementId`;
- multi-slide selection;
- canvas zoom and pan;
- crop mode;
- table-cell selection;
- ruler and guide state;
- active creation tools;
- contextual inspector state.

These are foundations to expose coherently, not features to recreate.

### 2.3 Current architectural weaknesses

#### History

`editor-runtime.ts` snapshots only:

- `slides`;
- `slideIndex`.

Title, theme, viewport, and templates are excluded. The title is therefore committed with `recordHistory: false`. This is incompatible with an agent that must make one undoable document edit across any valid presentation property.

#### Runtime origin

The core transaction type already supports:

```ts
type PresentationTransactionOrigin =
  | 'user'
  | 'agent'
  | 'import'
  | 'system'
  | 'test'
```

However, `EditorRuntime.commit()` always creates an origin of `user`. The correct seam for agentic editing exists but is not exposed.

#### Persistence

IndexedDB autosave is real and includes blob media. Its public contract exposes only:

```ts
interface DeckPersistence {
  isDirty(): boolean
  stop(): void
}
```

The header therefore cannot honestly show saving, saved, failed, last-saved, or retry states.

#### AI

The AI button now opens `EditorAgentDialog`. The dialog dispatches `mona:agent-generate-request`, but no code listens for that event. Its submit path is not an AI editing workflow.

There is also an older `ai-writing.ts` text-writing endpoint used by text controls. It directly streams writing into rich text and is not a provider-neutral agent transaction pipeline.

#### React subscriptions

Several large components subscribe to the full presentation or full session object. `useEditorSelector` is a thin `useSyncExternalStore` wrapper without an equality layer. This causes shell UI to rerender for document changes it does not consume. React Compiler does not correct unstable external-store snapshot selection.

#### Overlay behavior

Mona mixes:

- shadcn/Radix dialogs, sheets, popovers, dropdowns, and context menus;
- local component booleans;
- legacy moveable panels with manual z-index ranges;
- document-level mouse handlers;
- hard-coded selectors in `EditorDeck` to preserve focus around portalled controls;
- window `CustomEvent` dispatch for core application actions.

This makes new workflows increasingly fragile.

---

## 3. What to keep, extend, replace, and postpone

| Area | Decision | Reason |
| --- | --- | --- |
| `@mona/presentation-core` model and command validation | Keep and extend | Framework-neutral, already transaction-based and validated |
| `@mona/editor-state` canonical store | Keep and extend | Correct home for document/session interaction state |
| `@mona/editor-interactions` geometry | Keep | Existing canvas behavior is valuable and should not be destabilized by shell work |
| `EditorCanvas` renderer and element components | Keep | The redesign is a shell change, not a rendering rewrite |
| Rich-text runtime | Keep | Already isolates rich-text behavior |
| `EditorThumbnails` selection/reorder/context foundations | Keep and refactor | Strong workflow base; missing the complete page experience |
| Existing element style/position/animation controls | Recompose | Controls exist but are split between top, floating, and side surfaces |
| `EditorRail` and drawer | Refactor into rail + shared task panel | Existing refit behavior is useful, current routing and width are partial |
| `EditorHeader` | Replace structurally | Current 40 px, right-of-rail header cannot become the target with small patches |
| `EditorContextToolbar` | Replace composition logic | Needs a capability resolver, mixed selection, and explicit mode handling |
| `EditorMoveablePanel` for ordinary editor work | Retire | Competes with the shared task-panel model and manual overlay rules |
| `window` custom events for AI/export/presentation | Replace | Core application actions should be typed and scoped |
| Persistence implementation | Extend | Save mechanism works; observable lifecycle is missing |
| AI dialog submit pipeline | Replace | Current request event is unhandled |
| Local comments | Keep, rename, and surface coherently | Data is real; the UI placement and terminology are confusing |
| Remote collaboration, presence, analytics | Postpone | Do not build fake controls before the services exist |
| Auth/account menu | Postpone behind an interface | Settings can remain; use an avatar only when identity is real |

---

## 4. Target editor shell

The target shell is a stable application frame with a full-width header:

```text
┌──────────────────────────────────────────────────────────────┐
│ Global document header                                       │ 56
├────────┬────────────────┬────────────────────────────────────┤
│ Rail   │ Shared task    │ Contextual command zone            │
│ 72     │ panel 360      ├────────────────────────────────────┤
│        │ when open      │                                    │
│        │                │ Canvas workspace                   │
│        │                │                                    │
│        │                ├────────────────────────────────────┤
│        │                │ Page strip / page grid workflow    │
│        │                ├────────────────────────────────────┤
│        │                │ Utility/status bar                 │
└────────┴────────────────┴────────────────────────────────────┘
```

Recommended CSS grid:

```css
.mona-editor-shell {
  display: grid;
  grid-template:
    "header header header" var(--editor-header-height)
    "rail panel workspace" minmax(0, 1fr)
    / var(--editor-rail-width) auto minmax(0, 1fr);
}
```

Tokens:

```css
--editor-header-height: 3.5rem; /* 56 px */
--editor-rail-width: 4.5rem;    /* 72 px */
--editor-task-panel-width: 22.5rem; /* 360 px */
--editor-context-height: 3.25rem;
--editor-status-height: 2.75rem;
```

These are editor geometry tokens, separate from brand tokens and component corner-radius tokens.

### Required invariants

- The header spans the full viewport.
- The rail begins below the header.
- Opening a shared task panel changes available workspace dimensions; it does not cover the slide.
- Slide document coordinates never change when a panel opens. The screen transform may refit.
- The contextual zone belongs to the workspace, not to the task panel.
- The bottom workflow remains reachable in every ordinary editing mode.
- Presentation mode is a distinct application activity, not an overlay over the editor.

---

## 5. State ownership model

Four state layers prevent a new monolithic store.

### 5.1 Document state

Home: `@mona/presentation-core` and the canonical editor store.

Examples:

- title, theme, viewport;
- slides and elements;
- page notes and comments;
- page title, hidden state, duration, transitions;
- agent-applied content changes.

Every mutation is a validated `PresentationTransaction`.

### 5.2 Editor session state

Home: `@mona/editor-state`.

Examples:

- selection and group drill-in;
- canvas zoom/pan;
- select/create/draw/text-edit/crop mode;
- active task-panel route;
- workspace mode: canvas or page grid;
- selected slides;
- transient guides and rulers.

This state may be reset without changing the presentation.

### 5.3 Shell UI state

Home: a small React context/reducer at editor-shell level.

Examples:

- open header overlay;
- focused modal;
- utility popover such as timer;
- panel return focus;
- mobile/compact disclosure.

This is view coordination, not presentation data.

### 5.4 Application services

Home: `EditorApplicationProvider` created in `FoundationPage`.

Examples:

- import/export requests;
- open agent workspace;
- enter presentation mode;
- persistence status;
- future identity/share providers;
- media/image search providers.

This replaces intra-app window events while preserving lazy loading at the page boundary.

### Proposed types

```ts
type EditorWorkspaceMode = 'canvas' | 'page-grid'

type EditorCanvasMode =
  | { kind: 'select' }
  | { kind: 'text-edit'; elementId: string }
  | { kind: 'crop'; elementId: string }
  | { kind: 'create'; tool: CreateTool }
  | { kind: 'draw'; tool: DrawingTool }

type EditorTaskPanelRoute =
  | { kind: 'create'; category: CreationCategory }
  | { kind: 'properties'; panel: PropertyPanel; elementIds: string[] }
  | { kind: 'speaker-notes'; slideId: string }
  | { kind: 'agent'; scope: AgentScope }
  | { kind: 'search' }
  | { kind: 'layers' }
  | null

type HeaderOverlay =
  | 'file'
  | 'save-status'
  | 'comments'
  | 'present'
  | 'share'
  | 'account'
  | null
```

Only one `HeaderOverlay` may be open. A task panel may remain open while an ordinary header popover opens. Entering a modal or presentation mode closes transient popovers and utility controls.

---

## 6. Global header implementation

The header is a document command surface, not a decorative toolbar.

### 6.1 Layout

Use a three-column grid:

```css
grid-template-columns: minmax(0, 1fr) minmax(12rem, 32rem) minmax(0, 1fr);
```

- Left group: navigation/document commands.
- Center: stable editable title.
- Right group: document output and application commands.
- The title remains centered in available space, not merely placed between two flex groups.
- All standard targets are 40 px high inside the 56 px header.

### 6.2 Left group

Implement only real commands:

- Home, once Mona has a real destination;
- File menu;
- optional Resize when viewport/page resizing is ready;
- editing mode;
- undo;
- redo;
- observable save state.

Do not show unsupported history, collaboration, or cloud lifecycle items as active controls.

### 6.3 Title

The present Button-to-Input swap should be removed. It causes different box metrics and is the source of the title jump.

Use one input for resting and editing states:

```tsx
<Input
  aria-label={t('header.presentationTitle')}
  className="..."
  onBlur={commit}
  onFocus={beginDraft}
  onKeyDown={handleTitleKeyDown}
  readOnly={!editing}
  value={draftOrTitle}
/>
```

Contract:

- pointer or Enter enters edit mode;
- Cmd/Ctrl+A selects the title text when editing;
- Enter commits;
- Escape restores the original draft and exits;
- blur commits only if Escape did not cancel;
- the outer box never changes width, padding, font, or alignment;
- no translated fallback is stored as a document title;
- an empty stored title renders a localized placeholder only.

Title edits should become undoable after history is upgraded to capture the complete presentation state.

### 6.4 Save status

Expose real persistence state:

```ts
interface DeckPersistenceSnapshot {
  dirty: boolean
  status: 'saved' | 'saving' | 'error'
  savedAt: number | null
  pendingSince: number | null
  error: { message: string; recoverable: boolean } | null
}
```

The header control displays:

- `Saving…` only while a write is in flight;
- `Saved` only after IndexedDB confirms the write;
- an error state with Retry when saving fails;
- local-storage wording, not cloud-sync wording.

A later remote persistence adapter may add offline/sync/conflict states without changing the header API.

### 6.5 File menu

Use the existing shadcn `DropdownMenu`, grouping real commands with `DropdownMenuGroup`, `DropdownMenuSeparator`, submenus, and shortcut labels.

Initial complete menu:

- New presentation, with confirmation if dirty;
- Import PowerPoint;
- Export submenu;
- Presentation metadata;
- Search;
- View/accessibility commands that already work;
- local save-status detail.

Resetting the deck from File must use `AlertDialog`, not a direct destructive mutation.

### 6.6 Right group

Initial:

- local comments overview;
- Present split button;
- AI entry;
- Export or Share/Publish, depending which workflow is real;
- Settings/account entry.

Later, when backed by services:

- identity/avatar;
- Share panel;
- analytics;
- collaboration state.

Do not create a Canva-like Share control that has no access model. Mona can retain Export as the real primary output action until sharing exists.

### 6.7 Components

Use existing or official shadcn components:

- `Button`, `ButtonGroup`;
- `Input`;
- `DropdownMenu`;
- `Popover`;
- `Separator`;
- `Tooltip`;
- `Dialog`/`AlertDialog`;
- `Avatar` once identity is real;
- `ScrollArea` for long menus/panels;
- `Sonner` for non-blocking operation results.

Use the project's semantic neutral tokens. Brand red/orange is limited to Mona identity and intentional AI emphasis, never broad application chrome.

---

## 7. Rail and shared task panel

### 7.1 Persistent rail

The 72 px rail is already close to the target geometry. Change its information architecture:

- Design/Templates;
- Elements;
- Text;
- Uploads/Media;
- Draw;
- Projects or assets when real;
- Apps/Tools when real;
- AI as a first-class Mona entry.

Specific charts, tables, equations, shapes, lines, images, audio, and video belong inside Elements or Tools rather than all competing at rail level.

The current rail can preserve direct expert shortcuts in a `More` or configurable section later.

### 7.2 Shared task panel

Rename `EditorRailDrawer` conceptually to `EditorTaskPanel`.

One panel frame renders routed content:

- creation catalogs;
- design/templates;
- text presets;
- uploads/media;
- element properties;
- position/layers;
- animation;
- speaker notes;
- search;
- AI workspace.

Panel contract:

- one active route;
- 360 px standard width;
- optional user resize only if every route supports it;
- route header, optional search, content scroll, optional footer;
- Esc returns focus and closes unless a nested control handled Esc;
- switching rail categories replaces panel content without closing/reopening animation;
- selected-element changes update or close property routes according to an explicit rule;
- opening the panel refits the workspace.

### 7.3 Retire duplicate panels

Migrate ordinary work out of `EditorMoveablePanel`:

- `EditorSelectionPanel` → Layers route;
- `EditorSearchPanel` → Search route;
- `EditorNotesPanel` → Comments surface;
- `EditorMarkupPanel` → Draw route or markup utility, depending final purpose.

Keep a moveable/floating surface only when floating is intrinsic to the task, such as a timer or presentation utility.

### 7.4 Speaker notes versus comments

Rename concepts in code:

- `Slide.remark` UI → `SpeakerNotes`;
- `Slide.notes` UI → `Comments`.

The data model may retain legacy field names for compatibility, but feature and translation names must be unambiguous.

---

## 8. Contextual controls

The current `EditorContextToolbar` demonstrates the correct location but not the final architecture.

### 8.1 Capability resolver

Create a pure resolver:

```ts
interface SelectionCapabilities {
  selectionKind: 'page' | 'text' | 'image' | 'shape' | 'line'
    | 'chart' | 'table' | 'media' | 'equation' | 'mixed'
  canFill: boolean
  canStroke: boolean
  canCrop: boolean
  canEditText: boolean
  canAnimate: boolean
  canPosition: boolean
  canGroup: boolean
  canUngroup: boolean
  canLink: boolean
  canLock: boolean
  mixedValues: Set<CapabilityKey>
}
```

Inputs:

- selected elements;
- handle element;
- active group child;
- canvas mode;
- selected table cells;
- permissions.

Output:

- primary controls;
- overflow commands;
- deep panel routes;
- adjacent lifecycle actions.

The React component renders a model. It should not contain a growing tree of element-type conditionals.

### 8.2 State matrix

At minimum, verify:

| State | Primary controls | Deep actions |
| --- | --- | --- |
| Page | background/design, transition, duration | Design, Animate |
| Group | group-level style where valid | Position, Animate, Layers |
| Single text selected | font, size, emphasis, color, alignment | Effects, Position, Animate |
| Text editing | text formatting; suppress object-only actions | Link, advanced typography |
| Image | crop, flip, transparency | Edit image, Position, Animate |
| Shape/vector | fill, stroke, transparency | Edit path when supported, Position, Animate |
| Line | stroke, endpoints, weight, style | Position, Animate |
| Chart | chart type/data shortcuts | Data, Style, Position, Animate |
| Table | cell fill/border/text | Table properties, Position, Animate |
| Mixed selection | only shared capabilities; mixed-value indicators | Position, Group, Animate |
| Group child | child capabilities plus explicit return-to-group | Parent group/layers |

### 8.3 Top versus object-adjacent controls

- Top contextual pill: formatting and property entry points.
- Object-adjacent pill: lifecycle actions such as duplicate, delete, lock, and selection traversal.
- Rich-text bubble: caret/range-specific commands only.

Do not render the same formatting controls simultaneously in all three places.

### 8.4 Page selection

“No selected element” must not automatically mean “page selected.”

Add an explicit page/canvas selection state so the contextual pill can disappear when the user is in a non-page mode, while still showing page controls when the page itself is selected.

---

## 9. Bottom page workflow

The existing filmstrip is strong enough to extend.

### 9.1 Preserve

- active-page focus;
- Cmd/Ctrl and Shift multi-selection;
- SortableJS reordering;
- duplicate, delete, copy, paste, new page;
- sections;
- slide thumbnail rendering;
- presenter entry.

### 9.2 Add

- Pages toggle rather than an always-forced strip;
- direct page-number input;
- page-grid overview;
- speaker-notes entry;
- timer utility;
- page duration;
- explicit transition boundary control;
- per-page title;
- hidden-page state;
- insertion affordances between pages;
- Help/shortcuts;
- Present shortcut.

### 9.3 Page grid is a workspace mode

The grid overview is not a modal. It replaces the canvas workspace while preserving:

- rail;
- global header;
- selected slides;
- task panel when compatible;
- bottom utility state.

It supports:

- multi-selection;
- reorder;
- duplicate/delete;
- bulk hide/unhide;
- section movement;
- return to a chosen page.

### 9.4 Model additions

Add only through a versioned model migration:

```ts
interface Slide {
  title?: string
  hidden?: boolean
  durationMs?: number
}
```

Before adding `locked`, decide whether page lock means collaboration permission, edit protection, or a local accidental-edit guard. Those are different features.

Every addition requires:

- validation;
- normalize/default behavior;
- storage migration;
- import behavior;
- PPTX export behavior;
- slideshow behavior;
- duplication/copy behavior;
- undo/redo tests.

---

## 10. Drawing-first Mona workflow

Drawing is not another custom-shape tool. It is a first-class canvas mode used to communicate intent to the agent.

### 10.1 Drawing layer

Use an Excalidraw-compatible scene layer or another scene-graph implementation with:

- editable vector strokes;
- text blocks;
- arrows and connectors;
- rectangles/ellipses;
- eraser;
- color and width;
- lasso/select;
- undo independent from presentation history until applied;
- scene JSON persistence;
- SVG/PNG export for model vision.

The scene must be anchored to slide coordinates, not browser pixels.

```ts
interface SlideSketch {
  version: number
  slideId: string
  scene: unknown
  updatedAt: number
}
```

Store sketches separately from PowerPoint elements until the user explicitly applies them or asks the agent to interpret them. This avoids exporting rough instructions as presentation content.

### 10.2 Mode behavior

- Draw opens a compact object-adjacent palette.
- The slide remains visible beneath the drawing layer.
- Existing slide elements may be selected as references without mutating them.
- Switching to Select hides or preserves the sketch according to a clear toggle.
- “Build this” opens the AI task panel with the sketch and current slide as context.
- The user can keep, clear, or revise the sketch after agent output.

### 10.3 Agent context

The request should include:

```ts
interface AgentContext {
  documentRevision: string
  locale: string
  selectedSlideIds: string[]
  selectedElementIds: string[]
  presentationSummary: PresentationSummary
  elementTree: SerializableElementTree
  slidePreview: Blob
  sketchScene?: unknown
  sketchPreview?: Blob
  instruction?: string
}
```

The model receives both structure and pixels. Vision alone is insufficient for precise editable output; structure alone is insufficient for visual judgment.

---

## 11. Agentic editing architecture

Mona's agent should behave like a developer tool for slides: inspect, plan, execute precise operations, render, and revise.

### 11.1 JavaScript presentation SDK

Expose an intentionally narrow JavaScript API:

```ts
interface MonaPresentationSdk {
  document: {
    getSummary(): PresentationSummary
    getSlide(id: string): SerializableSlide
  }
  selection: {
    get(): SerializableSelection
  }
  slides: {
    add(input: AddSlideInput): string
    update(id: string, patch: SlidePatch): void
    remove(ids: string[]): void
  }
  elements: {
    add(slideId: string, element: NewElement): string
    update(slideId: string, id: string, patch: ElementPatch): void
    remove(slideId: string, ids: string[]): void
  }
  assets: {
    searchImages(query: string): Promise<ImageSearchResult[]>
    importImage(source: ImageSource): Promise<ManagedAsset>
  }
  render: {
    previewSlide(slideId: string): Promise<Blob>
  }
}
```

SDK calls record `PresentationCommand` objects. They do not mutate React state directly.

Generated JavaScript must never run through `eval` in the Mona page. Execute it in a sandboxed worker, iframe, or server sandbox with:

- no ambient DOM;
- no unrestricted network;
- time and memory limits;
- an allowlisted SDK;
- deterministic command recording;
- cancellation;
- structured logs.

### 11.2 Apply pipeline

```text
User text/sketch
    ↓
Context builder: document structure + selection + previews
    ↓
Model plans and/or writes SDK JavaScript
    ↓
Sandbox executes against a read-only snapshot and command recorder
    ↓
Core validates the generated transaction
    ↓
Preview: visual render + operation summary + warnings
    ↓
User applies
    ↓
One transaction with origin "agent"
    ↓
Autosave + single-step undo
```

### 11.3 Runtime changes

Replace the current commit signature with an origin-aware path:

```ts
interface CommitOptions {
  origin?: PresentationTransactionOrigin
  historyKey?: string
  recordHistory?: boolean
}

interface EditorRuntime {
  preview(transaction: PresentationTransaction): PresentationTransactionResult
  commitTransaction(transaction: PresentationTransaction): boolean
}
```

User-facing helpers may continue to default to `origin: 'user'`.

An agent change must:

- validate atomically;
- be based on a document revision;
- reject or rebase if the document changed;
- show a human-readable summary;
- record warnings for unsupported elements;
- create one undo boundary unless the user accepts stages separately.

### 11.4 Visual feedback loop

After a candidate transaction:

1. render the affected slides with Mona's own renderer;
2. send previews and operation results back to the model;
3. allow a bounded revision loop;
4. display the final diff to the user;
5. commit only the accepted transaction.

`html-to-image` already exists, but the long-term capture path should render an isolated slide surface so editor selection handles and UI overlays cannot leak into screenshots.

### 11.5 Provider separation

The UI talks to a provider-neutral `AgentService`.

Authentication and billing rules are separate adapters. The editor shell must not assume a specific provider, model, local runtime, or key mechanism. Google AI Studio key support can be one adapter without turning the presentation engine into a key-management system.

---

## 12. Overlay, focus, and dismissal architecture

Do not replace every overlay with one giant manager. Coordinate overlay **lanes**:

| Lane | Examples | Rule |
| --- | --- | --- |
| Header overlay | File, save, Present disclosure, Settings | One at a time; anchored; return focus |
| Shared task panel | Templates, Layers, Notes, AI | One route at a time; refits workspace |
| Anchored document panel | Comments, future Share | Non-modal; one per anchor; constrained height |
| Focused modal | Import warning, export, chart data, LaTeX, destructive confirm | One modal at a time |
| Object popover | color, link, crop utility | Owned by active selection/control |
| Floating utility | timer | May coexist when it does not obscure work |
| Application activity | presentation mode | Closes transient overlays; editor remains mounted via React Activity |

Use Radix/shadcn for:

- focus trap when modal;
- outside-pointer dismissal;
- Escape handling;
- portal positioning;
- focus return;
- collision handling;
- accessible labels and descriptions.

Replace the hard-coded focus-preservation selector list with a shared marker:

```html
data-editor-interactive-overlay
```

Canvas focus logic checks this marker rather than knowing every component class.

---

## 13. Accessibility and keyboard model

### Header

- `<header>` landmark with named document-control and output-control groups;
- File uses a real menu primitive;
- buttons and title stay in logical tab order;
- arrow-key grouping may be added only with a complete roving-focus implementation;
- skip-to-canvas action;
- tooltips are not accessible names.

### Rail and panel

- rail items expose selected/expanded state;
- panel has a labelled heading;
- Esc returns to the invoking rail control;
- search results use listbox/command semantics as appropriate.

### Canvas

- mode is announced;
- selected object count and type are available to assistive technology;
- selection changes are not excessively verbose;
- keyboard move/resize commands remain functional;
- object-adjacent controls are reachable without pointer precision.

### Bottom workflow

- direct page-number input has current/total semantics;
- pages have meaningful names, not only “Slide 3” when a title exists;
- reorder has keyboard commands and announcements;
- grid multi-selection exposes selection count.

### Motion

- preserve the existing motion-smoke work;
- obey `prefers-reduced-motion`;
- no layout animation during precise canvas manipulation;
- panel transitions must not delay input.

---

## 14. Responsive behavior

The desktop editor has a practical minimum width, but it should degrade deliberately.

### Wide desktop

- full header labels;
- 72 px rail;
- 360 px task panel;
- full contextual controls;
- filmstrip or page grid.

### Compact desktop

- keep rail icons, hide labels;
- contextual overflow absorbs low-priority controls;
- header title narrows but does not jump;
- Present and primary output remain visible;
- task panel may reduce to a tokenized compact width.

### Below editor minimum

Do not continuously squeeze the desktop canvas. Route to the existing mobile experience or a supported compact editor. The current `min-w-[960px]` should become a documented capability boundary rather than an accidental overflow guard.

---

## 15. React and performance architecture

### 15.1 Selector discipline

Avoid:

```ts
useEditorSelector(store, state => state.presentation)
useEditorSelector(store, state => state.session)
```

Prefer stable primitives and derived selectors:

```ts
useEditorSelector(store, selectPresentationTitle)
useEditorSelector(store, selectActiveElementIds)
useEditorSelector(store, selectCurrentSelectionCapabilities)
```

Add an equality-aware store hook or `useSyncExternalStoreWithSelector` equivalent. Memoized selectors must return stable references until their inputs change.

### 15.2 Component boundaries

- Header must not rerender for element drag coordinates.
- Rail must not rerender for rich-text keystrokes.
- Task-panel chrome must not rerender when only its route content changes.
- Bottom page controls subscribe to slide order/metadata, not all element geometry.
- Canvas owns high-frequency geometry subscriptions.
- Agent/export/presentation code remains lazy.

### 15.3 Events

Run mutations from user event handlers, not effects. Effects synchronize external systems only:

- persistence;
- fullscreen lifecycle;
- browser title;
- media/resource cleanup.

### 15.4 Large features

Keep lazy boundaries for:

- export;
- AI workspace;
- chart data editor;
- LaTeX editor;
- page-grid view if it becomes heavy;
- drawing/Excalidraw bundle.

Prefetch on intent, such as hover or focus of the corresponding entry, rather than at initial boot.

---

## 16. Proposed file architecture

The names are directional; move one workflow at a time rather than performing a mass rename.

```text
apps/web/src/features/editor/
  shell/
    EditorShell.tsx
    EditorWorkspace.tsx
    EditorTaskPanel.tsx
    editor-shell-reducer.ts
    editor-overlay-coordinator.ts
  header/
    EditorGlobalHeader.tsx
    EditorFileMenu.tsx
    EditorDocumentTitle.tsx
    EditorSaveStatus.tsx
    EditorPresentControl.tsx
    EditorCommentsControl.tsx
  rail/
    EditorRail.tsx
    editor-rail-model.ts
  contextual/
    EditorContextualBar.tsx
    EditorObjectActions.tsx
    resolve-selection-capabilities.ts
    contextual-control-registry.ts
  panels/
    create/
    properties/
    layers/
    search/
    speaker-notes/
    agent/
  bottom/
    EditorBottomBar.tsx
    EditorPageStrip.tsx
    EditorPageGrid.tsx
    EditorPageNumber.tsx
    EditorTimer.tsx
    EditorZoom.tsx
  drawing/
    DrawingLayer.tsx
    DrawingPalette.tsx
    drawing-store.ts
    drawing-serialization.ts
  agent/
    agent-context-builder.ts
    agent-service.ts
    agent-sdk.ts
    agent-command-recorder.ts
    agent-transaction-runner.ts
  services/
    EditorApplicationProvider.tsx
    editor-application-actions.ts
    deck-persistence-store.ts
```

### Current-file migration map

| Current file | Destination/action |
| --- | --- |
| `EditorDeck.tsx` | Reduce to shell composition; remove feature-local overlay ownership |
| `EditorHeader.tsx` | Replace with `header/EditorGlobalHeader.tsx` and focused children |
| `EditorRail.tsx` | Split persistent rail from routed task-panel content |
| `EditorContextToolbar.tsx` | Replace type checks with capability registry |
| `EditorThumbnails.tsx` | Extract reusable page selection/reorder model; compose PageStrip and PageGrid |
| `EditorStatusBar.tsx` | Split Notes, page, zoom, timer, view, and Present controls |
| `EditorRemark.tsx` | Rename UI to SpeakerNotes and route through shared task panel |
| `EditorNotesPanel.tsx` | Rename UI to Comments and anchor from header |
| `EditorMoveablePanel.tsx` | Remove from ordinary editor routes |
| `EditorFloating*Toolbar.tsx` | Separate reusable control groups from object-adjacent lifecycle actions |
| `editor-runtime.ts` | Add transaction origin, preview, complete history, and typed service hooks |
| `editor-persistence.ts` | Become observable persistence store |
| `FoundationPage.tsx` | Provide application services; keep lazy features and Activity |
| `EditorAgentDialog.tsx` | Replace with task-panel agent workspace and real execution pipeline |
| `ai-writing.ts` | Adapt behind `AgentService` or retire after equivalent writing action exists |
| `editor.css` | Split shell geometry from feature styles; use semantic tokens |

---

## 17. Incremental implementation gates

Every gate is a product-completion boundary. Do not begin the next gate until its acceptance evidence passes.

### Gate 0 — Behavior baseline and typed seams

Implementation:

- add deterministic shell test fixtures;
- introduce `EditorApplicationProvider`;
- replace AI/export/presentation window events with typed actions;
- add shell/overlay state types without visual changes;
- add selector/equality support;
- document current keyboard and focus behavior.

Acceptance:

- no global custom event remains for ordinary same-tree application actions;
- import, export, AI open, and presentation open still work;
- initial bundle does not absorb lazy feature bundles;
- header/rail do not rerender during an isolated element drag test;
- current browser tests and production-stability tests pass.

Rollback: provider can adapt to the old handlers internally until all callers migrate.

### Gate 1 — Complete global header

Implementation:

- move header above rail/workspace;
- use 56 px full-width shell geometry;
- build stable title input;
- expose persistence status;
- restructure File and Present;
- add real comments entry;
- keep Export as the real output action until Share exists.

Acceptance:

- title box has identical geometry resting, focused, typing, committed, and cancelled;
- title Enter/Escape/blur behavior passes;
- all File actions work end to end;
- dirty/saving/saved/error states are driven by persistence;
- undo/redo reflect complete history;
- popovers dismiss and return focus correctly;
- deterministic screenshots pass at wide and compact desktop sizes.

Not complete if the menu only opens or the title only looks correct in its resting state.

### Gate 2 — Shell grid and unified task panel

Implementation:

- create the new shell grid;
- refactor rail categories;
- create routed 360 px task panel;
- migrate creation catalogs, properties, layers, search, and speaker notes;
- retire corresponding moveable panels.

Acceptance:

- only one task-panel route exists at a time;
- opening and switching panels refits the workspace without document mutations;
- selection changes follow documented panel rules;
- Esc and invoking-button focus return work;
- canvas pointer/keyboard interactions remain unchanged;
- no panel content is duplicated in a floating window.

### Gate 3 — Capability-driven contextual editing

Implementation:

- build the capability resolver and control registry;
- complete the selection matrix;
- distinguish page selection from empty selection;
- separate top formatting, text bubble, and adjacent lifecycle controls;
- preserve group drill-in and crop/text-edit modes.

Acceptance:

- every state in the matrix has a direct browser test;
- mixed selection shows only shared controls and correct mixed values;
- actions modify the actual selected targets and undo correctly;
- group child and parent states are visibly and behaviorally distinct;
- no element-type conditional tree remains in the toolbar component.

Not complete if a type merely shows a generic Style button.

### Gate 4 — Complete bottom workflow

Implementation:

- Pages toggle;
- page strip improvements;
- direct page input;
- page grid;
- speaker-notes route;
- timer;
- page title, hidden, duration, and transition boundaries;
- insertion affordances.

Acceptance:

- selection/reorder parity between strip and grid;
- keyboard and multi-select behavior works;
- slide schema changes round-trip through storage/import/export;
- hidden/duration/transition affect slideshow correctly;
- page number input handles bounds and invalid values;
- notes remain attached to the correct slide after reorder/duplicate.

### Gate 5 — Drawing mode

Implementation:

- lazy drawing bundle;
- coordinate-aligned sketch layer;
- compact drawing palette;
- per-slide sketch persistence;
- scene and preview export;
- “Build this” handoff to agent panel.

Acceptance:

- drawing survives zoom, pan, task-panel refit, slide switching, and reload;
- sketch coordinates remain aligned to slide coordinates;
- clearing a sketch does not mutate slide elements;
- the bundle is absent from initial load;
- keyboard, pointer, and reduced-motion behavior pass.

### Gate 6 — Agent transaction workflow

Implementation:

- provider-neutral agent service;
- context builder;
- sandboxed JavaScript SDK;
- command recorder;
- validated preview;
- visual feedback loop;
- agent workspace in shared panel;
- apply/undo.

Acceptance:

- agent reads an existing slide and selection;
- text-only and sketch-first requests both produce editable presentation elements;
- no generated code runs in the page context;
- invalid commands are rejected without partial mutation;
- stale-revision edits are blocked or rebased explicitly;
- one accepted agent operation can be undone in one step;
- before/after render and operation summary are visible;
- image search/import uses a managed provider, not arbitrary ambient network access.

### Gate 7 — Accessibility, compact desktop, and release hardening

Implementation:

- complete keyboard routes;
- accessible announcements;
- compact layouts;
- error and empty states;
- performance and memory profiling;
- recovery tests.

Acceptance:

- keyboard-only end-to-end editor walkthrough;
- focus never falls behind a modal or disappears after close;
- no unexpected layout shift during title edit, selection, or panel changes;
- no high-frequency shell rerenders during manipulation;
- persistence failure and restoration are test-covered;
- full build, lint, type-check, unit, browser, E2E, architecture, and production-stability checks pass.

---

## 18. Test strategy and proof standard

### 18.1 Unit

- capability resolver for every selection matrix row;
- shell reducer exclusivity;
- persistence status transitions;
- complete history snapshots;
- slide-schema migrations;
- agent command recording and validation;
- drawing coordinate transforms.

### 18.2 Browser component

- header title lifecycle;
- File/Present/Settings focus and dismissal;
- panel routing and workspace refit;
- contextual real mutations;
- speaker notes/comments separation;
- bottom page selection and reordering;
- agent preview/apply/undo.

### 18.3 E2E

Use deterministic decks containing:

- text, image, shape, line;
- chart and table;
- group and nested group;
- animation and transition;
- comments and speaker notes;
- long/multilingual title;
- enough pages for scrolling, sections, and grid view.

Test:

- desktop wide;
- desktop compact;
- reduced motion;
- reload/restore;
- storage failure;
- presentation entry/exit;
- import/edit/export;
- drawing-to-agent workflow.

### 18.4 Visual evidence

Visual regression is appropriate for stable shell states:

- empty/page selection;
- text selected;
- text editing;
- image selected;
- mixed selection;
- task panel open;
- File menu open;
- page grid;
- drawing mode;
- agent preview.

Screenshots supplement behavior tests. They never replace command, state, focus, or undo assertions.

### 18.5 Completion claim

A workflow may be called complete only when all are true:

1. its entry control is present;
2. every advertised action performs a real operation;
3. state and persistence effects are correct;
4. undo/redo behavior is correct;
5. keyboard and focus behavior are verified;
6. empty, error, and dismissal paths work;
7. deterministic visual evidence exists where layout matters;
8. no known target state is represented by a placeholder.

---

## 19. Validation commands for every gate

Run the narrowest affected tests while developing, then the full gate:

```bash
npm run type-check
npm run lint
npm run i18n:check
npm run check:architecture
npm run test:core
npm run test:react
npm run e2e:react
npm run build
npm run test:production-stability
```

For performance-sensitive gates:

```bash
npm run benchmark:state
npm run measure:build
npm run measure:runtime
```

No gate should update a performance baseline merely to make a regression pass. First explain the change and establish that the new behavior requires the cost.

---

## 20. Decisions that should not be reopened during implementation

- Mona remains a React application.
- The existing renderer and interaction engine are preserved.
- shadcn/Radix primitives are the default for ordinary application UI.
- specialized canvas controls may remain custom when their behavior is not an ordinary app component.
- application chrome remains neutral; Mona's red/orange brand colors are reserved for identity and deliberate AI emphasis.
- the global header spans above the rail.
- there is one shared left task panel.
- drawing is a first-class mode and stores editable scene data.
- the agent receives both presentation structure and rendered visuals.
- agent output becomes validated, editable presentation commands.
- generated JavaScript runs in a sandbox, never in the Mona page.
- fake collaboration, identity, sharing, analytics, or save states are not acceptable.
- presence is not parity, and visual similarity is not workflow completion.

---

## 21. Implementation status and release evidence

The scoped implementation described by Gates 0–7 is present as of 2026-07-24,
and the release matrix below passes. This is not a blanket Canva-parity claim
or a declaration that the broader Mona product is finished. A gate is only
closed for the explicit workflows and evidence named in this document;
unverified Canva behavior and later product requirements remain open audit
work.

The verified scoped implementation includes:

- the Canva-familiar neutral shell, contextual editing surface, page workflow,
  and compact-desktop behavior described in this study;
- a slide-coordinate Excalidraw layer with per-slide persistence, independent
  undo/redo, preview export, and “Build this” agent handoff;
- a provider-neutral JavaScript presentation-agent transaction with structural
  and visual context, opaque-origin execution, validated commands, before/after
  rendering, a bounded visual review pass, atomic apply/discard, stale-revision
  protection, and one-step undo;
- OpenAI ChatGPT subscription login through device authorization, Anthropic
  Claude Pro/Max login through the hosted manual-callback bridge, Google AI
  Studio bring-your-own-key support, and an explicit deployment-availability
  state for Mona-managed AI;
- managed Wikimedia image search/import with signed results, content
  validation, and content-addressed local assets;
- native chart-data/type editing, table creation/structural editing (including
  merged-cell row/column guards), image crop commit/undo, URL media insertion,
  and durable blob-backed media uploads through the existing IndexedDB media
  capture/restore path; the table-size picker is keyboard operable and chart
  data cells have stable accessible names;
- a complete import/edit/export lifecycle: serialized and PPTX imports are
  single-flight and atomically undoable, full-document imports reset stale
  editor interaction state, appended imports clear stale selection state,
  export filenames are safe without changing the stored document title, and
  JSON, Mona, and editable PPTX artifacts are verified by re-reading or
  re-importing them; corrupt input leaves the working deck unchanged, export
  ranges and modes are named for assistive technology, and PDF printing has
  load/error cleanup;
- the five redistribution-safe PPTX corpus decks are executable browser
  regressions for live slide/element types, hyperlinks, notes, grouping,
  rotation, and viewport geometry; known chart-generator, group, and SmartArt
  limits remain explicit in `tests/corpus/baselines` rather than being
  represented as supported fidelity; ordinary PowerPoint groups now import as
  actionable Mona groups, while nested group hierarchy and editable SmartArt
  remain format-model limits;
- working-copy persistence and legacy-namespace migration;
- keyboard focus restoration, modal focus containment, reduced-motion
  behavior, compact-width bounds, and selection-guide stability.

Release verification on 2026-07-24:

- type-check: passed across web, agent server, and packages;
- lint and i18n synchronization: passed;
- architecture audit: passed;
- presentation core: 44 tests passed;
- React/unit/browser components: 191 tests passed;
- agent server: 12 tests passed;
- Playwright editor E2E: 35 tests passed;
- production stability: 2 tests passed, 173 listeners before and after,
  navigation p95 24.4 ms, zero long tasks, and thumbnail DOM identity
  preserved;
- memory profile after 16 agent-panel cycles: 994,012 bytes heap growth,
  86 DOM nodes, and zero document growth, within the 8 MB / 250-node budgets;
- production runtime median: editor ready 133.5 ms, FCP 48 ms, initial transfer
  649,935 bytes, 1,977,303 decoded bytes, and 10 MB used JS heap;
- cold-route feature splitting reduced initial transfer by 24.7% and decoded
  resources by 27.1% from the pre-remediation measurement. Slideshow, mobile,
  rail catalogs, inspectors, secondary panels, equation rendering, drawing,
  AI, export, and font subsetting now load at their actual entry points;
- the English cold route fetches one 52.8 KB presentation font. The complete
  distribution retains the sliced multilingual presentation-font corpus so
  imported decks can render supported fonts without fetching them all at
  startup;
- the state performance budget test passed without rewriting its stored
  baseline;
- the distribution contains 8,009,681 bytes of JavaScript (2,796,132 bytes
  gzip) and 61,662,888 bytes of sliced presentation fonts. The largest
  JavaScript asset is the 1,821,047-byte font-subsetting WebAssembly chunk,
  which remains off the cold editor route and loads with the export/subsetting
  workflow;
- `npm audit --omit=dev` still reports the documented 13 transitive findings
  (1 high, 12 moderate) in the two reviewed dependency families, and the
  production assets contain no Chevrotain or Langium parser implementation.

The build intentionally excludes Excalidraw's optional Mermaid parser from
Mona's drawing mode. Current dependency-audit exceptions and their
reachability analysis are recorded in `doc/RELEASE_HARDENING.md`; they must be
revisited on every upstream dependency update.
