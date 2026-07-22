import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { editorActions, selectPresentation } from '@mona/editor-state'
import { createPresentationId } from '@mona/presentation-core'

import ClickIcon from '~icons/custom/click'
import FileJpgIcon from '~icons/custom/file-jpg'
import FilePptIcon from '~icons/custom/file-ppt'
import FilePptistIcon from '~icons/custom/file-pptist'
import CommandIcon from '~icons/icon-park-outline/command'
import CommentIcon from '~icons/icon-park-outline/comment'
import DownIcon from '~icons/icon-park-outline/down'
import DownloadIcon from '~icons/icon-park-outline/download'
import HamburgerIcon from '~icons/icon-park-outline/hamburger-button'
import HelpIcon from '~icons/icon-park-outline/helpcenter'
import MarkIcon from '~icons/icon-park-outline/mark'
import PptIcon from '~icons/icon-park-outline/ppt'
import RefreshIcon from '~icons/icon-park-outline/refresh'
import SettingIcon from '~icons/icon-park-outline/setting-two'
import SlideIcon from '~icons/icon-park-outline/slide-two'
import TranslateIcon from '~icons/icon-park-outline/translate'

import { EditorHotkeyDrawer } from '@/features/editor/EditorHotkeyDrawer'
import { InspectorSelect } from '@/features/editor/EditorInspectorPrimitives'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { LOCALES, isSupportedLocale, setLocale, type SupportedLocale } from '@/i18n'

type OpenPopover = 'main' | 'screen' | 'settings' | null

function HeaderDivider() {
  return <div className="mona-header-divider" />
}

