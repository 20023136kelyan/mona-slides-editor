import { createBrowserRouter, type LoaderFunctionArgs } from 'react-router'

import { RouteErrorBoundary } from '@/app/RouteErrorBoundary'
import { RouteHydrateFallback } from '@/app/RouteHydrateFallback'
import { loadPresentation } from '@/features/presentation-renderer/load-presentation'
import { monaBridge } from '@/lib/mona-bridge'

const loadHomeOrDevelopmentFixture = async ({ params, request }: LoaderFunctionArgs) => {
  const url = new URL(request.url)
  if (url.searchParams.has('developmentFixture')) {
    return loadPresentation({ params, request })
  }
  const bridge = monaBridge()
  const [documents, projects, sources, sourceDocuments] = await Promise.all([
    bridge.documents.list(),
    bridge.projects.list(),
    bridge.dataSources.list(),
    bridge.dataSources.listDocuments(),
  ])
  const sourceId = url.searchParams.get('sourceId')
  const itemId = url.searchParams.get('itemId')
  const initialScope = sourceId && itemId
    ? { itemId, kind: 'source' as const, sourceId }
    : { kind: 'all' as const }
  return { documents, initialScope, projects, sourceDocuments, sources }
}

const loadProject = async ({ params }: LoaderFunctionArgs) => {
  const projectId = params.projectId
  if (!projectId) throw new Response('Project not found', { status: 404 })
  const bridge = monaBridge()
  const [project, projects, documents, sources, sourceDocuments, jobs] = await Promise.all([
    bridge.projects.read(projectId),
    bridge.projects.list(),
    bridge.documents.list(),
    bridge.dataSources.list(),
    bridge.dataSources.listDocuments(),
    bridge.projectJobs.list(projectId),
  ])
  if (!project) throw new Response('Project not found', { status: 404 })
  return { documents, jobs, project, projects, sourceDocuments, sources }
}

export const router = createBrowserRouter([
  {
    path: '/',
    ErrorBoundary: RouteErrorBoundary,
    HydrateFallback: RouteHydrateFallback,
    loader: loadHomeOrDevelopmentFixture,
    lazy: async () => {
      const { RootPage } = await import('@/features/documents/RootPage')
      return { Component: RootPage }
    },
  },
  {
    path: '/projects/:projectId',
    ErrorBoundary: RouteErrorBoundary,
    HydrateFallback: RouteHydrateFallback,
    loader: loadProject,
    lazy: async () => {
      const { ProjectPage } = await import('@/features/projects/ProjectPage')
      return { Component: ProjectPage }
    },
  },
  {
    path: '/documents/:documentId',
    ErrorBoundary: RouteErrorBoundary,
    HydrateFallback: RouteHydrateFallback,
    loader: loadPresentation,
    lazy: async () => {
      const { DocumentEditorPage } = await import('@/features/foundation/FoundationPage')
      return { Component: DocumentEditorPage }
    },
  },
])
