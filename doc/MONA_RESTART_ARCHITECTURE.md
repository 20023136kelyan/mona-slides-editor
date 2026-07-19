# Mona restart architecture

Status: product and agent architecture, updated 2026-07-19.

Platform decision update: Mona Slides is migrating completely from Vue to React. The earlier Vue + React-island implementation route is superseded by [REACT_MIGRATION_BLUEPRINT.md](./REACT_MIGRATION_BLUEPRINT.md). The product invariant, agent loop, JavaScript presentation SDK, and drawing-first interaction in this document remain authoritative. Vue is now only the temporary parity oracle.

This document replaces the previous phase plan. It starts from an unmodified PPTist checkout and puts Mona's actual novelty first: a user can express a slide visually with Excalidraw, then a visual agent turns that intent into native, editable presentation elements.

## Product invariant

Mona is an editable presentation agent, not an image generator and not a chat wrapper around a slide editor.

Every successful AI operation must end as ordinary PPTist slide data that the user can select, move, edit, undo, and export to PPTX. A screenshot is evidence for the agent, never the source of truth.

## First complete user loop

1. The user opens or imports a presentation in PPTist.
2. The user chooses **Text** or **Draw**.
3. In Draw mode, Excalidraw opens with the current slide render as an optional background.
4. The user sketches boxes, arrows, images, and text. They may add a short instruction.
5. Mona sends the model:
   - Excalidraw scene JSON;
   - a PNG render of the sketch;
   - current slide/deck data with stable element IDs;
   - a current-slide PNG;
   - theme, viewport, selection, and the user's instruction.
6. The model writes JavaScript against Mona's presentation SDK.
7. The script runs against a cloned deck, not the live deck.
8. Mona renders the result and gives the model the image plus structural warnings.
9. The model may revise the JavaScript until the result passes the basic checks.
10. The user sees before/after and chooses **Apply** or **Discard**.
11. Apply replaces the clone atomically and creates one normal PPTist history snapshot.

This loop—not authentication, billing, collaboration, or a general command system—is the first milestone.

## Reuse, adopt, and build

| Need | Decision | Source |
| --- | --- | --- |
| Editable slide canvas and element model | Preserve behavior, port UI to React | PPTist `src/types/slides.ts`, canvas components, and stores are the parity oracle |
| PPTX reading | Keep | PPTist's `pptxtojson` import path in `src/hooks/useImport.ts` |
| PPTX writing | Keep | PPTist's PptxGenJS export path in `src/hooks/useExport.ts` |
| Rendering and thumbnails | Keep | PPTist's live element components and `ThumbnailSlide` |
| Selection and edit context | Preserve and extract | `useMainStore` defines the reference behavior; React uses framework-neutral domain/state boundaries |
| Apply/undo | Keep and wrap during migration | Existing snapshot history remains behind an adapter until parity |
| Existing AIPPT templates | Keep as optional feature/reference | `useAIPPT.ts`, template markers, and `doc/AIPPT.md`; this is not the agent core |
| Drawing surface | Adopt after the React editor foundation | Official `@excalidraw/excalidraw` as a native React dependency |
| Agent loop and provider normalization | Adopt | `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` on the hosted service |
| Model-auth patterns | Adopt later | Pi/OpenCode provider flows: Google AI Studio key; supported subscription OAuth where provider terms allow it |
| JavaScript sandbox | Adopt behind an interface | First spike: `quickjs-emscripten` in a dedicated Web Worker with memory and time limits |
| Agent presentation skill | Build a Mona-specific open skill | Use the proven JavaScript + inspect + render + revise pattern; do not copy restricted runtimes |
| Presentation SDK | Build a thin adapter | A typed, capability-limited wrapper over cloned PPTist slide data |
| Drawing prompt package | Build | Coordinate-normalized Excalidraw JSON + PNG + deck context |

## Licensing boundaries

