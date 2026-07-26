/**
 * The drawer's task panels, by route.
 *
 * This is the whole surface for adding a category: write a panel that renders
 * PanelChrome > [PanelHeader] + PanelBody, pull what it needs from
 * useEditorPanel() / useEditorPanelSearch(), and add one entry here. The drawer
 * renders the match and knows nothing else about it — no per-panel props, no
 * per-panel container styling, no branch in EditorRailDrawer.
 *
 * Titles are not listed: they come from `foundation.editor.taskPanels.<route>`
 * by convention, which EditorDeck already resolves for the drawer's aria-label.
 */
import type { ComponentType } from 'react'

import { CATEGORY_ICONS } from '@/features/editor/icons/category-icons'
import type { EditorPanelSearchMode } from '@/features/editor/panel/editor-panel-search'
import { ElementsPanel, TextPanel } from '@/features/editor/panel/panels/ElementsPanel'
import { ChartsRoute, PhotosRoute, UploadsRoute, VideosRoute } from '@/features/editor/panel/panels/MediaRoutes'
import { TemplatesPanel } from '@/features/editor/panel/panels/TemplatesPanel'
import type { EditorTaskPanelRoute } from '@/features/editor/shell/editor-shell'

export interface EditorPanelDefinition {
  Component: ComponentType
  /**
   * The category's own mark. The drawer hands it to the empty space so an
   * empty panel reads as *this category, empty* rather than a generic void.
   * Panels whose icon varies with their state (Elements, one icon per pool)
   * override it when they render the empty space themselves.
   */
  icon: ComponentType<{ className?: string }>
  /** How this panel consumes the drawer search bar. */
  searchMode: EditorPanelSearchMode
  /**
   * Placeholder for the search bar. Omit to get the generic
   * "Search {{category}}" built from the panel's own title.
   */
  searchPlaceholderKey?: string
}

/**
 * Routes the drawer renders itself. Routes absent from this map are either
 * rendered as `secondaryContent` (speaker notes, comments, search, layers,
 * slide-type labels) or belong to the contextual inspector (`properties`).
 */
export const EDITOR_PANEL_REGISTRY: Partial<Record<EditorTaskPanelRoute, EditorPanelDefinition>> = {
  charts: { Component: ChartsRoute, icon: CATEGORY_ICONS.charts, searchMode: 'submit', searchPlaceholderKey: 'foundation.editor.charts.searchPlaceholder' },
  design: { Component: TemplatesPanel, icon: CATEGORY_ICONS.templates, searchMode: 'filter', searchPlaceholderKey: 'foundation.editor.templates.searchPlaceholder' },
  elements: { Component: ElementsPanel, icon: CATEGORY_ICONS.shapes, searchMode: 'filter' },
  photos: { Component: PhotosRoute, icon: CATEGORY_ICONS.photos, searchMode: 'submit', searchPlaceholderKey: 'foundation.editor.photos.searchPlaceholder' },
  text: { Component: TextPanel, icon: CATEGORY_ICONS.text, searchMode: 'filter' },
  uploads: { Component: UploadsRoute, icon: CATEGORY_ICONS.uploads, searchMode: 'filter', searchPlaceholderKey: 'foundation.editor.uploads.searchPlaceholder' },
  videos: { Component: VideosRoute, icon: CATEGORY_ICONS.videos, searchMode: 'submit', searchPlaceholderKey: 'foundation.editor.videos.searchPlaceholder' },
}
