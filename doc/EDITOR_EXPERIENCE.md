# Mona editor experience

This document tracks the editor-shell migration independently from Mona's presentation model, renderer, and editing engine. The current reference is the interaction architecture of familiar visual editors such as Canva; Mona keeps its own neutral design system, terminology, and product identity.

## Product rule

The canvas is the primary surface. Chrome must progressively disclose controls instead of permanently reducing the working area.

1. A narrow creation rail remains visible.
2. A task panel opens beside the rail only when a creation or deep-property workflow needs it.
3. The canvas refits when that panel opens or closes; slide coordinates do not change.
4. Selecting content exposes a contextual toolbar above the canvas.
5. Frequent actions stay in that toolbar. Deep actions open the shared task panel or a small popover.
6. Slide navigation stays in the bottom filmstrip, with notes and zoom nearby.

## Reference interaction map

### Global header

- Document navigation and file actions at the left.
- Editable presentation title in the central working area.
- Present, share/export, comments, AI, and account/settings actions at the right.
- Menus are compact command surfaces, not permanent inspectors.

### Creation rail and task panel

- The rail is persistent and icon-led with short labels.
- Templates, elements, text, uploads/media, charts, and future drawing/AI entry points open the same task-panel region.
- Activating the current rail item again, or pressing the panel close control, returns the space to the canvas.
- Position, layers, animation, and other deep element controls reuse the same region.

### Contextual commands

- No selection: slide design, transition, and slide-level controls.
- Element selection: type-specific formatting, transparency, animation, position, and copy-style controls.
- Compact object actions remain close to the selection; the overflow menu contains less-frequent commands and shortcuts.
- Position contains Arrange and Layers modes rather than spawning a second permanent inspector.

### Bottom navigation

- Horizontal page filmstrip with per-page operations.
- Notes, timer/presentation utilities, page count, zoom, grid view, and full-screen controls share the bottom region.

## Migration gates

### Current status — 2026-07-23

- Gate 1 is complete. The creation rail is persistent, the shared task panel is user-controlled, the canvas refits without changing element coordinates, and regression coverage locks the disclosure behavior.
- Gate 2 is complete. The top toolbar now exposes the real type-specific editor commands; deep Style, Animation, and Position controls open in the shared panel. Browser tests exercise a real shape fill update and rich-text formatting command.
- Gate 3 is complete for the scoped editor-shell workflow. Layers, position,
  animation, design, search, comments, speaker notes, semantics, uploads, and
  media libraries use the shared task-panel contract; structured data,
  equation, path, export, and blocking confirmation workflows remain modals.
- Gate 4 is complete for the scoped bottom workflow. The filmstrip and page
  grid support keyboard selection, range selection, focus management,
  drag/keyboard reorder, undoable page operations, page numbers/titles,
  comments, speaker notes, transitions, presentation entry, and accessible
  context menus. A comment badge activates the slide that owns it before
  opening that slide's comments.
- Gate 5 is complete for the scoped drawing-to-agent handoff. Drawing is a
  first-class rail mode with per-slide editable scene persistence, independent
  undo/redo, rendered preview data, and a tested “Build this” handoff into the
  agent workspace.

These statuses describe the bounded gates below. They are not a blanket claim
that Mona has implemented every behavior observed in Canva or that the whole
product goal is finished. The broader capability audit remains open and uses
the acceptance standard in `Mona Canva Editor Implementation Study`.

### Gate 1 — shell disclosure

- Keep the existing Mona creation rail and horizontal filmstrip.
- Make the task panel optional instead of permanently reserving its width.
- Add the persistent contextual entry bar above the canvas.
- Reuse every existing creation and property panel; do not rewrite editor behavior.

### Gate 2 — real contextual toolbar

- Replace generic Style/Position/Animation entry tabs with type-specific high-frequency controls.
- Preserve existing floating rich-text and media behaviors while consolidating duplicated controls.
- Keep deep property editors available through the shared task panel.

### Gate 3 — panel unification

- Move layers/selection, position, animation, design, search, and media libraries into the shared task-panel contract where appropriate.
- Reserve modal dialogs for workflows that genuinely require blocking focus, such as export or structured data editing.

### Gate 4 — bottom workflow completion

- Finish page-level actions, page titles, transitions, notes, page count, grid view, and presentation controls in the bottom region.
- Verify keyboard navigation and compact viewport behavior.

### Gate 5 — Mona-native input

- Add drawing as a first-class rail mode.
- Let the user switch between text instructions and a drawing-first brief without changing the editor mental model.
- Feed the slide image, drawing, element tree, and selected elements into the agent workspace.

## Gate acceptance standard

Each gate requires all of the following before the next begins:

- The existing editor commands still change the real presentation state.
- Selection, undo/redo, clipboard, import/export, and slideshow entry remain operational.
- Opening and closing panels does not move slide elements or alter their document coordinates.
- The canvas refits without visible jumping.
- Desktop browser verification covers the default slide, a selected text element, a selected non-text element, and an open task panel.
- Type-check, lint, focused tests, and the production build pass.
