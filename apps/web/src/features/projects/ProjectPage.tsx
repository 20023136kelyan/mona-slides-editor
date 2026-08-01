import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowUp,
  Bot,
  Check,
  CircleCheck,
  CircleX,
  Clock3,
  File,
  FileText,
  LoaderCircle,
  Paperclip,
  Plus,
  Presentation,
  Search,
  Square,
  X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useLoaderData, useLocation, useNavigate } from 'react-router'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
import type { UIMessage } from 'ai'

import type {
  DataSourceDocument,
  DataSourceDocumentReference,
} from '@mona/data-source'
import {
  documentJobProgress,
  isTerminalDocumentJobStatus,
  type DocumentJobRecord,
} from '@mona/document-jobs'
import type {
  ProjectArtifact,
  ProjectRecord,
  ProjectSummary,
} from '@mona/project-core'

import { AgentProviderIcon } from '@/features/agent/AgentProviderIcon'
import { useAgentAccount } from '@/features/agent/agent-account'
import { useAgentModels } from '@/features/agent/agent-model-catalog'
import {
  agentModelStore,
  useAgentModelSelection,
} from '@/features/agent/agent-model-store'
import {
  ApplicationSidebar,
  ApplicationSidebarContentToggle,
} from '@/features/application-shell/ApplicationSidebar'
import { useOptionalApplicationSidebarState } from '@/features/application-shell/application-sidebar-context'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  SidebarInset,
  SidebarProvider,
} from '@/components/ui/sidebar'
import { Textarea } from '@/components/ui/textarea'
import { DocumentDataSourceSidebar } from '@/features/documents/DocumentDataSourceSidebar'
import { useDataSourceBrowser, type DocumentBrowserScope } from '@/features/documents/use-data-source-browser'
import { createBlankPresentation } from '@/features/presentation-renderer/load-presentation'
import { monaBridge } from '@/lib/mona-bridge'

import type { ProjectPageData } from './project-data'
import {
  projectMessageText,
  useProjectAgentChat,
} from './use-project-agent-chat'

const presentationMediaType = 'application/vnd.mona.presentation-package'

export function ProjectPage() {
  const initialData = useLoaderData() as ProjectPageData
  return <ProjectConversation key={initialData.project.id} initialData={initialData} />
}

