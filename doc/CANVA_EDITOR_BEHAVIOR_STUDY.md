# Canva presentation editor behavior study

Status: research complete, 2026-07-23  
Scope: desktop presentation editor only  
Implementation status: no Mona application code was changed during this study

## Purpose

This document records the interaction contracts observed in Canva's presentation editor so Mona can feel familiar without copying Canva's branding or visual identity. The useful reference is not a particular icon, gradient, or CSS value. It is the way controls move between the global header, contextual toolbar, object-adjacent actions, shared task panel, canvas, and page workflow as the user's intent changes.

The study used a signed-in, non-confidential 20-page presentation. The deck was treated as read-only: objects and pages were selected, panels and menus were opened, and editing modes were inspected, but content was not intentionally inserted, deleted, moved, restyled, or reordered.

Evidence came from:

- direct interaction with text, grouped text, mixed groups, raster images, graphics, line/path objects, pages, and multi-page selections;
- visual screenshots at a 1358 × 988 browser viewport;
- accessible names, roles, focus state, DOM geometry, and menu contents;
- keyboard-help text exposed by the editor.

## Executive conclusion

Canva's editor is organized around one rule:

> Keep the canvas primary, show the smallest useful control surface for the current intent, and move deeper work into one reusable panel.

The editor does not use a permanently visible property inspector. Instead it combines five coordinated surfaces:

1. The global header owns document-level and account-level actions.
2. The top contextual pill owns frequent actions for the current selection or page.
3. A small object-adjacent pill owns immediate object lifecycle actions.
4. A persistent creation rail opens one shared left task panel for creation and deep properties.
5. The bottom region owns page navigation, ordering, notes, zoom, timing utilities, overview, and presentation entry.

This is the interaction grammar Mona should reproduce. The exact Canva styling should not be reproduced.

## 1. The editor's surface model

### 1.1 Global header

The header is approximately 56 pixels high in the observed viewport.

The left side contains:

- Home;
- File;
- Resize;
- editing-mode status;
- Undo and Redo;
- save/sync state.

The center contains the editable design title.

The right side contains:

- plan/account entry;
- Analytics;
- comments;
- the primary Present button;
- a separate disclosure button for all presentation modes;
- Share.

The title is edited in place. Enter starts editing and Escape stops editing. It is a document property, not a translated application string.

### 1.2 Persistent creation rail

The creation rail is approximately 72 pixels wide and remains visible in the ordinary editor. In the studied deck it contained:

- Templates;
- Elements;
- Text;
- Brand;
- Uploads;
- Tools;
- Projects;
- Apps;
- Magic Media;
- Photos;
- Charts.

Each item is icon-led with a short label. The rail chooses a domain; it does not try to contain that domain's full UI.

### 1.3 Shared task panel

Creation domains and deep property workflows reuse the same left-side task-panel region. At the observed viewport:

- the rail occupied `x = 0–72`;
- the panel content started at approximately `x = 72`;
- the panel content width was approximately 360 pixels;
- the panel began below the contextual toolbar;
- the close control was a 40 × 40 target near the panel's upper-right corner.

Opening the panel did not cover the slide. The workspace refitted:

- closed workspace: approximately `x = 96`, width `1237`;
- open workspace: approximately `x = 456`, width `877`.

The 360-pixel change matched the task-panel width. Slide content coordinates did not change; only the viewport fit changed. This is a critical Mona contract.

### 1.4 Top contextual pill

The contextual toolbar is a floating, rounded horizontal surface directly under the global header and above the canvas. It is centered around its own contents rather than fixed to a permanent inspector column.

Its contents are computed from:

- whether the page or an element is selected;
- element type;
- single versus multiple or grouped selection;
- whether text is selected or actively being edited;
- whether an interaction mode such as drawing is active.

The pill is absent when there is no actionable selection state.

### 1.5 Object-adjacent actions

A second, smaller pill appears close to the selected object. It owns lifecycle and collaboration actions that should stay spatially connected to the object, such as:

- Ask Canva;
- Magic Write for text;
- Ungroup;
- Link while editing text;
- Comment;
- Lock;
- Duplicate;
- Delete;
- More.

The exact set changes with the selection and edit state. This surface is not a duplicate of the top toolbar.

### 1.6 Bottom region

The bottom region is not merely a status bar. It is the presentation workflow layer:

