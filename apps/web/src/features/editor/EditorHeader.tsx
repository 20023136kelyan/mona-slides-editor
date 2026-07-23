import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  ChevronDown,
  CircleAlert,
  Download,
  FileArchive,
  FileJson,
  FilePlus2,
  FileSliders,
  FileType2,
  Image,
  Languages,
  LoaderCircle,
  MessageSquare,
  MonitorPlay,
  Redo2,
  Search,
  Settings,
  Sparkles,
  Undo2,
} from 'lucide-react'

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
import { ButtonGroup } from '@/components/ui/button-group'
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
import { EditorHotkeyDrawer } from '@/features/editor/EditorHotkeyDrawer'
import { InspectorSelect } from '@/features/editor/EditorInspectorPrimitives'
import type { ExportDialogType } from '@/features/editor/EditorExportDialog'
import type { DeckPersistenceSnapshot } from '@/features/editor/editor-persistence'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorApplication } from '@/features/editor/services/editor-application'
import { useEditorShell } from '@/features/editor/shell/editor-shell'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { LOCALES, isSupportedLocale, setLocale, type SupportedLocale } from '@/i18n'
import { LEGACY_NATIVE_FILE_EXTENSION } from '@/lib/legacy-compatibility'

type OpenPopover = 'file' | 'view' | 'tools' | 'screen' | 'save' | 'settings' | null