function HeaderMenuItem({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return <div className="mona-header-popover-menu-item" onClick={onClick} onKeyDown={event => {
    if (event.key === 'Enter' || event.key === ' ') onClick() 
  }} role="menuitem" tabIndex={0}>{icon}<span className="mona-header-menu-label">{` ${label}`}</span></div>
}

export function EditorHeader({ runtime }: { runtime: EditorRuntime }) {
  const { i18n, t } = useTranslation()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const mainTriggerRef = useRef<HTMLButtonElement>(null)
  const screenTriggerRef = useRef<HTMLButtonElement>(null)
  const settingsTriggerRef = useRef<HTMLButtonElement>(null)
  const screenMenuRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [openPopover, setOpenPopover] = useState<OpenPopover>(null)
  const [popoverPosition, setPopoverPosition] = useState({ left: 0, top: 0 })
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState(presentation.title)
  const [hotkeysOpen, setHotkeysOpen] = useState(false)
  const resolvedLanguage = i18n.resolvedLanguage ?? ''
  const activeLocale: SupportedLocale = isSupportedLocale(resolvedLanguage) ? resolvedLanguage : 'en-US'

  useEffect(() => {
    if (!openPopover) return undefined
    const close = (event: MouseEvent) => {
      const target = event.target as Element
      if (target.closest('.mona-header-popover, .mona-editor-header-item, .mona-panel-select-popover')) return
      setOpenPopover(null)
    }
    document.addEventListener('mousedown', close)
    return () => {
      document.removeEventListener('mousedown', close)
    }
  }, [openPopover])

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.focus()
  }, [editingTitle])

  useLayoutEffect(() => {
    if (openPopover !== 'screen' || !screenMenuRef.current) return
    const width = Number.parseFloat(getComputedStyle(screenMenuRef.current).width)
    setPopoverPosition(position => ({ ...position, left: Math.round(position.left - (width / 2)) }))
  }, [openPopover])

  const togglePopover = (name: Exclude<OpenPopover, null>, trigger: HTMLElement, align: 'center' | 'end' | 'start', width: number) => {
    if (openPopover === name) {
      setOpenPopover(null)
      return
    }
    const rect = trigger.getBoundingClientRect()
    const left = align === 'start' ? rect.left : align === 'end' ? rect.right - width : rect.left + (rect.width / 2)
    setPopoverPosition({ left, top: Math.round(rect.bottom + 8) })
    setOpenPopover(name)
  }

  const commitTitle = () => {
    runtime.commit('Update presentation title', [{ type: 'presentation.title.set', title: titleValue, fallbackTitle: t('header.untitledPresentation') }], { recordHistory: false })
    setEditingTitle(false)
  }

  const resetSlides = () => {
    runtime.commit('Reset presentation', [
      {
        type: 'presentation.slides.replace',
        slides: [{
          id: createPresentationId(10),
          elements: [],
          background: { type: 'solid', color: presentation.theme.backgroundColor },
        }],
      },
      { type: 'slide.focus', index: 0 },
    ], { recordHistory: false })
    runtime.store.dispatch(editorActions.selectionChanged([]))
    setOpenPopover(null)
  }

  const requestAgent = () => {
    window.dispatchEvent(new CustomEvent('mona:agent-request'))
    setOpenPopover(null)
  }
  const requestScreen = (fromStart: boolean) => {
    window.dispatchEvent(new CustomEvent('mona:screening-request', { detail: { fromStart } }))
    setOpenPopover(null)
  }
  const requestExport = () => {
    window.dispatchEvent(new CustomEvent('mona:export-request', { detail: { type: 'pptx' } }))
    setOpenPopover(null)
  }
  const requestImport = (type: 'json' | 'pptist' | 'pptx', event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (files?.length) window.dispatchEvent(new CustomEvent('mona:import-request', { detail: { files, type } }))
    event.target.value = ''
    setOpenPopover(null)
  }
  const openLink = (url: string) => {
    window.open(url)
    setOpenPopover(null)
  }

  const mainMenu = openPopover === 'main' ? createPortal((
    <div className="mona-header-popover mona-editor-main-menu" role="menu" style={popoverPosition}>
      <div className="mona-header-ai-menu" onClick={requestAgent} onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') requestAgent() 
      }} role="menuitem" tabIndex={0}>
        <div className="mona-header-ai-icon"><ClickIcon /></div>
        <div className="mona-header-ai-content"><div className="mona-header-ai-title"><span>AIPPT</span></div><div className="mona-header-ai-subtitle">{t('header.aiSubtitle')}</div></div>
      </div>
      <HeaderDivider />
      <div className="mona-header-import-section">
        <div className="mona-header-import-label">{t('header.importFile')}</div>
        <div className="mona-header-import-grid">
          <label className="mona-header-import-block"><input accept="application/vnd.openxmlformats-officedocument.presentationml.presentation" onChange={event => requestImport('pptx', event)} type="file" /><span className="mona-header-import-icon"><FilePptIcon /></span><span className="mona-header-import-name">PPTX</span><span className="mona-header-import-sub">({t('header.testingOnly')})</span></label>
          <label className="mona-header-import-block"><input accept=".json" onChange={event => requestImport('json', event)} type="file" /><span className="mona-header-import-icon"><FileJpgIcon /></span><span className="mona-header-import-name">JSON</span><span className="mona-header-import-sub">({t('header.testingOnly')})</span></label>
          <label className="mona-header-import-block"><input accept=".pptist" onChange={event => requestImport('pptist', event)} type="file" /><span className="mona-header-import-icon"><FilePptistIcon /></span><span className="mona-header-import-name">PPTIST</span><span className="mona-header-import-sub">({t('header.nativeFormat')})</span></label>
        </div>
      </div>
      <HeaderDivider />
      <HeaderMenuItem icon={<DownloadIcon className="mona-header-popover-icon" />} label={t('header.exportFile')} onClick={requestExport} />
      <HeaderDivider />
      <HeaderMenuItem icon={<RefreshIcon className="mona-header-popover-icon" />} label={t('header.resetSlides')} onClick={resetSlides} />
      <HeaderMenuItem icon={<MarkIcon className="mona-header-popover-icon" />} label={t('header.markSlideTypes')} onClick={() => {
        runtime.store.dispatch(editorActions.panelVisibilityChanged({ open: true, panel: 'markup' })); setOpenPopover(null) 
      }} />
      <HeaderMenuItem icon={<CommandIcon className="mona-header-popover-icon" />} label={t('header.keyboardShortcuts')} onClick={() => {
        setOpenPopover(null); setHotkeysOpen(true) 
      }} />
      <HeaderMenuItem icon={<CommentIcon className="mona-header-popover-icon" />} label={t('header.feedback')} onClick={() => openLink('https://github.com/pipipi-pikachu/PPTist/issues')} />
      <HeaderMenuItem icon={<HelpIcon className="mona-header-popover-icon" />} label={t('header.faq')} onClick={() => openLink('https://github.com/pipipi-pikachu/PPTist/blob/master/doc/Q&A.md')} />
      <HeaderDivider />
      <div className="mona-header-statement">{t('header.demoNotice')}</div>
    </div>
  ), document.body) : null

  const screeningMenu = openPopover === 'screen' ? createPortal((
    <div className="mona-header-popover mona-header-screen-menu" ref={screenMenuRef} role="menu" style={popoverPosition}>
      <HeaderMenuItem icon={<SlideIcon className="mona-header-popover-icon" />} label={t('header.fromBeginning')} onClick={() => requestScreen(true)} />
      <HeaderMenuItem icon={<PptIcon className="mona-header-popover-icon" />} label={t('header.fromCurrentSlide')} onClick={() => requestScreen(false)} />
    </div>
  ), document.body) : null

  const settingsMenu = openPopover === 'settings' ? createPortal((
    <div className="mona-header-popover mona-header-settings-menu" style={popoverPosition}>
      <div className="mona-header-settings-title"><SettingIcon /><span>{t('header.settings')}</span></div>
      <div className="mona-header-settings-row">
        <span>{t('locale.language')}</span>
        <InspectorSelect
          ariaLabel={t('locale.language')}
          className="mona-header-locale-select"
          icon={<TranslateIcon />}
          onChange={locale => {
            if (isSupportedLocale(locale)) void setLocale(locale)
          }}
          options={LOCALES.map(locale => ({ label: t(locale.labelKey), value: locale.code }))}
          value={activeLocale}
        />
      </div>
    </div>
  ), document.body) : null

  return (
    <header className="mona-editor-header">
      <div className="mona-editor-header-left">
        <button aria-expanded={openPopover === 'main'} aria-haspopup="menu" aria-label="Menu" className="mona-editor-header-item" onClick={() => mainTriggerRef.current && togglePopover('main', mainTriggerRef.current, 'start', 0)} ref={mainTriggerRef} type="button"><HamburgerIcon className="mona-editor-header-icon" /></button>
        <div className="mona-editor-header-title">
          {editingTitle ? <input aria-label={t('header.untitledPresentation')} className="mona-editor-header-title-input" onBlur={commitTitle} onChange={event => setTitleValue(event.target.value)} ref={titleInputRef} value={titleValue} /> : <button className="mona-editor-header-title-text" onClick={() => {
            setTitleValue(presentation.title); setEditingTitle(true) 
          }} title={presentation.title} type="button">{presentation.title}</button>}
        </div>
      </div>
      <div className="mona-editor-header-right">
        <div className="mona-header-screen-group">
          <button aria-label={t('header.startSlideshow')} className="mona-editor-header-item mona-header-screen-main" onClick={() => requestScreen(false)} title={t('header.startSlideshow')} type="button"><PptIcon className="mona-editor-header-icon" /></button>
          <button aria-expanded={openPopover === 'screen'} aria-haspopup="menu" aria-label={t('header.startSlideshow')} className="mona-header-screen-arrow" onClick={() => screenTriggerRef.current && togglePopover('screen', screenTriggerRef.current, 'center', 0)} ref={screenTriggerRef} type="button"><DownIcon /></button>
        </div>
        <button aria-label={t('header.generateWithAI')} className="mona-editor-header-item" onClick={requestAgent} title={t('header.generateWithAI')} type="button"><span className="mona-header-ai-text">AI</span></button>
        <button aria-label={t('header.export')} className="mona-editor-header-item" onClick={requestExport} title={t('header.export')} type="button"><DownloadIcon className="mona-editor-header-icon" /></button>
        <button aria-expanded={openPopover === 'settings'} aria-haspopup="dialog" aria-label={t('header.settings')} className="mona-editor-header-item" onClick={() => settingsTriggerRef.current && togglePopover('settings', settingsTriggerRef.current, 'end', 272)} ref={settingsTriggerRef} title={t('header.settings')} type="button"><SettingIcon className="mona-editor-header-icon" /></button>
      </div>
      {mainMenu}{screeningMenu}{settingsMenu}
      <EditorHotkeyDrawer onClose={() => setHotkeysOpen(false)} open={hotkeysOpen} />
    </header>
  )
}