- Notes;
- Timer;
- zoom slider and zoom policy;
- Pages/filmstrip;
- current page and page count;
- Grid view;
- Present full screen;
- Help.

When page thumbnails are open, the filmstrip sits immediately above this footer.

## 2. Contextual toolbar behavior

### 2.1 Selection-to-toolbar matrix

| State | Observed top-pill controls |
| --- | --- |
| Page selected | Ask Canva, Edit, page timing, background color, Animate, Position, Comment, Delete page |
| Grouped text with mixed values | Multiple fonts, mixed font size with decrement/increment, text color, applicable text formatting, alignment, list, advanced settings, transparency, Animate, Position, Copy style |
| Single text box | Font, font size, text color, bold, italic, underline, strikethrough, uppercase, alignment, list, advanced settings, transparency, Effects, Animate, Position, Copy style |
| Text-edit mode | The text-format controls remain; the adjacent pill adds Link and removes object-level Duplicate/Delete |
| Graphic/vector object | Edit, current color, Stroke style, Corner rounding, Crop, Flip, Transparency, Animate, Position, Copy style |
| Full-page raster/background image | Edit, BG Remover, Eraser, color chips, Stroke style, Corner rounding, Crop, Flip, Transparency, Animate, Position, Copy style |
| Mixed shape-and-text group | Shape fill plus font, size, text color, applicable text formatting, transparency, Animate, Position, Copy style |
| Grouped line/path graphic | Stroke color, Stroke style, Transparency, Animate, Position, Copy style |
| Individual line after drilling into its group | Stroke color, Stroke style, Line start, Swap line ends, Line end, Line type, Transparency, Animate, Position, Copy style |

The toolbar composes relevant controls for mixed groups. It does not collapse everything to a generic "group" inspector.

### 2.2 Drilling into groups

The first click selects the group and shows group-level geometry. A subsequent click on a child drills into that child without destroying group context.

This is visible in two ways:

- mixed or placeholder values become concrete child values;
- the top toolbar gains child-specific commands, such as line endpoint controls.

The group can still expose `Ungroup` in the adjacent pill while a child is being targeted.

### 2.3 Text editing is a distinct state

Selecting a text box and editing text are not treated as the same state.

When the text box is selected, the adjacent actions include object lifecycle commands such as Duplicate and Delete. In active text-edit mode:

- Link becomes available;
- text-generation assistance remains available;
- Duplicate and Delete disappear from the nearby surface;
- Escape exits text editing.

This prevents destructive object actions from occupying the most immediate surface while the user's intent is caret-level editing.

### 2.4 Page selection uses the same architecture

The page itself is another contextual selection target. Selecting a page changes the top pill to page-level properties:

- duration/timing;
- background color;
- animation;
- position;
- comments;
- deletion.

Mona should not create a completely separate page-inspector architecture. Page selection should participate in the same contextual system with page-specific commands.

### 2.5 High-frequency versus deep controls

The top pill keeps frequent, low-latency commands one click away. Controls with larger internal structure open either:

- a small anchored popover for a compact adjustment; or
- the shared task panel for a sustained workflow.

This is progressive disclosure, not arbitrary relocation.

## 3. Deep-property workflows

### 3.1 Advanced text settings

The first advanced-text popover contains:

- letter spacing;
- line spacing;
- text-box anchor position;
- More settings.

`More settings` opens the shared task panel with:

- Spacing;
- Letter spacing;
- Line spacing;
- Anchor text box;
- Formatting;
- Text position;
- Typography;
- Kerning;
- Ligatures.

The small popover is for quick numeric adjustment. The shared panel is for the complete text-layout workflow.

### 3.2 Position panel

Position opens the shared task panel with two tabs: `Arrange` and `Layers`.

Arrange contains:

- Forward;
- Backward;
- To front;
- To back;
- align to page: Top, Left, Middle, Center, Bottom, Right;
- advanced geometry: Width, Height, aspect ratio, X, Y, Rotate.

The selection remains live on the canvas while this panel is open.

### 3.3 Layers panel

Layers has two modes:

- All;
- Overlapping.

Rows use actual element previews and content names. They are not generic icon-only rows.

On hover a row exposes:

- a six-dot drag handle;
- a context-menu button.

Clicking a layer row selects the corresponding canvas object without closing the panel. `Overlapping` filters the list to objects intersecting the current selection.

