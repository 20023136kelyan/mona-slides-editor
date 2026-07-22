import { createContext, useContext } from 'react'

export const EditorModalCloseContext = createContext<() => void>(() => undefined)

export const useEditorModalClose = () => useContext(EditorModalCloseContext)
