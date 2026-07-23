import { createContext, useContext } from 'react'

export type EditorTaskPanelRoute =
  | 'comments'
  | 'design'
  | 'elements'
  | 'layers'
  | 'properties'
  | 'search'
  | 'semantics'
  | 'speakerNotes'
  | 'text'
  | 'uploads'

export interface CloseTaskPanelOptions {
  restoreFocus?: boolean
}

export interface EditorShell {
  closeTaskPanel: (options?: CloseTaskPanelOptions) => void
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