The observed layer context menu included:

- Copy;
- Copy style;
- Paste;
- Duplicate;
- Delete;
- Layer;
- Align to page;
- Create component;
- Comment;
- Lock;
- Link;
- Show element timings;
- Alternative text;
- Translate text.

The Layer submenu contained:

- Bring to front;
- Bring forward;
- Send backward;
- Send to back.

The Align submenu contained:

- Left;
- Center;
- Right;
- Top;
- Middle;
- Bottom.

### 3.4 Animation panel

Animation uses the same shared panel but changes its content based on whether a text element or the page is being animated.

For text, the observed panel included:

- presentation settings;
- Appear on click;
- custom motion by dragging the element;
- suggested text animations;
- general animations;
- Both, On enter, and On exit modes;
- speed;
- direction;
- reverse exit animation;
- add-on effects such as Rotate, Flicker, Pulse, and Wiggle;
- Remove animation.

For a page, the observed panel included:

- Animate entire design;
- Magic Animate;
- style families such as Simple, Sleek, Fun, Party, Corporate, and Chill;
- general page animations;
- suggested photo animations;
- Remove all animations;
- Apply to all pages.

The important pattern is one animation entry point with target-aware contents.

## 4. Sidebar and task-panel study

### 4.1 Templates

The Templates panel is search- and generation-oriented. It exposed:

- Generate;
- Search;
- Recently used;
- multi-slide template cards with `1 of N` and `N slides`;
- More templates for you.

Templates are treated as presentation-level bundles, not just single-slide artwork.

### 4.2 Elements

The Elements panel exposed:

- Generate;
- Search;
- Shapes;
- Graphics;
- Photos;
- Videos;
- 3D;
- Forms;
- Animations;
- Audio;
- Sheets;
- Tables;
- Charts;
- Frames;
- Grids;
- Mockups.

The hierarchy is search first, then browsable object families.

### 4.3 Text

The Text panel exposed:

- Add a text box;
- Magic Write;
- Brand Kit and brand-font editing;
- Add heading;
- Add subheading;
- Add body text;
- dynamic Page numbers;
- Apps;
- font combinations.

The order is useful: primitive insertion first, then brand/default styles, then dynamic and extensible content.

### 4.4 Uploads

The Uploads surface exposed a recording entry (`Record yourself`) in the accessible UI. The complete upload-source menu was not opened during this read-only pass.

### 4.5 Tools and drawing mode

Tools is directly relevant to Mona's drawing-first vision. It exposed:

- Select;
- Draw;
- Shapes;
- Lines;
- Sticky notes;
- Text;
- Signature;
- Tables.

Activating Draw changed the upper tool controls to:

- Pen;
- Marker;
- Highlighter;
- Eraser;
- Color;
- Settings.

The tool-mode list remained available below those controls.

In the observed state, drawing mode used a compact vertical palette beside the rail. It behaved as an interaction mode:

- the palette overlaid rather than permanently consumed canvas width;
- drawing-specific controls displaced ordinary selection formatting;
- Select returned to ordinary object interaction;
- a close control exited the palette.

For Mona, drawing must be a first-class canvas mode with an explicit exit, not a modal dialog and not an isolated sketch page.

### 4.6 Projects

Projects opened the shared panel with a `Your projects` heading. Its asset-management depth was outside this editor-focused study.

### 4.7 Apps

Apps is an extensibility and discovery surface, not a dump of every feature into the core editor.

Observed categories included:

- For you;
- AI generation;
- Communication;
- File/data management;
- Graphic design;
- Marketing;
- Photo editing;
- Project management;
- Text styling;
- Made for presentations.

Examples included text-effect apps and Canva-provided components such as:

- Magic Media;
- AI Voice;
- Charts;
- Photos;
- Bulk create;
- Data autofill;
- Audio;
- Background;
- Videos;
- Translate;
- Furigana;
- Mockups;
- Captions.

### 4.8 Photos

Photos is search-first and supplements search with topical suggestion chips. The observed suggestions ranged from content terms such as `Tokyo`, `Office`, and `Beach` to visual needs such as `Background` and `White background`.

### 4.9 Charts

The Charts insertion panel organized choices by data-visual family:

- Start with data;
- Bar charts;
- Line charts;
- Pie and donut;
- Area;
- Scatter and dot;
- Hierarchy;
- Bar race;
- Infographics;
- Other.

