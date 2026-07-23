# Canva global editor header study

Status: research complete, 2026-07-23  
Scope: the very top, document-level header in Canva's desktop presentation editor  
Implementation status: no Mona application code was changed during this study

## Purpose

This document isolates the interaction contract of Canva's topmost editor bar. It is a behavioral reference for Mona, not a request to copy Canva's brand gradient, icons, upsell copy, class names, or exact product taxonomy.

The study used a signed-in, non-confidential 20-page presentation. The deck was treated as read-only. Menus, panels, title focus, save state, comments, analytics, presentation choices, and sharing were inspected without intentionally changing the presentation.

Evidence came from:

- direct browser interaction;
- accessible roles, names, state, and keyboard-help text;
- DOM geometry and computed styles;
- the contents of menus and anchored panels;
- comparison with the selection and page states already recorded in `CANVA_EDITOR_BEHAVIOR_STUDY.md`.

The primary measured viewport for this pass was 1280 × 720 CSS pixels at device pixel ratio 2.

## Executive conclusion

Canva's top header is a document command bar, not a formatting toolbar.

It stays structurally stable while the selection-specific toolbar underneath it changes. Its responsibilities are deliberately limited to:

1. leaving or managing the document;
2. reporting the current edit and persistence state;
3. naming the document;
4. showing identity and collaboration status;
5. entering analytics, comments, presentation, sharing, export, and publishing workflows.

The most important Mona lesson is separation of scope:

- the global header should not acquire element-formatting controls;
- the contextual toolbar should not acquire file, account, or publishing controls;
- the title should remain an in-place document property;
- stateful utilities should disclose details from the control that owns the state;
- primary actions may use split-button behavior when one default action is much more common than its alternatives.

## 1. Top-level architecture

### 1.1 Header container

The observed header:

- was 57 pixels high;
- occupied the full viewport width;
- used `overflow: hidden`;
- contained one semantic `menubar` named `Main`;
- divided that menubar into two named groups:
  - `Document controls`;
  - `Share and publish`.

The menubar itself used:

- horizontal flex layout;
- `justify-content: space-between`;
- vertical centering;
- a dark-theme command treatment over Canva's brand gradient.

Canva's observed background was a cyan-to-purple gradient. Mona should not inherit this treatment. Mona's previously agreed neutral application chrome remains the correct direction.

### 1.2 Document-controls group

Measured group:

- `x = 0`;
- `y = 0`;
- width approximately `451.5`;
- height `56`;
- horizontal flex layout;
- 4-pixel gap;
- padding `8px 0 8px 16px`.

The group contained:

- Home;
- File;
- Resize;
- current editing mode;
- conditional history/state controls;
- save and sync state.

Undo and Redo are state-dependent. They were present in an earlier active-edit observation but absent after a clean reload with no available local history. They must not reserve permanent visible space when there is nothing to undo or redo.

### 1.3 Share-and-publish group

Measured group:

- began at approximately `x = 451.5`;
- used the remaining width;
- height `56`;
- horizontal flex layout;
- `justify-content: flex-end`;
- 8-pixel gap;
- 8-pixel padding;
- `overflow: hidden`.

It contained:

- the centered editable document title;
- a plan/trial call to action;
- current-user identity;
- Analytics;
- comments and unread count;
- the default Present action;
- the presentation-mode disclosure;
- Share.

The title lives inside this right-side flex region, but it is visually centered in the available header space. Mona should implement a deliberate center-title layout instead of relying on accidental flex balance between the left and right control counts.

## 2. Measured control inventory

All measurements below are CSS pixels at the observed viewport.

| Control | X | Width | Height | Semantic behavior |
| --- | ---: | ---: | ---: | --- |
| Home | 16.00 | 40.00 | 40 | `menuitem`; route-level editor exit |
| File | 60.00 | 56.42 | 40 | `menuitem`; popup menu |
| Resize | 120.42 | 70.95 | 40 | `menuitem`; premium document-size workflow |
| Editing | 195.37 | 123.94 | 40 | `menuitem`; current access/edit-mode indicator |
| Save/sync | 337.30 | 40.00 | 40 | icon-only `menuitem`; popup status |
| Design title | 533.81 | 189.96 | 40 | in-place textbox |
| Trial CTA | 731.77 | 192.67 | 40 | monetization action |
| Identity | 932.45 | 32.00 | 32 | button; participant/identity card |
| Analytics | 972.45 | 40.00 | 40 | icon-only `menuitem`; dialog |
| Comments | 1020.45 | 40.00 | 40 | icon-only `menuitem`; anchored panel |
| Present | 1068.45 | 84.44 | 40 | primary split-button action |
| Present modes | 1152.88 | 40.00 | 40 | split-button disclosure |
| Share | 1200.88 | 71.12 | 40 | emphasized `menuitem`; anchored panel |