- PPTist is AGPL-3.0. Mona is intended to remain open source, so this is compatible with the product direction, but the hosted source and appropriate notices must remain available.
- OpenAI's bundled `@oai/artifact-tool` is private and licensed only for internal evaluation/testing. It must not be copied, distributed, or made a Mona dependency. Its workflow is a design reference only.
- Anthropic's public document skills are source-available under their own terms, not a generic open-source dependency. Treat them as research material unless the exact license permits the intended use.
- The community `Noi1r/powerpoint-skill` is MIT and is a useful reference for JavaScript generation and visual QA, but its PptxGenJS-first object model is not Mona's live editor model.
- Pi, Excalidraw, QuickJS Emscripten, and PptxGenJS are permissively licensed at the time of this mapping. Pin exact versions and retain notices when adopted.

## Runtime shape

```text
React/PPTist-compatible editor
  |
  +-- Text prompt
  |
  +-- Excalidraw drawing surface
          | scene JSON + PNG
          v
Mona request envelope
  | deck clone + stable IDs + renders + theme + selection
  v
Hosted agent service (Pi agent-core / pi-ai)
  | model emits JavaScript using the Mona presentation skill
  v
Browser Web Worker / QuickJS
  | only receives the presentation SDK and bounded helper functions
  v
Validated cloned PPTist deck
  | render -> inspect -> revise
  v
Apply / Discard
  | Apply creates one PPTist history snapshot
  v
Native editable slide + PPTX export
```

The generated script has no filesystem, shell, network, DOM, credentials, or direct application-store access. Online image search is an explicit agent tool on the hosted side; approved image assets are passed into the sandbox as data handles.

## Request envelope v0

```ts
interface MonaEditRequest {
  intent: {
    mode: 'text' | 'draw'
    instruction?: string
  }
  drawing?: {
    elements: unknown[]
    appState: Record<string, unknown>
    files: Record<string, unknown>
    pngDataUrl: string
  }
  presentation: {
    viewport: { width: number; ratio: number }
    theme: SlideTheme
    currentSlideId: string
    selectedSlideIds: string[]
    selectedElementIds: string[]
    slides: Slide[]
    currentSlidePngDataUrl: string
  }
  assets: Array<{
    id: string
    kind: 'image'
    src: string
    width: number
    height: number
    attribution?: string
  }>
}
```

The service may prune deck context for token efficiency, but stable IDs must never be rewritten until Apply.

## Presentation SDK v0

The agent authors JavaScript, not a narrow list of JSON commands. The initial SDK should still be small enough to validate completely.

```js
const slide = presentation.currentSlide();
const title = slide.find({ id: "existing-element-id" });

title.setText("A clearer message");

slide.addText({
  text: "Native and editable",
  x: 72,
  y: 420,
  width: 360,
  height: 54,
  fontSize: 30,
});

slide.addImage({
  assetId: "searched-image-3",
  x: 560,
  y: 100,
  width: 360,
  height: 300,
  fit: "cover",
});

presentation.finish();
```

The SDK exposes semantic operations (`setText`, `addImage`, `addChart`, `group`, `align`, `distribute`) and read/inspect operations. It does not expose the store or accept arbitrary unvalidated PPTist JSON.

For advanced cases, it may expose an explicitly versioned `unsafe.element()` escape hatch after the basic SDK is stable. That escape hatch still validates the final deck.

## Render and inspect loop

The agent receives both structure and pixels:

- `inspectDeck()` returns compact slide and element summaries with stable IDs.
- `inspectElement(id)` returns type-aware properties.
- `renderSlide(id)` uses PPTist's own renderer and returns a PNG.
- `validateDeck()` reports invalid geometry, missing assets, non-finite values, out-of-bounds elements, empty text, and duplicate IDs.
- `finish()` succeeds only if validation passes.

Visual review remains essential because valid geometry can still be ugly. The model should normally render after meaningful edits and revise when the screenshot does not match the sketch or instruction.

## Excalidraw integration

Excalidraw remains a separate intent surface, not another slide storage format.

