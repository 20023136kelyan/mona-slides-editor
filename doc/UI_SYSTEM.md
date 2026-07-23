# Mona UI system

Mona uses shadcn as its application-component layer. Feature code composes components from `apps/web/src/components/ui`; it does not import Radix primitives directly. Radix remains an implementation detail of the registry components.

## Ownership layers

1. `apps/web/src/components/ui` contains official shadcn components and small Mona-wide extensions such as editor sizes, overlay class forwarding, and semantic radius tokens.
2. `EditorInspectorPrimitives.tsx` composes those components into inspector-specific controls without reimplementing focus, keyboard, popup, or selection behavior.
3. Feature components own layout and product behavior. Their `mona-*` classes describe composition or geometry, not a second component library.
4. The presentation renderer owns document appearance. UI tokens and shadcn styles must never leak into editable slide content.

## Color policy

Application chrome is neutral and uses shadcn semantic tokens: `background`, `foreground`, `muted`, `border`, `input`, `ring`, and their foreground counterparts.

Mona’s red-to-amber palette is reserved for identity surfaces such as the AI mark, branded illustrations, and future product artwork:

- `--brand-deep-red`
- `--brand-red`
- `--brand-orange`
- `--brand-amber`
- `--brand-yellow`

Brand colors are not control states. Selection, focus, disabled, destructive, success, and warning states use semantic UI tokens.

Direct-manipulation selection uses the neutral `--editor-selection*` scale. This keeps canvas handles, thumbnails, inspector states, and slideshow tools consistent without turning Mona's brand palette into application chrome.

## Radius policy

Feature CSS uses centralized roles:

- `--radius-detail` for tiny visual markers whose geometry needs a visible but minimal radius.
- `--radius-control` for buttons, inputs, toggles, and compact rows.
- `--radius-surface` for cards, previews, and grouped content.
- `--radius-overlay` for dialogs, menus, popovers, and sheets.
- `--radius-pill` only for deliberately pill-shaped badges or status chips.

New literal border-radius values are not accepted for ordinary UI. Renderer geometry and imported document values are exempt because they describe presentation content rather than application chrome.

## Component selection

Use the official shadcn component first:

| Need | Component |
| --- | --- |
| Action | `Button`, grouped with `ButtonGroup` |
| Text or numeric entry | `Input`; use `InputGroup` when the field contains actions or adornments |
| Long-form entry | `Textarea` |
| Searchable choice | `Command` inside `Popover` (the shadcn combobox pattern) |
| Boolean state | `Checkbox` or `Switch` |
| Mutually exclusive state | `ToggleGroup`, `Tabs`, or `Select`, depending on the interaction |
| Menu | `DropdownMenu` or `ContextMenu` |
| Anchored content | `Popover` |
| Modal or side panel | `Dialog` or `Sheet`, always with a title |
| Continuous value | `Slider` |

Do not rebuild dismissal, portal positioning, focus trapping, arrow-key navigation, or accessible roles inside a feature.

## Application-specific exceptions

Native elements remain appropriate when they are part of the document interaction engine rather than the product component system:

- slide and thumbnail hit targets;
- resize, rotate, crop, alignment-guide, gradient-stop, and SVG control handles;
- renderer-owned media controls and read-only presentation navigation, which must not inherit editor chrome;
- chart spreadsheet cells;
- hidden file inputs;
- low-level color-channel controls;
- inline thumbnail and layer-name editing where the input is embedded in a direct-manipulation row;
- coordinate-driven canvas and thumbnail context-menu adapters whose opening event also performs editor hit-testing.

These exceptions may use shadcn around the specialized surface—Dialog, ContextMenu, Button, or Input shells—but must not change document coordinates or pointer contracts merely to look more component-like.

## Class conventions

- Use `mona-<feature>-<part>` for feature layout and geometry.
- Use `data-slot`, `data-state`, `aria-*`, and shadcn variants for component state; do not invent parallel `.is-open` or `.is-selected` state systems for registry components.
- Use `cn()` for conditional class composition in TypeScript.
- Keep reusable visual variants in the registry component or a shared composition, not copied across feature CSS.

`npm run check:architecture` enforces the direct-Radix boundary, shadcn ownership of ordinary controls, centralized radii, neutral selection states, and the presence of the central brand and radius tokens.