It then offered Flourish by Canva for a larger long-tail set of chart types, maps, and interactive content.

The chart-looking slide inspected in the fixture was not a native chart object. It was a grouped vector construction, so its contextual toolbar correctly resolved to group and line/path controls. Native Canva chart-object formatting remains explicitly unverified.

## 5. Bottom presentation workflow

### 5.1 Persistent footer

At the observed 1358 × 988 viewport, the footer occupied approximately `y = 952–984`.

Observed controls:

| Control | Approximate geometry | Behavior |
| --- | --- | --- |
| Notes | 80 × 32 | Opens a page-linked writing panel |
| Timer | 79 × 32 | Opens a floating presentation utility |
| Zoom slider | persistent | Continuous scale |
| Zoom options | 55 × 32 | Presets plus Fit/Fill policy |
| Pages | 79 × 32 | Toggles the filmstrip |
| Page counter | 65 × 32 | Becomes an inline page-number input |
| Grid view | 32 × 32 | Opens the whole-deck ordering overview |
| Present full screen | 32 × 32 | Direct presentation entry |
| Help | 32 × 32 | Assistance entry |

### 5.2 Notes

Notes opens a fixed left task panel while leaving the 72-pixel rail visible. The canvas refits rather than being covered.

The observed panel contained:

- `Page 2 – Add page title`;
- text-format entry;
- Download notes;
- Close;
- an editor placeholder;
- page time;
- `0 out of 5,000 characters used`;
- Generate notes.

Notes are tied to the active page and remain an editor workflow, not a blocking modal.

### 5.3 Timer

Timer opens a floating 200 × 200 circular utility above the lower-left footer. It does not refit the canvas.

Observed controls:

- subtract one minute;
- add one minute;
- editable minutes and seconds;
- Start timer;
- Reset timer.

The footer toggle changes to `Hide timer` while the timer is visible.

This distinction matters: a task panel is for document work; a floating utility is for transient presentation support.

### 5.4 Zoom

The zoom menu contained:

- 300%;
- 200%;
- 125%;
- 100%;
- 75%;
- 50%;
- 25%;
- 10%;
- Fit;
- Fill.

The slider provides continuous zoom. The menu provides common presets and fitting policy.

`Fit` is dynamic. Opening Notes changed the observed fit from 64% to 46% because the available workspace became narrower.

### 5.5 Filmstrip mode

Clicking Pages changes the editor from a continuous document view to a focused single-page workspace with a horizontal thumbnail filmstrip above the footer.

Observed behavior:

- the active thumbnail uses a strong selection outline;
- page numbers remain visible;
- thumbnails scroll horizontally;
- per-page comment state can appear on a thumbnail;
- each page exposes Page options;
- page titles can be edited inline in the active thumbnail;
- insertion controls appear at page boundaries;
- transition controls belong to the boundary between pages;
- the main slide refits above the filmstrip.

The accessible structure exposed:

- navigation named `Page`;
- `Page Thumbnails`;
- a `Pages` list;
- a button for every page;
- Page options for every page;
- Add controls between pages;
- Add page;
- Add page type;
- Add transition or Change transition.

The filmstrip keyboard contract stated:

- Left and Right select pages;
- Home and End jump to the first or last page.

### 5.6 Page counter

Clicking `2 / 20` transforms the current-page value into an inline input:

- role: spinbutton;
- label: Go to page;
- input mode: numeric;
- minimum: 1;
- maximum: 20;
- current page supplied as the placeholder.

This is faster than opening a separate navigator popover.

### 5.7 Page context menu

Right-clicking a page opened a menu containing:

- page title editing;
- document type and dimensions;
- Copy;
- Copy page style;
- Paste;
- Duplicate page;
- Delete page;
- Add page;
- Hide page;
- Add transition;
- Comment;
- Lock page;
- Download page;
- Copy link to this page;
- Notes;
- Resize page;
- Edit as video;
- Expand to whiteboard.

Shortcuts were shown beside applicable actions.

### 5.8 Grid view and ordering

Grid view replaces the canvas and ordinary creation rail with a whole-deck overview. At the observed viewport:

- page tiles were approximately 190 × 107 pixels;
- six tiles fit per row;
- the selected page used a strong outline;
- page numbers appeared below the previews;
- each tile exposed Page options;
- an Add-page tile followed the final page;
- the persistent footer retained Close grid view, Present full screen, and Help.

