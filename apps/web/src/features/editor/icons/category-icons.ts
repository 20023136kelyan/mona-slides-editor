/**
 * One icon per rail category, from Microsoft's Fluent UI System Icons.
 *
 * Two collections, used deliberately rather than interchangeably:
 *
 * - `fluent-color` is the colour family — gradient-shaded, ~199 distinct
 *   concepts. Built categories take these.
 * - `fluent` is the monochrome family from the same repo, ~20k icons. Stub
 *   categories take these, so "no colour" reads as "not built yet" instead of
 *   as an inconsistency, and the rail's existing `text-muted-foreground` on
 *   stubs still does something (a colour icon would ignore it).
 *
 * Three built categories — Shape, Line, Equation — are monochrome because the
 * colour family has no equivalent. That is a real gap, not a choice.
 *
 * Icons are the 24px artwork: the rail renders at 16px and the drawer's empty
 * space at 20px, and Fluent's 24px variants carry enough detail to scale down
 * cleanly to both.
 *
 * Imports are static because unplugin-icons resolves them at build time; a
 * lookup table keyed by category is the closest we get to dynamic, and it keeps
 * every icon decision in one file rather than scattered across the rail.
 */
import ColorBoard from '~icons/fluent-color/board-24'
import ColorChart from '~icons/fluent-color/data-bar-vertical-ascending-24'
import ColorCloud from '~icons/fluent-color/cloud-24'
import ColorImage from '~icons/fluent-color/image-24'
import ColorSettings from '~icons/fluent-color/settings-24'
import ColorSymbol from '~icons/fluent-color/number-symbol-square-24'
import ColorTable from '~icons/fluent-color/table-24'
import ColorText from '~icons/fluent-color/text-edit-style-24'
import ColorVideo from '~icons/fluent-color/video-24'

import MonoApps from '~icons/fluent/apps-24-regular'
import MonoColor from '~icons/fluent/color-24-regular'
import MonoCrop from '~icons/fluent/crop-24-regular'
import MonoCube from '~icons/fluent/cube-24-regular'
import MonoFolder from '~icons/fluent/folder-24-regular'
import MonoForm from '~icons/fluent/form-24-regular'
import MonoFormula from '~icons/fluent/math-formula-24-regular'
import MonoGrid from '~icons/fluent/grid-24-regular'
import MonoLine from '~icons/fluent/line-horizontal-1-24-regular'
import MonoMusic from '~icons/fluent/music-note-1-24-regular'
import MonoPhone from '~icons/fluent/phone-24-regular'
import MonoShapes from '~icons/fluent/shapes-24-regular'
import MonoSparkle from '~icons/fluent/sparkle-24-regular'
import MonoSticker from '~icons/fluent/sticker-24-regular'
import MonoTableSimple from '~icons/fluent/table-simple-24-regular'

import type { ComponentType } from 'react'

export type EditorCategoryIconKey =
  | 'apps'
  | 'audio'
  | 'brand'
  | 'charts'
  | 'equations'
  | 'forms'
  | 'frames'
  | 'graphics'
  | 'grids'
  | 'lines'
  | 'magicMedia'
  | 'mockups'
  | 'photos'
  | 'projects'
  | 'settings'
  | 'shapes'
  | 'sheets'
  | 'symbols'
  | 'tables'
  | 'templates'
  | 'text'
  | 'threeD'
  | 'uploads'
  | 'videos'

export const CATEGORY_ICONS: Record<EditorCategoryIconKey, ComponentType<{ className?: string }>> = {
  // Built — colour.
  charts: ColorChart,
  photos: ColorImage,
  settings: ColorSettings,
  symbols: ColorSymbol,
  tables: ColorTable,
  templates: ColorBoard,
  text: ColorText,
  uploads: ColorCloud,
  videos: ColorVideo,
  // Built, but the colour family has no equivalent.
  equations: MonoFormula,
  lines: MonoLine,
  shapes: MonoShapes,
  // Not built yet — monochrome is the signal.
  apps: MonoApps,
  audio: MonoMusic,
  brand: MonoColor,
  forms: MonoForm,
  frames: MonoCrop,
  graphics: MonoSticker,
  grids: MonoGrid,
  magicMedia: MonoSparkle,
  mockups: MonoPhone,
  projects: MonoFolder,
  sheets: MonoTableSimple,
  threeD: MonoCube,
}
