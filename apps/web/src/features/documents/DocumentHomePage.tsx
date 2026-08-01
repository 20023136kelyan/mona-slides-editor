import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import {
  ArrowDownUp,
  ArrowUp,
  Bot,
  CalendarDays,
  Copy,
  FilePlus2,
  FolderInput,
  Grid2X2,
  List,
  MoreHorizontal,
  Pencil,
  Presentation,
  Search,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

import type { DataSourceDocument } from '@mona/data-source'
import type { ProjectSummary } from '@mona/project-core'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import {
  SidebarInset,
  SidebarProvider,
} from '@/components/ui/sidebar'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Toaster } from '@/components/ui/sonner'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  ApplicationSidebar,
  ApplicationSidebarContentToggle,
} from '@/features/application-shell/ApplicationSidebar'
import { useOptionalApplicationSidebarState } from '@/features/application-shell/application-sidebar-context'
import { createBlankPresentation } from '@/features/presentation-renderer/load-presentation'
import { isSupportedLocale, type SupportedLocale } from '@/i18n'
import { monaBridge, type MonaDocumentSummary } from '@/lib/mona-bridge'

import { DocumentDataSourceSidebar } from './DocumentDataSourceSidebar'
import {
  DocumentLibraryTile,
  type DocumentLibraryView,
} from './DocumentLibraryTile'
import type { DocumentHomeData } from './home-data'
import {
  createUserOwnedDocument,
  moveRecoveryDocumentToLocalFiles,
} from './local-document-actions'
import { useDataSourceBrowser } from './use-data-source-browser'

interface DocumentHomePageProps { initialData: DocumentHomeData }

type DocumentLibrarySort = 'modified-ascending' | 'modified-descending' | 'name'
type DocumentLibraryGrouping = 'date' | 'none'

interface LibraryPresentation {
  createdAt: number
  document?: MonaDocumentSummary
  key: string
  size?: number
  source: string
  sourceDocument?: DataSourceDocument
  sourceFile: boolean
  thumbnailUrl?: string
  title: string
  updatedAt: number
}

const byRecent = (documents: readonly MonaDocumentSummary[]) => (
  [...documents].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
)

const documentThumbnailUrl = (document: MonaDocumentSummary): string | undefined => (
  document.thumbnailRevision
    ? `mona://preview/document/${encodeURIComponent(document.id)}?v=${document.thumbnailRevision}`
    : undefined
)

const sourceThumbnailUrl = (document: DataSourceDocument): string => (
  `mona://preview/source/${encodeURIComponent(document.sourceId)}/${encodeURIComponent(document.id)}?v=${document.modifiedAt}-${document.size}`
)

const withoutExtension = (name: string): string => name.replace(/\.[^.]+$/, '')

