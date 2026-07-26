import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowUp,
  Bot,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleStop,
  Clipboard,
  ExternalLink,
  Gauge,
  KeyRound,
  Lock,
  LogIn,
  Paperclip,
  PenLine,
  Search,
  Square,
  Unplug,
  Wand2,
  X,
} from 'lucide-react'
import SlideAttachmentIcon from '~icons/fluent/slide-layout-20-regular'
import { MONA_AGENT_MODELS } from '@mona/agent-protocol'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  SelectValue,
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
import {
  agentProviderStore,
  useAgentProviderConfiguration,
} from '@/features/editor/agent/agent-provider-store'
import { AGENT_PROVIDER_IDS, type AgentProviderId } from '@/features/editor/agent/agent-types'
import { AgentProviderIcon } from '@/features/editor/agent/AgentProviderIcon'
import { effortLevelsFor, useAgentModels, type AgentModel } from '@/features/editor/agent/agent-model-catalog'
import { buildToolLabel, slideLabelFor } from '@/features/editor/agent/agent-tool-label'
import {
  answerAgentAuthPrompt,
  cancelAgentAuthFlow,
  connectAgentApiKey,
  connectAgentProvider,
  disconnectAgentProvider,
  refreshAgentAuthStatus,
  useAgentAuthStatus,
  type AgentAuthPrompt,
  type OAuthAgentProviderId,
} from '@/features/editor/agent/agent-auth-client'
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

const MODEL_PROVIDER_ORDER: readonly AgentProviderId[] = [
  'openai-chatgpt',
  'anthropic-claude',
  'google-ai-studio',
]


const useObjectUrl = (blob: Blob | null | undefined) => {
  const url = useMemo(() => blob ? URL.createObjectURL(blob) : null, [blob])
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url)
  }, [url])
  return url
}

