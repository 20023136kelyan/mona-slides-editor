import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowUp,
  Bot,
  ChartColumn,
  Check,
  ChevronDown,
  Gauge,
  Lock,
  Paperclip,
  PenLine,
  Search,
  Square,
  Wand2,
  X,
} from 'lucide-react'
import SlideAttachmentIcon from '~icons/fluent/slide-layout-20-regular'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from '@/components/ui/sidebar'
import { Textarea } from '@/components/ui/textarea'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import type { SketchAgentHandoff } from '@/features/editor/drawing/drawing-serialization'
import { useAgentChat } from '@/features/editor/agent/use-agent-chat'
import { agentModelStore, useAgentModelSelection } from '@/features/editor/agent/agent-model-store'
import { AgentProviderIcon } from '@/features/editor/agent/AgentProviderIcon'
import { effortLevelsFor, useAgentModels, type AgentModel } from '@/features/editor/agent/agent-model-catalog'
import { buildToolLabel, slideLabelFor } from '@/features/editor/agent/agent-tool-label'
import { refreshAgentAccount, useAgentAccount } from '@/features/editor/agent/agent-account'
import { useEditorApplication } from '@/features/editor/services/editor-application'
import { useEdgeFade } from '@/features/editor/use-edge-fade'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { EditorAgentSlashMenu } from '@/features/editor/EditorAgentSlashMenu'
import { matchSlashCommands, parseSlashCommand, type ParsedSlashCommand } from '@/features/editor/agent/agent-slash-commands'
import { EditorAgentActivity, EditorAgentMessage, messageHasLiveBlock } from '@/features/editor/EditorAgentMessage'
import { cn } from '@/lib/utils'

/** A user message's text, for the plain bubble the composer echoes back. */
const readMessageText = (message: { parts?: Array<{ text?: string; type?: string }> }): string => (
  (message.parts ?? []).filter(part => part.type === 'text').map(part => part.text ?? '').join('')
)

const SUGGESTION_ICONS = {
  improve: Wand2,
  rewrite: PenLine,
  visualize: ChartColumn,
} as const

type AgentModelOption = AgentModel


/**
 * The lane above the composer.
 *
 * The same keycap face as the header and composer controls, one size down
 * because it is secondary to the input beneath it. Shared rather than repeated
 * so the chip - a span wrapping its own remove button, so it cannot be a
 * `Button` variant - carries the identical treatment instead of a hand-copied
 * approximation. Every tone is mixed from `--foreground`/`--background`, so it
 * inverts in dark; the literal `rgb(15 23 42 / 8%)` these used before could not.
 */
const LANE_FACE = 'rounded-action border border-border bg-[color-mix(in_oklab,var(--foreground)_3%,var(--background))] shadow-[0_1px_2px_0_color-mix(in_oklab,var(--foreground)_12%,transparent)]'

/**
 * The face plus the lane's own height and type, for anything text-bearing.
 *
 * The size is an explicit length rather than the `text-tiny` token because `cn`
 * runs tailwind-merge, which does not know our custom sizes: it read `text-tiny`
 * as a text *colour*, so any colour merged in afterwards silently dropped it and
 * the chip inherited 16px from the document.
 */
const LANE_KEYCAP = `h-6.5 text-[11.5px] font-medium ${LANE_FACE}`

const LANE_KEYCAP_HOVER = 'hover:bg-[color-mix(in_oklab,var(--foreground)_6%,var(--background))] hover:text-foreground active:shadow-none'

const useObjectUrl = (blob: Blob | null | undefined) => {
  const url = useMemo(() => blob ? URL.createObjectURL(blob) : null, [blob])
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url)
  }, [url])
  return url
}

