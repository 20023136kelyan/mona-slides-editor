import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  Check,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderRoot,
  MessageSquare,
  Plus,
  Presentation,
  Trash2,
} from 'lucide-react'

import type {
  DataSourceFolder,
  DataSourceItem,
  DataSourceSummary,
} from '@mona/data-source'
import type { ProjectSummary } from '@mona/project-core'

import { Button } from '@/components/ui/button'
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar'
import {
  ApplicationSidebarItem,
} from '@/features/application-shell/ApplicationSidebar'
import { cn } from '@/lib/utils'

import {
  documentBrowserScopeKey,
  type DocumentBrowserScope,
} from './use-data-source-browser'

interface DocumentDataSourceSidebarProps {
  activeProjectId?: string
  listChildren: (sourceId: string, parentItemId: string) => Promise<DataSourceItem[]>
  onAddLocalFolder: () => Promise<unknown>
  onCreateProject: () => Promise<unknown>
  onDeleteProject: (projectId: string) => Promise<void>
  onOpenProject: (projectId: string) => void
  onRemoveSource: (sourceId: string) => Promise<void>
  onScopeChange: (scope: DocumentBrowserScope) => void
  onSetDefaultSaveLocation: (sourceId: string) => Promise<void>
  projects: ProjectSummary[]
  scope: DocumentBrowserScope
  sources: DataSourceSummary[]
  treeRevision: number
}

