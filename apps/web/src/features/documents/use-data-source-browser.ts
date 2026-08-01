import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import type {
  DataSourceDocument,
  DataSourceDocumentReference,
  DataSourceItem,
  DataSourceSummary,
} from '@mona/data-source'

import { monaBridge } from '@/lib/mona-bridge'

export type DocumentBrowserScope =
  | { kind: 'all' }
  | { itemId: string; kind: 'source'; sourceId: string }

const scopeReference = (
  scope: DocumentBrowserScope,
): DataSourceDocumentReference | undefined => (
  scope.kind === 'source'
    ? { itemId: scope.itemId, sourceId: scope.sourceId }
    : undefined
)

export const documentBrowserScopeKey = (scope: DocumentBrowserScope): string => {
  if (scope.kind !== 'source') return scope.kind
  return `source:${scope.sourceId}:${scope.itemId}`
}

export function useDataSourceBrowser({
  initialDocuments,
  initialScope = { kind: 'all' },
  initialSources,
  query,
}: {
  initialDocuments: DataSourceDocument[]
  initialScope?: DocumentBrowserScope
  initialSources: DataSourceSummary[]
  query: string
}) {
  const [scope, setScope] = useState<DocumentBrowserScope>(initialScope)
  const [sources, setSources] = useState(initialSources)
  const [documents, setDocuments] = useState(initialDocuments)
  const [loadingDocuments, setLoadingDocuments] = useState(false)
  const [treeRevision, setTreeRevision] = useState(0)

  const refreshSources = useCallback(async () => {
    const next = await monaBridge().dataSources.list()
    startTransition(() => setSources(next))
    return next
  }, [])

  const refreshDocuments = useCallback(async (
    nextScope: DocumentBrowserScope,
    nextQuery: string,
  ) => {
    setLoadingDocuments(true)
    try {
      const next = await monaBridge().dataSources.listDocuments({
        query: nextQuery,
        scope: scopeReference(nextScope),
      })
      startTransition(() => setDocuments(next))
    }
    finally {
      setLoadingDocuments(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    setLoadingDocuments(true)
    void monaBridge().dataSources.listDocuments({
      query,
      scope: scopeReference(scope),
    }).then(next => {
      if (active) startTransition(() => setDocuments(next))
    }).finally(() => {
      if (active) setLoadingDocuments(false)
    })
    return () => { active = false }
  }, [query, scope])

  useEffect(() => monaBridge().dataSources.onChange(event => {
    if (
      event.kind === 'configuration'
      && event.sourceId
      && scope.kind === 'source'
      && scope.sourceId === event.sourceId
    ) {
      void refreshSources().then(nextSources => {
        if (!nextSources.some(source => source.id === event.sourceId)) {
          startTransition(() => setScope({ kind: 'all' }))
        }
      })
    }
    else {
      void refreshSources()
    }
    setTreeRevision(current => current + 1)
    void refreshDocuments(scope, query)
  }), [query, refreshDocuments, refreshSources, scope])

  const addLocalFolder = useCallback(async () => {
    const source = await monaBridge().dataSources.addLocalFolder()
    if (!source) return null
    const nextScope: DocumentBrowserScope = {
      itemId: source.rootItemId,
      kind: 'source',
      sourceId: source.id,
    }
    await refreshSources()
    setTreeRevision(current => current + 1)
    setScope(nextScope)
    await refreshDocuments(nextScope, query)
    return source
  }, [query, refreshDocuments, refreshSources])

  const removeSource = useCallback(async (sourceId: string) => {
    await monaBridge().dataSources.remove(sourceId)
    const nextScope: DocumentBrowserScope = scope.kind === 'source' && scope.sourceId === sourceId
      ? { kind: 'all' }
      : scope
    setScope(nextScope)
    await Promise.all([
      refreshSources(),
      refreshDocuments(nextScope, query),
    ])
    setTreeRevision(current => current + 1)
  }, [query, refreshDocuments, refreshSources, scope])

  const setDefaultSaveLocation = useCallback(async (sourceId: string) => {
    await monaBridge().dataSources.setDefaultSaveLocation(sourceId)
    await refreshSources()
  }, [refreshSources])

  const listChildren = useCallback((
    sourceId: string,
    parentItemId: string,
  ): Promise<DataSourceItem[]> => (
    monaBridge().dataSources.listChildren(sourceId, parentItemId)
  ), [])

  const sourceById = useMemo(
    () => new Map(sources.map(source => [source.id, source])),
    [sources],
  )

  return {
    addLocalFolder,
    documents,
    listChildren,
    loadingDocuments,
    removeSource,
    refreshSources,
    scope,
    setScope,
    setDefaultSaveLocation,
    sourceById,
    sources,
    treeRevision,
  }
}
