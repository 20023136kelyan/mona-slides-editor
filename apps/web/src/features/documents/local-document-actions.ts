import type { DataSourceSummary } from '@mona/data-source'

import { monaBridge, type MonaDocumentSummary } from '@/lib/mona-bridge'

const availableWritableSource = (sources: readonly DataSourceSummary[]): DataSourceSummary | undefined => (
  sources.find(source => (
    source.isDefaultSaveLocation
    && source.status === 'available'
    && source.capabilities.write
  ))
)

export const chooseDefaultSaveLocation = async (): Promise<DataSourceSummary | null> => (
  monaBridge().dataSources.chooseDefaultLocalFolder()
)

export const resolveDefaultSaveLocation = async (
  knownSources?: readonly DataSourceSummary[],
): Promise<DataSourceSummary | null> => {
  const source = availableWritableSource(knownSources ?? await monaBridge().dataSources.list())
  return source ?? chooseDefaultSaveLocation()
}

export const createUserOwnedDocument = async (
  presentation: unknown,
  knownSources?: readonly DataSourceSummary[],
): Promise<MonaDocumentSummary | null> => {
  const source = await resolveDefaultSaveLocation(knownSources)
  if (!source) return null
  return monaBridge().documents.createLocal(presentation, source.id)
}

export const moveRecoveryDocumentToLocalFiles = async (
  documentId: string,
  knownSources?: readonly DataSourceSummary[],
): Promise<MonaDocumentSummary | null> => {
  const source = await resolveDefaultSaveLocation(knownSources)
  if (!source) return null
  return monaBridge().documents.moveToSource(documentId, source.id)
}