export function DocumentDataSourceSidebar({
  activeProjectId,
  listChildren,
  onAddLocalFolder,
  onCreateProject,
  onDeleteProject,
  onOpenProject,
  onRemoveSource,
  onScopeChange,
  onSetDefaultSaveLocation,
  projects,
  scope,
  sources,
  treeRevision,
}: DocumentDataSourceSidebarProps) {
  const { t } = useTranslation()
  const [adding, setAdding] = useState(false)
  const [creatingProject, setCreatingProject] = useState(false)
  const [projectToDelete, setProjectToDelete] = useState<ProjectSummary | null>(null)
  const [deletingProject, setDeletingProject] = useState(false)
  const [sourceToRemove, setSourceToRemove] = useState<DataSourceSummary | null>(null)
  const [removing, setRemoving] = useState(false)
  const activeKey = documentBrowserScopeKey(scope)

  const addLocalFolder = async () => {
    if (adding) return
    setAdding(true)
    try {
      await onAddLocalFolder()
    }
    finally {
      setAdding(false)
    }
  }

  const confirmRemove = async () => {
    if (!sourceToRemove || removing) return
    setRemoving(true)
    try {
      await onRemoveSource(sourceToRemove.id)
      setSourceToRemove(null)
    }
    finally {
      setRemoving(false)
    }
  }

  const createProject = async () => {
    if (creatingProject) return
    setCreatingProject(true)
    try {
      await onCreateProject()
    }
    finally {
      setCreatingProject(false)
    }
  }

  const deleteProject = async () => {
    if (!projectToDelete || deletingProject) return
    setDeletingProject(true)
    try {
      await onDeleteProject(projectToDelete.id)
      setProjectToDelete(null)
    }
    catch {
      // The route owns the user-facing error treatment; keep the dialog open so
      // the user can retry without having to find the project again.
    }
    finally {
      setDeletingProject(false)
    }
  }

  return (
    <>
      <SidebarGroup className="pb-0">
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <ApplicationSidebarItem
                active={!activeProjectId && scope.kind === 'all'}
                icon={Presentation}
                label={t('header.allPresentations')}
                onClick={() => onScopeChange({ kind: 'all' })}
              />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup className="-mt-2">
        <SidebarGroupLabel className="group-data-[collapsed=true]/rail:hidden">
          {t('documents.dataSources')}
        </SidebarGroupLabel>
        <SidebarGroupAction
          aria-label={t('documents.addDataSource')}
          className="group-data-[collapsed=true]/rail:hidden"
          disabled={adding}
          onClick={() => { void addLocalFolder() }}
          title={t('documents.addDataSource')}
        >
          <Plus />
          <span className="sr-only">{t('documents.addDataSource')}</span>
        </SidebarGroupAction>
        <SidebarGroupContent>
          <SidebarMenu>
            {sources.map(source => (
              <DataSourceTree
                activeKey={activeKey}
                key={source.id}
                listChildren={listChildren}
                onRemove={() => setSourceToRemove(source)}
                onScopeChange={onScopeChange}
                onSetDefaultSaveLocation={() => onSetDefaultSaveLocation(source.id)}
                source={source}
                treeRevision={treeRevision}
              />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup className="group-data-[collapsed=true]/rail:hidden">
        <SidebarGroupLabel>{t('documents.projects')}</SidebarGroupLabel>
        <SidebarGroupAction
          aria-label={t('projects.newProject')}
          disabled={creatingProject}
          onClick={() => { void createProject() }}
          title={t('projects.newProject')}
        >
          <Plus />
          <span className="sr-only">{t('projects.newProject')}</span>
        </SidebarGroupAction>
        <SidebarGroupContent>
          <SidebarMenu>
            {projects.map(project => (
              <SidebarMenuItem key={project.id}>
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <ApplicationSidebarItem
                      active={activeProjectId === project.id}
                      icon={MessageSquare}
                      label={project.title || t('projects.untitled')}
                      onClick={() => onOpenProject(project.id)}
                    />
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      onSelect={() => setProjectToDelete(project)}
                      variant="destructive"
                    >
                      <Trash2 />
                      {t('common.delete')}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup className="mt-auto group-data-[collapsed=true]/rail:hidden">
        <SidebarGroupLabel>{t('documents.workflows')}</SidebarGroupLabel>
      </SidebarGroup>

      <AlertDialog
        onOpenChange={open => {
          if (!open && !removing) setSourceToRemove(null)
        }}
        open={sourceToRemove !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('documents.removeSourceTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('documents.removeSourceDescription', { name: sourceToRemove?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={removing}
              onClick={() => { void confirmRemove() }}
              variant="destructive"
            >
              {t('documents.removeSource')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        onOpenChange={open => {
          if (!open && !deletingProject) setProjectToDelete(null)
        }}
        open={projectToDelete !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('projects.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('projects.deleteDescription', {
                name: projectToDelete?.title || t('projects.untitled'),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingProject}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingProject}
              onClick={() => { void deleteProject() }}
              variant="destructive"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function DataSourceTree({
  activeKey,
  listChildren,
  onRemove,
  onScopeChange,
  onSetDefaultSaveLocation,
  source,
  treeRevision,
}: {
  activeKey: string
  listChildren: DocumentDataSourceSidebarProps['listChildren']
  onRemove: () => void
  onScopeChange: DocumentDataSourceSidebarProps['onScopeChange']
  onSetDefaultSaveLocation: () => Promise<void>
  source: DataSourceSummary
  treeRevision: number
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [folders, setFolders] = useState<DataSourceFolder[]>([])
  const [loading, setLoading] = useState(true)
  const rootKey = `source:${source.id}:${source.rootItemId}`

  useEffect(() => {
    if (source.status !== 'available') return
    let active = true
    void listChildren(source.id, source.rootItemId).then(items => {
      if (active) setFolders(items.filter(item => item.kind === 'folder'))
    }).catch(() => {
      if (active) setFolders([])
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [listChildren, source.id, source.rootItemId, source.status, treeRevision])

  return (
    <SidebarMenuItem>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <ApplicationSidebarItem
            active={activeKey === rootKey}
            aria-expanded={open}
            icon={source.status === 'available' ? FolderRoot : AlertCircle}
            label={source.name}
            onClick={() => {
              onScopeChange({
                itemId: source.rootItemId,
                kind: 'source',
                sourceId: source.id,
              })
              if (folders.length > 0) setOpen(current => !current)
            }}
            title={source.status === 'available'
              ? source.name
              : t(`documents.sourceStatus.${source.status}`, { name: source.name })}
          >
            <div aria-hidden="true" className="ms-auto flex size-4 shrink-0 items-center justify-center">
              {!loading && folders.length > 0 ? (
                <ChevronRight
                  className={cn('size-4 transition-transform', open && 'rotate-90')}
                  data-source-disclosure="root"
                />
              ) : null}
            </div>
          </ApplicationSidebarItem>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuGroup>
            {source.capabilities.write ? (
              <ContextMenuItem
                disabled={source.isDefaultSaveLocation}
                onSelect={() => { void onSetDefaultSaveLocation() }}
              >
                {source.isDefaultSaveLocation ? <Check data-icon="inline-start" /> : null}
                {source.isDefaultSaveLocation
                  ? t('documents.defaultSaveLocation')
                  : t('documents.useForNewPresentations')}
              </ContextMenuItem>
            ) : null}
            <ContextMenuItem variant="destructive" onSelect={onRemove}>
              {t('documents.removeSource')}
            </ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
      {open && folders.length > 0 ? (
        <SourceTreeChildren
          activeKey={activeKey}
          folders={folders}
          listChildren={listChildren}
          onScopeChange={onScopeChange}
          treeRevision={treeRevision}
        />
      ) : null}
    </SidebarMenuItem>
  )
}

function SourceTreeChildren({
  activeKey,
  folders,
  listChildren,
  onScopeChange,
  treeRevision,
}: {
  activeKey: string
  folders: DataSourceFolder[]
  listChildren: DocumentDataSourceSidebarProps['listChildren']
  onScopeChange: DocumentDataSourceSidebarProps['onScopeChange']
  treeRevision: number
}) {
  if (!folders.length) return null

  return (
    <SidebarMenuSub>
      {folders.map(folder => (
        <SourceFolderNode
          activeKey={activeKey}
          folder={folder}
          key={folder.id}
          listChildren={listChildren}
          onScopeChange={onScopeChange}
          treeRevision={treeRevision}
        />
      ))}
    </SidebarMenuSub>
  )
}

function SourceFolderNode({
  activeKey,
  folder,
  listChildren,
  onScopeChange,
  treeRevision,
}: {
  activeKey: string
  folder: DataSourceFolder
  listChildren: DocumentDataSourceSidebarProps['listChildren']
  onScopeChange: DocumentDataSourceSidebarProps['onScopeChange']
  treeRevision: number
}) {
  const [open, setOpen] = useState(false)
  const [folders, setFolders] = useState<DataSourceFolder[]>([])
  const key = `source:${folder.sourceId}:${folder.id}`

  useEffect(() => {
    if (!open) return
    let active = true
    void listChildren(folder.sourceId, folder.id).then(items => {
      if (active) setFolders(items.filter(item => item.kind === 'folder'))
    }).catch(() => {
      if (active) setFolders([])
    })
    return () => { active = false }
  }, [folder.id, folder.sourceId, listChildren, open, treeRevision])

  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton asChild isActive={activeKey === key}>
        <Button
          aria-expanded={open}
          onClick={() => {
            onScopeChange({
              itemId: folder.id,
              kind: 'source',
              sourceId: folder.sourceId,
            })
            if (folder.hasChildren) setOpen(current => !current)
          }}
          title={folder.name}
          type="button"
          variant="ghost"
        >
          {open
            ? <FolderOpen data-icon="inline-start" />
            : <Folder data-icon="inline-start" />}
          <span>{folder.name}</span>
          {folder.hasChildren ? (
            <ChevronRight
              aria-hidden="true"
              className={cn('ms-auto transition-transform', open && 'rotate-90')}
              data-icon="inline-end"
            />
          ) : null}
        </Button>
      </SidebarMenuSubButton>
      {open && folders.length > 0 ? (
        <SourceTreeChildren
          activeKey={activeKey}
          folders={folders}
          listChildren={listChildren}
          onScopeChange={onScopeChange}
          treeRevision={treeRevision}
        />
      ) : null}
    </SidebarMenuSubItem>
  )
}