Common geometry:

- ordinary interactive height: 40 pixels;
- icon-only ordinary target: 40 × 40 pixels;
- visible user avatar: 32 × 32 pixels inside the 40-pixel rhythm;
- common standalone radius: 12 pixels;
- common horizontal group gap: 4 or 8 pixels;
- present split button:
  - main action radius `12px 0 0 12px`;
  - disclosure radius `0 12px 12px 0`;
- Share used a light, high-contrast fill while most other controls were transparent.

The consistent target size matters more than the exact Canva radius or icon.

## 3. Visual hierarchy

The header establishes four visual levels:

1. **Neutral document utilities**  
   Home, File, Resize, mode, save, identity, analytics, and comments use low-emphasis transparent treatments.

2. **Document identity**  
   The title is centered and readable but does not resemble a permanent form field.

3. **Primary task entry**  
   Present is wider and text-labeled because it is a frequent presentation-specific outcome.

4. **Terminal publish action**  
   Share receives the strongest contrast in the bar.

The Canva trial CTA is intentionally prominent but is not part of the editor's transferable interaction model. Mona should omit it until Mona has an actual plan or account action to place there. Empty product monetization chrome must not be recreated.

## 4. File menu

### 4.1 Surface behavior

File opens a 320-pixel-wide menu anchored directly below the File button:

- `x = 60`;
- `y = 56`;
- width `320`;
- observed content height exceeded the 720-pixel viewport;
- the menu scrolls or clips internally rather than moving the header;
- menu rows are approximately 40 pixels high.

The top of the menu is a metadata block rather than an ordinary action row. It displays:

- the document title;
- an inline title-edit affordance;
- document type;
- author;
- document dimensions.

The title is repeated here because the File menu is also the document-information entry point.

### 4.2 Complete observed File hierarchy

The main File menu contained:

- Create new design;
- Upload files;
- Settings;
- Accessibility;
- Save, with `All changes saved` secondary text;
- Make available offline, marked `New`;
- Star;
- Make a copy;
- Download;
- Print;
- Version history;
- Find and replace text, with `⌘F`;
- Open in desktop app;
- Suggest improvement;
- Report design.

Settings, Accessibility, and Print are cascading-menu entries. They advertise the submenu relationship and expanded state semantically.

### 4.3 Settings submenu

The Settings submenu remained open beside the parent File menu:

- `x = 378`;
- `y = 238`;
- width `320`;
- height approximately `370`.

Observed settings:

- Show rulers and guides, `⇧R`;
- Add guides;
- Show margins;
- Show print bleed;
- Show comments;
- Use English formulas;
- Video playback quality;
- Locale settings.

This is a cascading menu, not navigation to a generic Settings screen. Mona should use the same rule for immediately actionable document-view settings.

### 4.4 Accessibility submenu

Observed accessibility actions:

- Show view-only captions on media;
- Check design accessibility;
- Edit text semantics;
- Reduce motion;
- Navigate by layer order.

These are document or editor behaviors, so their placement under File is coherent even though application-wide accessibility preferences may also exist elsewhere.

### 4.5 Mona implications

Mona should not copy every Canva File item. It should copy the hierarchy rule:

- put document lifecycle, import/export, copy, history, and document-view settings in File;
- place document metadata at the top;
- use cascading menus for small, immediately actionable option sets;
- use a dedicated panel or dialog when the workflow needs search, previews, or multiple decisions;
- show keyboard shortcuts in the menu, not in a separate help-only surface.

## 5. Save and persistence state

The save control is an icon-only cloud/state button. Its accessible name changes with status; the observed settled state was `All changes saved`.

Opening it produced:

- `Changes saved`;
- `Last saved: Just now`;
- `Keep designing offline`;
- an explanation that offline copies are stored on the current device;
- `Make available offline`.

Behavioral contract:

- the icon is a status indicator and a disclosure control;
- clicking it explains the current state;
- the popover combines persistence status with the nearest relevant recovery/offline action;
- transient save states should use the same location so the user never has to hunt for document safety.

Mona should model at least:

- idle/saved;
- saving;
- local-only or offline;
- save failed;
- retrying;
- conflict or remote-update attention.