function ProjectConversation({ initialData }: { initialData: ProjectPageData }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const account = useAgentAccount()
  const models = useAgentModels()
  const selection = useAgentModelSelection()
  const sidebarState = useOptionalApplicationSidebarState()
  const [localSidebarCollapsed, setLocalSidebarCollapsed] = useState(false)
  const collapsed = sidebarState?.collapsed ?? localSidebarCollapsed
  const setCollapsed = sidebarState?.setCollapsed ?? setLocalSidebarCollapsed
  const [project, setProject] = useState(initialData.project)
  const [jobs, setJobs] = useState(initialData.jobs)
  const [projects, setProjects] = useState<ProjectSummary[]>(initialData.projects)
  const [documents, setDocuments] = useState(initialData.documents)
  const [draft, setDraft] = useState('')
  const [titleDraft, setTitleDraft] = useState(project.title)
  const [addingDocuments, setAddingDocuments] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const initialPromptSent = useRef(false)
  const endRef = useRef<HTMLDivElement>(null)
  const sourceBrowser = useDataSourceBrowser({
    initialDocuments: initialData.sourceDocuments,
    initialSources: initialData.sources,
    query: '',
  })
  const activeModel = models.find(model => model.id === selection.model) ?? models[0]!
  const chat = useProjectAgentChat({
    effort: selection.effort,
    model: activeModel.id,
    onProjectChange: setProject,
    project,
  })
  const busy = chat.status === 'streaming' || chat.status === 'submitted'

  const refreshProjects = useCallback(() => {
    void Promise.all([
      monaBridge().projects.list(),
      monaBridge().projects.read(project.id),
    ]).then(([nextProjects, nextProject]) => {
      setProjects(nextProjects)
      if (nextProject) setProject(nextProject)
    })
  }, [project.id])

  const refreshJobs = useCallback((changedProjectId?: string) => {
    if (changedProjectId && changedProjectId !== project.id) return
    void monaBridge().projectJobs.list(project.id).then(setJobs)
  }, [project.id])

  useEffect(() => monaBridge().projects.onChange(refreshProjects), [refreshProjects])
  useEffect(() => monaBridge().projectJobs.onChange(refreshJobs), [refreshJobs])
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [chat.messages, busy])

  const submitText = useCallback(async (text: string) => {
    const content = text.trim()
    if (!content || submitting) return
    if (!account.connected) {
      toast.error(t('projects.agentUnavailable'), {
        description: t('projects.agentUnavailableDescription'),
      })
      return
    }
    setSubmitting(true)
    try {
      const updated = await monaBridge().projects.appendMessage(project.id, {
        content,
        role: 'user',
      })
      setProject(updated)
      setTitleDraft(updated.title)
      setDraft('')
      await chat.sendMessage({ text: content })
    }
    catch (error) {
      toast.error(t('documents.actionFailed'), {
        description: error instanceof Error ? error.message : t('documents.unknownError'),
      })
    }
    finally {
      setSubmitting(false)
    }
  }, [account.connected, chat, project.id, submitting, t])

  useEffect(() => {
    const initialPrompt = (location.state as { initialPrompt?: unknown } | null)?.initialPrompt
    if (
      initialPromptSent.current
      || typeof initialPrompt !== 'string'
      || !initialPrompt.trim()
      || !account.connected
    ) return
    initialPromptSent.current = true
    void submitText(initialPrompt)
    void navigate(location.pathname, { replace: true, state: null })
  }, [account.connected, location.pathname, location.state, navigate, submitText])

  const createProject = async () => {
    try {
      const created = await monaBridge().projects.create()
      await navigate(`/projects/${encodeURIComponent(created.id)}`)
      return created
    }
    catch (error) {
      toast.error(t('documents.actionFailed'), {
        description: error instanceof Error ? error.message : t('documents.unknownError'),
      })
      return null
    }
  }

  const navigateToScope = (scope: DocumentBrowserScope) => {
    if (scope.kind === 'all') {
      void navigate('/')
      return
    }
    const search = new URLSearchParams({
      itemId: scope.itemId,
      sourceId: scope.sourceId,
    })
    void navigate(`/?${search}`)
  }

  const saveTitle = async () => {
    if (titleDraft === project.title) return
    try {
      const updated = await monaBridge().projects.rename(project.id, titleDraft)
      setProject(updated)
      setTitleDraft(updated.title)
    }
    catch (error) {
      setTitleDraft(project.title)
      toast.error(t('documents.actionFailed'), {
        description: error instanceof Error ? error.message : t('documents.unknownError'),
      })
    }
  }

  const addArtifact = async (document: DataSourceDocument) => {
    try {
      const updated = await monaBridge().projects.addArtifact(project.id, {
        documentType: document.documentType,
        mediaType: document.mediaType,
        name: document.name,
        reference: {
          itemId: document.id,
          sourceId: document.sourceId,
        },
      })
      setProject(updated)
    }
    catch (error) {
      toast.error(t('documents.actionFailed'), {
        description: error instanceof Error ? error.message : t('documents.unknownError'),
      })
    }
  }

  const removeArtifact = async (artifactId: string) => {
    try {
      setProject(await monaBridge().projects.removeArtifact(project.id, artifactId))
    }
    catch (error) {
      toast.error(t('documents.actionFailed'), {
        description: error instanceof Error ? error.message : t('documents.unknownError'),
      })
    }
  }

  const openArtifact = async (artifact: ProjectArtifact) => {
    if (artifact.documentType !== 'presentation') {
      toast.info(t('documents.sourceTypeNotEditable'))
      return
    }
    const existing = documents.find(document => sameReference(
      document.sourceReference,
      artifact.reference,
    ))
    if (existing) {
      await navigate(`/documents/${encodeURIComponent(existing.id)}`)
      return
    }
    try {
      if (artifact.mediaType === presentationMediaType) {
        const opened = await monaBridge().documents.openSource(artifact.reference)
        setDocuments(current => [opened, ...current.filter(item => item.id !== opened.id)])
        await navigate(`/documents/${encodeURIComponent(opened.id)}`)
        return
      }
      const title = artifact.name.replace(/\.[^.]+$/, '')
      const created = await monaBridge().documents.create({
        ...createBlankPresentation(),
        title,
      }, artifact.reference)
      setDocuments(current => [created, ...current])
      const parameters = new URLSearchParams({
        sourceImport: artifact.name.toLocaleLowerCase().endsWith('.pptx') ? 'pptx' : 'native',
        sourceItemId: artifact.reference.itemId,
        sourceId: artifact.reference.sourceId,
      })
      await navigate(`/documents/${encodeURIComponent(created.id)}?${parameters}`)
    }
    catch (error) {
      toast.error(t('documents.actionFailed'), {
        description: error instanceof Error ? error.message : t('documents.unknownError'),
      })
    }
  }

  const candidateDocuments = useMemo(() => {
    const attached = new Set(project.artifacts.map(artifact => (
      `${artifact.reference.sourceId}:${artifact.reference.itemId}`
    )))
    return sourceBrowser.documents.filter(document => (
      !attached.has(`${document.sourceId}:${document.id}`)
    ))
  }, [project.artifacts, sourceBrowser.documents])
  const sourceNames = useMemo(
    () => new Map(sourceBrowser.sources.map(source => [source.id, source.name])),
    [sourceBrowser.sources],
  )

  return (
    <SidebarProvider className="h-svh min-h-0 overflow-hidden">
      <title>{t('projects.pageTitle', { title: project.title || t('projects.untitled') })}</title>
      <ApplicationSidebar
        ariaLabel={t('documents.sidebarLabel')}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        onOpenLibrary={() => { void navigate('/') }}
      >
        <DocumentDataSourceSidebar
          activeProjectId={project.id}
          listChildren={sourceBrowser.listChildren}
          onAddLocalFolder={sourceBrowser.addLocalFolder}
          onCreateProject={createProject}
          onDeleteProject={async projectId => {
            try {
              await monaBridge().projects.delete(projectId)
              if (projectId === project.id) {
                await navigate('/')
                return
              }
              setProjects(current => current.filter(item => item.id !== projectId))
            }
            catch (error) {
              toast.error(t('documents.actionFailed'), {
                description: error instanceof Error ? error.message : t('documents.unknownError'),
              })
              throw error
            }
          }}
          onOpenProject={projectId => {
            if (projectId !== project.id) void navigate(`/projects/${encodeURIComponent(projectId)}`)
          }}
          onRemoveSource={sourceBrowser.removeSource}
          onScopeChange={navigateToScope}
          onSetDefaultSaveLocation={sourceBrowser.setDefaultSaveLocation}
          projects={projects}
          scope={sourceBrowser.scope}
          sources={sourceBrowser.sources}
          treeRevision={sourceBrowser.treeRevision}
        />
      </ApplicationSidebar>

      <SidebarInset className="relative flex h-svh min-h-0 min-w-0 flex-row overflow-hidden bg-[var(--workspace-surface)] text-foreground">
        <ApplicationSidebarContentToggle
          className="absolute start-3 top-2 z-20"
          collapsed={collapsed}
          onExpand={() => setCollapsed(false)}
        />

        <section className="flex min-w-0 flex-1 flex-col" aria-label={t('projects.conversation')}>
          <div className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4 ps-12">
            <Input
              aria-label={t('projects.titleLabel')}
              className="h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 py-0 text-base font-semibold shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
              onBlur={() => { void saveTitle() }}
              onChange={event => setTitleDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') {
                  setTitleDraft(project.title)
                  event.currentTarget.blur()
                }
              }}
              placeholder={t('projects.untitled')}
              value={titleDraft}
            />
            <span className="hidden text-xs text-muted-foreground md:inline">
              {account.loading
                ? t('projects.checkingAgent')
                : account.connected
                  ? account.accountLabel ?? t('projects.agentConnected')
                  : t('projects.agentDisconnected')}
            </span>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-8">
              {chat.messages.length ? (
                <div className="flex flex-col gap-7">
                  {chat.messages.map((message, index) => (
                    <ProjectMessage
                      key={message.id}
                      message={message}
                      streaming={busy && index === chat.messages.length - 1 && message.role === 'assistant'}
                    />
                  ))}
                  {busy && chat.messages.at(-1)?.role !== 'assistant' ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <LoaderCircle className="size-4 animate-spin" />
                      {t('projects.working')}
                    </div>
                  ) : null}
                  <div ref={endRef} />
                </div>
              ) : (
                <div className="grid flex-1 place-items-center py-16 text-center">
                  <div className="max-w-sm">
                    <Bot className="mx-auto mb-4 size-6 text-muted-foreground" />
                    <h2 className="text-lg font-semibold">{t('projects.emptyTitle')}</h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {t('projects.emptyDescription')}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          {jobs[0] ? (
            <ProjectJobActivity
              job={jobs[0]}
              onCancel={async jobId => {
                try {
                  await monaBridge().projectJobs.cancel(project.id, jobId)
                }
                catch (error) {
                  toast.error(t('documents.actionFailed'), {
                    description: error instanceof Error
                      ? error.message
                      : t('documents.unknownError'),
                  })
                }
              }}
            />
          ) : null}

          <div className="shrink-0 px-5 pb-5">
            <form
              className="mx-auto max-w-3xl rounded-overlay border border-border bg-background p-2 shadow-sm"
              onSubmit={event => {
                event.preventDefault()
                void submitText(draft)
              }}
            >
              <Textarea
                aria-label={t('projects.composerLabel')}
                className="max-h-40 min-h-16 resize-none border-0 bg-transparent px-2 py-1 shadow-none focus-visible:ring-0"
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => {
                  if (event.key !== 'Enter' || event.shiftKey) return
                  event.preventDefault()
                  void submitText(draft)
                }}
                placeholder={t('projects.composerPlaceholder')}
                value={draft}
              />
              <div className="flex items-center gap-2 px-1 pt-1">
                <Select
                  onValueChange={value => agentModelStore.setModel(value)}
                  value={activeModel.id}
                >
                  <SelectTrigger
                    aria-label={t('projects.chooseModel')}
                    className="h-7 w-auto min-w-28 border-0 bg-transparent px-1.5 shadow-none"
                    icon={<AgentProviderIcon className="size-3.5" />}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map(model => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={() => setAddingDocuments(true)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Paperclip />
                  {t('projects.attach')}
                </Button>
                <div className="ms-auto">
                  {busy ? (
                    <Button
                      aria-label={t('projects.stop')}
                      onClick={() => { void chat.stop() }}
                      size="icon-sm"
                      type="button"
                      variant="secondary"
                    >
                      <Square />
                    </Button>
                  ) : (
                    <Button
                      aria-label={t('projects.send')}
                      disabled={!draft.trim() || submitting || !account.connected}
                      size="icon-sm"
                      type="submit"
                    >
                      <ArrowUp />
                    </Button>
                  )}
                </div>
              </div>
            </form>
            {chat.error ? (
              <p className="mx-auto mt-2 max-w-3xl text-xs text-destructive">
                {chat.error.message}
              </p>
            ) : null}
          </div>
        </section>

        <ArtifactPanel
          onAdd={() => setAddingDocuments(true)}
          onOpen={openArtifact}
          onRemove={removeArtifact}
          project={project}
          sourceNames={sourceNames}
        />
      </SidebarInset>

      <AttachDocumentsDialog
        documents={candidateDocuments}
        onAdd={addArtifact}
        onOpenChange={setAddingDocuments}
        open={addingDocuments}
        sourceNames={sourceNames}
      />
    </SidebarProvider>
  )
}

