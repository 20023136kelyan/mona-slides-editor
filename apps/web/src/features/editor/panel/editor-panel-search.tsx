import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * How a panel consumes the drawer search bar.
 *
 * `filter` narrows content already on screen, so the panel reads `query` and
 * re-renders per keystroke. `submit` runs work worth debouncing — a network
 * search — so the panel reads `submitted`, which only changes on Enter or the
 * search button.
 */
export type EditorPanelSearchMode = 'filter' | 'submit'

export interface EditorPanelSearch {
  /** Whether the active panel does anything with the query. */
  enabled: boolean
  mode: EditorPanelSearchMode
  /** Live field value. `filter` panels read this. */
  query: string
  /** Last committed value. `submit` panels read this. */
  submitted: string
  clear: () => void
  setQuery: (value: string) => void
  submit: () => void
  /**
   * Commit a value the user did not type — a Photos category chip, a Charts
   * category. Sets the field and the committed value together, so the bar keeps
   * showing what the results actually reflect. `submit()` cannot serve this: it
   * reads the current field, which has not updated yet in the same tick.
   */
  submitQuery: (value: string) => void
}

export const EditorPanelSearchContext = createContext<EditorPanelSearch | null>(null)

/**
 * Panels call this to read the drawer's search bar. The bar is owned by the
 * drawer rather than the panel so that every category has one by construction —
 * a panel cannot forget to render it, and it cannot drift in placement or
 * styling from one category to the next.
 */
export function useEditorPanelSearch(): EditorPanelSearch {
  const search = useContext(EditorPanelSearchContext)
  if (!search) throw new Error('Drawer panels require an EditorPanelSearchContext provider')
  return search
}

/**
 * Owns the drawer search bar's state.
 *
 * `route` is stored alongside the term so that changing category reads as an
 * empty field during the same render rather than after an effect fires — a
 * panel must never observe the previous category's query, not even briefly.
 */
export function EditorPanelSearchProvider({
  children,
  mode = 'filter',
  route,
}: {
  children: ReactNode
  mode?: EditorPanelSearchMode
  route: string | null
}) {
  const [state, setState] = useState<{ query: string; route: string | null; submitted: string }>({ query: '', route, submitted: '' })
  const { query, submitted } = state.route === route ? state : { query: '', submitted: '' }

  const value = useMemo<EditorPanelSearch>(() => ({
    clear: () => setState({ query: '', route, submitted: '' }),
    enabled: true,
    mode,
    query,
    setQuery: next => setState({
      query: next,
      route,
      // A filter panel reads `query` directly, but keeping `submitted` in step
      // lets a panel read either field without knowing its own mode.
      submitted: mode === 'filter' ? next : submitted,
    }),
    submit: () => setState({ query, route, submitted: query }),
    submitQuery: next => setState({ query: next, route, submitted: next }),
    submitted,
  }), [mode, query, route, submitted])

  return <EditorPanelSearchContext value={value}>{children}</EditorPanelSearchContext>
}
