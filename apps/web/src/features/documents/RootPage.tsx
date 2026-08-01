import { lazy, Suspense } from 'react'
import { useLoaderData } from 'react-router'

import type { PresentationState } from '@mona/presentation-core'

import { DocumentHomePage } from './DocumentHomePage'
import type { DocumentHomeData } from './home-data'

const DevelopmentFixtureEditor = lazy(async () => ({
  default: (await import('@/features/foundation/FoundationPage')).FoundationPage,
}))

const isDocumentLibrary = (
  value: DocumentHomeData | PresentationState,
): value is DocumentHomeData => (
  'documents' in value && 'sources' in value && 'sourceDocuments' in value
)

export function RootPage() {
  const data = useLoaderData() as DocumentHomeData | PresentationState
  if (isDocumentLibrary(data)) return <DocumentHomePage initialData={data} />

  return (
    <Suspense fallback={null}>
      <DevelopmentFixtureEditor />
    </Suspense>
  )
}