The state label must remain accessible even when the visible control is icon-only.

## 6. Editable document title

The title is always implemented as a textbox, even when it visually reads as plain header text.

Observed resting geometry:

- `x = 533.81`;
- `y = 8`;
- width `189.96`;
- height `40`;
- 12-pixel radius;
- `9px 15px` padding;
- transparent background and border;
- light text;
- `tabindex = -1` in the observed menubar state.

On pointer activation:

- the same textbox receives focus;
- its rectangle does not move or resize;
- the caret is placed at the clicked/end position;
- the title does not jump left or right;
- Escape exits title editing without requiring a save button.

Canva's own keyboard-help text states:

- Enter starts title editing;
- Escape stops title editing.

Mona contract:

- render display and edit states in the same box;
- keep font, line height, padding, width, and horizontal position identical;
- never replace a display `<div>` with a differently measured input;
- save by blur/Enter according to Mona's state model;
- let Escape restore the prior committed title when the current edit has not been committed;
- do not translate the presentation title.

## 7. Editing mode

The observed control displayed a pencil icon, `Editing`, and a disclosure chevron.

In this owner/edit session it behaved as the current access-mode indicator and did not expose an additional menu during repeated pointer activation. It also did not advertise `aria-haspopup` in the inspected DOM.

Mona should therefore treat the label as a stateful access/edit-mode slot, not assume that it is always a dropdown. If Mona later supports owner-controlled mode switching, the same slot can disclose:

- Editing;
- Commenting;
- Viewing.

The label must reflect actual permissions. A user without edit permission should never see a cosmetic `Editing` state.

## 8. Identity and participant state

The 32-pixel avatar opens a compact identity/participant card rather than a complete account-settings menu.

The observed card showed:

- the current participant, marked `You`;
- account identifier/email;
- current document access level, `Can edit`.

Mona implication:

- this header slot answers “who am I in this document, and what can I do?”;
- application settings and sign-out may belong in a broader user menu in Mona;
- document-role information should still be visible near collaboration controls;
- do not expose email or other account data unless it is useful and intentionally scoped.

## 9. Analytics

Analytics opened a focused dialog titled `Analytics`. The dialog exposed a Close action and marked the header control expanded while open.

The studied document did not expose useful metric content in this account state, but the surface contract is still clear:

- Analytics is document-scoped;
- it opens a modal/focused analysis surface;
- it is not mixed into Share;
- it remains an icon-only secondary utility in the header.

Mona can omit Analytics until meaningful presentation or viewer telemetry exists.

## 10. Comments

The Comments control:

- is a 40 × 40 icon target;
- exposes the unread count as a badge;
- used an anchored panel rather than a modal;
- advertised `aria-haspopup="menu"` and expanded state;
- did not navigate away from the editor.

The open panel exposed:

- `Current page`;
- `Unread comments on other pages`;
- a View/filter control;
- empty/current-page guidance;
- `Add comment`;
- comment-filter/sort support.

The current-page selector measured 168 × 40 pixels in the panel.

The badge visually used `9` in the studied deck. Mona must:

- use one semantic count even if visual layering creates duplicate text nodes;
- provide the button an accessible name independent of the count;
- distinguish unread comments from total comments;
- preserve the selected page and canvas state while the panel opens.

Comments are collaboration state, not element formatting. Per-element comment creation may be available in the object-adjacent toolbar, while the global header opens the all-comments overview.

## 11. Present split button

Present is a true split action:

- the wide left segment starts the default presentation mode;
- the 40-pixel right segment exposes alternatives;
- the segments share one visual outline but remain separate interactive targets;
- the primary side is text-labeled;
- the disclosure side is icon-only with an accessible name.

Observed presentation modes:

- Full screen — Present in full screen;
- Presenter view — View notes and upcoming slides;
- Present and record — Record yourself as you present;
- Autoplay — Set speed to automatically play.

Mona should retain this pattern. A single Present button that first opens a chooser adds unnecessary friction; a single button that silently chooses a mode makes the alternatives undiscoverable.

The default action and disclosure must remain separate in the accessibility tree and keyboard order.

## 12. Share and publishing panel

### 12.1 Surface geometry

Share opens an anchored right-side publishing panel immediately below the header:

- `x = 856`;
- `y = 56`;
- width `416`;
- observed height approximately `647`;
- bottom at approximately `703`;
- internal content area scrolls;
- semantic outer region rather than a page navigation.

The editor remains visible behind it. This is not a centered modal.

### 12.2 Observed contents

The panel contained:

