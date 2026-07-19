import { createBrowserRouter } from 'react-router'

import { RouteErrorBoundary } from '@/app/RouteErrorBoundary'
import { RouteHydrateFallback } from '@/app/RouteHydrateFallback'

export const router = createBrowserRouter([
  {
    path: '/',
    ErrorBoundary: RouteErrorBoundary,
    HydrateFallback: RouteHydrateFallback,
    lazy: async () => {
      const { FoundationPage } = await import('@/features/foundation/FoundationPage')
      return { Component: FoundationPage }
    },
  },
])
