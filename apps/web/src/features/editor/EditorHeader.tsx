import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  CircleAlert,
  Download,
  FileArchive,
  FileJson,
  FilePlus2,
  FileSliders,
  FileType2,
  Languages,
  Laptop,
  LoaderCircle,
  MessageSquare,
  MonitorPlay,
  PanelsTopLeft,
  Play,
  Redo2,
  Search,
  Settings,
  Share2,
  Sparkles,
  Undo2,
} from 'lucide-react'

import ImageIcon from '~icons/vscode-icons/file-type-image'
import JsonIcon from '~icons/vscode-icons/file-type-json'
import PdfIcon from '~icons/vscode-icons/file-type-pdf2'
import PowerPointIcon from '~icons/vscode-icons/file-type-powerpoint2'

import { editorActions } from '@mona/editor-state'
import { createPresentationId } from '@mona/presentation-core'

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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { EditorHotkeyDrawer } from '@/features/editor/EditorHotkeyDrawer'
import { InspectorSelect } from '@/features/editor/EditorInspectorPrimitives'
import type { ExportType } from '@/features/editor/EditorExportPopover'
import type { DeckPersistenceSnapshot } from '@/features/editor/editor-persistence'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import type { StartPresentationOptions } from '@/features/editor/services/editor-application'
import { useEditorApplication } from '@/features/editor/services/editor-application'
import { useEditorShell } from '@/features/editor/shell/editor-shell'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { LOCALES, isSupportedLocale, setLocale, type SupportedLocale } from '@/i18n'
import { LEGACY_NATIVE_FILE_EXTENSION } from '@/lib/legacy-compatibility'
import { cn } from '@/lib/utils'

type OpenPopover = 'file' | 'view' | 'tools' | 'screen' | 'settings' | null

// The export stack (pptxgenjs, html-to-image) loads on first use, keeping it
// out of the editor's critical path.
const EditorExportFeature = lazy(async () => ({
  default: (await import('@/features/editor/EditorExportFeature')).EditorExportFeature,
}))

const EMPTY_PERSISTENCE_SNAPSHOT: DeckPersistenceSnapshot = {
  dirty: false,
  error: null,
  pendingSince: null,
  savedAt: null,
  status: 'idle',
}
const subscribeToNothing = () => () => {}
const getEmptyPersistenceSnapshot = () => EMPTY_PERSISTENCE_SNAPSHOT

const headerMenuItemClass = 'flex w-full min-w-30 items-center gap-2 whitespace-nowrap rounded-control px-2 py-1.5 text-xs min-h-8 [&_svg]:size-3.5 [&_svg]:text-muted-foreground'

function HeaderMenuItem({
  disabled = false,
  icon,
  label,
  onSelect,
  shortcut,
  variant = 'default',
}: {
  disabled?: boolean
  icon: ReactNode
  label: string
  onSelect: () => void
  shortcut?: string
  variant?: 'default' | 'destructive'
}) {
  return (
    <DropdownMenuItem
      className={headerMenuItemClass}
      disabled={disabled}
      onSelect={onSelect}
      variant={variant}
    >
      {icon}
      <span className="relative top-px flex-1">{label}</span>
      {shortcut ? <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut> : null}
    </DropdownMenuItem>
  )
}

