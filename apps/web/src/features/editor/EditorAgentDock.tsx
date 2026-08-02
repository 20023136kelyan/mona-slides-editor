import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bot,
  ChartColumn,
  PenLine,
  Wand2,
  X,
} from 'lucide-react'
import SlideAttachmentIcon from '~icons/fluent/slide-layout-20-regular'

import { Button } from '@/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from '@/components/ui/sidebar'
import {
  AgentComposer,
  AGENT_LANE_KEYCAP,
  AGENT_LANE_KEYCAP_HOVER,
} from '@/features/agent/AgentComposer'
import { AgentTranscript } from '@/features/agent/AgentTranscript'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import type { SketchAgentHandoff } from '@/features/editor/drawing/drawing-serialization'
import { useAgentChat } from '@/features/editor/agent/use-agent-chat'
import { useAgentModelSelection } from '@/features/agent/agent-model-store'
import { consumeAgentPrompt, useQueuedAgentPrompt } from '@/features/editor/agent/agent-prompt-queue'
import { buildToolLabel, slideLabelFor } from '@/features/editor/agent/agent-tool-label'
import { refreshAgentAccount, useAgentAccount } from '@/features/agent/agent-account'
import { useEditorApplication } from '@/features/editor/services/editor-application'
import { useEdgeFade } from '@/features/editor/use-edge-fade'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { EditorAgentSlashMenu } from '@/features/editor/EditorAgentSlashMenu'
import { matchSlashCommands, parseSlashCommand, type ParsedSlashCommand } from '@/features/editor/agent/agent-slash-commands'
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
  const account = useAgentAccount(selection.providerId)
  const queuedPrompt = useQueuedAgentPrompt()
  const [draft, setDraft] = useState(() => (
    handoff ? t('foundation.editor.agent.sketchInstruction') : ''
  ))
  const [attachmentVisible, setAttachmentVisible] = useState(Boolean(handoff))
  // The host falls back to the plan's default when no model is chosen.
  const chat = useAgentChat({
    effort: selection.effort,
    model: selection.model ?? '',
    providerId: selection.providerId,
    runtime,
  })
  const sendAgentMessage = chat.sendMessage
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const stagedPromptIdRef = useRef<number | null>(null)
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
  const agentReady = account.connected
  // The SDK reports the run: submitted before the first token, streaming after.
  const busy = chat.status === 'streaming' || chat.status === 'submitted'
  const slashMatches = matchSlashCommands(draft)
  useEdgeFade(suggestionsRef, 'x', chat.messages.length + Number(Boolean(handoff || busy)))

  // Ask once the dock opens rather than at module load, so a window that never
  // opens it does not spawn the binary to read a login it will not use.
  useEffect(() => {
    void refreshAgentAccount()
  }, [])

  useEffect(() => {
    if (!queuedPrompt) return
    if (stagedPromptIdRef.current !== queuedPrompt.id) {
      stagedPromptIdRef.current = queuedPrompt.id
      setDraft(queuedPrompt.text)
    }
    if (!agentReady) return

    // Claim before sending. React development mode may replay an effect setup;
    // only the setup that removed this prompt is allowed to start the turn.
    if (!consumeAgentPrompt(queuedPrompt.id)) return
    stagedPromptIdRef.current = null
    setDraft('')
    setSlashIndex(0)
    void sendAgentMessage({ text: queuedPrompt.text })
  }, [agentReady, queuedPrompt, sendAgentMessage])

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
    if (!instruction || !agentReady) return
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
      {/* Slim chat header: a name and a quiet scope hint. */}
      <SidebarHeader className="flex min-h-11.5 flex-row items-center justify-between gap-3 px-4 pt-1.5 pb-0 [&_>button_svg]:size-4">
        {/* No close control: the header's AI button is the single toggle. */}
        {/* The dock is a chat, so it is named after the thread. Slide scope
            moved to the composer chips, where the user can change it. */}
        <h2 className="m-0 min-w-0 truncate text-control font-medium" id="mona-agent-dock-title" title={chatName}>{chatName}</h2>
      </SidebarHeader>

      <SidebarContent>
        <div className="flex min-h-full flex-1 flex-col gap-2.5 px-4 py-3">
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
          <AgentTranscript
            busy={busy}
            empty={!handoff ? (
              <div className="flex min-h-full flex-1 flex-col items-center justify-center px-2.5 py-7 text-center">
                <span className="mb-3.5 flex size-11 items-center justify-center rounded-action bg-ink-deep/6 text-ink/70 [&_svg]:size-5.5"><Bot /></span>
                <h3 className="m-0 text-field font-[750]">{t('foundation.editor.agent.emptyTitle')}</h3>
                <p className="mt-1.75 mb-0 max-w-72.5 text-xs leading-normal text-muted-foreground">{t('foundation.editor.agent.emptyDescription')}</p>
              </div>
            ) : null}
            error={chat.error}
            messages={chat.messages}
            toolLabel={toolLabel}
          />
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
        <AgentComposer
          ariaLabel={t('foundation.editor.agent.composerLabel')}
          attachment={{
            active: attachmentVisible,
            disabled: !handoff,
            label: t('foundation.editor.agent.attach'),
            onClick: () => setAttachmentVisible(current => !current),
          }}
          busy={busy}
          context={(
            <div aria-label={t('foundation.editor.agent.slideContext')} className="flex min-w-0 flex-wrap items-center gap-1.5" role="group">
              {contextSlides.map(slide => (
                <span className={cn(AGENT_LANE_KEYCAP, 'inline-flex max-w-45 items-center gap-1 pr-0.5 pl-1.5 text-foreground/85')} key={slide.id}>
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
                  className={cn(AGENT_LANE_KEYCAP, AGENT_LANE_KEYCAP_HOVER, 'shrink-0 gap-1 px-2 text-muted-foreground [&_svg]:size-3')}
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
            }
          }}
          onStop={() => { void chat.stop() }}
          onSubmit={submit}
          onValueChange={value => {
            setDraft(value)
            setSlashIndex(0)
          }}
          placeholder={t('foundation.editor.agent.composerPlaceholder')}
          textareaRef={composerRef}
          value={draft}
        />
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
        ) : agentReady ? null : (
          // Only the connect prompt survives here. The notice that used to sit
          // opposite it described the old review-and-apply flow, which no longer
          // exists - the agent edits directly and one undo reverts the run.
          <p className="mt-1.75 mr-0.5 mb-0 ml-0.5 text-center text-mini leading-[1.4] text-muted-foreground">
            {t('foundation.editor.agent.connectionRequired')}
          </p>
        )}
      </SidebarFooter>
    </Sidebar>
  )
}
