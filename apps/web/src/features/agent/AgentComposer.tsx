import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowUp,
  Check,
  ChevronDown,
  Gauge,
  Lock,
  Paperclip,
  Search,
  Square,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { Textarea } from '@/components/ui/textarea'
import {
  connectAgentAccount,
  useAgentAccounts,
} from '@/features/agent/agent-account'
import {
  effortLevelsFor,
  useAgentModels,
  type AgentModel,
} from '@/features/agent/agent-model-catalog'
import {
  agentModelStore,
  useAgentModelSelection,
} from '@/features/agent/agent-model-store'
import { AgentProviderIcon } from '@/features/agent/AgentProviderIcon'
import { cn } from '@/lib/utils'

export const AGENT_LANE_FACE = 'rounded-action border border-border bg-[color-mix(in_oklab,var(--foreground)_3%,var(--background))] shadow-[0_1px_2px_0_color-mix(in_oklab,var(--foreground)_12%,transparent)]'
export const AGENT_LANE_KEYCAP = `h-6.5 text-[11.5px] font-medium ${AGENT_LANE_FACE}`
export const AGENT_LANE_KEYCAP_HOVER = 'hover:bg-[color-mix(in_oklab,var(--foreground)_6%,var(--background))] hover:text-foreground active:shadow-none'

export interface AgentComposerAttachment {
  active?: boolean
  disabled?: boolean
  label: string
  onClick: () => void
}

export interface AgentComposerProps {
  /** Accessible name for the input and its form. */
  ariaLabel: string
  attachment?: AgentComposerAttachment
  busy: boolean
  className?: string
  /** Content carried with the prompt, such as slide or document chips. */
  context?: ReactNode
  disabled?: boolean
  onKeyDown?: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void
  onStop?: () => void
  onSubmit: () => void
  onValueChange: (value: string) => void
  placeholder: string
  /** Home may create a project while signed out; actual agent turns may not. */
  requireConnection?: boolean
  sendLabel?: string
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  value: string
}

/**
 * Mona's canonical agent composer.
 *
 * The editor, project conversation and Home entry point render this component,
 * so their model control, keyboard behavior, activity buttons, spacing and
 * account state cannot silently drift into separate designs again.
 */