The top contextual pill changed to page-set actions:

- Select all;
- Add page;
- Duplicate page;
- Delete page;
- Hide;
- More.

Shift-clicking a second page produced real multi-selection. Labels updated to the selection count:

- Duplicate 2 pages;
- Delete 2 pages;
- Hide (2).

The bulk More menu contained:

- Rename 2 pages;
- Copy;
- Copy page style;
- Paste;
- Duplicate 2 pages;
- Delete 2 pages;
- Add page;
- Hide 2 pages;
- Add transition;
- Lock 2 pages;
- Download 2 pages;
- Copy link to this page;
- Notes;
- Edit (2) as video;
- Expand to whiteboard.

No explicit `Move page` command appeared. Ordering is therefore designed around direct manipulation of page tiles. The study did not drag a page because that would mutate the user's deck, so drag feedback, auto-scroll, drop indicators, and keyboard reorder remain unverified.

### 5.9 Presentation entry

The header uses a split action:

- `Present` is the default action;
- the adjacent disclosure opens all presentation modes.

Observed modes:

- Full screen — present in full screen;
- Presenter view — view notes and upcoming slides;
- Present and record — record yourself as you present;
- Autoplay — set speed to automatically play.

This split keeps the common action immediate while preserving discoverability of advanced modes.

## 6. Keyboard and accessibility contracts

The editor exposes substantial keyboard guidance:

### Global navigation

- Left and Right move between main-navigation buttons.
- Enter activates the current button.
- Command-F2 skips to the canvas.

### Design title

- Enter starts title editing.
- Escape stops title editing.

### Canvas

- Enter navigates into the page.
- Enter again navigates into groups or elements.
- Tab moves to the next page, group, or element.
- Command-F1 operates the toolbar.

### Selected element

- Arrow keys move the element.
- Comma and period rotate it.
- Command plus arrow keys resize it.
- Shift increases the increment.

### Filmstrip

- Left and Right select pages.
- Home and End jump to the first and last page.

Mona should preserve the same quality of keyboard model even if exact shortcuts differ. Every contextual surface must be discoverable by accessible name and navigable without pointer-only traps.

## 7. Mona interaction contracts

These are the non-negotiable behaviors inferred from the study.

### 7.1 Canvas primacy

- The slide remains the visual center of the product.
- Deep panels refit the workspace; they do not change document coordinates.
- Transient utilities overlay only when their task is genuinely transient.
- Opening a panel must not cause selected elements or guides to jump.

### 7.2 One contextual system

- Page, element, group, multi-selection, and edit modes use one contextual-toolbar architecture.
- The toolbar is computed from real selection capabilities.
- Mixed groups compose relevant controls.
- Drilling into groups exposes child controls without losing the group mental model.
- Placeholder controls must never be presented as finished functionality.

### 7.3 One shared task panel

- Creation rail domains and deep property workflows share one panel owner.
- Opening a new workflow replaces the panel content predictably.
- Re-activating the active rail item or pressing Close returns space to the canvas.
- Position, Layers, Animation, Notes, libraries, and future AI workflows should not each invent a different side-panel shell.

### 7.4 Clear command placement

- Global/document commands belong in the header.
- Frequent selection formatting belongs in the top pill.
- Immediate object lifecycle commands belong near the object.
- Sustained workflows belong in the shared panel.
- Compact one-value adjustments belong in anchored popovers.
- Page navigation and ordering belong at the bottom.
- Rare actions and shortcuts belong in overflow/context menus.

### 7.5 Complete page workflow

- The filmstrip is the default focused-page navigation surface.
- Add-page and transition affordances belong at page boundaries.
- Page title, comments, timing, notes, visibility, lock state, and transitions remain page-linked.
- The page counter supports direct numeric navigation.
- Grid view supports page-set selection and bulk actions.
- The default Present action and alternate presentation modes are both obvious.

### 7.6 Drawing-first input

- Draw is a first-class interaction mode reachable from the creation rail.
- Drawing tools appear in a compact mode-specific palette.
- Select is an explicit way back to object editing.
- Drawing must not open an isolated editor that loses slide context.
- Mona's AI brief can combine the current slide render, sketch layer, selected elements, element tree, and text instruction.
- Switching between text-first and drawing-first prompting should preserve the same document and selection state.

