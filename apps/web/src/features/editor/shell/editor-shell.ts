import { createContext, useContext } from 'react'

/** Element pools are individual rail entries, not a nested picker. */
export type EditorElementCategory = 'equations' | 'lines' | 'shapes' | 'symbols' | 'tables'

export type EditorTaskPanelRoute =
  | 'audio'
  | 'charts'
  | 'comments'
  | 'design'
  | 'elements'
  | 'layers'
  | 'photos'
  | 'properties'
  | 'search'
  | 'semantics'
  | 'speakerNotes'
  | 'text'
  | 'uploads'
  | 'videos'

export interface CloseTaskPanelOptions {
  restoreFocus?: boolean
}

export interface EditorShell {
  closeTaskPanel: (options?: CloseTaskPanelOptions) => void
  /**
   * Shared because the toggle changes owner, not just appearance.
   *
   * Expanded, it sits in the rail's own header. Collapsed, the rail is only wide
   * enough for macOS's traffic lights, so the toggle moves into the editor header
   * beside undo — the same row, so it reads as having stayed put.
   */
  railCollapsed: boolean
  setRailCollapsed: (collapsed: boolean) => void
  openTaskPanel: (route: EditorTaskPanelRoute, trigger?: HTMLElement | null) => void
  taskPanelRoute: EditorTaskPanelRoute | null
  toggleTaskPanel: (route: EditorTaskPanelRoute, trigger?: HTMLElement | null) => void
}

export const EditorShellContext = createContext<EditorShell | null>(null)

export function useEditorShell(): EditorShell {
  const shell = useContext(EditorShellContext)
  if (!shell) throw new Error('Editor shell actions require an EditorShellProvider')
  return shell
}

export function useOptionalEditorShell(): EditorShell | null {
  return useContext(EditorShellContext)
}
