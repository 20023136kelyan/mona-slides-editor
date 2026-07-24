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
  Code2,
  ExternalLink,
  KeyRound,
  Lock,
  LogIn,
  Paperclip,
  PenLine,
  RotateCcw,
  Search,
  Sparkles,
  Unplug,
  Wand2,
  X,
} from 'lucide-react'
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
import {
  applyAgentCandidate,
  generateAgentCandidate,
  type AgentProgressStage,
} from '@/features/editor/agent/agent-service'
import {
  agentProviderStore,
  useAgentProviderConfiguration,
} from '@/features/editor/agent/agent-provider-store'
import { referenceAgentEnabled } from '@/features/editor/agent/agent-runtime-mode'
import type { AgentCandidate, AgentProviderId } from '@/features/editor/agent/agent-types'
import {
  answerAgentAuthPrompt,
  cancelAgentAuthFlow,
  connectAgentProvider,
  disconnectAgentProvider,
  refreshAgentAuthStatus,
  useAgentAuthStatus,
  type AgentAuthPrompt,
  type OAuthAgentProviderId,
} from '@/features/editor/agent/agent-auth-client'
import { useManagedAgentStatus } from '@/features/editor/agent/managed-agent-status'
import { useEditorApplication } from '@/features/editor/services/editor-application'
import { useEdgeFade } from '@/features/editor/use-edge-fade'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { cn } from '@/lib/utils'

interface ConversationEntry {
  id: number
  role: 'agent' | 'error' | 'user'
  text: string
}

const SUGGESTION_ICONS = {
  improve: Wand2,
  rewrite: PenLine,
  visualize: ChartColumn,
} as const

interface AgentModelOption {
  badge?: 'max'
  id: string
  name: string
  providerId: AgentProviderId
}

// Models the picker offers, grouped by the provider that serves them. The
// name is a brand proper noun (not translated); the provider group label and
// its lock/sign-in copy come from the catalogs.
const AGENT_MODELS: readonly AgentModelOption[] = [
  ...MONA_AGENT_MODELS,
  ...(referenceAgentEnabled ? [{ id: 'reference', name: 'Reference engine', providerId: 'reference' } satisfies AgentModelOption] : []),
]

const MODEL_PROVIDER_ORDER: readonly AgentProviderId[] = [
  'openai-chatgpt',
  'anthropic-claude',
  'google-ai-studio',
  'mona-managed',
  ...(referenceAgentEnabled ? ['reference' as const] : []),
]