export function EditorAgentDock({ handoff = null, runtime }: {
  handoff?: SketchAgentHandoff | null
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const { closeAgent } = useEditorApplication()
  const selection = useAgentModelSelection()
  const account = useAgentAccount()
  const [draft, setDraft] = useState(() => (
    handoff ? t('foundation.editor.agent.sketchInstruction') : ''
  ))
  const [attachmentVisible, setAttachmentVisible] = useState(Boolean(handoff))
  // The host falls back to the plan's default when no model is chosen.
  const chat = useAgentChat({
    effort: selection.effort,
    model: selection.model ?? '',
    runtime,
  })
  const [providerOpen, setProviderOpen] = useState(false)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const [modelQuery, setModelQuery] = useState('')
  const [slashIndex, setSlashIndex] = useState(0)
  const endRef = useRef<HTMLDivElement>(null)
  const suggestionsRef = useRef<HTMLDivElement>(null)
  const slides = useEditorSelector(runtime.store, state => state.presentation.slides)
  const currentSlideId = useEditorSelector(runtime.store, state => state.presentation.slides[state.presentation.slideIndex]?.id)
  // The dock is scoped to slides, so the composer carries them as chips the
  // way an assistant carries attachments. It follows the current slide until
  // the user curates the set, then it stays where they put it.
  const [contextSlideIds, setContextSlideIds] = useState<string[]>(() => currentSlideId ? [currentSlideId] : [])
  const curatedRef = useRef(false)
  useEffect(() => {
    if (curatedRef.current || !currentSlideId) return
    setContextSlideIds([currentSlideId])
  }, [currentSlideId])
  const handoffUrl = useObjectUrl(handoff?.preview)
  const agentModels = useAgentModels()
  const activeModel = agentModels.find(model => model.id === selection.model) ?? agentModels[0]!
  const effortLevels = effortLevelsFor(activeModel)
  // A depth the newly chosen model does not accept must not linger, or the chip
  // would display one thing while the run used another.
  useEffect(() => {
    if (selection.effort && !effortLevels.includes(selection.effort)) agentModelStore.setEffort(undefined)
  }, [selection.effort, effortLevels])
  const providerReady = account.connected
  // The SDK reports the run: submitted before the first token, streaming after.
  const busy = chat.status === 'streaming' || chat.status === 'submitted'
  const runStartedAt = useMemo(() => busy ? Date.now() : null, [busy])
  // True when the newest assistant message already renders a running block, so
  // the standalone activity line stands down rather than doubling up on it.
  const lastMessage = chat.messages[chat.messages.length - 1]
  const liveBlockShowing = busy
    && lastMessage?.role === 'assistant'
    && messageHasLiveBlock(lastMessage)
  const slashMatches = matchSlashCommands(draft)
  useEdgeFade(suggestionsRef, 'x', chat.messages.length + Number(Boolean(handoff || busy)))

  // Ask once the dock opens rather than at module load, so a window that never
  // opens it does not spawn the binary to read a login it will not use.
  useEffect(() => {
    void refreshAgentAccount()
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [chat.messages, busy])

  useEffect(() => {
    const frame = requestAnimationFrame(() => composerRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (document.querySelector('[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"]')) {
        return
      }
      event.preventDefault()
      closeAgent()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [closeAgent])

  const activateModel = (model: AgentModelOption) => {
    agentModelStore.setModel(model.id)
    setProviderOpen(false)
  }

  // Until threads are persisted with their own titles, the chat is named after
  // what it was opened with — the first prompt.
  const firstPrompt = chat.messages.find(message => message.role === 'user')
    ? readMessageText(chat.messages.find(message => message.role === 'user')!).trim()
    : undefined
  const chatName = firstPrompt
    ? firstPrompt.length > 48 ? `${firstPrompt.slice(0, 48)}\u2026` : firstPrompt
    : t('foundation.editor.agent.newChat')

  const labelContext = { currentSlideId, slides, translate: t }

  const contextSlides = contextSlideIds
    .map(id => {
      const label = slideLabelFor(id, labelContext)
      return label ? { id, label } : null
    })
    .filter((slide): slide is { id: string; label: string } => slide !== null)

  const toolLabel = (name: string, input: unknown) => buildToolLabel(name, input, labelContext)

  const modelFilter = modelQuery.trim().toLocaleLowerCase()
  const visibleModels = agentModels.filter(model => (
    !modelFilter || model.name.toLocaleLowerCase().includes(modelFilter)
  ))

  // There is nothing to connect from here. The account is the machine's own
  // Claude login, so signing in happens in a terminal with `claude` - the dock
  // reports the state and says what to do rather than offering a button that
  // cannot work from inside a renderer.

  const runSlashCommand = (command: ParsedSlashCommand): string | null => {
    setDraft('')
    if (command.name === 'stop') {
      void chat.stop()
      return null
    }
    if (command.name === 'clear') {
      chat.setMessages([])
      return null
    }
    // `look` is a shorthand for asking, so it becomes a real prompt.
    return command.name === 'look' ? 'What is on this slide?' : null
  }

  const submit = () => {
    const instruction = draft.trim()
    if (!instruction || !providerReady) return
    const command = parseSlashCommand(instruction)
    const rewritten = command ? runSlashCommand(command) : null
    if (command && !rewritten) return
    setDraft('')
    setSlashIndex(0)
    // Sending during a run is steering: the SDK queues it onto the same
    // conversation rather than refusing, so nothing needs disabling.
    void chat.sendMessage({ text: rewritten ?? instruction })
  }



  return (
    <Sidebar aria-label={t('foundation.editor.agent.title')} className="mona-agent-dock w-[var(--dock-w)] shrink-0 overflow-hidden border-l border-sidebar-border" collapsible="none" id="mona-agent-dock" role="complementary" side="right">
      {/* The provider Popover wraps the whole dock: its content is portaled,
          and the trigger sits inside the composer, the way current assistant
          UIs place their model picker. The root renders no DOM node. */}
      <Popover
        onOpenChange={open => {
          setProviderOpen(open)
          if (!open) {
            setModelQuery('')
          }
        }}
        open={providerOpen}
      >
      {/* Slim chat header: a name and a quiet scope hint. */}
      <SidebarHeader className="flex min-h-11.5 flex-row items-center justify-between gap-3 px-4 pt-1.5 pb-0 [&_>button_svg]:size-4">
        {/* No close control: the header's AI button is the single toggle. */}
        {/* The dock is a chat, so it is named after the thread. Slide scope
            moved to the composer chips, where the user can change it. */}
        <h2 className="m-0 min-w-0 truncate text-control font-medium" id="mona-agent-dock-title" title={chatName}>{chatName}</h2>
      </SidebarHeader>
          <PopoverContent
            aria-label={t('foundation.editor.agent.chooseProvider')}
            align="start"
            className="w-[min(248px,calc(100vw-24px))] max-h-[min(70vh,460px)] gap-0 overflow-y-auto p-1.25"
            data-editor-interactive-overlay
            side="top"
            sideOffset={8}
          >
            <div className="-mx-1.25 -mt-1.25 mb-1 flex items-center gap-1.5 border-b border-border px-2.75 py-0.75">
              <Search className="size-3.25 shrink-0 text-muted-foreground" />
              <input
                aria-label={t('foundation.editor.agent.searchModels')}
                className="h-7 w-full border-0 bg-transparent p-0 text-[12.5px] text-foreground shadow-none outline-none placeholder:text-muted-foreground focus:shadow-none focus:outline-none focus-visible:shadow-none focus-visible:outline-none [&::-webkit-search-cancel-button]:appearance-none"
                onChange={event => setModelQuery(event.target.value)}
                placeholder={t('foundation.editor.agent.searchModels')}
                type="search"
                value={modelQuery}
              />
            </div>
            <div className="grid gap-px">
              {visibleModels.map(model => {
                const active = activeModel.id === model.id
                return (
                  <Button
                    aria-label={model.name}
                    className={cn(
                      'h-7.5 w-full justify-between gap-2.25 rounded-control px-2 text-left text-[12.5px] text-foreground hover:bg-ink-deep/6 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
                      active && 'bg-ink-deep/8 font-semibold [&_svg]:text-foreground',
                    )}
                    key={model.id}
                    onClick={() => activateModel(model)}
                    size="editor"
                    type="button"
                    variant="ghost"
                  >
                    <span className="inline-flex min-w-0 items-center gap-1.75 overflow-hidden text-ellipsis whitespace-nowrap">
                      <AgentProviderIcon className="size-3.5" />
                      {model.name}
                    </span>
                    {active ? <Check /> : null}
                  </Button>
                )
              })}
              {visibleModels.length ? null : (
                <p className="my-2.5 text-center text-xs text-muted-foreground">{t('foundation.editor.agent.noModels')}</p>
              )}
            </div>
            {/* The account, stated rather than actionable: signing in happens in a
                terminal with `claude`, so a button here would only mislead. */}
            <div className="-mx-1.25 -mb-1.25 mt-1 border-t border-border px-2.75 py-1.75">
              <span className="flex items-center gap-1.75 text-mini text-muted-foreground">
                <span className={cn(
                  'size-1.75 shrink-0 rounded-pill',
                  account.connected ? 'bg-[var(--success,#16a34a)]' : 'bg-muted-foreground/40',
                )} />
                <span className="min-w-0 truncate">
                  {account.connected
                    ? [account.accountLabel, account.planLabel].filter(Boolean).join(' \u00b7 ')
                    : t('foundation.editor.agent.signedOutHint')}
                </span>
              </span>
            </div>
          </PopoverContent>

      <SidebarContent>
        <div aria-live="polite" className="flex min-h-full flex-1 flex-col gap-2.5 px-4 py-3">
          {!chat.messages.length && !handoff ? (
            <div className="flex min-h-full flex-1 flex-col items-center justify-center px-2.5 py-7 text-center">
              <span className="mb-3.5 flex size-11 items-center justify-center rounded-action bg-ink-deep/6 text-ink/70 [&_svg]:size-5.5"><Bot /></span>
              <h3 className="m-0 text-field font-[750]">{t('foundation.editor.agent.emptyTitle')}</h3>
              <p className="mt-1.75 mb-0 max-w-72.5 text-xs leading-normal text-muted-foreground">{t('foundation.editor.agent.emptyDescription')}</p>
            </div>
          ) : null}

          {handoff && attachmentVisible && handoffUrl ? (
            <div className="m-0 grid gap-2.5 rounded-overlay border border-border bg-muted p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="grid gap-0.5">
                  <strong className="text-xs">{t('foundation.editor.agent.sketchAttached')}</strong>
                  <span className="text-mini text-muted-foreground">{t('foundation.editor.agent.sketchElements', {
                    count: handoff.scene.elements.filter(element => element.isDeleted !== true).length,
                  })}</span>
                </div>
                <Button aria-label={t('foundation.editor.agent.removeSketch')} onClick={() => setAttachmentVisible(false)} size="editor-icon" type="button" variant="ghost"><X /></Button>
              </div>
              <img alt={t('foundation.editor.agent.sketchPreview')} className="w-full rounded-surface border border-border bg-white object-contain" src={handoffUrl} />
            </div>
          ) : null}

          {/* The SDK owns the transcript, so it is rendered straight from
              chat.messages rather than mirrored into local state. */}
          {chat.messages.map((message, index) => (
            <div
              className={cn('flex max-w-full', message.role === 'user' && 'max-w-[88%] self-end')}
              key={message.id}
            >
              {message.role === 'user' ? (
                <p className="m-0 rounded-overlay bg-ink-deep/6 px-3 py-2 text-[12.5px] leading-[1.55] whitespace-pre-wrap">
                  {readMessageText(message)}
                </p>
              ) : (
                <EditorAgentMessage
                  message={message}
                  streaming={busy && index === chat.messages.length - 1}
                  toolLabel={toolLabel}
                />
              )}
            </div>
          ))}

          {chat.error ? (
            <p className="m-0 rounded-overlay bg-[color-mix(in_oklab,var(--destructive)_7%,var(--background))] px-3 py-2 text-[12.5px] text-destructive">
              {chat.error.message}
            </p>
          ) : null}

          {/* The agent is alive even when nothing is printing: between
              submitting and the first token, and between turns while the next
              call is in flight. Suppressed while a block is already showing its
              own live state, so only one thing is ever running on screen. */}
          {busy && !liveBlockShowing ? <EditorAgentActivity startedAt={runStartedAt} /> : null}

          <div ref={endRef} />
        </div>
      </SidebarContent>

      <SidebarFooter className="gap-0 px-4 pt-1 pb-2.5">
        <EditorAgentSlashMenu
          commands={slashMatches}
          onSelect={command => {
            setDraft(command.argument ? `/${command.name} ` : `/${command.name}`)
            composerRef.current?.focus()
          }}
          selected={slashIndex}
        />
        {/* Nested cards: a quiet outer tray carries the status strip, and the
            white input card sits inside it. The strip therefore reads as
            context attached to the composer rather than a bar ruled onto it. */}
        <div className="mona-agent-composer rounded-[calc(var(--radius-overlay)+10px)] border border-[color-mix(in_oklab,var(--foreground)_8%,transparent)] bg-ink-deep/[0.045] p-1.5 shadow-[inset_0_1px_0_0_rgb(255_255_255/70%),0_1px_2px_0_rgb(15_23_42/5%)]">
          {/* One strip, two jobs. Signed out: what to do about it, stated in
              place rather than behind a dialog. Signed in: the slides this
              prompt will act on, carried as chips like attachments. */}
          <div className="mona-agent-strip flex min-h-8 flex-wrap items-center gap-1.5 px-1.5 pt-0.5 pb-1.5">
            {!providerReady ? (
              <>
                <span className={cn(LANE_FACE, 'grid size-6.5 shrink-0 place-items-center text-muted-foreground [&_svg]:size-3.25')}>
                  {account.loading ? (
                    <span className="size-3 animate-spin rounded-full border-2 border-border border-t-foreground motion-reduce:animate-none" />
                  ) : <Lock />}
                </span>
                {/* No button: the login belongs to the machine, and a renderer
                    cannot perform it. Saying where it happens beats offering a
                    control that would do nothing. */}
                <span className="min-w-0 flex-1 text-mini leading-[1.35] text-muted-foreground">
                  {account.loading
                    ? t('foundation.editor.agent.checkingAccount')
                    : t('foundation.editor.agent.signedOutHint')}
                </span>
              </>
            ) : (
              <div aria-label={t('foundation.editor.agent.slideContext')} className="flex min-w-0 flex-wrap items-center gap-1.5" role="group">
                {contextSlides.map(slide => (
                  <span className={cn(LANE_KEYCAP, 'inline-flex max-w-45 items-center gap-1 pr-0.5 pl-1.5 text-foreground/85')} key={slide.id}>
                    {/* Names what the chip holds. Slides are the only attachment
                        today; a second kind would pick its own icon here. */}
                    <SlideAttachmentIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate">{slide.label}</span>
                    <Button
                      aria-label={t('foundation.editor.agent.removeSlideContext', { slide: slide.label })}
                      className="size-5 shrink-0 rounded-detail text-muted-foreground hover:bg-foreground/8 hover:text-foreground [&_svg]:size-2.75"
                      onClick={() => {
                        curatedRef.current = true
                        setContextSlideIds(current => current.filter(id => id !== slide.id))
                      }}
                      size="editor-icon"
                      type="button"
                      variant="ghost"
                    ><X /></Button>
                  </span>
                ))}
                {currentSlideId && !contextSlideIds.includes(currentSlideId) ? (
                  <Button
                    className={cn(LANE_KEYCAP, LANE_KEYCAP_HOVER, 'shrink-0 gap-1 px-2 text-muted-foreground [&_svg]:size-3')}
                    onClick={() => {
                      curatedRef.current = true
                      setContextSlideIds(current => [...current, currentSlideId])
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >+ {t('foundation.editor.agent.addCurrentSlide')}</Button>
                ) : null}
              </div>
            )}
          </div>
          <form
            className="overflow-hidden rounded-[calc(var(--radius-overlay)+6px)] bg-background shadow-[0_0_0_1px_rgb(15_23_42/4%),0_1px_1px_0_rgb(15_23_42/4%),0_4px_10px_-4px_rgb(15_23_42/10%)]"
            onSubmit={event => {
              event.preventDefault()
              submit()
            }}
          >
          <Textarea
            aria-label={t('foundation.editor.agent.composerLabel')}
            className="max-h-55 min-h-12.5 field-sizing-content resize-none overflow-y-auto rounded-none border-0 bg-transparent px-3 pt-3 pb-0.5 text-control leading-normal shadow-none focus-visible:border-0 focus-visible:shadow-none focus-visible:ring-0"
            onChange={event => {
              setDraft(event.target.value)
              setSlashIndex(0)
            }}
            onKeyDown={event => {
              if (slashMatches.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                event.preventDefault()
                setSlashIndex(current => {
                  const next = event.key === 'ArrowDown' ? current + 1 : current - 1
                  return (next + slashMatches.length) % slashMatches.length
                })
                return
              }
              if (slashMatches.length && event.key === 'Tab') {
                event.preventDefault()
                const chosen = slashMatches[slashIndex] ?? slashMatches[0]
                if (chosen) setDraft(chosen.argument ? `/${chosen.name} ` : `/${chosen.name}`)
                return
              }
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                submit()
              }
            }}
            placeholder={t('foundation.editor.agent.composerPlaceholder')}
            ref={composerRef}
            rows={2}
            value={draft}
          />
          <div className="flex min-h-11 items-center gap-1 px-1.5 pt-1 pb-1.5 [&_button_svg]:size-3.75">
            <PopoverTrigger asChild>
              <Button
                aria-label={t('foundation.editor.agent.chooseProvider')}
                // Matches the header's controls: `rounded-action` rather than a
                // full pill, and the same raised shadow that flattens on press.
                // Sized to its label rather than stretched - it used to carry
                // `flex-1` to fill a row that also held the mode and depth
                // chips, and once those went it had the whole row to itself.
                className="mr-auto min-w-0 max-w-full text-[12.5px] text-foreground [&_>svg]:size-3 [&_>svg]:shrink-0"
                size="header-pill"
                type="button"
                variant="header-pill"
              >
                <AgentProviderIcon className="size-3.5" />
                <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{activeModel.name}</span>
                <ChevronDown />
              </Button>
            </PopoverTrigger>
            {/* Reasoning depth, offered only where the model takes one. Haiku
                reports no levels, and sending it one would be rejected. */}
            {effortLevels.length ? (
              <Select onValueChange={agentModelStore.setEffort} value={selection.effort ?? 'high'}>
                <SelectTrigger
                  aria-label={t('foundation.editor.agent.thinkingLevel')}
                  // `size="sm"` rather than an h-7 class: the trigger sets its
                  // height through `data-[size=default]:h-8`, which is
                  // attribute-qualified and so outranks a plain utility.
                  size="sm"
                  className="w-auto shrink-0 gap-1 rounded-action border-border bg-[color-mix(in_oklab,var(--foreground)_3%,var(--background))] px-2 text-[12.5px] font-medium text-foreground/80 shadow-[0_1px_2px_0_color-mix(in_oklab,var(--foreground)_12%,transparent)] hover:text-foreground [&>svg]:size-3 [&_svg]:shrink-0"
                >
                  <Gauge className="size-3.5" />
                  <span>{t(`foundation.editor.agent.thinkingLevels.${selection.effort ?? 'high'}`)}</span>
                </SelectTrigger>
                <SelectContent position="popper">
                  {effortLevels.map(level => (
                    <SelectItem key={level} value={level}>
                      {t(`foundation.editor.agent.thinkingLevels.${level}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <Button
                aria-label={t('foundation.editor.agent.attach')}
                disabled={!handoff}
                onClick={() => setAttachmentVisible(current => !current)}
                size="action-icon"
                type="button"
                variant={attachmentVisible ? 'secondary' : 'ghost'}
              >
                <Paperclip />
              </Button>
              {busy ? (
                <Button
                  aria-label={t('foundation.editor.agent.cancel')}
                  onClick={() => {
                    void chat.stop()
                  }}
                  size="action-icon"
                  type="button"
                  variant="stop-pill"
                >
                  {/* A filled square rather than a stop glyph: on a red face the
                      solid shape reads at 10px where an outlined ring does not. */}
                  <Square className="size-2.5 fill-current stroke-none" />
                </Button>
              ) : null}
              {!busy || draft.trim() ? (
                <Button
                  aria-label={busy ? t('foundation.editor.agent.steer') : t('foundation.editor.agent.send')}
                  className="[&_svg]:stroke-[2.4]"
                  disabled={!draft.trim() || !providerReady}
                  size="action-icon"
                  type="submit"
                  variant="action-pill"
                ><ArrowUp /></Button>
              ) : null}
            </div>
          </div>
          </form>
        </div>
        {/* Prompt starters live under the input, the way current assistant
            UIs surface them — only while the thread is still empty. */}
        {!chat.messages.length && !handoff ? (
          <div className="mona-agent-suggestions mt-2 flex flex-nowrap items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" ref={suggestionsRef}>
            {(['improve', 'rewrite', 'visualize'] as const).map(suggestion => {
              const SuggestionIcon = SUGGESTION_ICONS[suggestion]
              return (
                <Button
                  className="h-7 shrink-0 gap-1.5 rounded-control border-0 bg-transparent px-2 text-xs font-medium whitespace-nowrap text-muted-foreground hover:bg-ink-deep/5 hover:text-foreground [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground"
                  key={suggestion}
                  onClick={() => {
                    setDraft(t(`foundation.editor.agent.suggestions.${suggestion}`))
                    requestAnimationFrame(() => composerRef.current?.focus())
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <SuggestionIcon />
                  <span>{t(`foundation.editor.agent.suggestions.${suggestion}`)}</span>
                </Button>
              )
            })}
          </div>
        ) : providerReady ? null : (
          // Only the connect prompt survives here. The notice that used to sit
          // opposite it described the old review-and-apply flow, which no longer
          // exists - the agent edits directly and one undo reverts the run.
          <p className="mt-1.75 mr-0.5 mb-0 ml-0.5 text-center text-mini leading-[1.4] text-muted-foreground">
            {t('foundation.editor.agent.connectionRequired')}
          </p>
        )}
      </SidebarFooter>
      </Popover>
    </Sidebar>
  )
}
