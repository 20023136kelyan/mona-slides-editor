import { createContext, useContext } from 'react'

export interface ApplicationSidebarState {
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
}

export const ApplicationSidebarStateContext = createContext<ApplicationSidebarState | null>(null)

export function useOptionalApplicationSidebarState() {
  return useContext(ApplicationSidebarStateContext)
}
