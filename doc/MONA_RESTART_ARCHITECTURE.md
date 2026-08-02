# Mona product and agent architecture

Status: authoritative presentation and agent architecture, updated 2026-08-03.

Mona is an open-source desktop presentation editor: an Electron shell around a
React renderer, with no Mona-hosted agent server. Native provider harnesses make
outbound model requests from the user's machine.
Its differentiator is a drawing-first agent workflow: the user can express a
slide visually, and an AI agent turns that intent into native, editable slide
elements. Source-project attribution and licensing are recorded in
[`NOTICE.md`](../NOTICE.md).

## Product invariant

Mona is an editable presentation agent, not an image generator and not a chat
wrapper. Every successful AI operation ends as ordinary Mona presentation data
that the user can select, move, edit, undo, save, and export to PPTX. Renders
are evidence for the agent and the user; they are never the document model.

## Current foundation

- `apps/web`: React editor, mobile views, slideshow, presenter tools, and
  import/export surfaces.
- `packages/presentation-core`: canonical presentation model and commands.
- `packages/editor-state`: transactions, history, state, and selectors.
- `packages/editor-interactions`: geometry and direct-manipulation behavior.
- `packages/rich-text`: framework-neutral rich-text behavior.
- `packages/test-fixtures`: deterministic product fixtures.

Mona's native file extension is `.mona`. Import remains backward-compatible
with the legacy native format through a single compatibility boundary; new
files, clipboard payloads, browser storage, channels, and exported PPTX
metadata use Mona identifiers.

## First complete agent loop

1. The user opens or imports a presentation.
2. The user chooses **Text** or **Draw**.
3. Draw mode opens Excalidraw with the current slide render as an optional
   locked background.
4. The user sketches boxes, arrows, images, and text, optionally adding a short
   instruction.
5. Mona sends the model the Excalidraw scene, a PNG of the sketch, current deck
   structure with stable IDs, current-slide render, theme, viewport, selection,
   and instruction.
6. The model writes JavaScript against Mona's presentation SDK.
7. The script runs against a cloned deck in a bounded sandbox.
8. Mona validates and renders the clone, then gives structural warnings and
   pixels back to the model for revision.
9. The user reviews before/after and chooses **Apply** or **Discard**.
10. Apply commits the clone atomically as one normal history entry.

Authentication, billing, collaboration, and a general command platform do not
precede this loop.

## Agent runtime boundary

```text
Text prompt or Excalidraw scene
              |
              v
Mona request envelope (deck clone, stable IDs, renders, theme, selection)
              |
              v
Hosted model adapter and presentation skill
              |
              v
Sandboxed JavaScript using the Mona presentation SDK
              |
              v
Validate -> render -> inspect -> revise
              |
              v
User review -> atomic Apply or Discard
```

The generated script has no filesystem, shell, network, DOM, credentials, or
direct store access. Online image search is an explicit hosted tool; approved
assets enter the sandbox as bounded data handles.

## Request envelope v0

```ts
interface MonaEditRequest {
  intent: { mode: 'text' | 'draw'; instruction?: string }
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

The service may prune deck context for token efficiency, but it must preserve
stable IDs through Apply.

## Presentation SDK v0

The agent authors JavaScript, not a narrow command list. The first SDK remains
small enough to validate completely:

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

The SDK exposes semantic operations such as `setText`, `addImage`, `addChart`,
`group`, `align`, and `distribute`, plus read/inspect operations. It never
exposes the application store or accepts unvalidated document JSON. A future,
versioned escape hatch may accept a raw element only if final validation still
passes.

## Render and inspect loop

- `inspectDeck()` returns compact slide and element summaries with stable IDs.
- `inspectElement(id)` returns type-aware properties.
- `renderSlide(id)` uses Mona's production renderer and returns a PNG.
- `validateDeck()` reports invalid geometry, missing assets, non-finite values,
  out-of-bounds elements, empty text, and duplicate IDs.
- `finish()` succeeds only after validation.

Valid geometry can still be visually poor, so the model normally performs at
least one render/review cycle before Apply is offered.

## Drawing surface

Excalidraw is an intent surface, not a second slide format. Mona uses its
official React component, stores the structured scene while a draft exists,
and exports both JSON and PNG. JSON preserves exact text, bounds, arrows,
groups, and spatial intent; PNG gives a multimodal model the complete visual
composition. The agent decides the polished native implementation rather than
converting sketch objects mechanically.

## Model access

Mona does not hold model credentials. The Electron main process supports two
complete local harnesses: the Claude Agent SDK uses the machine's Claude login,
and Codex app-server uses its supported ChatGPT subscription login. Both native
processes keep credentials outside the sandboxed renderer. The renderer can ask
for account status, start the provider's browser login, select a discovered
model, and send a prompt over preload IPC; it cannot read the credential.

The conversation is provider-neutral and may move between Claude and Codex only
between generations. Each provider retains its native thread identity while Mona
hands it only the canonical user/assistant text it missed. Both harnesses mount
the same visual-inspection and transactional document tools. See
[`doc/AGENT_PROVIDER_ARCHITECTURE.md`](AGENT_PROVIDER_ARCHITECTURE.md).

## Implemented execution path

1. Excalidraw captures structured scene JSON and a visual preview per slide.
2. Opening the agent creates a temporary file workspace containing the deck and
   its assets.
3. The selected native harness uses filesystem and shell tools to edit that workspace.
4. Mona-specific `look` renders slides for visual inspection.
5. `apply` validates the workspace against the current document revision and
   commits the result as one undoable transaction.
6. The Electron shell owns model execution, native storage and the IPC boundary;
   no hosted agent service participates.

Collaboration remains out of scope until the single-user agent loop is robust.

## Explicit non-goals

- Rebuilding Excalidraw.
- Creating an AI-specific slide schema parallel to Mona's canonical model.
- Using comments as the agent editing interface.
- Treating screenshots or generated images as editable presentation data.
- Exposing arbitrary network, DOM, filesystem, shell, store, or credential
  access to generated scripts.
- Building collaboration, billing, or a large command platform before the
  drawing-to-edit loop works.

## External references

- Excalidraw integration: <https://docs.excalidraw.com/docs/@excalidraw/excalidraw/integration>
- Pi agent runtime: <https://github.com/earendil-works/pi>
- OpenCode provider patterns: <https://opencode.ai/docs/providers>
- QuickJS Emscripten: <https://github.com/justjake/quickjs-emscripten>
- PptxGenJS: <https://gitbrent.github.io/PptxGenJS/>