export function AgentComposer({
  ariaLabel,
  attachment,
  busy,
  className,
  context,
  disabled = false,
  onKeyDown,
  onStop,
  onSubmit,
  onValueChange,
  placeholder,
  requireConnection = true,
  sendLabel,
  textareaRef,
  value,
}: AgentComposerProps) {
  const { t } = useTranslation()
  const accounts = useAgentAccounts()
  const models = useAgentModels()
  const selection = useAgentModelSelection()
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [modelQuery, setModelQuery] = useState('')
  const activeModel = models.find(model => (
    model.id === selection.model && model.providerId === selection.providerId
  )) ?? models.find(model => model.providerId === selection.providerId) ?? models[0]!
  const account = accounts.find(candidate => candidate.providerId === activeModel.providerId)
    ?? { connected: false, connecting: false, loading: false, providerId: activeModel.providerId }
  const effortLevels = effortLevelsFor(activeModel)
  const connected = account.connected

  useEffect(() => {
    if (selection.effort && !effortLevels.includes(selection.effort)) {
      agentModelStore.setEffort(undefined)
    }
  }, [selection.effort, effortLevels])

  const visibleModels = useMemo(() => {
    const filter = modelQuery.trim().toLocaleLowerCase()
    return models.filter(model => !filter || [model.name, model.providerId]
      .some(value => value.toLocaleLowerCase().includes(filter)))
  }, [modelQuery, models])

  const activateModel = (model: AgentModel) => {
    agentModelStore.setModel(model)
    setModelPickerOpen(false)
  }

  const submitDisabled = disabled
    || !value.trim()
    || (requireConnection && !connected)
  const canSteer = busy && Boolean(onStop) && Boolean(value.trim())
  const showContextStrip = !connected || context !== undefined

  return (
    <Popover
      onOpenChange={open => {
        setModelPickerOpen(open)
        if (!open) setModelQuery('')
      }}
      open={modelPickerOpen}
    >
      <PopoverContent
        aria-label={t('foundation.editor.agent.chooseModel')}
        align="start"
        className="max-h-[min(70vh,460px)] w-[min(248px,calc(100vw-24px))] gap-0 overflow-y-auto p-1.25"
        data-editor-interactive-overlay
        side="top"
        sideOffset={8}
      >
        <div className="-mx-1.25 -mt-1.25 mb-1 flex items-center gap-1.5 border-b border-border px-2.75 py-0.75">
          <Search className="size-3.25 shrink-0 text-muted-foreground" />
          <Input
            aria-label={t('foundation.editor.agent.searchModels')}
            className="h-7 w-full rounded-none border-0 bg-transparent p-0 text-[12.5px] text-foreground shadow-none outline-none placeholder:text-muted-foreground focus:shadow-none focus:outline-none focus-visible:border-0 focus-visible:ring-0 focus-visible:shadow-none focus-visible:outline-none [&::-webkit-search-cancel-button]:appearance-none"
            onChange={event => setModelQuery(event.target.value)}
            placeholder={t('foundation.editor.agent.searchModels')}
            type="search"
            value={modelQuery}
          />
        </div>
        <div className="grid gap-px">
          {visibleModels.map(model => {
            const active = activeModel.id === model.id
              && activeModel.providerId === model.providerId
            return (
              <Button
                aria-label={model.name}
                className={cn(
                  'h-7.5 w-full justify-between gap-2.25 rounded-control px-2 text-left text-[12.5px] text-foreground hover:bg-ink-deep/6 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
                  active && 'bg-ink-deep/8 font-semibold [&_svg]:text-foreground',
                )}
                key={`${model.providerId}:${model.id}`}
                onClick={() => activateModel(model)}
                size="editor"
                type="button"
                variant="ghost"
              >
                <span className="inline-flex min-w-0 items-center gap-1.75 overflow-hidden text-ellipsis whitespace-nowrap">
                  <AgentProviderIcon className="size-3.5" providerId={model.providerId} />
                  {model.name}
                </span>
                {active ? <Check /> : null}
              </Button>
            )
          })}
          {visibleModels.length ? null : (
            <p className="my-2.5 text-center text-xs text-muted-foreground">
              {t('foundation.editor.agent.noModels')}
            </p>
          )}
        </div>
        <div className="-mx-1.25 -mb-1.25 mt-1 grid gap-0.5 border-t border-border px-1.25 py-1.25">
          {accounts.map(providerAccount => {
            const providerName = providerAccount.providerId === 'anthropic' ? 'Claude' : 'OpenAI'
            return (
              <div className="flex min-h-7 items-center gap-1.75 rounded-control px-1.5 text-mini text-muted-foreground" key={providerAccount.providerId}>
                <AgentProviderIcon className="size-3.25" providerId={providerAccount.providerId} />
                <span className="min-w-0 flex-1 truncate">
                  {providerAccount.connected
                    ? [providerAccount.accountLabel, providerAccount.planLabel].filter(Boolean).join(' \u00b7 ')
                    : providerName}
                </span>
                {providerAccount.connected ? (
                  <span aria-label={t('foundation.editor.agent.connected')} className="size-1.75 shrink-0 rounded-pill bg-[var(--success,#16a34a)]" />
                ) : (
                  <Button
                    className="h-6 px-2 text-mini"
                    disabled={providerAccount.loading || providerAccount.connecting}
                    onClick={() => {
                      void connectAgentAccount(providerAccount.providerId).catch(error => {
                        toast.error(t('foundation.editor.agent.signInFailed'), {
                          description: error instanceof Error ? error.message : undefined,
                        })
                      })
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {providerAccount.connecting
                      ? t('foundation.editor.agent.connecting')
                      : t('foundation.editor.agent.signIn')}
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      </PopoverContent>

      <div
        className={cn(
          'mona-agent-composer rounded-[calc(var(--radius-overlay)+10px)] border border-[color-mix(in_oklab,var(--foreground)_8%,transparent)] bg-ink-deep/[0.045] p-1.5 shadow-[inset_0_1px_0_0_rgb(255_255_255/70%),0_1px_2px_0_rgb(15_23_42/5%)]',
          className,
        )}
        data-agent-composer
      >
        {showContextStrip ? (
          <div className="mona-agent-strip flex min-h-8 flex-wrap items-center gap-1.5 px-1.5 pt-0.5 pb-1.5">
            {!connected ? (
              <>
                <span className={cn(AGENT_LANE_FACE, 'grid size-6.5 shrink-0 place-items-center text-muted-foreground [&_svg]:size-3.25')}>
                  {account.loading ? (
                    <span className="size-3 animate-spin rounded-full border-2 border-border border-t-foreground motion-reduce:animate-none" />
                  ) : <Lock />}
                </span>
                <span className="min-w-0 flex-1 text-mini leading-[1.35] text-muted-foreground">
                  {account.loading
                    ? t('foundation.editor.agent.checkingAccount')
                    : t('foundation.editor.agent.signedOutProviderHint', {
                        provider: activeModel.providerId === 'anthropic' ? 'Claude' : 'OpenAI',
                      })}
                </span>
              </>
            ) : context}
          </div>
        ) : null}
        <form
          aria-label={ariaLabel}
          className="overflow-hidden rounded-[calc(var(--radius-overlay)+6px)] bg-background shadow-[0_0_0_1px_rgb(15_23_42/4%),0_1px_1px_0_rgb(15_23_42/4%),0_4px_10px_-4px_rgb(15_23_42/10%)]"
          onSubmit={event => {
            event.preventDefault()
            if (!submitDisabled) onSubmit()
          }}
        >
          <Textarea
            aria-label={ariaLabel}
            className="max-h-55 min-h-12.5 field-sizing-content resize-none overflow-y-auto rounded-none border-0 bg-transparent px-3 pt-3 pb-0.5 text-control leading-normal shadow-none focus-visible:border-0 focus-visible:shadow-none focus-visible:ring-0"
            disabled={disabled}
            onChange={event => onValueChange(event.target.value)}
            onKeyDown={event => {
              onKeyDown?.(event)
              if (event.defaultPrevented) return
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                if (!submitDisabled) onSubmit()
              }
            }}
            placeholder={placeholder}
            ref={textareaRef}
            rows={2}
            value={value}
          />
          <div className="flex min-h-11 items-center gap-1 px-1.5 pt-1 pb-1.5 [&_button_svg]:size-3.75">
            <div
              className={cn(
                AGENT_LANE_FACE,
                'mr-auto flex h-7 min-w-0 max-w-full overflow-hidden transition-all has-[button:active]:translate-y-px has-[button:active]:shadow-none has-[[data-state=open]]:bg-[color-mix(in_oklab,var(--foreground)_10%,var(--background))] has-[[data-state=open]]:shadow-none',
              )}
            >
              <PopoverTrigger asChild>
                <Button
                  aria-label={t('foundation.editor.agent.chooseModel')}
                  className="min-w-0 max-w-full flex-1 gap-1 rounded-none border-0 bg-transparent px-2 text-[12.5px] text-foreground shadow-none hover:bg-[color-mix(in_oklab,var(--foreground)_6%,var(--background))] hover:text-foreground active:translate-y-0! [&_>svg]:size-3 [&_>svg]:shrink-0"
                  size="header-pill"
                  type="button"
                  variant="ghost"
                >
                  <AgentProviderIcon className="size-3.5" providerId={activeModel.providerId} />
                  <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{activeModel.name}</span>
                  <ChevronDown />
                </Button>
              </PopoverTrigger>
              {effortLevels.length ? (
                <Select
                  onValueChange={value => agentModelStore.setEffort(value)}
                  value={selection.effort ?? 'high'}
                >
                  <SelectTrigger
                    aria-label={t('foundation.editor.agent.thinkingLevel')}
                    className="h-full w-auto shrink-0 gap-1 rounded-none border-y-0 border-r-0 border-l border-border bg-transparent px-2 text-[12.5px] font-medium text-foreground/80 shadow-none hover:bg-[color-mix(in_oklab,var(--foreground)_6%,var(--background))] hover:text-foreground data-[state=open]:bg-transparent [&>svg]:size-3 [&_svg]:shrink-0"
                    size="sm"
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
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {attachment ? (
                <Button
                  aria-label={attachment.label}
                  disabled={attachment.disabled}
                  onClick={attachment.onClick}
                  size="action-icon"
                  type="button"
                  variant={attachment.active ? 'secondary' : 'ghost'}
                >
                  <Paperclip />
                </Button>
              ) : null}
              {busy && onStop ? (
                <Button
                  aria-label={t('foundation.editor.agent.cancel')}
                  onClick={onStop}
                  size="action-icon"
                  type="button"
                  variant="stop-pill"
                >
                  <Square className="size-2.5 fill-current stroke-none" />
                </Button>
              ) : null}
              {!busy || canSteer ? (
                <Button
                  aria-label={busy
                    ? t('foundation.editor.agent.steer')
                    : sendLabel ?? t('foundation.editor.agent.send')}
                  className="[&_svg]:stroke-[2.4]"
                  disabled={submitDisabled}
                  size="action-icon"
                  type="submit"
                  variant="action-pill"
                >
                  <ArrowUp />
                </Button>
              ) : null}
            </div>
          </div>
        </form>
      </div>
    </Popover>
  )
}