### 7.7 AI placement

Canva uses AI entries in both global creation and contextual editing. Mona should follow the same intent split:

- a global agent entry can create, transform, or coordinate across pages;
- `Ask Mona` on the page or selection should inherit page, selection, and viewport context;
- text assistance should appear in text-edit context;
- agent changes must resolve to editable document operations, not a flattened image.

The AI control must use the same real command/state layer as manual editing so undo, redo, selection, and export remain coherent.

## 8. State model for implementation

| Editor state | Top pill | Adjacent pill | Shared panel | Bottom |
| --- | --- | --- | --- | --- |
| No selection | Hidden or page-neutral | Hidden | Last explicit workflow only | Persistent |
| Page selected | Page properties | Page lifecycle | Page position/animation if requested | Active page |
| Element selected | Type-specific frequent properties | Object lifecycle | Deep property workflow if requested | Persistent |
| Group selected | Composed/mixed properties | Ungroup plus lifecycle | Group-aware deep workflow | Persistent |
| Child in group | Child-specific properties | Group context retained | Child selection remains live | Persistent |
| Text editing | Text properties | AI/text/link/comment/lock | Text deep settings if requested | Persistent |
| Drawing mode | Drawing-tool properties | Suppressed | Compact tool palette | Persistent |
| Filmstrip open | Current page or selection context | As applicable | Optional | Expanded thumbnails |
| Grid view | Page-set bulk actions | None | Hidden | Minimal overview utilities |
| Presentation utility open | Current editor context | As applicable | Unchanged | Utility toggled/expanded |

## 9. Implementation acceptance checklist

### Contextual toolbar

- [ ] Page selection exposes real page commands.
- [ ] Text selection and text editing have different adjacent actions.
- [ ] Shape, image, graphic, line, table, chart, media, group, and multi-selection each expose real capabilities.
- [ ] Mixed values use explicit mixed states rather than false defaults.
- [ ] Group drill-in does not lose group context.
- [ ] Every visible command changes real editor state and participates in undo/redo.

### Shared panel

- [ ] The rail remains persistent in ordinary editor mode.
- [ ] Only one shared panel is open at a time.
- [ ] Panel open/close refits the canvas with stable document coordinates.
- [ ] Position has Arrange and Layers.
- [ ] Layer selection and canvas selection stay synchronized.
- [ ] Deep text and animation workflows remain target-aware.

### Bottom workflow

- [ ] Filmstrip selection, scrolling, title editing, page options, comments, and insertion boundaries work.
- [ ] Page transitions are attached to boundaries.
- [ ] Numeric page navigation is inline and bounded.
- [ ] Notes are active-page-linked.
- [ ] Timer overlays without changing document geometry.
- [ ] Zoom offers continuous, preset, Fit, and Fill behavior.
- [ ] Grid view supports range/multi-selection and bulk commands.
- [ ] Reordering has visible drag origin, drop target, auto-scroll, and cancel behavior.
- [ ] Present has a default action plus alternate modes.

### Drawing and AI

- [ ] Drawing is a canvas mode with Select as an explicit exit.
- [ ] Sketch content remains aligned to the slide coordinate system.
- [ ] The agent can receive the slide render, sketch, element tree, selection, and user instruction together.
- [ ] Agent edits are editable operations with previews, undo, and error recovery.

### Accessibility and stability

- [ ] Every toolbar, menu, panel, filmstrip item, page tile, and direct-edit field has an accessible name.
- [ ] Focus returns to the invoking control after a popover or panel closes.
- [ ] Keyboard users can reach the header, canvas, contextual toolbar, panel, filmstrip, and page overview.
- [ ] Opening panels, showing guides, and changing selection states do not cause visual jumps.
- [ ] Compact viewports preserve the same command hierarchy through overflow rather than silently removing actions.

## 10. Explicitly unverified areas

The following were not claimed as verified:

- native Canva chart-object contextual controls;
- native table-object contextual controls;
- video and audio selection toolbars;
- crop-mode internals;
- complete upload-source menus;
- page drag feedback and actual reorder behavior;
- mobile and touch layouts;
- collaboration conflict states;
- paid AI generation results.

These should receive focused observation only when Mona reaches the corresponding implementation gate. They should not block the shell, contextual-toolbar, shared-panel, bottom-workflow, or drawing-mode work already supported by this study.