- Share design;
- current visitor count;
- People with access;
- Add people;
- Access level;
- Anyone with the link;
- Must have link to access;
- current permission, `Can edit`;
- Copy link;
- Personalize your link;
- Download;
- Live;
- Public view link;
- Present and record;
- Present;
- Website;
- Microsoft PowerPoint;
- Google Drive;
- See all.

The panel combines two related layers:

1. access and collaboration;
2. delivery, export, and publishing destinations.

The ordering is important. Canva presents access control and copy-link behavior before export destinations.

### 12.3 Mona implications

For Mona:

- keep Share as the terminal high-emphasis header action;
- use a right-anchored panel so the document remains spatially present;
- show access and link state first;
- follow with export/publish destinations;
- make PowerPoint export a first-class item;
- do not hide the most important native format under `See all`;
- separate destructive permission changes from safe copy/download actions;
- reflect permission changes immediately in the header's mode/identity state.

## 13. Home and navigation

Home is an icon-only 40 × 40 target at the far left.

It is a route-level action that exits the editor context. It should:

- remain spatially stable;
- have a clear accessible name;
- never resemble Undo;
- preserve or confirm unsaved local work before navigation;
- not be duplicated in File unless the destinations differ.

The study did not activate Home because doing so would leave the editor.

## 14. Keyboard and focus contract

Canva exposes explicit keyboard guidance for the header:

- the main navigation contains document-level controls;
- Left and Right move between header controls;
- Enter activates the current control;
- `⌘F2` skips to the canvas.

It also exposes hidden skip links:

- Skip navigation;
- Skip to main content.

Observed semantics:

- header: `banner`;
- primary control row: `menubar` named `Main`;
- left group: `Document controls`;
- right group: `Share and publish`;
- ordinary commands: `menuitem`;
- title: textbox;
- identity: button;
- popup owners expose `aria-haspopup` and `aria-expanded`;
- menu and submenu items use `menu`/`menuitem`.

The observed DOM included a mixture of `tabindex = 0` and `-1` values because focus state is managed dynamically. Mona should implement one predictable roving-focus model rather than hard-code the sampled tab-index values.

Required Mona behavior:

- one Tab stop enters the menubar;
- Left/Right move within it;
- Home/End move to the first/last available command;
- Enter/Space activate;
- Escape closes the newest overlay and returns focus to its owner;
- opening a submenu moves focus into the menu;
- closing any menu restores focus;
- title edit mode temporarily gives text-editing keys to the input;
- skip-to-canvas bypasses the entire header and contextual toolbar.

## 15. State and overlay model

The header owns multiple overlay types. They should not be implemented as one generic dropdown component.

| Owner | Surface | Dismissal | Focus return |
| --- | --- | --- | --- |
| File | anchored menu | Escape, outside click, chosen action | File |
| Settings/Accessibility | cascading submenu | Escape, pointer back to parent | submenu owner |
| Save/sync | compact status popover | Escape, outside click | save icon |
| Identity | compact participant card | Escape, outside click | avatar |
| Analytics | dialog | Close, Escape | Analytics |
| Comments | anchored overview panel | toggle, Escape, outside click | Comments |
| Present modes | anchored menu | Escape, outside click, chosen mode | disclosure segment |
| Share | 416-pixel anchored panel | toggle, Escape, outside click | Share |

Only one top-header overlay should own focus at a time. Opening a new one closes the previous one.

## 16. Invariance across editor modes

The global header remained the document-level surface while the UI underneath it changed between:

- no selection;
- page selection;
- text and object selection;
- task-panel workflows;
- page-thumbnail and grid-oriented work.

The contextual toolbar changes with selection. The global header does not absorb those controls.

Expected state changes inside the header are limited to:

- Undo/Redo availability;
- save/sync state;
- title value/editing;
- permission/edit mode;
- participant presence;
- analytics availability;
- comment unread count;
- presentation availability;
- share/access state.

## 17. Responsive and overflow behavior

The observed header uses two flex groups and `overflow: hidden` on the header and right group. That confirms explicit compression is part of the design.

The browser-control surface did not expose a safe viewport-resize API, so breakpoint-by-breakpoint behavior was not directly verified in this pass. It must not be claimed as observed parity.

Mona's recommended compression priority is:

1. remove optional monetization or promotional controls;
2. collapse low-priority text labels to icon-only controls with tooltips;
3. reduce the title's maximum width and ellipsize its resting value;
4. move Analytics and other low-frequency utilities into an overflow menu;
5. keep comments, Present, and Share available;
6. keep Home/File/save status reachable;
7. never allow controls to overlap the title;
8. never allow the title to push Share off-screen.

