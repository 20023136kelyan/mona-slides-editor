import { createContext, useContext, type ComponentType } from 'react'

import type { Slide, SlideTemplate, SlideTheme, TemplateProvider } from '@mona/presentation-core/model'

import type { CreateChartElementOptions } from '@/features/editor/editor-chart'
import type { EditorCreateTool } from '@/features/editor/editor-create-tool'
import type { EditorElementCategory } from '@/features/editor/shell/editor-shell'

/** What a drawer panel is allowed to do to the deck. */
export interface EditorPanelActions {
  /** Arm a create tool; the next canvas gesture places it. */
  createTool: (tool: EditorCreateTool | null) => void
  /** Start the freehand custom-shape gesture. */
  drawCustomShape: () => void
  insertAudio: (payload: { ext?: string; src: string }) => void
  insertChart: (spec: CreateChartElementOptions & { openDataEditor?: boolean }) => void
  insertImageSource: (src: string) => void
  insertSymbol: (value: string) => void
  insertTable: (rows: number, columns: number) => void
  insertTemplateAll: (slides: Slide[], theme: Partial<SlideTheme>) => void
  insertTemplateOne: (slide: Slide) => void
  insertVideo: (payload: { ext?: string; poster?: string; src: string }) => void
  openLatexEditor: () => void
  openPathEditor: () => void
}

/**
 * Everything the drawer offers its panels.
 *
 * Panels reach this through context rather than props. Every action used to be
 * threaded from EditorDeck through EditorRailDrawer into the one panel that
 * needed it, so adding a category meant editing both files even when the new
 * panel introduced nothing new. A panel now states its own dependencies by
 * reading them here, and the registry entry is the only place that changes.
 */
export interface EditorPanelContextValue {
  actions: EditorPanelActions
  /**
   * The active category's mark, from the registry. PanelEmptyState falls back
   * to it, so the drawer's empty space carries the right icon without every
   * panel having to name its own.
   */
  categoryIcon?: ComponentType<{ className?: string }>
  /** Which element pool the rail currently has selected. */
  elementCategory: EditorElementCategory
  /**
   * Where the catalogue's templates come from. App configuration rather than
   * deck data, so it is provided here instead of living in persisted state.
   */
  templateProviders: readonly TemplateProvider[]
  templates: readonly SlideTemplate[]
  theme: SlideTheme
}

export const EditorPanelContext = createContext<EditorPanelContextValue | null>(null)

/** Non-throwing variant for primitives that may render outside the drawer. */
export function useOptionalEditorPanel(): EditorPanelContextValue | null {
  return useContext(EditorPanelContext)
}

export function useEditorPanel(): EditorPanelContextValue {
  const value = useContext(EditorPanelContext)
  if (!value) throw new Error('Drawer panels require an EditorPanelContext provider')
  return value
}
