# Mona UI system

Mona uses shadcn as its application-component layer. Feature code composes components from `apps/web/src/components/ui`; it does not import Radix primitives directly. Radix remains an implementation detail of the registry components.

## Ownership layers

1. `apps/web/src/components/ui` contains official shadcn components and small Mona-wide extensions such as editor sizes, overlay class forwarding, and semantic radius tokens. Editor control density lives here as `cva` variants (for example `Button` `variant="editor"` / `size="editor"`), not as a private CSS skin.
2. Editor chrome (header, rail, task drawer, status bar, agent dock, contextual toolbar shell, filmstrip chrome) is composed with **Tailwind utilities + shadcn variants**. Prefer semantic tokens already wired in `index.css` (`background`, `foreground`, `muted`, `border`, `sidebar`, and their counterparts).
3. Thin layout recipes (`InspectorRow`, `InspectorSection`, and similar) are allowed only when the same Tailwind composition repeats three or more times. They are ordinary TSX helpers, not a second component library.
4. `EditorInspectorPrimitives.tsx` is transitional. The end state is direct `ui/*` usage plus those thin recipes. New inspector work must not add `mona-panel-*` skins.
5. Feature CSS (`editor.css`) is reserved for **document geometry and direct-manipulation exceptions**: stage/viewport, selection and transform handles, hit targets, filmstrip drag markers and edge masks, `CollapsiblePanelRegion` width animation, rich-text document surface, and renderer-adjacent rules that cannot express pixel contracts in utilities alone. When a chrome rule moves to Tailwind, delete it from `editor.css` in the same change.
6. The presentation renderer owns document appearance. UI tokens and shadcn styles must never leak into editable slide content.

## Chrome styling rule

New editor chrome must not introduce a private visual language in `editor.css` when a Tailwind utility or `ui/*` variant can express the same look. Keep a stable `data-testid`, landmark role, or minimal hook class only when tests need a selector; hook classes must not carry visual rules once the skin has moved.

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

- Prefer Tailwind utilities and `ui/*` variants for editor chrome layout and control look.
- Use `mona-<feature>-<part>` for document geometry, direct-manipulation hooks, and test-stable selectors that must not carry chrome skins.
- Use `data-slot`, `data-state`, `aria-*`, and shadcn variants for component state; do not invent parallel `.is-open` or `.is-selected` state systems for registry components.
- Use `cn()` for conditional class composition in TypeScript.
- Keep reusable visual variants in the registry component or a shared composition, not copied across feature CSS.

`npm run check:architecture` enforces the direct-Radix boundary, shadcn ownership of ordinary controls, centralized radii, neutral selection states, and the presence of the central brand and radius tokens.