At phone-sized widths, Mona should use a different editor shell rather than indefinitely compress the desktop header.

## 18. What Mona should copy

Copy these interaction rules:

- fixed 56-ish-pixel global document bar;
- two semantic command groups;
- stable 40-pixel target rhythm;
- in-place title input with no layout jump;
- stateful save icon with explanatory popover;
- conditional history controls;
- comments badge and overview panel;
- split Present action;
- emphasized terminal Share action;
- anchored right-side Share panel;
- explicit keyboard/focus model;
- separation between document commands and selection formatting.

## 19. What Mona should not copy

Do not copy:

- Canva's cyan-purple gradient;
- Canva icons or trademarks;
- trial/upsell text;
- Canva-specific destinations that Mona does not support;
- duplicate product taxonomy;
- account identifiers exposed by the studied account;
- class names or implementation structure;
- every File-menu action simply to make the menu look full.

## 20. Proposed Mona component boundaries

Suggested React component structure:

```text
GlobalEditorHeader
├─ DocumentControlsGroup
│  ├─ HomeButton
│  ├─ FileMenu
│  ├─ ResizeAction
│  ├─ EditModeIndicator
│  ├─ HistoryControls
│  └─ SaveStatusPopover
├─ DocumentTitleInput
└─ SharePublishGroup
   ├─ PresenceButton
   ├─ AnalyticsButton
   ├─ CommentsPanelTrigger
   ├─ PresentSplitButton
   └─ SharePanelTrigger
```

Supporting overlay components:

```text
FileMenu
├─ DocumentMetadata
├─ DocumentLifecycleActions
├─ DocumentViewSettingsSubmenu
└─ AccessibilitySubmenu

SharePanel
├─ AccessSummary
├─ PeopleWithAccess
├─ LinkPermissionControls
├─ CopyLinkAction
└─ PublishExportDestinations
```

The component tree should not dictate state ownership. Document title, save state, permissions, undo state, comment count, and presence should come from the editor/application stores rather than local visual-component state.

## 21. Acceptance checklist for Mona

### Layout

- [ ] Header remains exactly one stable row at supported desktop widths.
- [ ] All ordinary targets are at least 40 × 40 pixels.
- [ ] Title is visually centered without relying on symmetrical control counts.
- [ ] Left and right groups cannot overlap the title.
- [ ] Present segments share a visual shell but have separate hit targets.
- [ ] Share remains the highest-emphasis terminal action.

### Title

- [ ] Activating the title does not change its rectangle.
- [ ] The caret appears without horizontal jumping.
- [ ] Enter begins editing from keyboard navigation.
- [ ] Escape exits and restores the correct committed value.
- [ ] The document title is not localized.

### State

- [ ] Undo/Redo appear only when relevant.
- [ ] Save status exposes an accessible state label.
- [ ] Saving, saved, offline, retry, conflict, and failure states are designed.
- [ ] Comment count distinguishes unread from total.
- [ ] Edit mode reflects real permissions.

### Menus and panels

- [ ] File is anchored to its owner and keyboard navigable.
- [ ] File submenus cascade without closing the parent prematurely.
- [ ] Save opens a compact status popover.
- [ ] Comments opens an overview panel without losing selection.
- [ ] Present's main segment starts the default mode directly.
- [ ] Present disclosure lists alternative modes.
- [ ] Share opens a right-anchored, internally scrollable panel.
- [ ] Opening one header overlay closes another.
- [ ] Escape returns focus to the triggering control.

### Accessibility

- [ ] Header is a named landmark/menubar.
- [ ] Left and right groups have meaningful names.
- [ ] Icon-only controls have stable accessible names.
- [ ] Popup controls expose expanded and popup state.
- [ ] Roving keyboard focus works with Left/Right/Home/End.
- [ ] Skip navigation and skip-to-canvas affordances exist.
- [ ] Badges do not create duplicated spoken counts.

## 22. Explicitly unverified

The following were not safely or completely verified and should not be described as Canva parity:

- exact breakpoint thresholds and control-collapse order;
- the full Resize workflow in the studied account;
- alternate editing-mode choices in a non-owner or view-only session;
- populated Analytics metrics;
- dirty/save-failure animation timing;
- multi-user live-presence animation;
- Home navigation with unsaved local-only changes;
- touch and mobile-editor variants.

These are follow-up research items if Mona reaches the corresponding implementation stage.