const modelBadgeClass = 'inline-flex items-center rounded-[var(--radius-detail)] border border-border bg-[linear-gradient(90deg,rgb(129_161_193),rgb(125_124_155))] bg-clip-text px-1 text-[8.5px] font-extrabold tracking-[0.04em] text-transparent'

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
      className="grid gap-1.5 rounded-[var(--radius-md)] border border-border bg-muted p-[9px]"
      onSubmit={event => {
        event.preventDefault()
        if (!answer.trim()) return
        void answerAgentAuthPrompt(providerId, prompt.id, answer).catch(() => undefined)
      }}
    >
      <Label className="text-[10px] leading-[1.35] text-muted-foreground" htmlFor={answerId}>{prompt.message}</Label>
      {prompt.type === 'select' ? (
        <Select onValueChange={setAnswer} value={answer}>
          <SelectTrigger aria-label={prompt.message} className="w-full bg-background text-[11px]" id={answerId}>
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
      <div className="grid gap-[9px] [&_button]:w-full [&_button_svg]:size-[13px]">
        <div className="flex items-center gap-2">
          <span className="size-[7px] shrink-0 rounded-[var(--radius-pill)] bg-[var(--success,#16a34a)] opacity-100" />
          <span className="grid gap-px">
            <strong className="text-[11px]">{status.accountLabel || t('foundation.editor.agent.connected')}</strong>
            <small className="m-0 text-[10px] leading-[1.4] text-muted-foreground">{status.planLabel || t('foundation.editor.agent.subscriptionReady')}</small>
          </span>
        </div>
        <Button disabled={status.loading} onClick={() => void disconnectAgentProvider(providerId)} size="sm" type="button" variant="outline">
          <Unplug />{t('foundation.editor.agent.disconnect')}
        </Button>
        <small className="m-0 text-[10px] leading-[1.4] text-muted-foreground">{t('foundation.editor.agent.oauthSecurityNotice')}</small>
      </div>
    )
  }
  return (
    <div className="grid gap-[9px] [&_button]:w-full [&_button_svg]:size-[13px]">
      <p className="m-0 text-[10px] leading-[1.4] text-muted-foreground">{t(`foundation.editor.agent.providers.${providerId}.signInDescription`)}</p>
      <Button disabled={status.loading} onClick={() => void connectAgentProvider(providerId).catch(() => undefined)} size="sm" type="button">
        <LogIn />{status.loading
          ? t('foundation.editor.agent.connecting')
          : t(`foundation.editor.agent.providers.${providerId}.signIn`)}
      </Button>
      {status.flow?.deviceCode ? (
        <div className="grid gap-1.5 rounded-[var(--radius-md)] border border-border bg-muted p-[9px]">
          <span className="text-[10px] leading-[1.35] text-muted-foreground">{t('foundation.editor.agent.deviceCodeLabel')}</span>
          <div className="flex items-center gap-1.5">
            <code className="flex-1 rounded-[var(--radius-sm)] bg-background px-2 py-[7px] text-center text-[13px] font-bold tracking-[0.12em]">{status.flow.deviceCode.userCode}</code>
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
            className="inline-flex items-center justify-center gap-[5px] text-[10px] font-semibold text-foreground no-underline hover:underline [&_svg]:size-3"
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
      {status.flow?.message ? <p className="m-0 text-[10px] leading-[1.4] text-muted-foreground">{status.flow.message}</p> : null}
      {status.flow?.status === 'pending' ? (
        <Button onClick={() => void cancelAgentAuthFlow(providerId)} size="sm" type="button" variant="ghost">
          <CircleStop />{t('common.cancel')}
        </Button>
      ) : null}
      {status.error ? <p className="m-0 text-[10px] leading-[1.4] text-destructive">{status.error}</p> : null}
      <small className="m-0 text-[10px] leading-[1.4] text-muted-foreground">{t('foundation.editor.agent.oauthSecurityNotice')}</small>
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
  const geminiModels = AGENT_MODELS.filter(model => model.providerId === 'google-ai-studio')

  return (
    <form
      className="grid gap-2.5 [&_>div]:grid [&_>div]:gap-[5px] [&_label]:text-[11px]"
      onSubmit={event => {
        event.preventDefault()
        if (apiKey.trim()) onConnect(apiKey.trim(), modelId)
      }}
    >
      <div>
        <Label htmlFor={apiKeyId}>{t('foundation.editor.agent.apiKey')}</Label>
        <div className="relative">
          <KeyRound className="pointer-events-none absolute top-1/2 left-2 z-[1] size-[13px] -translate-y-1/2 text-muted-foreground" />
          <Input
            autoComplete="off"
            className="pl-[27px]"
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
      <p className="mt-[-2px] mr-px mb-0 ml-px text-[10px] leading-[1.4] text-muted-foreground">{t('foundation.editor.agent.keyMemoryNotice')}</p>
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
  const [entries, setEntries] = useState<ConversationEntry[]>([])
  const [candidate, setCandidate] = useState<AgentCandidate | null>(null)
  const [appliedCandidate, setAppliedCandidate] = useState<AgentCandidate | null>(null)
  const [progress, setProgress] = useState<AgentProgressStage | null>(null)
  const [providerOpen, setProviderOpen] = useState(false)
  // The picker has two views: the model list (authView null) and a single
  // provider's sign-in panel (authView set), reached by clicking a locked
  // model or its group's Sign in shortcut.
  const [authView, setAuthView] = useState<AgentProviderId | null>(null)
  const [modelQuery, setModelQuery] = useState('')
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const entryIdRef = useRef(0)
  const endRef = useRef<HTMLDivElement>(null)
  const suggestionsRef = useRef<HTMLDivElement>(null)
  const slideTitle = useEditorSelector(runtime.store, state => state.presentation.slides[state.presentation.slideIndex]?.title)
  const openaiStatus = useAgentAuthStatus('openai-chatgpt')
  const anthropicStatus = useAgentAuthStatus('anthropic-claude')
  const managedStatus = useManagedAgentStatus()
  const handoffUrl = useObjectUrl(handoff?.preview)
  const beforeUrl = useObjectUrl(candidate?.beforePreview)
  const afterUrl = useObjectUrl(candidate?.afterPreview)
  // Whether each provider can run right now. A provider that isn't ready
  // shows its models grayed and routes a click to its sign-in panel.
  const providerReadiness: Record<AgentProviderId, boolean> = {
    'anthropic-claude': anthropicStatus.connected,
    'google-ai-studio': configuration.providerId === 'google-ai-studio' && Boolean(configuration.apiKey?.trim()),
    'mona-managed': managedStatus.available,
    'openai-chatgpt': openaiStatus.connected,
    reference: referenceAgentEnabled,
  }
  const activeModel = AGENT_MODELS.find(model => model.providerId === configuration.providerId && model.id === configuration.model)
    ?? AGENT_MODELS.find(model => model.providerId === configuration.providerId)
    ?? AGENT_MODELS[AGENT_MODELS.length - 1]!
  const providerReady = providerReadiness[configuration.providerId]
  const busy = progress !== null
  useEdgeFade(suggestionsRef, 'x', entries.length + Number(Boolean(candidate || handoff || progress)))

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [candidate, entries, progress])

  useEffect(() => () => abortRef.current?.abort(), [])

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

  const appendEntry = (role: ConversationEntry['role'], text: string) => {
    setEntries(current => [...current, { id: ++entryIdRef.current, role, text }])
  }

  const selectModel = (model: AgentModelOption) => {
    if (providerReadiness[model.providerId]) activateModel(model)
    else setAuthView(model.providerId) // locked → this provider's sign-in
  }

  const connectGemini = (apiKey: string, modelId: string) => {
    agentProviderStore.setProvider('google-ai-studio')
    agentProviderStore.setApiKey(apiKey)
    agentProviderStore.setModel(modelId)
    setAuthView(null)
    setProviderOpen(false)
  }

  const submit = async () => {
    const instruction = draft.trim()
    if (!instruction || busy || !providerReady) return
    const controller = new AbortController()
    abortRef.current = controller
    setCandidate(null)
    setAppliedCandidate(null)
    appendEntry('user', instruction)
    setDraft('')
    try {
      const next = await generateAgentCandidate({
        configuration,
        handoff: attachmentVisible ? handoff : null,
        instruction,
        onProgress: setProgress,
        runtime,
        signal: controller.signal,
      })
      setCandidate(next)
      setAttachmentVisible(false)
    }
    catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        appendEntry('agent', t('foundation.editor.agent.cancelled'))
      }
      else {
        appendEntry('error', error instanceof Error ? error.message : t('foundation.editor.agent.failed'))
      }
    }
    finally {
      abortRef.current = null
      setProgress(null)
    }
  }

  const applyCandidate = () => {
    if (!candidate) return
    const result = applyAgentCandidate(runtime, candidate)
    if (!result.ok) {
      appendEntry('error', result.message)
      if (result.reason === 'stale') setCandidate(null)
      return
    }
    appendEntry('agent', t('foundation.editor.agent.applied'))
    setAppliedCandidate(candidate)
    setCandidate(null)
  }

  const undoApplied = () => {
    if (!appliedCandidate || !runtime.undo()) return
    appendEntry('agent', t('foundation.editor.agent.undone'))
    setAppliedCandidate(null)
  }

  return (
    <Sidebar aria-labelledby="mona-agent-dock-title" className="mona-agent-dock w-[var(--dock-w)] shrink-0 overflow-hidden border-l border-sidebar-border" collapsible="none" id="mona-agent-dock" role="complementary" side="right">
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
      <SidebarHeader className="flex min-h-[46px] flex-row items-center justify-between gap-3 pt-1.5 pr-2 pb-0 pl-4 [&_>button_svg]:size-4">
        <h2 className="m-0 min-w-0 truncate text-[13px] font-medium" id="mona-agent-dock-title" title={slideTitle || t('foundation.editor.statusBar.untitledPage')}>{slideTitle || t('foundation.editor.statusBar.untitledPage')}</h2>
        <Button aria-label={t('common.close')} onClick={closeAgent} size="editor-icon" type="button" variant="ghost"><X /></Button>
      </SidebarHeader>
          <PopoverContent
            aria-label={t('foundation.editor.agent.chooseProvider')}
            align="start"
            className="w-[min(248px,calc(100vw-24px))] max-h-[min(70vh,460px)] gap-0 overflow-y-auto p-[5px]"
            data-editor-interactive-overlay
            side="top"
            sideOffset={8}
          >
            {authView ? (
              <div className="grid gap-2.5 p-1">
                <div className="flex items-center gap-1.5">
                  <Button
                    aria-label={t('foundation.editor.agent.back')}
                    className="size-[26px] [&_svg]:size-[15px]"
                    onClick={() => setAuthView(null)}
                    size="editor-icon"
                    type="button"
                    variant="ghost"
                  ><ChevronLeft /></Button>
                  <strong className="text-[13px] font-bold">{t(`foundation.editor.agent.providers.${authView}.name`)}</strong>
                </div>
                {authView === 'openai-chatgpt' || authView === 'anthropic-claude' ? (
                  <OAuthAuthPanel providerId={authView} />
                ) : null}
                {authView === 'google-ai-studio' ? (
                  <GeminiAuthPanel defaultModelId="gemini-3.6-flash" onConnect={connectGemini} />
                ) : null}
                {authView === 'mona-managed' ? (
                  <p className="m-0 text-[11px] leading-[1.45] text-muted-foreground">{t('foundation.editor.agent.managedUnavailable')}</p>
                ) : null}
              </div>
            ) : (
              <>
                <div className="-mx-[5px] -mt-[5px] mb-1 flex items-center gap-1.5 border-b border-border px-[11px] py-[3px]">
                  <Search className="size-[13px] shrink-0 text-muted-foreground" />
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
                    const models = AGENT_MODELS.filter(model => (
                      model.providerId === providerId && (!query || model.name.toLocaleLowerCase().includes(query))
                    ))
                    if (!models.length) return null
                    const ready = providerReadiness[providerId]
                    return (
                      <div className="grid gap-px not-first:mt-[3px]" key={providerId}>
                        <div className="flex items-center justify-between gap-2 px-2 pt-1 pb-px text-[10px] font-semibold tracking-[0.02em] text-muted-foreground uppercase">
                          <span>{t(`foundation.editor.agent.providers.${providerId}.name`)}</span>
                          {ready ? null : (
                            <Button
                              aria-label={t('foundation.editor.agent.signInToProvider', { provider: t(`foundation.editor.agent.providers.${providerId}.name`) })}
                              className="h-auto min-h-0 rounded-[var(--radius-control)] px-1.5 py-px text-[10.5px] font-semibold tracking-normal text-foreground normal-case hover:bg-[rgb(15_16_21/6%)]"
                              onClick={() => setAuthView(providerId)}
                              size="sm"
                              type="button"
                              variant="ghost"
                            >{t('foundation.editor.agent.signInShort')}</Button>
                          )}
                        </div>
                        {models.map(model => {
                          const active = activeModel.id === model.id && configuration.providerId === model.providerId
                          return (
                            <Button
                              aria-label={ready ? model.name : t('foundation.editor.agent.modelLockedHint', { model: model.name })}
                              className={cn(
                                'h-[30px] w-full justify-between gap-[9px] rounded-[var(--radius-control)] px-2 text-left text-[12.5px] text-foreground hover:bg-[rgb(15_16_21/6%)] [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
                                active && 'bg-[rgb(15_16_21/8%)] font-semibold [&_svg]:text-foreground',
                                !ready && 'text-muted-foreground',
                              )}
                              key={model.id}
                              onClick={() => selectModel(model)}
                              size="editor"
                              type="button"
                              variant="ghost"
                            >
                              <span className="inline-flex min-w-0 items-center gap-[7px] overflow-hidden text-ellipsis whitespace-nowrap">
                                {model.name}
                                {model.badge === 'max' ? <span className={modelBadgeClass}>MAX</span> : null}
                              </span>
                              {active ? <Check /> : ready ? null : <Lock />}
                            </Button>
                          )
                        })}
                      </div>
                    )
                  })}
                  {AGENT_MODELS.every(model => modelQuery.trim() && !model.name.toLocaleLowerCase().includes(modelQuery.trim().toLocaleLowerCase()))
                    ? <p className="my-2.5 text-center text-xs text-muted-foreground">{t('foundation.editor.agent.noModels')}</p>
                    : null}
                </div>
              </>
            )}
          </PopoverContent>

      <SidebarContent>
        <div aria-live="polite" className="flex min-h-full flex-1 flex-col gap-2.5 p-3">
          {!entries.length && !candidate && !handoff ? (
            <div className="flex min-h-full flex-1 flex-col items-center justify-center px-2.5 py-7 text-center">
              <span className="mb-3.5 flex size-11 items-center justify-center rounded-[var(--radius-action)] bg-[rgb(15_16_21/6%)] text-[rgb(16_18_25/70%)] [&_svg]:size-[22px]"><Bot /></span>
              <h3 className="m-0 text-[15px] font-[750]">{t('foundation.editor.agent.emptyTitle')}</h3>
              <p className="mt-[7px] mb-0 max-w-[290px] text-xs leading-normal text-muted-foreground">{t('foundation.editor.agent.emptyDescription')}</p>
            </div>
          ) : null}

          {handoff && attachmentVisible && handoffUrl ? (
            <div className="m-0 grid gap-2.5 rounded-[var(--radius-overlay)] border border-border bg-muted p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="grid gap-0.5">
                  <strong className="text-xs">{t('foundation.editor.agent.sketchAttached')}</strong>
                  <span className="text-[10px] text-muted-foreground">{t('foundation.editor.agent.sketchElements', {
                    count: handoff.scene.elements.filter(element => element.isDeleted !== true).length,
                  })}</span>
                </div>
                <Button aria-label={t('foundation.editor.agent.removeSketch')} onClick={() => setAttachmentVisible(false)} size="editor-icon" type="button" variant="ghost"><X /></Button>
              </div>
              <img alt={t('foundation.editor.agent.sketchPreview')} className="w-full rounded-[var(--radius-surface)] border border-border bg-white object-contain" src={handoffUrl} />
            </div>
          ) : null}

          {entries.map(entry => (
            <div
              className={cn(
                'flex max-w-full',
                entry.role === 'user' && 'max-w-[88%] self-end',
              )}
              key={entry.id}
            >
              <p className={cn(
                'm-0 text-[12.5px] leading-[1.55] whitespace-pre-wrap',
                entry.role === 'user' && 'rounded-[var(--radius-overlay)] bg-[rgb(15_16_21/6%)] px-3 py-2',
                entry.role === 'agent' && 'text-[rgb(16_18_25/88%)]',
                entry.role === 'error' && 'rounded-[var(--radius-overlay)] bg-[color-mix(in_oklab,var(--destructive)_7%,var(--background))] px-3 py-2 text-destructive',
              )}>{entry.text}</p>
            </div>
          ))}

          {progress ? (
            <output className="flex items-center gap-2.5 rounded-[var(--radius-overlay)] bg-[rgb(15_16_21/4%)] px-3 py-2.5">
              <span className="size-[15px] shrink-0 animate-spin rounded-full border-2 border-border border-t-foreground motion-reduce:animate-none motion-reduce:border-muted-foreground" />
              <div className="grid gap-0.5">
                <strong className="text-[11.5px]">{t(`foundation.editor.agent.progress.${progress}`)}</strong>
                <small className="text-[9.5px] leading-[1.35] text-muted-foreground">{t('foundation.editor.agent.progress.detail')}</small>
              </div>
            </output>
          ) : null}

          {candidate && candidate.preview.ok ? (
            <article className="overflow-hidden rounded-[var(--radius-overlay)] border border-border bg-background shadow-[0_8px_26px_rgb(15_23_42/7%)]">
              <header className="flex items-start gap-[9px] border-b border-border p-[11px]">
                <span className="grid size-[25px] shrink-0 place-items-center rounded-[var(--radius-action)] bg-muted text-foreground [&_svg]:size-3.5"><Sparkles /></span>
                <div className="grid min-w-0 gap-0.5">
                  <strong className="text-xs leading-[1.4]">{candidate.explanation}</strong>
                  <small className="text-[10px] text-muted-foreground">{candidate.providerLabel}</small>
                </div>
              </header>
              {beforeUrl || afterUrl ? (
                <div className="grid grid-cols-2 gap-px bg-border">
                  {beforeUrl ? (
                    <figure className="relative m-0 min-w-0 bg-muted">
                      <img alt={t('foundation.editor.agent.beforePreview')} className="block aspect-video w-full bg-white object-contain" src={beforeUrl} />
                      <figcaption className="absolute right-[5px] bottom-[5px] rounded-[var(--radius-pill)] bg-[rgb(24_24_27/78%)] px-1.5 py-0.5 text-[8.5px] text-white backdrop-blur-[5px]">{t('foundation.editor.agent.before')}</figcaption>
                    </figure>
                  ) : null}
                  {afterUrl ? (
                    <figure className="relative m-0 min-w-0 bg-muted">
                      <img alt={t('foundation.editor.agent.afterPreview')} className="block aspect-video w-full bg-white object-contain" src={afterUrl} />
                      <figcaption className="absolute right-[5px] bottom-[5px] rounded-[var(--radius-pill)] bg-[rgb(24_24_27/78%)] px-1.5 py-0.5 text-[8.5px] text-white backdrop-blur-[5px]">{t('foundation.editor.agent.after')}</figcaption>
                    </figure>
                  ) : null}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-[5px] px-2.5 pt-[9px] pb-1">
                <span className="rounded-[var(--radius-pill)] bg-muted px-[7px] py-[3px] text-[9px] text-muted-foreground">{t('foundation.editor.agent.summary.created', { count: candidate.summary.createdElements })}</span>
                <span className="rounded-[var(--radius-pill)] bg-muted px-[7px] py-[3px] text-[9px] text-muted-foreground">{t('foundation.editor.agent.summary.updated', { count: candidate.summary.updatedElements })}</span>
                <span className="rounded-[var(--radius-pill)] bg-muted px-[7px] py-[3px] text-[9px] text-muted-foreground">{t('foundation.editor.agent.summary.removed', { count: candidate.summary.deletedElements })}</span>
              </div>
              <details className="mx-2.5 mt-[5px] mb-2.5 rounded-[var(--radius-control)] border border-border">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-[7px] text-[10px] text-muted-foreground [&::-webkit-details-marker]:hidden [&_svg]:size-3"><Code2 />{t('foundation.editor.agent.viewProgram')}</summary>
                <pre className="m-0 max-h-[200px] overflow-auto border-t border-border bg-muted p-[9px] text-[9px] leading-[1.45] whitespace-pre-wrap"><code>{candidate.code}</code></pre>
              </details>
              <footer className="flex justify-end gap-[7px] border-t border-border px-2.5 py-[9px] [&_svg]:size-[13px]">
                <Button onClick={() => setCandidate(null)} size="sm" type="button" variant="outline">
                  {t('foundation.editor.agent.discard')}
                </Button>
                <Button onClick={applyCandidate} size="sm" type="button">
                  <Check />{t('foundation.editor.agent.apply')}
                </Button>
              </footer>
            </article>
          ) : null}

          {appliedCandidate ? (
            <div className="flex items-center gap-[7px] rounded-[var(--radius-overlay)] border border-border px-[9px] py-2 text-[10.5px]">
              <Check className="size-3.5 text-[var(--success,#16a34a)]" />
              <span className="min-w-0 flex-1">{t('foundation.editor.agent.appliedSummary')}</span>
              <Button className="[&_svg]:size-3" onClick={undoApplied} size="sm" type="button" variant="outline"><RotateCcw />{t('foundation.editor.agent.undo')}</Button>
            </div>
          ) : null}
          <div ref={endRef} />
        </div>
      </SidebarContent>

      <SidebarFooter className="gap-0 px-3 pt-1 pb-2.5">
        <form
          className="overflow-hidden rounded-[calc(var(--radius-overlay)+4px)] border border-border bg-card shadow-[0_6px_18px_-6px_rgb(21_30_130/14%),0_2px_5px_-2px_rgb(21_30_130/8%)] focus-within:border-foreground/25"
          onSubmit={event => {
            event.preventDefault()
            void submit()
          }}
        >
          <Textarea
            aria-label={t('foundation.editor.agent.composerLabel')}
            className="max-h-[220px] min-h-[50px] field-sizing-content resize-none overflow-y-auto rounded-none border-0 bg-transparent px-3 pt-3 pb-0.5 text-[13px] leading-normal shadow-none focus-visible:border-0 focus-visible:shadow-none focus-visible:ring-0"
            disabled={busy}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void submit()
              }
            }}
            placeholder={t('foundation.editor.agent.composerPlaceholder')}
            ref={composerRef}
            rows={2}
            value={draft}
          />
          <div className="flex min-h-10 items-center gap-1.5 px-1.5 pt-1 pb-1.5 [&_button_svg]:size-[15px]">
            <PopoverTrigger asChild>
              <Button
                aria-label={t('foundation.editor.agent.chooseProvider')}
                className="h-[26px] min-w-0 gap-[5px] rounded-[var(--radius-control)] px-1 text-[12.5px] font-medium text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=open]:bg-transparent data-[state=open]:text-foreground [&_>svg]:size-3 [&_>svg]:shrink-0"
                size="sm"
                type="button"
                variant="ghost"
              >
                <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{activeModel.name}</span>
                {activeModel.badge === 'max' ? <span className={modelBadgeClass}>MAX</span> : null}
                <ChevronDown />
              </Button>
            </PopoverTrigger>
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                aria-label={t('foundation.editor.agent.attach')}
                disabled={!handoff}
                onClick={() => setAttachmentVisible(current => !current)}
                size="editor-icon"
                type="button"
                variant={attachmentVisible ? 'secondary' : 'ghost'}
              >
                <Paperclip />
              </Button>
              {busy ? (
                <Button
                  aria-label={t('foundation.editor.agent.cancel')}
                  className="size-[30px] shrink-0 rounded-[var(--radius-pill)] border-[rgb(16_18_25/20%)] p-0 [&_svg]:stroke-[2.4]"
                  onClick={() => abortRef.current?.abort()}
                  size="editor-icon"
                  type="button"
                  variant="outline"
                ><CircleStop /></Button>
              ) : (
                <Button
                  aria-label={t('foundation.editor.agent.send')}
                  className="size-[30px] shrink-0 rounded-[var(--radius-pill)] p-0 disabled:bg-muted disabled:opacity-100 disabled:[&_svg]:text-muted-foreground [&_svg]:stroke-[2.4]"
                  disabled={!draft.trim() || !providerReady}
                  size="editor-icon"
                  type="submit"
                ><ArrowUp /></Button>
              )}
            </div>
          </div>
        </form>
        {/* Prompt starters live under the input, the way current assistant
            UIs surface them — only while the thread is still empty. */}
        {!entries.length && !candidate && !handoff && !progress ? (
          <div className="mona-agent-suggestions mt-2 flex flex-nowrap items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" ref={suggestionsRef}>
            {(['improve', 'rewrite', 'visualize'] as const).map(suggestion => {
              const SuggestionIcon = SUGGESTION_ICONS[suggestion]
              return (
                <Button
                  className="h-7 shrink-0 gap-1.5 rounded-[var(--radius-control)] border-0 bg-transparent px-2 text-xs font-medium whitespace-nowrap text-muted-foreground hover:bg-[rgb(15_16_21/5%)] hover:text-foreground [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground"
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
        ) : (
          <p className="mt-[7px] mr-0.5 mb-0 ml-0.5 text-center text-[10px] leading-[1.4] text-muted-foreground">{providerReady
            ? t('foundation.editor.agent.reviewNotice')
            : t('foundation.editor.agent.connectionRequired')}</p>
        )}
      </SidebarFooter>
      </Popover>
    </Sidebar>
  )
}