- Use the official React component directly after the React foundation exists; do not rewrite Excalidraw.
- Persist its structured scene while a draft exists.
- Export both JSON and PNG. JSON gives exact text, bounds, arrows, groups, and rough spatial intent; PNG gives the multimodal model the complete visual composition.
- Normalize its scene bounds to the PPTist viewport but retain the original coordinates.
- Allow the current slide PNG to appear as a locked background for draw-over editing.
- Do not directly convert every sketch object into a slide object. The sketch communicates intent; the agent decides the polished native implementation.

## Model access

Model credentials belong to the user, not the source tree and not build-time environment variables.

For the first end-to-end slice:

- Google uses a user-entered AI Studio key.
- The UI keeps the key in browser session storage by default.
- The hosted service receives it only for the active request and must not log or persist it.

After the drawing-to-edit loop works:

- add OpenAI subscription login through a supported OAuth flow;
- add Anthropic subscription/extra-usage login only under the provider's supported third-party terms;
- retain API-key options where appropriate;
- encrypt refresh tokens at rest and keep provider credentials out of the JavaScript sandbox.

Provider authentication is an adapter behind the agent runtime. It must not change the presentation SDK or the Excalidraw request format.

## Minimal implementation order

Before these product slices, complete the applicable gates in [REACT_MIGRATION_BLUEPRINT.md](./REACT_MIGRATION_BLUEPRINT.md). The React migration is a platform prerequisite, not a change to the agent design below.

### Slice 1: local drawing-to-edit proof

1. Add Excalidraw to the React editor.
2. Capture scene JSON and PNG plus the current slide PNG.
3. Implement a pure in-memory `PresentationSession` that clones a PPTist deck.
4. Implement the smallest JavaScript SDK: inspect, add/update/delete text/shape/image, finish.
5. Run a deterministic hand-written JavaScript fixture through the sandbox.
6. Render before/after and wire Apply/Discard to existing PPTist history.

Acceptance: a sketch containing a title, two cards, and an image placeholder becomes editable PPTist elements and exports to PPTX.

### Slice 2: actual visual agent

1. Add the Mona presentation skill.
2. Add the Pi agent service with a Google AI Studio key supplied by the user.
3. Give the agent `execute_javascript`, `render_slide`, `inspect_deck`, and bounded image-search tools.
4. Require one render/review cycle before Apply is offered.

Acceptance: the model turns a rough drawing into a visually coherent, editable slide and can revise it from a follow-up instruction.

### Slice 3: existing-deck editing

1. Preserve imported stable IDs during an edit session.
2. Add selection-aware and multi-slide context.
3. Extend the SDK to tables, charts, groups, alignment, and theme helpers.
4. Test against the real PPTX fidelity corpus.

Acceptance: the agent can modify an imported deck without flattening untouched native elements.

### Slice 4: hosted product essentials

Add provider OAuth, user/deck persistence, jobs, quotas, and operational controls by adopting established libraries and services. Collaboration remains out of scope until the single-user agent loop is reliable.

## Explicit non-goals for the restart

- Rebranding PPTist before the product loop works.
- Replacing PPTist behavior, the document model, or proven engines while changing frameworks.
- Rebuilding Excalidraw.
- Inventing an AI-specific slide schema parallel to PPTist's `Slide` and `PPTElement` types.
- Using comments as the agent editing interface.
- Making screenshots or generated slide images the editable document.
- Building a large command bus before the JavaScript SDK spike.
- Building collaboration, billing, donations, or a full account system before the visual loop.
- Depending on OpenAI's private artifact runtime.

## Source references

- PPTist AI template flow: `doc/AIPPT.md`
- PPTist element types: `src/types/slides.ts`
- PPTist import/export: `src/hooks/useImport.ts`, `src/hooks/useExport.ts`
- Excalidraw integration/API: <https://docs.excalidraw.com/docs/@excalidraw/excalidraw/integration> and <https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api>
- Pi agent runtime/providers: <https://github.com/earendil-works/pi> and <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md>
- OpenCode headless server/provider reference: <https://opencode.ai/docs/server/> and <https://opencode.ai/docs/providers>
- QuickJS Emscripten: <https://github.com/justjake/quickjs-emscripten>
- MIT PowerPoint skill reference: <https://github.com/Noi1r/powerpoint-skill>
