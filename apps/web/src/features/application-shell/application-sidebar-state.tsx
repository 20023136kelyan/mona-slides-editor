import { useMemo, useState, type ReactNode } from 'react'

import { ApplicationSidebarStateContext } from '@/features/application-shell/application-sidebar-context'

/**
 * Owns the one piece of sidebar state that must survive route changes.
 *
 * Home, the editor, and the future project-chat surface render different middle
 * content, but they are views of the same application rail. Keeping collapse
 * state above the router makes that identity visible when navigating between
 * surfaces instead of resetting the rail on every route.
 */
export function ApplicationSidebarStateProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const value = useMemo(() => ({ collapsed, setCollapsed }), [collapsed])

  return (
    <ApplicationSidebarStateContext value={value}>
      {children}
    </ApplicationSidebarStateContext>
  )
}
