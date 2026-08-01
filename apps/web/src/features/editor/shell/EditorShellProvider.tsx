import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  EditorShellContext,
  type CloseTaskPanelOptions,
  type EditorShell,
  type EditorTaskPanelRoute,
} from '@/features/editor/shell/editor-shell'
import { useOptionalApplicationSidebarState } from '@/features/application-shell/application-sidebar-context'

const focusFallbackForRoute = (route: EditorTaskPanelRoute | null) => {
  if (!route) return
  document.querySelector<HTMLElement>(`[data-task-panel-route="${route}"]`)?.focus()
}

export function EditorShellProvider({ children }: { children: ReactNode }) {
  const [taskPanelRoute, setTaskPanelRoute] = useState<EditorTaskPanelRoute | null>(null)
  const applicationSidebarState = useOptionalApplicationSidebarState()
  const [localRailCollapsed, setLocalRailCollapsed] = useState(false)
  const railCollapsed = applicationSidebarState?.collapsed ?? localRailCollapsed
  const setRailCollapsed = applicationSidebarState?.setCollapsed ?? setLocalRailCollapsed
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const routeRef = useRef<EditorTaskPanelRoute | null>(null)

  const openTaskPanel = useCallback((route: EditorTaskPanelRoute, trigger?: HTMLElement | null) => {
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    returnFocusRef.current = trigger ?? activeElement
    routeRef.current = route
    setTaskPanelRoute(route)
  }, [])

  const closeTaskPanel = useCallback((options: CloseTaskPanelOptions = {}) => {
    const route = routeRef.current
    const returnFocus = returnFocusRef.current
    routeRef.current = null
    returnFocusRef.current = null
    setTaskPanelRoute(null)

    if (options.restoreFocus === false) return
    requestAnimationFrame(() => {
      if (returnFocus?.isConnected) returnFocus.focus()
      else focusFallbackForRoute(route)
    })
  }, [])

  const toggleTaskPanel = useCallback((route: EditorTaskPanelRoute, trigger?: HTMLElement | null) => {
    if (routeRef.current === route) {
      closeTaskPanel()
      return
    }
    openTaskPanel(route, trigger)
  }, [closeTaskPanel, openTaskPanel])

  const value = useMemo<EditorShell>(() => ({
    closeTaskPanel,
    railCollapsed,
    setRailCollapsed,
    openTaskPanel,
    taskPanelRoute,
    toggleTaskPanel,
  }), [closeTaskPanel, openTaskPanel, railCollapsed, setRailCollapsed, taskPanelRoute, toggleTaskPanel])

  return <EditorShellContext value={value}>{children}</EditorShellContext>
}