function ProjectJobActivity({
  job,
  onCancel,
}: {
  job: DocumentJobRecord
  onCancel: (jobId: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const progress = documentJobProgress(job)
  const active = !isTerminalDocumentJobStatus(job.status)
  const currentStep = job.steps.find(step => step.status === 'running')
    ?? job.steps.find(step => step.status === 'failed')
    ?? job.steps.at(-1)
  const Icon = job.status === 'succeeded'
    ? CircleCheck
    : job.status === 'failed' || job.status === 'partial'
      ? CircleX
      : Clock3
  const label = t(`projects.jobStatus.${job.status}`)

  return (
    <section
      aria-label={t('projects.jobActivity')}
      className="mx-auto w-full max-w-3xl shrink-0 border-t border-border px-1 py-3"
    >
      <div className="flex items-center gap-3">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{job.explanation}</span>
            <Badge variant={job.status === 'failed' ? 'destructive' : 'secondary'}>
              {label}
            </Badge>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {currentStep?.error
              ?? currentStep?.name
              ?? t('projects.jobDocuments', {
                completed: progress.completed,
                total: progress.total,
              })}
          </p>
        </div>
        {active ? (
          <Button
            onClick={() => { void onCancel(job.id) }}
            size="sm"
            type="button"
            variant="ghost"
          >
            <X data-icon="inline-start" />
            {t('projects.cancelJob')}
          </Button>
        ) : null}
      </div>
      <Progress
        aria-label={t('projects.jobProgress', { percent: progress.percent })}
        className="mt-2 h-1"
        value={progress.percent}
      />
    </section>
  )
}

function sameReference(
  left: DataSourceDocumentReference | undefined,
  right: DataSourceDocumentReference,
): boolean {
  return left?.sourceId === right.sourceId && left.itemId === right.itemId
}

function ProjectMessage({
  message,
  streaming,
}: {
  message: UIMessage
  streaming: boolean
}) {
  const { t } = useTranslation()
  if (message.role === 'user') {
    return (
      <div className="ms-auto max-w-[78%] rounded-overlay bg-foreground px-3.5 py-2.5 text-sm leading-6 text-background">
        {projectMessageText(message)}
      </div>
    )
  }

  return (
    <div className="grid w-full gap-2 text-sm leading-6">
      {message.parts.map((part, index) => {
        if (part.type === 'text') {
          return (
            <div className="mona-project-markdown min-w-0" key={index}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {(part as { text: string }).text}
              </ReactMarkdown>
            </div>
          )
        }
        if (part.type === 'reasoning') {
          return (
            <details className="text-xs text-muted-foreground" key={index}>
              <summary>{t('projects.thinking')}</summary>
              <p className="mt-1 whitespace-pre-wrap">{(part as { text?: string }).text}</p>
            </details>
          )
        }
        if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
          const toolName = 'toolName' in part && typeof part.toolName === 'string'
            ? part.toolName.replace(/^mcp__mona__/, '')
            : t('projects.tool')
          return (
            <div className="flex items-center gap-2 text-xs text-muted-foreground" key={index}>
              {streaming ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              <span>{toolName}</span>
            </div>
          )
        }
        return null
      })}
    </div>
  )
}

function ArtifactPanel({
  onAdd,
  onOpen,
  onRemove,
  project,
  sourceNames,
}: {
  onAdd: () => void
  onOpen: (artifact: ProjectArtifact) => Promise<void>
  onRemove: (artifactId: string) => Promise<void>
  project: ProjectRecord
  sourceNames: Map<string, string>
}) {
  const { t } = useTranslation()
  return (
    <aside
      aria-label={t('projects.artifacts')}
      className="flex w-80 shrink-0 flex-col border-l border-sidebar-border bg-sidebar max-xl:w-72"
    >
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border px-4">
        <h2 className="min-w-0 flex-1 text-sm font-semibold">{t('projects.artifacts')}</h2>
        <Button
          aria-label={t('projects.addDocuments')}
          onClick={onAdd}
          size="icon-xs"
          variant="ghost"
        >
          <Plus />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {project.artifacts.length ? (
          <div className="divide-y divide-sidebar-border">
            {project.artifacts.map(artifact => {
              const Icon = artifact.documentType === 'presentation'
                ? Presentation
                : artifact.documentType === 'pdf'
                  ? FileText
                  : File
              return (
                <div className="group/artifact flex items-center gap-2 px-3 py-2.5" key={artifact.id}>
                  <Button
                    className="h-auto min-w-0 flex-1 justify-start gap-2 p-0 text-start hover:bg-transparent"
                    onClick={() => { void onOpen(artifact) }}
                    variant="ghost"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-control bg-sidebar-accent">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{artifact.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {sourceNames.get(artifact.reference.sourceId) ?? t('documents.sourceDisconnected')}
                      </span>
                    </span>
                  </Button>
                  <Button
                    aria-label={t('projects.removeArtifact', { name: artifact.name })}
                    className="opacity-0 group-hover/artifact:opacity-100 focus-visible:opacity-100"
                    onClick={() => { void onRemove(artifact.id) }}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <X />
                  </Button>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="grid min-h-52 place-items-center px-6 text-center">
            <div>
              <Paperclip className="mx-auto mb-3 size-5 text-muted-foreground" />
              <p className="text-sm font-medium">{t('projects.noArtifacts')}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {t('projects.noArtifactsDescription')}
              </p>
            </div>
          </div>
        )}
      </ScrollArea>
    </aside>
  )
}

function AttachDocumentsDialog({
  documents,
  onAdd,
  onOpenChange,
  open,
  sourceNames,
}: {
  documents: DataSourceDocument[]
  onAdd: (document: DataSourceDocument) => Promise<void>
  onOpenChange: (open: boolean) => void
  open: boolean
  sourceNames: Map<string, string>
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const visible = documents.filter(document => (
    !query.trim() || document.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  ))
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[min(680px,80vh)] max-w-xl overflow-hidden p-0">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>{t('projects.addDocuments')}</DialogTitle>
          <DialogDescription>{t('projects.addDocumentsDescription')}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 border-y px-4 py-2">
          <Search className="size-4 text-muted-foreground" />
          <input
            aria-label={t('projects.searchDocuments')}
            className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none"
            onChange={event => setQuery(event.target.value)}
            placeholder={t('projects.searchDocuments')}
            value={query}
          />
        </div>
        <ScrollArea className="h-[min(420px,55vh)]">
          {visible.length ? (
            <div className="divide-y">
              {visible.map(document => {
                const Icon = document.documentType === 'presentation'
                  ? Presentation
                  : document.documentType === 'pdf'
                    ? FileText
                    : File
                return (
                  <Button
                    className="h-auto w-full justify-start gap-3 rounded-none px-5 py-3 text-start"
                    disabled={busyId === document.id}
                    key={`${document.sourceId}:${document.id}`}
                    onClick={() => {
                      setBusyId(document.id)
                      void onAdd(document).finally(() => setBusyId(null))
                    }}
                    variant="ghost"
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{document.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {sourceNames.get(document.sourceId) ?? t('documents.sourceDisconnected')}
                      </span>
                    </span>
                    {busyId === document.id ? <LoaderCircle className="animate-spin" /> : <Plus />}
                  </Button>
                )
              })}
            </div>
          ) : (
            <div className="grid h-52 place-items-center text-sm text-muted-foreground">
              {t('projects.noDocumentsFound')}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