const EMPTY_PERSISTENCE_SNAPSHOT: DeckPersistenceSnapshot = {
  dirty: false,
  error: null,
  pendingSince: null,
  savedAt: null,
  status: 'idle',
}
const subscribeToNothing = () => () => {}
const getEmptyPersistenceSnapshot = () => EMPTY_PERSISTENCE_SNAPSHOT

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
      className="mona-header-popover-menu-item"
      disabled={disabled}
      onSelect={onSelect}
      variant={variant}
    >
      {icon}
      <span className="mona-header-menu-label">{label}</span>
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
  onTriggerKeyDown,
  triggerRef,
}: {
  children: ReactNode
  label: string
  menu: Exclude<OpenPopover, null>
  open: OpenPopover
  onOpenChange: (menu: Exclude<OpenPopover, null>, open: boolean) => void
  onTriggerKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
  triggerRef?: Ref<HTMLButtonElement>
}) {
  return (
    <DropdownMenu onOpenChange={value => onOpenChange(menu, value)} open={open === menu}>
      <DropdownMenuTrigger asChild>
        <Button className="mona-header-menu-trigger" data-header-menu-trigger onKeyDown={onTriggerKeyDown} ref={triggerRef} size="editor" variant="ghost">{label}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="mona-header-popover mona-header-menu-content" sideOffset={6}>
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
    importFiles,
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
  const menuBarRef = useRef<HTMLElement>(null)
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
  const moveMenuFocus = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'End', 'Home'].includes(event.key)) return
    const current = event.currentTarget
    const triggers = Array.from(menuBarRef.current?.querySelectorAll<HTMLButtonElement>('[data-header-menu-trigger]') ?? [])
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

  const requestScreen = (fromStart: boolean) => {
    startPresentation({ fromStart })
    setOpenPopover(null)
  }

  const requestExport = (type: ExportDialogType = 'pptx') => {
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
        className="mona-skip-link"
        href="#mona-editor-canvas"
        onClick={event => {
          event.preventDefault()
          document.getElementById('mona-editor-canvas')?.focus()
        }}
      >{t('header.skipToCanvas')}</a>
      <header aria-label={t('header.editorHeader')} className="mona-editor-header">
        <fieldset aria-label={t('header.documentControls')} className="mona-editor-header-left">
          <div aria-label="Mona" className="mona-header-wordmark">
            <img alt="" aria-hidden="true" className="mona-header-logo" src="/favicon.svg" />
            <span>Mona</span>
          </div>
          <nav aria-label={t('header.menuBar')} className="mona-header-menubar" ref={menuBarRef}>
            <input accept="application/vnd.openxmlformats-officedocument.presentationml.presentation" aria-label={t('header.importPptx')} className="mona-visually-hidden" onChange={event => requestImport('pptx', event)} ref={pptxInputRef} type="file" />
            <input accept=".json" aria-label={t('header.importJson')} className="mona-visually-hidden" onChange={event => requestImport('json', event)} ref={jsonInputRef} type="file" />
            <input accept={`.mona,${LEGACY_NATIVE_FILE_EXTENSION}`} aria-label={t('header.importNative')} className="mona-visually-hidden" onChange={event => requestImport('native', event)} ref={nativeInputRef} type="file" />
            <HeaderMenu label={t('header.menuFile')} menu="file" onOpenChange={setMenuOpen} onTriggerKeyDown={moveMenuFocus} open={openPopover} triggerRef={fileMenuTriggerRef}>
              <HeaderMenuItem icon={<FilePlus2 />} label={t('header.newPresentation')} onSelect={() => setResetDialogOpen(true)} />
              <DropdownMenuSeparator className="mona-header-divider" />
              <HeaderMenuItem icon={<FileType2 />} label={t('header.importPptx')} onSelect={() => pptxInputRef.current?.click()} />
              <HeaderMenuItem icon={<FileArchive />} label={t('header.importNative')} onSelect={() => nativeInputRef.current?.click()} />
              <HeaderMenuItem icon={<FileJson />} label={t('header.importJson')} onSelect={() => jsonInputRef.current?.click()} />
              <DropdownMenuSeparator className="mona-header-divider" />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="mona-header-popover-menu-item">
                  <Download />
                  <span className="mona-header-menu-label">{t('header.exportFile')}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="mona-header-popover mona-header-export-submenu">
                  <HeaderMenuItem icon={<FileSliders />} label={t('header.exportPptx')} onSelect={() => requestExport('pptx')} />
                  <HeaderMenuItem icon={<FileType2 />} label={t('header.exportPdf')} onSelect={() => requestExport('pdf')} />
                  <HeaderMenuItem icon={<Image />} label={t('header.exportImage')} onSelect={() => requestExport('image')} />
                  <HeaderMenuItem icon={<FileArchive />} label={t('header.exportNative')} onSelect={() => requestExport('native')} />
                  <HeaderMenuItem icon={<FileJson />} label={t('header.exportJson')} onSelect={() => requestExport('json')} />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </HeaderMenu>
            <HeaderMenu label={t('header.menuView')} menu="view" onOpenChange={setMenuOpen} onTriggerKeyDown={moveMenuFocus} open={openPopover}>
              <HeaderMenuItem icon={<MessageSquare />} label={t('foundation.editor.canvasTool.comments')} onSelect={() => openTaskPanel('comments')} />
              <HeaderMenuItem icon={<FileSliders />} label={t('foundation.editor.canvasTool.selectionPane')} onSelect={() => openTaskPanel('layers')} />
              <DropdownMenuSeparator className="mona-header-divider" />
              <HeaderMenuItem icon={<MonitorPlay />} label={t('header.fromBeginning')} onSelect={() => requestScreen(true)} shortcut="F5" />
              <HeaderMenuItem icon={<MonitorPlay />} label={t('header.fromCurrentSlide')} onSelect={() => requestScreen(false)} shortcut="⇧F5" />
            </HeaderMenu>
            <HeaderMenu label={t('header.menuTools')} menu="tools" onOpenChange={setMenuOpen} onTriggerKeyDown={moveMenuFocus} open={openPopover}>
              <HeaderMenuItem icon={<Search />} label={t('foundation.editor.canvasTool.findReplace')} onSelect={() => openTaskPanel('search')} shortcut="⌃F" />
              <HeaderMenuItem icon={<FileSliders />} label={t('header.markSlideTypes')} onSelect={() => openTaskPanel('semantics')} />
              <DropdownMenuSeparator className="mona-header-divider" />
              <HeaderMenuItem icon={<Settings />} label={t('header.keyboardShortcuts')} onSelect={() => {
                setOpenPopover(null)
                setHotkeysOpen(true)
              }} />
            </HeaderMenu>
          </nav>
          <div aria-hidden="true" className="mona-header-divider-bar" />
          <Button aria-label={t('foundation.editor.canvasTool.undo')} className="mona-editor-header-item" disabled={historyCursor <= 0} onClick={() => runtime.undo()} size="editor-icon" title={t('foundation.editor.canvasTool.undo')} variant="ghost"><Undo2 className="mona-editor-header-icon" /></Button>
          <Button aria-label={t('foundation.editor.canvasTool.redo')} className="mona-editor-header-item" disabled={historyCursor >= historyLength - 1} onClick={() => runtime.redo()} size="editor-icon" title={t('foundation.editor.canvasTool.redo')} variant="ghost"><Redo2 className="mona-editor-header-icon" /></Button>
          {persistence ? <Popover onOpenChange={open => setMenuOpen('save', open)} open={openPopover === 'save'}>
            <PopoverTrigger asChild>
              <Button
                aria-label={saveLabel}
                className={`mona-header-save-status is-${persistenceSnapshot.status}`}
                size="sm"
                variant="ghost"
              >
                {persistenceSnapshot.status === 'saving' ? <LoaderCircle className="animate-spin" /> : persistenceSnapshot.status === 'error' ? <CircleAlert /> : <Check />}
                <span aria-live="polite">{saveLabel}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="mona-header-popover mona-save-status-popover" sideOffset={8}>
              <div className="mona-save-status-title">{saveLabel}</div>
              <p>{persistenceSnapshot.status === 'error' ? persistenceSnapshot.error : t('header.localSaveDescription')}</p>
              {savedAt ? <p>{t('header.lastSavedAt', { time: savedAt })}</p> : null}
              {persistenceSnapshot.status === 'error' ? (
                <Button onClick={() => void persistence.retry()} size="sm" variant="outline">{t('header.retrySave')}</Button>
              ) : null}
            </PopoverContent>
          </Popover> : null}
        </fieldset>

        <div className="mona-editor-header-center">
          <Input
            aria-label={t('header.presentationTitle')}
            className="mona-editor-header-title-input"
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

        <fieldset aria-label={t('header.presentationControls')} className="mona-editor-header-right">
          <Button
            aria-label={t('header.comments')}
            aria-pressed={taskPanelRoute === 'comments'}
            className={`mona-editor-header-item${taskPanelRoute === 'comments' ? ' is-active' : ''}`}
            onClick={event => toggleTaskPanel('comments', event.currentTarget)}
            size="editor-icon"
            title={t('header.comments')}
            variant="ghost"
          ><MessageSquare className="mona-editor-header-icon" /></Button>
          <DropdownMenu onOpenChange={open => setMenuOpen('screen', open)} open={openPopover === 'screen'}>
            <ButtonGroup className="mona-header-screen-group">
              <Button aria-label={t('header.startSlideshow')} className="mona-present-main" onClick={() => requestScreen(false)} size="sm" title={t('header.startSlideshow')} variant="ghost"><MonitorPlay /><span>{t('header.present')}</span></Button>
              <DropdownMenuTrigger asChild>
                <Button aria-label={t('header.slideshowOptions')} className="mona-present-arrow" size="sm" variant="ghost"><ChevronDown /></Button>
              </DropdownMenuTrigger>
            </ButtonGroup>
            <DropdownMenuContent align="center" className="mona-header-popover mona-header-screen-menu" sideOffset={8}>
              <HeaderMenuItem icon={<MonitorPlay />} label={t('header.fromBeginning')} onSelect={() => requestScreen(true)} shortcut="F5" />
              <HeaderMenuItem icon={<MonitorPlay />} label={t('header.fromCurrentSlide')} onSelect={() => requestScreen(false)} shortcut="⇧F5" />
            </DropdownMenuContent>
          </DropdownMenu>
          <Button aria-expanded={agentOpen} aria-label={t('header.generateWithAI')} className={`mona-editor-header-item mona-header-ai-button${agentOpen ? ' is-active' : ''}`} onClick={() => {
            if (agentOpen) closeAgent()
            else openAgent()
            setOpenPopover(null)
          }} size="editor" title={t('header.generateWithAI')} variant="ghost"><Sparkles /><span>{t('header.ai')}</span></Button>
          <Button aria-label={t('header.export')} className="mona-header-export-button" onClick={() => requestExport('pptx')} size="sm" title={t('header.export')} variant="default"><Download /><span>{t('header.export')}</span></Button>
          <Popover onOpenChange={open => setMenuOpen('settings', open)} open={openPopover === 'settings'}>
            <PopoverTrigger asChild>
              <Button aria-label={t('header.settings')} className="mona-editor-header-item" size="editor-icon" title={t('header.settings')} variant="ghost"><Settings className="mona-editor-header-icon" /></Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="mona-header-popover mona-header-settings-menu" sideOffset={8}>
              <div className="mona-header-settings-title"><Settings /><span>{t('header.settings')}</span></div>
              <div className="mona-header-settings-row">
                <span>{t('locale.language')}</span>
                <InspectorSelect
                  ariaLabel={t('locale.language')}
                  className="mona-header-locale-select"
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
