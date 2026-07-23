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
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
      className="mona-agent-auth-prompt"
      onSubmit={event => {
        event.preventDefault()
        if (!answer.trim()) return
        void answerAgentAuthPrompt(providerId, prompt.id, answer).catch(() => undefined)
      }}
    >
      <Label htmlFor={answerId}>{prompt.message}</Label>
      {prompt.type === 'select' ? (
        <Select onValueChange={setAnswer} value={answer}>
          <SelectTrigger aria-label={prompt.message} id={answerId}>
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
      <div className="mona-agent-oauth-panel">
        <div>
          <span className="mona-agent-provider-status is-ready" />
          <span>
            <strong>{status.accountLabel || t('foundation.editor.agent.connected')}</strong>
            <small>{status.planLabel || t('foundation.editor.agent.subscriptionReady')}</small>
          </span>
        </div>
        <Button disabled={status.loading} onClick={() => void disconnectAgentProvider(providerId)} size="sm" type="button" variant="outline">
          <Unplug />{t('foundation.editor.agent.disconnect')}
        </Button>
        <small>{t('foundation.editor.agent.oauthSecurityNotice')}</small>
      </div>
    )
  }
  return (
    <div className="mona-agent-oauth-panel">
      <p>{t(`foundation.editor.agent.providers.${providerId}.signInDescription`)}</p>
      <Button disabled={status.loading} onClick={() => void connectAgentProvider(providerId).catch(() => undefined)} size="sm" type="button">
        <LogIn />{status.loading
          ? t('foundation.editor.agent.connecting')
          : t(`foundation.editor.agent.providers.${providerId}.signIn`)}
      </Button>
      {status.flow?.deviceCode ? (
        <div className="mona-agent-device-code">
          <span>{t('foundation.editor.agent.deviceCodeLabel')}</span>
          <div>
            <code>{status.flow.deviceCode.userCode}</code>
            <Button
              aria-label={t('foundation.editor.agent.copyDeviceCode')}
              onClick={() => void navigator.clipboard.writeText(status.flow?.deviceCode?.userCode ?? '')}
              size="editor-icon"
              type="button"
              variant="ghost"
            >
              <Clipboard />
            </Button>
          </div>
          <a href={status.flow.deviceCode.verificationUri} rel="noreferrer" target="_blank">
            <ExternalLink />{t('foundation.editor.agent.openSignInPage')}
          </a>
        </div>
      ) : null}
      {status.flow?.prompt ? (
        <AgentAuthPromptForm key={status.flow.prompt.id} prompt={status.flow.prompt} providerId={providerId} />
      ) : null}
      {status.flow?.message ? <p>{status.flow.message}</p> : null}
      {status.flow?.status === 'pending' ? (
        <Button onClick={() => void cancelAgentAuthFlow(providerId)} size="sm" type="button" variant="ghost">
          <CircleStop />{t('common.cancel')}
        </Button>
      ) : null}
      {status.error ? <p className="mona-agent-auth-error">{status.error}</p> : null}
      <small>{t('foundation.editor.agent.oauthSecurityNotice')}</small>
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
      className="mona-agent-key-form"
      onSubmit={event => {
        event.preventDefault()
        if (apiKey.trim()) onConnect(apiKey.trim(), modelId)
      }}
    >
      <div>
        <Label htmlFor={apiKeyId}>{t('foundation.editor.agent.apiKey')}</Label>
        <div className="mona-agent-key-input">
          <KeyRound />
          <Input
            autoComplete="off"
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
      <p>{t('foundation.editor.agent.keyMemoryNotice')}</p>
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
  const slideNumber = useEditorSelector(runtime.store, state => state.presentation.slideIndex + 1)
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
    <aside aria-labelledby="mona-agent-dock-title" className="mona-agent-dock">
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
      <header className="mona-agent-dock-header">
        <div className="mona-agent-dock-title">
          <h2 id="mona-agent-dock-title">{t('foundation.editor.agent.title')}</h2>
          <p>{t('foundation.editor.agent.scope', { slide: slideNumber })}</p>
        </div>
        <Button aria-label={t('common.close')} onClick={closeAgent} size="editor-icon" type="button" variant="ghost"><X /></Button>
      </header>
          <PopoverContent align="start" className="mona-agent-model-popover" data-editor-interactive-overlay side="top" sideOffset={8}>
            {authView ? (
              <div className="mona-agent-auth-view">
                <div className="mona-agent-auth-head">
                  <Button
                    aria-label={t('foundation.editor.agent.back')}
                    onClick={() => setAuthView(null)}
                    size="editor-icon"
                    type="button"
                    variant="ghost"
                  ><ChevronLeft /></Button>
                  <strong>{t(`foundation.editor.agent.providers.${authView}.name`)}</strong>
                </div>
                {authView === 'openai-chatgpt' || authView === 'anthropic-claude' ? (
                  <OAuthAuthPanel providerId={authView} />
                ) : null}
                {authView === 'google-ai-studio' ? (
                  <GeminiAuthPanel defaultModelId="gemini-3.6-flash" onConnect={connectGemini} />
                ) : null}
                {authView === 'mona-managed' ? (
                  <p className="mona-agent-auth-note">{t('foundation.editor.agent.managedUnavailable')}</p>
                ) : null}
              </div>
            ) : (
              <>
                <div className="mona-agent-model-search">
                  <Search />
                  <input
                    aria-label={t('foundation.editor.agent.searchModels')}
                    onChange={event => setModelQuery(event.target.value)}
                    placeholder={t('foundation.editor.agent.searchModels')}
                    type="search"
                    value={modelQuery}
                  />
                </div>
                <div className="mona-agent-model-list">
                  {MODEL_PROVIDER_ORDER.map(providerId => {
                    const query = modelQuery.trim().toLocaleLowerCase()
                    const models = AGENT_MODELS.filter(model => (
                      model.providerId === providerId && (!query || model.name.toLocaleLowerCase().includes(query))
                    ))
                    if (!models.length) return null
                    const ready = providerReadiness[providerId]
                    return (
                      <div className="mona-agent-model-group" key={providerId}>
                        <div className="mona-agent-model-group-head">
                          <span>{t(`foundation.editor.agent.providers.${providerId}.name`)}</span>
                          {ready ? null : (
                            <Button
                              aria-label={t('foundation.editor.agent.signInToProvider', { provider: t(`foundation.editor.agent.providers.${providerId}.name`) })}
                              className="mona-agent-model-signin"
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
                              className={`mona-agent-model-option${ready ? '' : ' is-locked'}${active ? ' is-active' : ''}`}
                              key={model.id}
                              onClick={() => selectModel(model)}
                              size="editor"
                              type="button"
                              variant="ghost"
                            >
                              <span className="mona-agent-model-option-name">
                                {model.name}
                                {model.badge === 'max' ? <span className="mona-agent-model-badge">MAX</span> : null}
                              </span>
                              {active ? <Check /> : ready ? null : <Lock />}
                            </Button>
                          )
                        })}
                      </div>
                    )
                  })}
                  {AGENT_MODELS.every(model => modelQuery.trim() && !model.name.toLocaleLowerCase().includes(modelQuery.trim().toLocaleLowerCase()))
                    ? <p className="mona-agent-model-empty">{t('foundation.editor.agent.noModels')}</p>
                    : null}
                </div>
              </>
            )}
          </PopoverContent>

      <ScrollArea className="mona-agent-conversation">
        <div className="mona-agent-thread" aria-live="polite">
          {!entries.length && !candidate && !handoff ? (
            <div className="mona-agent-empty-state">
              <span className="mona-agent-empty-icon"><Bot /></span>
              <h3>{t('foundation.editor.agent.emptyTitle')}</h3>
              <p>{t('foundation.editor.agent.emptyDescription')}</p>
            </div>
          ) : null}

          {handoff && attachmentVisible && handoffUrl ? (
            <div className="mona-agent-sketch-handoff">
              <div className="mona-agent-sketch-heading">
                <div>
                  <strong>{t('foundation.editor.agent.sketchAttached')}</strong>
                  <span>{t('foundation.editor.agent.sketchElements', {
                    count: handoff.scene.elements.filter(element => element.isDeleted !== true).length,
                  })}</span>
                </div>
                <Button aria-label={t('foundation.editor.agent.removeSketch')} onClick={() => setAttachmentVisible(false)} size="editor-icon" type="button" variant="ghost"><X /></Button>
              </div>
              <img alt={t('foundation.editor.agent.sketchPreview')} src={handoffUrl} />
            </div>
          ) : null}

          {entries.map(entry => (
            <div className={`mona-agent-message is-${entry.role}`} key={entry.id}>
              <p>{entry.text}</p>
            </div>
          ))}

          {progress ? (
            <output className="mona-agent-progress">
              <span className="mona-agent-progress-spinner" />
              <div>
                <strong>{t(`foundation.editor.agent.progress.${progress}`)}</strong>
                <small>{t('foundation.editor.agent.progress.detail')}</small>
              </div>
            </output>
          ) : null}

          {candidate && candidate.preview.ok ? (
            <article className="mona-agent-candidate">
              <header>
                <span><Sparkles /></span>
                <div>
                  <strong>{candidate.explanation}</strong>
                  <small>{candidate.providerLabel}</small>
                </div>
              </header>
              {beforeUrl || afterUrl ? (
                <div className="mona-agent-preview-comparison">
                  {beforeUrl ? (
                    <figure>
                      <img alt={t('foundation.editor.agent.beforePreview')} src={beforeUrl} />
                      <figcaption>{t('foundation.editor.agent.before')}</figcaption>
                    </figure>
                  ) : null}
                  {afterUrl ? (
                    <figure>
                      <img alt={t('foundation.editor.agent.afterPreview')} src={afterUrl} />
                      <figcaption>{t('foundation.editor.agent.after')}</figcaption>
                    </figure>
                  ) : null}
                </div>
              ) : null}
              <div className="mona-agent-operation-summary">
                <span>{t('foundation.editor.agent.summary.created', { count: candidate.summary.createdElements })}</span>
                <span>{t('foundation.editor.agent.summary.updated', { count: candidate.summary.updatedElements })}</span>
                <span>{t('foundation.editor.agent.summary.removed', { count: candidate.summary.deletedElements })}</span>
              </div>
              <details>
                <summary><Code2 />{t('foundation.editor.agent.viewProgram')}</summary>
                <pre><code>{candidate.code}</code></pre>
              </details>
              <footer>
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
            <div className="mona-agent-applied">
              <Check />
              <span>{t('foundation.editor.agent.appliedSummary')}</span>
              <Button onClick={undoApplied} size="sm" type="button" variant="outline"><RotateCcw />{t('foundation.editor.agent.undo')}</Button>
            </div>
          ) : null}
          <div ref={endRef} />
        </div>
      </ScrollArea>

      <footer className="mona-agent-composer">
        <form
          className="mona-agent-composer-field"
          onSubmit={event => {
            event.preventDefault()
            void submit()
          }}
        >
          <Textarea
            aria-label={t('foundation.editor.agent.composerLabel')}
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
          <div className="mona-agent-composer-actions">
            <PopoverTrigger asChild>
              <Button
                aria-label={t('foundation.editor.agent.chooseProvider')}
                className="mona-agent-model-trigger"
                size="sm"
                type="button"
                variant="ghost"
              >
                <span className="mona-agent-model-label">{activeModel.name}</span>
                {activeModel.badge === 'max' ? <span className="mona-agent-model-badge">MAX</span> : null}
                <ChevronDown />
              </Button>
            </PopoverTrigger>
            <div className="mona-agent-composer-tools">
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
                <Button aria-label={t('foundation.editor.agent.cancel')} className="mona-agent-send is-stop" onClick={() => abortRef.current?.abort()} size="editor-icon" type="button" variant="outline"><CircleStop /></Button>
              ) : (
                <Button aria-label={t('foundation.editor.agent.send')} className="mona-agent-send" disabled={!draft.trim() || !providerReady} size="editor-icon" type="submit"><ArrowUp /></Button>
              )}
            </div>
          </div>
        </form>
        {/* Prompt starters live under the input, the way current assistant
            UIs surface them — only while the thread is still empty. */}
        {!entries.length && !candidate && !handoff && !progress ? (
          <div className="mona-agent-suggestions" ref={suggestionsRef}>
            {(['improve', 'rewrite', 'visualize'] as const).map(suggestion => {
              const SuggestionIcon = SUGGESTION_ICONS[suggestion]
              return (
                <Button
                  className="mona-agent-chip"
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
          <p className="mona-agent-composer-notice">{providerReady
            ? t('foundation.editor.agent.reviewNotice')
            : t('foundation.editor.agent.connectionRequired')}</p>
        )}
      </footer>
      </Popover>
    </aside>
  )
}