function HeaderMenu({
  children,
  label,
  menu,
  open,
  onOpenChange,
  triggerRef,
}: {
  children: ReactNode
  label: string
  menu: Exclude<OpenPopover, null>
  open: OpenPopover
  onOpenChange: (menu: Exclude<OpenPopover, null>, open: boolean) => void
  triggerRef?: Ref<HTMLButtonElement>
}) {
  return (
    <DropdownMenu onOpenChange={value => onOpenChange(menu, value)} open={open === menu}>
      <DropdownMenuTrigger asChild>
        <Button
          className="mona-header-menu-trigger h-7 min-h-7 min-w-7 rounded-action px-2 text-xs font-medium text-foreground/80 hover:bg-foreground/[0.06] hover:text-foreground data-[state=open]:bg-foreground/[0.08] data-[state=open]:text-foreground max-wide:px-1.5 max-compact:px-1"
          ref={triggerRef}
          size="editor"
          variant="ghost"
        >{label}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56 rounded-overlay p-1 text-xs shadow-[0_10px_30px_rgb(15_23_42_/_13%),0_2px_8px_rgb(15_23_42_/_8%)]" sideOffset={6}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function EditorHeader({ runtime }: { runtime: EditorRuntime }) {
  const { i18n, t } = useTranslation()
  const {
    agentOpen,
    closeAgent,
    closeExport,
    exportType,
    importFiles,
    importing,
    openAgent,
    openExport,
    persistence,
    startPresentation,
    subscribeToPresentationStart,
  } = useEditorApplication()
  const { openTaskPanel, taskPanelRoute, toggleTaskPanel } = useEditorShell()
  const presentationTitle = useEditorSelector(runtime.store, state => state.presentation.title)
  const presentationBackground = useEditorSelector(runtime.store, state => state.presentation.theme.backgroundColor)
  const historySnapshot = useSyncExternalStore(
    runtime.subscribeHistory,
    runtime.getHistorySnapshot,
    runtime.getHistorySnapshot,
  )
  const persistenceSnapshot = useSyncExternalStore(
    persistence?.subscribe ?? subscribeToNothing,
    persistence?.getSnapshot ?? getEmptyPersistenceSnapshot,
    persistence?.getSnapshot ?? getEmptyPersistenceSnapshot,
  )
  const [historyCursor = 0, historyLength = 1] = historySnapshot.split(':').map(Number)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const titleCancelledRef = useRef(false)
  const fileMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const menuBarRef = useRef<HTMLDivElement>(null)
  const pptxInputRef = useRef<HTMLInputElement>(null)
  const jsonInputRef = useRef<HTMLInputElement>(null)
  const nativeInputRef = useRef<HTMLInputElement>(null)
  const [openPopover, setOpenPopover] = useState<OpenPopover>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState('')
  const [hotkeysOpen, setHotkeysOpen] = useState(false)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const resolvedLanguage = i18n.resolvedLanguage ?? ''
  const activeLocale: SupportedLocale = isSupportedLocale(resolvedLanguage) ? resolvedLanguage : 'en-US'
  const setMenuOpen = (menu: Exclude<OpenPopover, null>, open: boolean) => {
    setOpenPopover(current => open ? menu : current === menu ? null : current)
  }
  const moveMenuFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'End', 'Home'].includes(event.key)) return
    if (
      event.target === titleInputRef.current
      && editingTitle
      && (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End')
    ) return
    const current = (event.target as HTMLElement).closest<HTMLElement>('button, input')
    if (!current) return
    const triggers = Array.from(
      menuBarRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input.mona-editor-header-title-input',
      ) ?? [],
    ).filter(control => control.offsetParent !== null)
    const index = triggers.indexOf(current)
    if (index === -1 || !triggers.length) return
    event.preventDefault()
    const target = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? triggers.length - 1
        : event.key === 'ArrowRight'
          ? (index + 1) % triggers.length
          : (index - 1 + triggers.length) % triggers.length
    triggers[target]?.focus()
  }

  // This subscription is intentionally registered outside the presentation
  // surface: portaled header menus/dialogs must close before the hidden
  // editor Activity yields to the slideshow.
  useEffect(() => subscribeToPresentationStart(() => {
    setOpenPopover(null)
    setHotkeysOpen(false)
    setResetDialogOpen(false)
  }), [subscribeToPresentationStart])

  const beginTitleEdit = () => {
    if (editingTitle) return
    setTitleValue(presentationTitle)
    setEditingTitle(true)
  }

  const commitTitle = () => {
    if (titleCancelledRef.current) {
      titleCancelledRef.current = false
      return
    }
    if (titleValue !== presentationTitle) {
      runtime.commit('Update presentation title', [{
        type: 'presentation.title.set',
        title: titleValue.trim(),
        // The localized placeholder is UI only; it is never persisted as the
        // user's document title.
        fallbackTitle: '',
      }], { historyKey: 'presentation-title' })
    }
    setEditingTitle(false)
  }

  const cancelTitleEdit = () => {
    titleCancelledRef.current = true
    setTitleValue(presentationTitle)
    setEditingTitle(false)
    titleInputRef.current?.blur()
  }

  const resetPresentation = () => {
    runtime.commit('Create new presentation', [
      {
        type: 'presentation.title.set',
        title: '',
        fallbackTitle: '',
      },
      {
        type: 'presentation.slides.replace',
        slides: [{
          id: createPresentationId(10),
          elements: [],
          background: { type: 'solid', color: presentationBackground },
        }],
      },
      { type: 'slide.focus', index: 0 },
    ], { historyKey: 'new-presentation' })
    runtime.store.dispatch(editorActions.selectionChanged([]))
    runtime.store.dispatch(editorActions.selectedSlideIndexesChanged([]))
    setResetDialogOpen(false)
    setOpenPopover(null)
    requestAnimationFrame(() => fileMenuTriggerRef.current?.focus())
  }

  const requestScreen = (
    fromStart: boolean,
    options: Omit<StartPresentationOptions, 'fromStart'> = {},
  ) => {
    startPresentation({ fromStart, ...options })
    setOpenPopover(null)
  }

  const requestExport = (type?: ExportType) => {
    openExport(type)
    setOpenPopover(null)
  }

  const requestImport = (type: 'json' | 'native' | 'pptx', event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (files?.length) void importFiles({ files, type })
    event.target.value = ''
    setOpenPopover(null)
  }

  const saveLabel = persistenceSnapshot.status === 'error'
    ? t('header.saveFailed')
    : persistenceSnapshot.status === 'saving'
      ? t('header.saving')
      : persistenceSnapshot.status === 'pending'
        ? t('header.changesPending')
        : t('header.savedLocally')
  const savedAt = persistenceSnapshot.savedAt
    ? new Intl.DateTimeFormat(activeLocale, { hour: 'numeric', minute: '2-digit' }).format(persistenceSnapshot.savedAt)
    : null

  return (
    <>
      <a
        className="mona-skip-link fixed top-2 left-2 z-[6000] rounded-control bg-foreground px-3.5 py-2.5 text-control font-bold text-background opacity-0 pointer-events-none -translate-y-[150%] transition-[transform,opacity] duration-120 focus:opacity-100 focus:pointer-events-auto focus:translate-y-0 focus:outline-2 focus:outline-ring focus:outline-offset-2"
        href="#mona-editor-canvas"
        onClick={event => {
          event.preventDefault()
          document.getElementById('mona-editor-canvas')?.focus()
        }}
      >{t('header.skipToCanvas')}</a>
      <header aria-label={t('header.editorHeader')} role="banner">
      <div
        aria-label={t('header.menuBar')}
        className="mona-editor-header relative grid h-11 flex-none grid-cols-[minmax(0,1fr)_minmax(12rem,32rem)_minmax(0,1fr)] items-center border-b border-border bg-background px-2.5 text-foreground leading-normal select-none max-wide:grid-cols-[minmax(0,1fr)_minmax(10rem,24rem)_minmax(0,1fr)] max-wide:px-2 max-narrow:grid-cols-[max-content_minmax(0,1fr)_max-content] max-compact:px-1"
        onKeyDown={moveMenuFocus}
        ref={menuBarRef}
        role="menubar"
        tabIndex={-1}
      >
        <fieldset aria-label={t('header.documentControls')} className="mona-editor-header-left m-0 flex min-w-0 items-center gap-1 border-0 p-0 justify-self-start max-narrow:gap-0">
          <div aria-label="Mona" className="mr-1.5 flex flex-none items-center gap-1.5 text-sm font-semibold tracking-tight text-foreground max-wide:mr-1 max-compact:hidden">
            <img alt="" aria-hidden="true" className="size-4 flex-none" src="/favicon.svg" />
            <span>Mona</span>
          </div>
          <nav aria-label={t('header.menuBar')} className="flex min-w-0 items-center gap-px">
            <input accept="application/vnd.openxmlformats-officedocument.presentationml.presentation" aria-hidden="true" hidden onChange={event => requestImport('pptx', event)} ref={pptxInputRef} tabIndex={-1} type="file" />
            <input accept=".json" aria-hidden="true" hidden onChange={event => requestImport('json', event)} ref={jsonInputRef} tabIndex={-1} type="file" />
            <input accept={`.mona,${LEGACY_NATIVE_FILE_EXTENSION}`} aria-hidden="true" hidden onChange={event => requestImport('native', event)} ref={nativeInputRef} tabIndex={-1} type="file" />
            <HeaderMenu label={t('header.menuFile')} menu="file" onOpenChange={setMenuOpen} open={openPopover} triggerRef={fileMenuTriggerRef}>
              <HeaderMenuItem disabled={importing} icon={<FilePlus2 />} label={t('header.newPresentation')} onSelect={() => setResetDialogOpen(true)} />
              <DropdownMenuSeparator className="my-1.5 bg-border" />
              <HeaderMenuItem disabled={importing} icon={<FileType2 />} label={t('header.importPptx')} onSelect={() => pptxInputRef.current?.click()} />
              <HeaderMenuItem disabled={importing} icon={<FileArchive />} label={t('header.importNative')} onSelect={() => nativeInputRef.current?.click()} />
              <HeaderMenuItem disabled={importing} icon={<FileJson />} label={t('header.importJson')} onSelect={() => jsonInputRef.current?.click()} />
              <DropdownMenuSeparator className="my-1.5 bg-border" />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className={headerMenuItemClass}>
                  <Download />
                  <span className="relative top-px flex-1">{t('header.exportFile')}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-52.5 rounded-overlay p-1 text-xs shadow-[0_10px_30px_rgb(15_23_42_/_13%),0_2px_8px_rgb(15_23_42_/_8%)]">
                  <HeaderMenuItem icon={<PowerPointIcon />} label={t('header.exportPptx')} onSelect={() => requestExport('pptx')} />
                  <HeaderMenuItem icon={<PdfIcon />} label={t('header.exportPdf')} onSelect={() => requestExport('pdf')} />
                  <HeaderMenuItem icon={<ImageIcon />} label={t('header.exportImage')} onSelect={() => requestExport('image')} />
                  <HeaderMenuItem icon={<img alt="" aria-hidden className="size-3.5" src="/favicon.svg" />} label={t('header.exportNative')} onSelect={() => requestExport('native')} />
                  <HeaderMenuItem icon={<JsonIcon />} label={t('header.exportJson')} onSelect={() => requestExport('json')} />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </HeaderMenu>
            <HeaderMenu label={t('header.menuView')} menu="view" onOpenChange={setMenuOpen} open={openPopover}>
              <HeaderMenuItem icon={<MessageSquare />} label={t('foundation.editor.canvasTool.comments')} onSelect={() => openTaskPanel('comments')} />
              <HeaderMenuItem icon={<FileSliders />} label={t('foundation.editor.canvasTool.selectionPane')} onSelect={() => openTaskPanel('layers')} />
              <DropdownMenuSeparator className="my-1.5 bg-border" />
              <HeaderMenuItem icon={<MonitorPlay />} label={t('header.fromBeginning')} onSelect={() => requestScreen(true)} shortcut="F5" />
              <HeaderMenuItem icon={<MonitorPlay />} label={t('header.fromCurrentSlide')} onSelect={() => requestScreen(false)} shortcut="⇧F5" />
            </HeaderMenu>
            <HeaderMenu label={t('header.menuTools')} menu="tools" onOpenChange={setMenuOpen} open={openPopover}>
              <HeaderMenuItem icon={<Search />} label={t('foundation.editor.canvasTool.findReplace')} onSelect={() => openTaskPanel('search')} shortcut="⌃F" />
              <HeaderMenuItem icon={<FileSliders />} label={t('header.markSlideTypes')} onSelect={() => openTaskPanel('semantics')} />
              <DropdownMenuSeparator className="my-1.5 bg-border" />
              <HeaderMenuItem icon={<Settings />} label={t('header.keyboardShortcuts')} onSelect={() => {
                setOpenPopover(null)
                setHotkeysOpen(true)
              }} />
            </HeaderMenu>
          </nav>
          <div aria-hidden="true" className="mx-1 h-4 w-px flex-none bg-border max-narrow:mx-0.5" />
          <Button aria-label={t('foundation.editor.canvasTool.undo')} disabled={historyCursor <= 0} onClick={() => runtime.undo()} size="header-icon" title={t('foundation.editor.canvasTool.undo')} variant="header-pill"><Undo2 /></Button>
          <Button aria-label={t('foundation.editor.canvasTool.redo')} disabled={historyCursor >= historyLength - 1} onClick={() => runtime.redo()} size="header-icon" title={t('foundation.editor.canvasTool.redo')} variant="header-pill"><Redo2 /></Button>
          {persistence ? (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    aria-label={saveLabel}
                    className={cn(
                      'inline-flex size-7 shrink-0 items-center justify-center rounded-action text-foreground/70 [&_svg]:size-3.5',
                      persistenceSnapshot.status === 'error' && 'text-destructive',
                      persistenceSnapshot.status === 'error' && 'hover:bg-foreground/[0.04]',
                    )}
                    onClick={persistenceSnapshot.status === 'error' ? () => void persistence.retry() : undefined}
                    type="button"
                  >
                    {persistenceSnapshot.status === 'saving' ? <LoaderCircle className="animate-spin" /> : persistenceSnapshot.status === 'error' ? <CircleAlert /> : <Laptop />}
                    <span aria-live="polite" className="sr-only">{saveLabel}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>
                  {saveLabel}
                  {persistenceSnapshot.status === 'error' ? ` — ${t('header.retrySave')}` : null}
                  {savedAt && persistenceSnapshot.status !== 'error' && persistenceSnapshot.status !== 'saving' ? ` · ${t('header.lastSavedAt', { time: savedAt })}` : null}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </fieldset>

        <div className="mona-editor-header-center pointer-events-none w-full min-w-0 px-3 max-narrow:px-1">
          <Input
            aria-label={t('header.presentationTitle')}
            className="mona-editor-header-title-input pointer-events-auto h-7 w-full rounded-control border border-transparent bg-transparent px-2.5 text-center text-tiny! font-normal text-foreground/80 text-ellipsis shadow-none hover:border-input hover:bg-background focus-visible:border-input focus-visible:bg-background focus-visible:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/20 read-only:cursor-text md:text-tiny! placeholder:font-normal placeholder:text-muted-foreground placeholder:opacity-100"
            onBlur={commitTitle}
            onChange={event => setTitleValue(event.target.value)}
            onFocus={beginTitleEdit}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitTitle()
                event.currentTarget.blur()
              }
              else if (event.key === 'Escape') {
                event.preventDefault()
                cancelTitleEdit()
              }
            }}
            placeholder={t('header.untitledPresentation')}
            readOnly={!editingTitle}
            ref={titleInputRef}
            title={presentationTitle || t('header.untitledPresentation')}
            value={editingTitle ? titleValue : presentationTitle}
          />
        </div>

        <fieldset aria-label={t('header.presentationControls')} className="mona-editor-header-right m-0 flex min-w-0 items-center gap-1 border-0 p-0 justify-self-end max-narrow:gap-0">
          <Button
            aria-label={t('header.comments')}
            aria-pressed={taskPanelRoute === 'comments'}
            onClick={event => toggleTaskPanel('comments', event.currentTarget)}
            size="header-icon"
            title={t('header.comments')}
            variant="header-pill"
          ><MessageSquare className={cn(taskPanelRoute === 'comments' && 'text-editor-selection')} /></Button>
          <DropdownMenu onOpenChange={open => setMenuOpen('screen', open)} open={openPopover === 'screen'}>
            <div className="flex h-7 overflow-hidden rounded-action border border-border bg-background max-narrow:mx-0.5" role="group">
              <Button
                aria-label={t('header.startSlideshow')}
                className="h-full gap-1 rounded-none border-0 bg-transparent px-2 text-xs font-medium text-foreground/80 hover:bg-foreground/[0.04] hover:text-foreground max-narrow:px-1.5 max-compact:w-7 max-compact:px-0 max-compact:[&>span]:hidden [&_svg]:size-3.5"
                onClick={() => requestScreen(false)}
                size="sm"
                title={t('header.startSlideshow')}
                variant="ghost"
              ><MonitorPlay /><span>{t('header.present')}</span></Button>
              <DropdownMenuTrigger asChild>
                <Button aria-label={t('header.slideshowOptions')} className="h-full w-7 shrink-0 rounded-none border-y-0 border-r-0 border-l border-border bg-transparent p-0 text-foreground/80 hover:bg-foreground/[0.04] hover:text-foreground data-[state=open]:bg-foreground/[0.06] data-[state=open]:text-foreground [&_svg]:size-3.5" size="sm" variant="ghost"><ChevronDown /></Button>
              </DropdownMenuTrigger>
            </div>
            <DropdownMenuContent align="center" className="w-max rounded-overlay p-1 text-xs shadow-[0_10px_30px_rgb(15_23_42_/_13%),0_2px_8px_rgb(15_23_42_/_8%)]" sideOffset={8}>
              <HeaderMenuItem icon={<MonitorPlay />} label={t('header.fromBeginning')} onSelect={() => requestScreen(true)} shortcut="F5" />
              <HeaderMenuItem icon={<MonitorPlay />} label={t('header.fromCurrentSlide')} onSelect={() => requestScreen(false)} shortcut="⇧F5" />
              <HeaderMenuItem icon={<PanelsTopLeft />} label={t('screen.presenterView')} onSelect={() => requestScreen(false, { viewMode: 'presenter' })} />
              <HeaderMenuItem icon={<Play />} label={t('screen.autoPlay')} onSelect={() => requestScreen(false, { autoPlay: true })} />
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            aria-expanded={agentOpen}
            aria-label={t('header.generateWithAI')}
            aria-pressed={agentOpen}
            className="max-wide:w-7 max-wide:px-0 max-wide:[&>span]:hidden"
            onClick={() => {
              if (agentOpen) closeAgent()
              else openAgent()
              setOpenPopover(null)
            }}
            size="header-pill"
            title={t('header.generateWithAI')}
            variant="header-pill"
          ><Sparkles className={cn(agentOpen && 'text-editor-selection')} /><span>{t('header.ai')}</span></Button>
          <Popover onOpenChange={open => open ? requestExport() : closeExport()} open={exportType !== null}>
            <PopoverTrigger asChild>
              <Button
                aria-label={t('header.share')}
                className="max-wide:w-7 max-wide:px-0 max-wide:[&>span]:hidden"
                size="header-pill"
                title={t('header.share')}
                variant="header-pill"
              ><Share2 /><span>{t('header.share')}</span></Button>
            </PopoverTrigger>
            {exportType ? <Suspense fallback={null}><EditorExportFeature runtime={runtime} /></Suspense> : null}
          </Popover>
          <Popover onOpenChange={open => setMenuOpen('settings', open)} open={openPopover === 'settings'}>
            <PopoverTrigger asChild>
              <Button aria-label={t('header.settings')} size="header-icon" title={t('header.settings')} variant="header-pill"><Settings /></Button>
            </PopoverTrigger>
            <PopoverContent aria-label={t('header.settings')} align="end" className="w-68 rounded-overlay p-1 text-xs shadow-[0_10px_30px_rgb(15_23_42_/_13%),0_2px_8px_rgb(15_23_42_/_8%)]" sideOffset={8}>
              <div className="flex items-center gap-2 border-b border-border px-0.5 pt-0.5 pb-2 text-sm font-semibold"><Settings className="size-3.5" /><span>{t('header.settings')}</span></div>
              <div className="flex items-center gap-4 pt-2.5">
                <span className="flex-1 text-muted-foreground">{t('locale.language')}</span>
                <InspectorSelect
                  ariaLabel={t('locale.language')}
                  className="h-7 w-35 flex-none border-transparent hover:bg-muted"
                  icon={<Languages />}
                  onChange={locale => {
                    if (isSupportedLocale(locale)) void setLocale(locale)
                  }}
                  options={LOCALES.map(locale => ({ label: t(locale.labelKey), value: locale.code }))}
                  value={activeLocale}
                />
              </div>
            </PopoverContent>
          </Popover>
        </fieldset>
      </div>
      </header>

      <AlertDialog onOpenChange={open => {
        setResetDialogOpen(open)
        if (!open) requestAnimationFrame(() => fileMenuTriggerRef.current?.focus())
      }} open={resetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('header.newPresentationConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('header.newPresentationConfirmDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={resetPresentation} variant="destructive">{t('header.createNewPresentation')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <EditorHotkeyDrawer onClose={() => setHotkeysOpen(false)} open={hotkeysOpen} />
    </>
  )
}