export function DocumentHomePage({ initialData }: DocumentHomePageProps) {
  const { i18n, t } = useTranslation()
  const navigate = useNavigate()
  const applicationSidebarState = useOptionalApplicationSidebarState()
  const [localSidebarCollapsed, setLocalSidebarCollapsed] = useState(false)
  const sidebarCollapsed = applicationSidebarState?.collapsed ?? localSidebarCollapsed
  const setSidebarCollapsed = applicationSidebarState?.setCollapsed ?? setLocalSidebarCollapsed
  const [documents, setDocuments] = useState(() => byRecent(initialData.documents))
  const [projects, setProjects] = useState<ProjectSummary[]>(initialData.projects)
  const [projectDraft, setProjectDraft] = useState('')
  const [creatingProject, setCreatingProject] = useState(false)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [view, setView] = useState<DocumentLibraryView>(() => (
    localStorage.getItem('mona:document-library-view') === 'list' ? 'list' : 'grid'
  ))
  const [libraryReferenceTime] = useState(Date.now)
  const [sort, setSort] = useState<DocumentLibrarySort>('modified-descending')
  const [grouping, setGrouping] = useState<DocumentLibraryGrouping>('date')
  const [creating, setCreating] = useState(false)
  const [busyDocumentId, setBusyDocumentId] = useState<string | null>(null)
  const [renameDocument, setRenameDocument] = useState<MonaDocumentSummary | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{
    document: MonaDocumentSummary
    sourceFile: boolean
  } | null>(null)
  const [busySourceItemId, setBusySourceItemId] = useState<string | null>(null)
  const resolvedLanguage = i18n.resolvedLanguage ?? ''
  const activeLocale: SupportedLocale = isSupportedLocale(resolvedLanguage)
    ? resolvedLanguage
    : 'en-US'
  const sourceBrowser = useDataSourceBrowser({
    initialDocuments: initialData.sourceDocuments,
    initialScope: initialData.initialScope,
    initialSources: initialData.sources,
    query: deferredQuery,
  })

  useEffect(() => monaBridge().projects.onChange(() => {
    void monaBridge().projects.list().then(setProjects)
  }), [])
  const filteredRecoveryDocuments = useMemo(() => {
    if (sourceBrowser.scope.kind === 'source') return []
    const needle = deferredQuery.trim().toLocaleLowerCase(activeLocale)
    const matching = needle ? documents.filter(document => (
      (document.title || t('header.untitledPresentation'))
        .toLocaleLowerCase(activeLocale)
        .includes(needle)
    )) : documents
    const visibleSourceDocuments = new Set(sourceBrowser.documents.map(document => (
      `${document.sourceId}:${document.id}`
    )))
    return matching.filter(document => {
      const reference = document.sourceReference
      return !reference || !visibleSourceDocuments.has(`${reference.sourceId}:${reference.itemId}`)
    })
  }, [
    activeLocale,
    deferredQuery,
    documents,
    sourceBrowser.documents,
    sourceBrowser.scope.kind,
    t,
  ])
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(activeLocale, { dateStyle: 'medium' }),
    [activeLocale],
  )
  const locationFilterValue = sourceBrowser.scope.kind === 'source'
    ? `source:${sourceBrowser.scope.sourceId}`
    : sourceBrowser.scope.kind
  const libraryPresentations = useMemo<LibraryPresentation[]>(() => {
    const recovery = filteredRecoveryDocuments.map(document => ({
      createdAt: document.createdAt,
      document,
      key: `document:${document.id}`,
      source: document.sourceReference
        ? t('documents.sourceDisconnected')
        : t('documents.recoveryCopy'),
      sourceFile: false,
      thumbnailUrl: documentThumbnailUrl(document),
      title: document.title || t('header.untitledPresentation'),
      updatedAt: document.updatedAt,
    }))
    const sourced = sourceBrowser.documents
      .filter(document => document.documentType === 'presentation')
      .map(sourceDocument => {
        const source = sourceBrowser.sourceById.get(sourceDocument.sourceId)
        const linkedDocument = documents.find(document => (
          document.sourceReference?.sourceId === sourceDocument.sourceId
          && document.sourceReference.itemId === sourceDocument.id
        ))
        const sourceFile = sourceDocument.mediaType === 'application/vnd.mona.presentation-package'
        return {
          createdAt: linkedDocument?.createdAt ?? sourceDocument.modifiedAt,
          document: linkedDocument,
          key: `source:${sourceDocument.sourceId}:${sourceDocument.id}`,
          size: sourceDocument.size,
          source: source?.name ?? t('documents.localFiles'),
          sourceDocument,
          sourceFile,
          thumbnailUrl: linkedDocument
            ? documentThumbnailUrl(linkedDocument) ?? sourceThumbnailUrl(sourceDocument)
            : sourceThumbnailUrl(sourceDocument),
          title: linkedDocument?.title || withoutExtension(sourceDocument.name),
          updatedAt: sourceDocument.modifiedAt,
        }
      })
    const combined = [...recovery, ...sourced]
    return combined.toSorted((a, b) => {
      if (sort === 'name') return a.title.localeCompare(b.title, activeLocale, { numeric: true })
      if (sort === 'modified-ascending') return a.updatedAt - b.updatedAt || a.title.localeCompare(b.title)
      return b.updatedAt - a.updatedAt || a.title.localeCompare(b.title)
    })
  }, [
    activeLocale,
    documents,
    filteredRecoveryDocuments,
    sort,
    sourceBrowser.documents,
    sourceBrowser.sourceById,
    t,
  ])
  const presentationGroups = useMemo(() => {
    if (grouping === 'none') return [{ key: 'all', presentations: libraryPresentations }]
    const day = 24 * 60 * 60 * 1000
    const groups = [
      { key: 'previous7Days', maximumAge: 7 * day, presentations: [] as LibraryPresentation[] },
      { key: 'previous30Days', maximumAge: 30 * day, presentations: [] as LibraryPresentation[] },
      { key: 'previous3Months', maximumAge: 90 * day, presentations: [] as LibraryPresentation[] },
      { key: 'older', maximumAge: Number.POSITIVE_INFINITY, presentations: [] as LibraryPresentation[] },
    ]
    for (const presentation of libraryPresentations) {
      const age = Math.max(0, libraryReferenceTime - presentation.updatedAt)
      groups.find(group => age <= group.maximumAge)!.presentations.push(presentation)
    }
    return groups.filter(group => group.presentations.length > 0)
  }, [grouping, libraryPresentations, libraryReferenceTime])

  const fail = (error: unknown) => {
    const detail = error instanceof Error ? error.message : t('documents.unknownError')
    toast.error(t('documents.actionFailed'), { description: detail })
  }

  const createPresentation = async () => {
    if (creating) return
    setCreating(true)
    try {
      const document = await createUserOwnedDocument(
        createBlankPresentation(),
        sourceBrowser.sources,
      )
      if (!document) {
        setCreating(false)
        return
      }
      await navigate(`/documents/${encodeURIComponent(document.id)}`)
    }
    catch (error) {
      fail(error)
      setCreating(false)
    }
  }

  const createProject = async (initialPrompt = '') => {
    if (creatingProject) return null
    setCreatingProject(true)
    try {
      const project = await monaBridge().projects.create()
      const nextProjects = await monaBridge().projects.list()
      setProjects(nextProjects)
      setProjectDraft('')
      await navigate(`/projects/${encodeURIComponent(project.id)}`, {
        state: initialPrompt ? { initialPrompt } : undefined,
      })
      return project
    }
    catch (error) {
      fail(error)
      return null
    }
    finally {
      setCreatingProject(false)
    }
  }

  const addLocalFolder = async () => {
    try {
      return await sourceBrowser.addLocalFolder()
    }
    catch (error) {
      fail(error)
      return null
    }
  }

  const removeSource = async (sourceId: string) => {
    try {
      await sourceBrowser.removeSource(sourceId)
      toast.success(t('documents.sourceRemoved'))
    }
    catch (error) {
      fail(error)
    }
  }

  const setDefaultSaveLocation = async (sourceId: string) => {
    try {
      await sourceBrowser.setDefaultSaveLocation(sourceId)
      toast.success(t('documents.defaultSaveLocationUpdated'))
    }
    catch (error) {
      fail(error)
    }
  }

  const openSourceDocument = async (sourceDocument: DataSourceDocument) => {
    if (busySourceItemId) return
    if (sourceDocument.documentType !== 'presentation') {
      toast.info(t('documents.sourceTypeNotEditable'))
      return
    }
    const existing = documents.find(document => (
      document.sourceReference?.sourceId === sourceDocument.sourceId
      && document.sourceReference.itemId === sourceDocument.id
    ))
    const packagedMona = sourceDocument.mediaType === 'application/vnd.mona.presentation-package'
    const desktopIngestible = packagedMona || sourceDocument.extension === '.pptx'
    if (existing && !packagedMona) {
      await navigate(`/documents/${encodeURIComponent(existing.id)}`)
      return
    }
    const source = sourceBrowser.sourceById.get(sourceDocument.sourceId)
    if (!source || source.status !== 'available') {
      toast.error(t('documents.sourceUnavailable'))
      return
    }

    setBusySourceItemId(sourceDocument.id)
    try {
      if (desktopIngestible) {
        const document = await monaBridge().documents.openSource({
          itemId: sourceDocument.id,
          sourceId: sourceDocument.sourceId,
        })
        setDocuments(current => byRecent([
          document,
          ...current.filter(candidate => candidate.id !== document.id),
        ]))
        await navigate(`/documents/${encodeURIComponent(document.id)}`)
        return
      }
      const title = sourceDocument.name.replace(/\.[^.]+$/, '')
      const presentation = {
        ...createBlankPresentation(),
        title,
      }
      const document = await monaBridge().documents.create(presentation, {
        itemId: sourceDocument.id,
        sourceId: sourceDocument.sourceId,
      })
      setDocuments(current => byRecent([document, ...current]))
      const parameters = new URLSearchParams({
        sourceImport: 'native',
        sourceItemId: sourceDocument.id,
        sourceId: sourceDocument.sourceId,
      })
      await navigate(`/documents/${encodeURIComponent(document.id)}?${parameters}`)
    }
    catch (error) {
      fail(error)
      setBusySourceItemId(null)
    }
  }

  const submitRename = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!renameDocument || busyDocumentId) return
    const title = renameValue.trim()
    if (!title) return
    setBusyDocumentId(renameDocument.id)
    try {
      const renamed = await monaBridge().documents.rename(renameDocument.id, title)
      setDocuments(current => current.map(document => (
        document.id === renamed.id ? renamed : document
      )))
      setRenameDocument(null)
      toast.success(t('documents.renamed'))
    }
    catch (error) {
      fail(error)
    }
    finally {
      setBusyDocumentId(null)
    }
  }

  const duplicatePresentation = async (document: MonaDocumentSummary) => {
    if (busyDocumentId) return
    setBusyDocumentId(document.id)
    try {
      const title = t('documents.copyTitle', {
        title: document.title || t('header.untitledPresentation'),
      })
      const recoveryCopy = await monaBridge().documents.duplicate(document.id, title)
      const duplicated = recoveryCopy.sourceReference
        ? recoveryCopy
        : await moveRecoveryDocumentToLocalFiles(
            recoveryCopy.id,
            sourceBrowser.sources,
          )
      if (!duplicated) {
        await monaBridge().documents.delete(recoveryCopy.id)
        return
      }
      setDocuments(current => byRecent([duplicated, ...current]))
      toast.success(t('documents.duplicated'))
    }
    catch (error) {
      fail(error)
    }
    finally {
      setBusyDocumentId(null)
    }
  }

  const moveToLocalFiles = async (document: MonaDocumentSummary) => {
    if (busyDocumentId) return
    setBusyDocumentId(document.id)
    try {
      const moved = await moveRecoveryDocumentToLocalFiles(
        document.id,
        sourceBrowser.sources,
      )
      if (!moved) return
      setDocuments(current => current.map(candidate => (
        candidate.id === moved.id ? moved : candidate
      )))
      toast.success(t('documents.movedToLocalFiles'))
    }
    catch (error) {
      fail(error)
    }
    finally {
      setBusyDocumentId(null)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget || busyDocumentId) return
    const { document, sourceFile } = deleteTarget
    setBusyDocumentId(document.id)
    try {
      if (sourceFile) await monaBridge().documents.delete(document.id)
      else await monaBridge().documents.discardRecovery(document.id)
      setDocuments(current => current.filter(candidate => candidate.id !== document.id))
      setDeleteTarget(null)
      toast.success(t('documents.deleted'))
    }
    catch (error) {
      fail(error)
    }
    finally {
      setBusyDocumentId(null)
    }
  }

  const presentationActions = (presentation: LibraryPresentation) => {
    const document = presentation.document
    if (!document || (presentation.sourceDocument && !presentation.sourceFile)) return null
    const actionTitle = presentation.sourceDocument?.name ?? presentation.title
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t('documents.moreActions', { title: actionTitle })}
            disabled={busyDocumentId === document.id}
            size="icon-sm"
            variant="ghost"
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={() => {
                setRenameValue(document.title || presentation.title)
                setRenameDocument(document)
              }}
            >
              <Pencil />
              {t('common.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => { void duplicatePresentation(document) }}>
              <Copy />
              {t('common.duplicate')}
            </DropdownMenuItem>
            {!presentation.sourceFile ? (
              <DropdownMenuItem onSelect={() => { void moveToLocalFiles(document) }}>
                <FolderInput />
                {t('documents.moveToLocalFiles')}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={() => setDeleteTarget({
                document,
                sourceFile: presentation.sourceFile,
              })}
              variant="destructive"
            >
              <Trash2 />
              {t('common.delete')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <SidebarProvider className="h-svh min-h-0 overflow-hidden">
      <title>{t('documents.pageTitle')}</title>
      <ApplicationSidebar
        ariaLabel={t('documents.sidebarLabel')}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
        onOpenLibrary={() => { void navigate('/') }}
      >
        <DocumentDataSourceSidebar
          listChildren={sourceBrowser.listChildren}
          onAddLocalFolder={addLocalFolder}
          onCreateProject={() => createProject()}
          onDeleteProject={async projectId => {
            try {
              await monaBridge().projects.delete(projectId)
              setProjects(current => current.filter(project => project.id !== projectId))
            }
            catch (error) {
              fail(error)
              throw error
            }
          }}
          onOpenProject={projectId => { void navigate(`/projects/${encodeURIComponent(projectId)}`) }}
          onRemoveSource={removeSource}
          onScopeChange={sourceBrowser.setScope}
          onSetDefaultSaveLocation={setDefaultSaveLocation}
          projects={projects}
          scope={sourceBrowser.scope}
          sources={sourceBrowser.sources}
          treeRevision={sourceBrowser.treeRevision}
        />
      </ApplicationSidebar>

      <SidebarInset className="relative flex h-svh min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--workspace-surface)] text-foreground">
        <ApplicationSidebarContentToggle
          className="absolute start-3 top-2 z-20"
          collapsed={sidebarCollapsed}
          onExpand={() => setSidebarCollapsed(false)}
        />

        <div className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4 ps-12">
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
            {t('documents.heading')}
          </h1>
          <InputGroup className="hidden w-64 shrink-0 bg-background md:flex">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              aria-label={t('documents.searchLabel')}
              onChange={event => setQuery(event.target.value)}
              placeholder={t('documents.searchPlaceholder')}
              type="search"
              value={query}
            />
          </InputGroup>
          <Button disabled={creating} onClick={() => { void createPresentation() }}>
            <FilePlus2 data-icon="inline-start" />
            {creating ? t('documents.creating') : t('header.newPresentation')}
          </Button>
        </div>

        <div className="flex min-h-13 shrink-0 flex-wrap items-center gap-2 border-b bg-background px-4 py-2">
          <Select
            onValueChange={value => {
              if (value === 'all') {
                sourceBrowser.setScope({ kind: 'all' })
                return
              }
              const sourceId = value.replace(/^source:/, '')
              const source = sourceBrowser.sourceById.get(sourceId)
              if (source) {
                sourceBrowser.setScope({
                  itemId: source.rootItemId,
                  kind: 'source',
                  sourceId,
                })
              }
            }}
            value={locationFilterValue}
          >
            <SelectTrigger aria-label={t('documents.locationFilter')} className="w-44 bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">{t('documents.allSources')}</SelectItem>
                {sourceBrowser.sources.map(source => (
                  <SelectItem key={source.id} value={`source:${source.id}`}>
                    {source.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          <InputGroup className="min-w-44 flex-1 bg-background md:hidden">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              aria-label={t('documents.searchLabel')}
              onChange={event => setQuery(event.target.value)}
              placeholder={t('documents.searchPlaceholder')}
              type="search"
              value={query}
            />
          </InputGroup>

          <div className="ms-auto flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <CalendarDays />
                  <span className="hidden xl:inline">{t('documents.group')}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                  onValueChange={value => setGrouping(value as DocumentLibraryGrouping)}
                  value={grouping}
                >
                  <DropdownMenuRadioItem value="date">
                    {t('documents.groupByDate')}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="none">
                    {t('documents.noGrouping')}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <ArrowDownUp />
                  <span className="hidden xl:inline">{t('documents.sort')}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                  onValueChange={value => setSort(value as DocumentLibrarySort)}
                  value={sort}
                >
                  <DropdownMenuRadioItem value="modified-descending">
                    {t('documents.newestFirst')}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="modified-ascending">
                    {t('documents.oldestFirst')}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="name">
                    {t('documents.sortByName')}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <ToggleGroup
              aria-label={t('documents.viewLabel')}
              className="rounded-control border bg-background p-0.5"
              onValueChange={value => {
                const nextView = value as DocumentLibraryView
                if (!nextView) return
                setView(nextView)
                localStorage.setItem('mona:document-library-view', nextView)
              }}
              spacing={0}
              type="single"
              value={view}
            >
              <ToggleGroupItem
                aria-label={t('documents.viewGrid')}
                className="size-7 rounded-[calc(var(--radius-control)-2px)] px-0"
                value="grid"
              >
                <Grid2X2 />
              </ToggleGroupItem>
              <ToggleGroupItem
                aria-label={t('documents.viewList')}
                className="size-7 rounded-[calc(var(--radius-control)-2px)] px-0"
                value="list"
              >
                <List />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>

        <main className="min-h-0 flex-1 overflow-y-auto px-5 py-6 lg:px-7">
          <form
            aria-label={t('projects.homeComposerLabel')}
            className="mx-auto mb-7 flex max-w-3xl items-end gap-2 border-b border-border pb-3"
            onSubmit={event => {
              event.preventDefault()
              const prompt = projectDraft.trim()
              if (prompt) void createProject(prompt)
            }}
          >
            <Bot className="mb-2.5 size-4 shrink-0 text-muted-foreground" />
            <Textarea
              aria-label={t('projects.homeComposerLabel')}
              className="max-h-32 min-h-10 flex-1 resize-none border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
              disabled={creatingProject}
              onChange={event => setProjectDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key !== 'Enter' || event.shiftKey) return
                event.preventDefault()
                const prompt = projectDraft.trim()
                if (prompt) void createProject(prompt)
              }}
              placeholder={t('projects.homeComposerPlaceholder')}
              rows={1}
              value={projectDraft}
            />
            <Button
              aria-label={t('projects.startProject')}
              disabled={creatingProject || !projectDraft.trim()}
              size="icon-sm"
              type="submit"
            >
              <ArrowUp />
            </Button>
          </form>
          {libraryPresentations.length === 0
            && !deferredQuery
            && sourceBrowser.scope.kind === 'all' ? (
            <EmptyLibrary creating={creating} onCreate={createPresentation} />
          ) : libraryPresentations.length === 0 ? (
            <Empty className="min-h-52 bg-transparent">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Search /></EmptyMedia>
                <EmptyTitle>{t('documents.noSearchResults')}</EmptyTitle>
                <EmptyDescription>{t('documents.tryAnotherSearch')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <section
              aria-label={t('documents.recentPresentations')}
              className="flex flex-col gap-8"
            >
              {presentationGroups.map(group => (
                <section aria-labelledby={`document-group-${group.key}`} key={group.key}>
                  {grouping === 'date' ? (
                    <div className="mb-3 flex items-baseline gap-2 px-0.5">
                      <h2
                        className="text-sm font-medium"
                        id={`document-group-${group.key}`}
                      >
                        {t(`documents.recency.${group.key}`)}
                      </h2>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {String(group.presentations.length).padStart(2, '0')}
                      </span>
                    </div>
                  ) : (
                    <h2 className="sr-only" id={`document-group-${group.key}`}>
                      {t('documents.allPresentations')}
                    </h2>
                  )}
                  <div className={view === 'grid'
                    ? 'grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4'
                    : 'flex flex-col border-t border-border/70'}
                  >
                    {group.presentations.map(presentation => {
                      const sourceDocument = presentation.sourceDocument
                      const openTitle = sourceDocument?.name ?? presentation.title
                      return (
                        <DocumentLibraryTile
                          actions={presentationActions(presentation)}
                          busy={sourceDocument
                            ? busySourceItemId === sourceDocument.id
                            : busyDocumentId === presentation.document?.id}
                          dataSourceDocumentId={sourceDocument?.id}
                          key={presentation.key}
                          metadata={t('documents.librarySourceMetadata', {
                            date: dateFormatter.format(presentation.updatedAt),
                            source: presentation.source,
                          })}
                          onOpen={() => {
                            if (sourceDocument) {
                              void openSourceDocument(sourceDocument)
                              return
                            }
                            if (presentation.document) {
                              void navigate(`/documents/${encodeURIComponent(presentation.document.id)}`)
                            }
                          }}
                          openLabel={t('documents.openPresentation', { title: openTitle })}
                          source={presentation.source}
                          thumbnailUrl={presentation.thumbnailUrl}
                          title={presentation.title}
                          view={view}
                        />
                      )
                    })}
                  </div>
                </section>
              ))}
            </section>
          )}
        </main>

      <Dialog
        onOpenChange={open => {
          if (!open && !busyDocumentId) setRenameDocument(null)
        }}
        open={renameDocument !== null}
      >
        <DialogContent>
          <form onSubmit={submitRename}>
            <DialogHeader>
              <DialogTitle>{t('documents.renameTitle')}</DialogTitle>
              <DialogDescription>{t('documents.renameDescription')}</DialogDescription>
            </DialogHeader>
            <FieldGroup className="my-5">
              <Field>
                <FieldLabel htmlFor="mona-document-name">{t('documents.nameLabel')}</FieldLabel>
                <Input
                  id="mona-document-name"
                  maxLength={200}
                  onChange={event => setRenameValue(event.target.value)}
                  value={renameValue}
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={busyDocumentId !== null} type="button" variant="outline">
                  {t('common.cancel')}
                </Button>
              </DialogClose>
              <Button disabled={!renameValue.trim() || busyDocumentId !== null} type="submit">
                {t('common.rename')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        onOpenChange={open => {
          if (!open && !busyDocumentId) setDeleteTarget(null)
        }}
        open={deleteTarget !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('documents.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(deleteTarget?.sourceFile
                ? 'documents.deleteSourceDescription'
                : 'documents.deleteRecoveryDescription', {
                title: deleteTarget?.document.title || t('header.untitledPresentation'),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyDocumentId !== null}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyDocumentId !== null}
              onClick={() => { void confirmDelete() }}
              variant="destructive"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Toaster position="top-center" richColors />
      </SidebarInset>
    </SidebarProvider>
  )
}

function EmptyLibrary({
  creating,
  onCreate,
}: {
  creating: boolean
  onCreate: () => Promise<void>
}) {
  const { t } = useTranslation()
  return (
    <Empty className="min-h-80 bg-transparent">
      <EmptyHeader>
        <EmptyMedia className="size-11 rounded-xl" variant="icon">
          <Presentation className="size-5 text-muted-foreground" />
        </EmptyMedia>
        <EmptyTitle className="text-base">{t('documents.emptyTitle')}</EmptyTitle>
        <EmptyDescription>{t('documents.emptyDescription')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button disabled={creating} onClick={() => { void onCreate() }}>
          <FilePlus2 data-icon="inline-start" />
          {t('header.newPresentation')}
        </Button>
      </EmptyContent>
    </Empty>
  )
}