function AgentAuthPromptForm({
  prompt,
  providerId,
}: {
  prompt: AgentAuthPrompt
  providerId: OAuthAgentProviderId
}) {
  const { t } = useTranslation()
  const [answer, setAnswer] = useState(() => (
    prompt.type === 'select' ? prompt.options?.[0]?.id ?? '' : ''
  ))
  const answerId = useId()

  return (
    <form
      className="grid gap-1.5 rounded-[var(--radius-md)] border border-border bg-muted p-2.25"
      onSubmit={event => {
        event.preventDefault()
        if (!answer.trim()) return
        void answerAgentAuthPrompt(providerId, prompt.id, answer).catch(() => undefined)
      }}
    >
      <Label className="text-mini leading-[1.35] text-muted-foreground" htmlFor={answerId}>{prompt.message}</Label>
      {prompt.type === 'select' ? (
        <Select onValueChange={setAnswer} value={answer}>
          <SelectTrigger aria-label={prompt.message} className="w-full bg-background text-tiny" id={answerId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {prompt.options?.map(option => (
              <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          autoComplete="off"
          id={answerId}
          onChange={event => setAnswer(event.target.value)}
          placeholder={prompt.placeholder || t('foundation.editor.agent.authPromptPlaceholder')}
          type={prompt.type === 'secret' ? 'password' : 'text'}
          value={answer}
        />
      )}
      <Button disabled={!answer.trim()} size="sm" type="submit">
        {t('foundation.editor.agent.continueSignIn')}
      </Button>
    </form>
  )
}

// The sign-in panel for one OAuth provider, reached by clicking a locked
// model. It subscribes to its own provider's status so both providers' model
// rows can reflect readiness at once.
function OAuthAuthPanel({ providerId }: { providerId: OAuthAgentProviderId }) {
  const { t } = useTranslation()
  const status = useAgentAuthStatus(providerId)
  useEffect(() => {
    void refreshAgentAuthStatus(providerId)
  }, [providerId])

  if (status.connected) {
    return (
      <div className="grid gap-2.25 [&_button]:w-full [&_button_svg]:size-3.25">
        <div className="flex items-center gap-2">
          <span className="size-1.75 shrink-0 rounded-pill bg-[var(--success,#16a34a)] opacity-100" />
          <span className="grid gap-px">
            <strong className="text-tiny">{status.accountLabel || t('foundation.editor.agent.connected')}</strong>
            <small className="m-0 text-mini leading-[1.4] text-muted-foreground">{status.planLabel || t('foundation.editor.agent.subscriptionReady')}</small>
          </span>
        </div>
        <Button disabled={status.loading} onClick={() => void disconnectAgentProvider(providerId)} size="sm" type="button" variant="outline">
          <Unplug />{t('foundation.editor.agent.disconnect')}
        </Button>
        <small className="m-0 text-mini leading-[1.4] text-muted-foreground">{t('foundation.editor.agent.oauthSecurityNotice')}</small>
      </div>
    )
  }
  return (
    <div className="grid gap-2.25 [&_button]:w-full [&_button_svg]:size-3.25">
      <p className="m-0 text-mini leading-[1.4] text-muted-foreground">{t(`foundation.editor.agent.providers.${providerId}.signInDescription`)}</p>
      <Button disabled={status.loading} onClick={() => void connectAgentProvider(providerId).catch(() => undefined)} size="sm" type="button">
        <LogIn />{status.loading
          ? t('foundation.editor.agent.connecting')
          : t(`foundation.editor.agent.providers.${providerId}.signIn`)}
      </Button>
      {status.flow?.deviceCode ? (
        <div className="grid gap-1.5 rounded-[var(--radius-md)] border border-border bg-muted p-2.25">
          <span className="text-mini leading-[1.35] text-muted-foreground">{t('foundation.editor.agent.deviceCodeLabel')}</span>
          <div className="flex items-center gap-1.5">
            <code className="flex-1 rounded-[var(--radius-sm)] bg-background px-2 py-1.75 text-center text-control font-bold tracking-[0.12em]">{status.flow.deviceCode.userCode}</code>
            <Button
              aria-label={t('foundation.editor.agent.copyDeviceCode')}
              className="size-7 min-w-7"
              onClick={() => void navigator.clipboard.writeText(status.flow?.deviceCode?.userCode ?? '')}
              size="editor-icon"
              type="button"
              variant="ghost"
            >
              <Clipboard />
            </Button>
          </div>
          <a
            className="inline-flex items-center justify-center gap-1.25 text-mini font-semibold text-foreground no-underline hover:underline [&_svg]:size-3"
            href={status.flow.deviceCode.verificationUri}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink />{t('foundation.editor.agent.openSignInPage')}
          </a>
        </div>
      ) : null}
      {status.flow?.prompt ? (
        <AgentAuthPromptForm key={status.flow.prompt.id} prompt={status.flow.prompt} providerId={providerId} />
      ) : null}
      {status.flow?.message ? <p className="m-0 text-mini leading-[1.4] text-muted-foreground">{status.flow.message}</p> : null}
      {status.flow?.status === 'pending' ? (
        <Button onClick={() => void cancelAgentAuthFlow(providerId)} size="sm" type="button" variant="ghost">
          <CircleStop />{t('common.cancel')}
        </Button>
      ) : null}
      {status.error ? <p className="m-0 text-mini leading-[1.4] text-destructive">{status.error}</p> : null}
      <small className="m-0 text-mini leading-[1.4] text-muted-foreground">{t('foundation.editor.agent.oauthSecurityNotice')}</small>
    </div>
  )
}

// Google's model needs a key rather than an OAuth round trip. The key stays
// in local state until Connect, so no partial provider switch leaks out.
function GeminiAuthPanel({ defaultModelId, onConnect }: {
  defaultModelId: string
  onConnect: (apiKey: string, modelId: string) => void
}) {
  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState('')
  const [modelId, setModelId] = useState(defaultModelId)
  const apiKeyId = useId()
  const geminiModels = MONA_AGENT_MODELS.filter(model => model.providerId === 'google-ai-studio')

  return (
    <form
      className="grid gap-2.5 [&_>div]:grid [&_>div]:gap-1.25 [&_label]:text-tiny"
      onSubmit={event => {
        event.preventDefault()
        if (apiKey.trim()) onConnect(apiKey.trim(), modelId)
      }}
    >
      <div>
        <Label htmlFor={apiKeyId}>{t('foundation.editor.agent.apiKey')}</Label>
        <div className="relative">
          <KeyRound className="pointer-events-none absolute top-1/2 left-2 z-[1] size-3.25 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoComplete="off"
            className="pl-6.75"
            id={apiKeyId}
            onChange={event => setApiKey(event.target.value)}
            placeholder={t('foundation.editor.agent.apiKeyPlaceholder')}
            type="password"
            value={apiKey}
          />
        </div>
      </div>
      <div>
        <Label>{t('foundation.editor.agent.model')}</Label>
        <Select onValueChange={value => value && setModelId(value)} value={modelId}>
          <SelectTrigger aria-label={t('foundation.editor.agent.model')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {geminiModels.map(model => <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Button disabled={!apiKey.trim()} size="sm" type="submit"><LogIn />{t('foundation.editor.agent.connectModel')}</Button>
      <p className="mt-[-2px] mr-px mb-0 ml-px text-mini leading-[1.4] text-muted-foreground">{t('foundation.editor.agent.keyMemoryNotice')}</p>
    </form>
  )
}

export function EditorAgentDock({ handoff = null, runtime }: {
  handoff?: SketchAgentHandoff | null
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const { closeAgent } = useEditorApplication()
  const configuration = useAgentProviderConfiguration()
  const [draft, setDraft] = useState(() => (
    handoff ? t('foundation.editor.agent.sketchInstruction') : ''
  ))
  const [attachmentVisible, setAttachmentVisible] = useState(Boolean(handoff))
  // Undefined leaves the SDK's own default rather than asserting a level.
  const [effort, setEffort] = useState<string | undefined>(undefined)
  // The server falls back to the provider's default when no model is chosen.
  const chat = useAgentChat({
    effort,
    model: configuration.model ?? '',
    runtime,
  })
  const [providerOpen, setProviderOpen] = useState(false)
  // The picker has two views: the model list (authView null) and a single
  // provider's sign-in panel, reached by clicking a locked model.
  const [authView, setAuthView] = useState<AgentProviderId | null>(null)
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
  const openaiStatus = useAgentAuthStatus('openai-chatgpt')
  const anthropicStatus = useAgentAuthStatus('anthropic-claude')
  const googleStatus = useAgentAuthStatus('google-ai-studio')
  const handoffUrl = useObjectUrl(handoff?.preview)
  // Whether each provider can run right now. A provider that isn't ready
  // shows its models grayed and routes a click to its sign-in panel.
  const providerReadiness: Record<AgentProviderId, boolean> = {
    'anthropic-claude': anthropicStatus.connected,
    'google-ai-studio': googleStatus.connected,
    'openai-chatgpt': openaiStatus.connected,
  }
  const agentModels = useAgentModels()
  const activeModel = agentModels.find(model => model.providerId === configuration.providerId && model.id === configuration.model)
    ?? agentModels.find(model => model.providerId === configuration.providerId)
    ?? agentModels[agentModels.length - 1]!
  const effortLevels = effortLevelsFor(activeModel)
  // A level that the newly chosen model does not accept must not linger, or the
  // chip would display one thing while the run used another.
  useEffect(() => {
    if (effort && !effortLevels.includes(effort)) setEffort(undefined)
  }, [effort, effortLevels])
  const providerReady = providerReadiness[configuration.providerId]
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

  // Ask every provider where it stands as soon as the dock opens. Without this
  // nothing fetches status until a sign-in panel is opened, so every model
  // renders locked even when the provider is ready - Anthropic in particular,
  // which authenticates from the machine's own Claude login and needs no panel.
  useEffect(() => {
    for (const providerId of AGENT_PROVIDER_IDS) void refreshAgentAuthStatus(providerId)
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
    agentProviderStore.setProvider(model.providerId)
    agentProviderStore.setModel(model.id)
    setAuthView(null)
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

  const activeAuthStatus = configuration.providerId === 'openai-chatgpt'
    ? openaiStatus
    : configuration.providerId === 'anthropic-claude' ? anthropicStatus : null
  // OAuth providers connect straight from the strip. A bring-your-own-key or
  // managed provider needs the panel, so the strip opens it rather than
  // pretending one click is enough.
  const connectActiveProvider = () => {
    const providerId = configuration.providerId
    if (providerId === 'openai-chatgpt' || providerId === 'anthropic-claude') {
      void connectAgentProvider(providerId).catch(() => undefined)
      return
    }
    setAuthView(providerId)
    setProviderOpen(true)
  }

  // Every model is selectable regardless of connection: the composer strip
  // carries the connect prompt and the send button stays disabled until the
  // chosen provider is ready. Picking a model is never a dead end.
  const selectModel = (model: AgentModelOption) => activateModel(model)

  // The key goes to the vault, not into the browser store: Google now runs
  // through the same server path as every other provider.
  const connectGemini = (apiKey: string, modelId: string) => {
    void connectAgentApiKey('google-ai-studio', apiKey)
      .then(() => {
        agentProviderStore.setProvider('google-ai-studio')
        agentProviderStore.setModel(modelId)
        setAuthView(null)
        setProviderOpen(false)
      })
      .catch(() => undefined)
  }

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
            setAuthView(null) // always reopen on the model list
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
            {authView ? (
              <div className="grid gap-2.5 p-1">
                <div className="flex items-center gap-1.5">
                  <Button
                    aria-label={t('foundation.editor.agent.back')}
                    className="size-6.5 [&_svg]:size-3.75"
                    onClick={() => setAuthView(null)}
                    size="editor-icon"
                    type="button"
                    variant="ghost"
                  ><ChevronLeft /></Button>
                  <strong className="text-control font-bold">{t(`foundation.editor.agent.providers.${authView}.name`)}</strong>
                </div>
                {authView === 'openai-chatgpt' || authView === 'anthropic-claude' ? (
                  <OAuthAuthPanel providerId={authView} />
                ) : null}
                {authView === 'google-ai-studio' ? (
                  <GeminiAuthPanel defaultModelId="gemini-3.6-flash" onConnect={connectGemini} />
                ) : null}
              </div>
            ) : (
              <>
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
                  {MODEL_PROVIDER_ORDER.map(providerId => {
                    const query = modelQuery.trim().toLocaleLowerCase()
                    const models = agentModels.filter(model => (
                      model.providerId === providerId && (!query || model.name.toLocaleLowerCase().includes(query))
                    ))
                    if (!models.length) return null
                    const ready = providerReadiness[providerId]
                    return (
                      <div className="grid gap-px not-first:mt-0.75" key={providerId}>
                        {/* No sign-in here: any model can be chosen, and the
                            composer strip handles connecting the one in use. */}
                        <div className="px-2 pt-1 pb-px text-mini font-semibold tracking-[0.02em] text-muted-foreground uppercase">
                          {t(`foundation.editor.agent.providers.${providerId}.name`)}
                        </div>
                        {models.map(model => {
                          const active = activeModel.id === model.id && configuration.providerId === model.providerId
                          return (
                            <Button
                              aria-label={ready ? model.name : t('foundation.editor.agent.modelLockedHint', { model: model.name })}
                              className={cn(
                                'h-7.5 w-full justify-between gap-2.25 rounded-control px-2 text-left text-[12.5px] text-foreground hover:bg-ink-deep/6 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
                                active && 'bg-ink-deep/8 font-semibold [&_svg]:text-foreground',
                                !ready && 'text-muted-foreground',
                              )}
                              key={model.id}
                              onClick={() => selectModel(model)}
                              size="editor"
                              type="button"
                              variant="ghost"
                            >
                              <span className="inline-flex min-w-0 items-center gap-1.75 overflow-hidden text-ellipsis whitespace-nowrap">
                                <AgentProviderIcon className="size-3.5" providerId={model.providerId} />
                                {model.name}
                              </span>
                              {active ? <Check /> : ready ? null : <Lock />}
                            </Button>
                          )
                        })}
                      </div>
                    )
                  })}
                  {agentModels.every(model => modelQuery.trim() && !model.name.toLocaleLowerCase().includes(modelQuery.trim().toLocaleLowerCase()))
                    ? <p className="my-2.5 text-center text-xs text-muted-foreground">{t('foundation.editor.agent.noModels')}</p>
                    : null}
                </div>
              </>
            )}
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
          {/* One strip, two jobs. Disconnected: the provider prompt, its device
              code and its spinner live here instead of behind a dialog, so the
              user never leaves the composer. Connected: the slides this prompt
              will act on, carried as chips like attachments. */}
          <div className="mona-agent-strip flex min-h-8 flex-wrap items-center gap-1.5 px-1.5 pt-0.5 pb-1.5">
            {!providerReady ? (
              <>
                <span className={cn(LANE_FACE, 'grid size-6.5 shrink-0 place-items-center text-muted-foreground [&_svg]:size-3.25')}>
                  {activeAuthStatus?.loading ? (
                    <span className="size-3 animate-spin rounded-full border-2 border-border border-t-foreground motion-reduce:animate-none" />
                  ) : <Lock />}
                </span>
                {activeAuthStatus?.flow?.deviceCode ? (
                  <>
                    <code className={cn(LANE_FACE, 'px-2 py-0.5 font-mono text-tiny tracking-[0.12em] tabular-nums')}>{activeAuthStatus.flow.deviceCode.userCode}</code>
                    <Button
                      aria-label={t('foundation.editor.agent.copyDeviceCode')}
                      className="size-6 shrink-0 [&_svg]:size-3.25"
                      onClick={() => void navigator.clipboard?.writeText(activeAuthStatus.flow!.deviceCode!.userCode).catch(() => undefined)}
                      size="editor-icon"
                      type="button"
                      variant="ghost"
                    ><Clipboard /></Button>
                  </>
                ) : null}
                <Button
                  className={cn(LANE_KEYCAP, LANE_KEYCAP_HOVER, 'ml-auto shrink-0 px-2.5 text-foreground/80')}
                  disabled={activeAuthStatus?.loading}
                  onClick={connectActiveProvider}
                  size="sm"
                  type="button"
                  variant="ghost"
                >{t('foundation.editor.agent.connectProvider', { provider: t(`foundation.editor.agent.providers.${configuration.providerId}.name`) })}</Button>
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
                <AgentProviderIcon className="size-3.5" providerId={activeModel.providerId} />
                <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{activeModel.name}</span>
                <ChevronDown />
              </Button>
            </PopoverTrigger>
            {/* Reasoning depth, offered only where the model takes one. Haiku
                reports no levels, and sending it one would be rejected. */}
            {effortLevels.length ? (
              <Select onValueChange={setEffort} value={effort ?? 'high'}>
                <SelectTrigger
                  aria-label={t('foundation.editor.agent.thinkingLevel')}
                  // `size="sm"` rather than an h-7 class: the trigger sets its
                  // height through `data-[size=default]:h-8`, which is
                  // attribute-qualified and so outranks a plain utility.
                  size="sm"
                  className="w-auto shrink-0 gap-1 rounded-action border-border bg-[color-mix(in_oklab,var(--foreground)_3%,var(--background))] px-2 text-[12.5px] font-medium text-foreground/80 shadow-[0_1px_2px_0_color-mix(in_oklab,var(--foreground)_12%,transparent)] hover:text-foreground [&>svg]:size-3 [&_svg]:shrink-0"
                >
                  <Gauge className="size-3.5" />
                  <span>{t(`foundation.editor.agent.thinkingLevels.${effort ?? 'high'}`)}</span>
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
