import { createBrowserRouter } from 'react-router'

import { RouteErrorBoundary } from '@/app/RouteErrorBoundary'
import { RouteHydrateFallback } from '@/app/RouteHydrateFallback'
import { loadPresentation } from '@/features/presentation-renderer/load-presentation'

export const router = createBrowserRouter([
  {
    path: '/',
    ErrorBoundary: RouteErrorBoundary,
    HydrateFallback: RouteHydrateFallback,
    loader: loadPresentation,
    lazy: async () => {
      const { FoundationPage } = await import('@/features/foundation/FoundationPage')
      return { Component: FoundationPage }
    },
  },
])
