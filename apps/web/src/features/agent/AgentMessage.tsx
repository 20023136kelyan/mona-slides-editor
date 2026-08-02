import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'
import { Check, ChevronRight, Clipboard, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { activityForTool } from '@/features/agent/agent-activity'
import { AgentStateOrb } from '@/features/agent/AgentStateOrb'
import {
  agentMessageText,
  agentToolName,
  renderableAgentParts,
} from '@/features/agent/agent-message-parts'
import { useSmoothText } from '@/features/agent/use-smooth-text'
import { cn } from '@/lib/utils'

const REMARK_PLUGINS = [remarkGfm]

export interface AgentToolRun {
  args?: unknown
  detail?: string
  isError?: boolean
  label: string
  status: 'done' | 'error' | 'running'
  toolCallId: string
  toolName: string
}

const TOOL_STATUS: Record<string, AgentToolRun['status']> = {
  'input-available': 'running',
  'input-streaming': 'running',
  'output-available': 'done',
  'output-error': 'error',
}

function StreamedText({ active, value }: { active: boolean; value: string }) {
  const shown = useSmoothText(value, active)
  return (
    <div className="mona-agent-prose text-[12.5px] leading-[1.55] text-ink/88">
      <Markdown remarkPlugins={REMARK_PLUGINS}>{shown}</Markdown>
    </div>
  )
}

function ThinkingBlock({ active, value }: { active: boolean; value: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(active)
  const [seconds, setSeconds] = useState(0)
  const startedRef = useRef<number | null>(null)

  useEffect(() => {
    if (active) {
      startedRef.current ??= Date.now()
      const timer = window.setInterval(() => {
        setSeconds(Math.round((Date.now() - (startedRef.current ?? Date.now())) / 1000))
      }, 500)
      return () => window.clearInterval(timer)
    }
    setOpen(false)
    if (startedRef.current !== null) {
      setSeconds(Math.max(1, Math.round((Date.now() - startedRef.current) / 1000)))
    }
    return undefined
  }, [active])

  return (
    <div className="mona-agent-thinking rounded-overlay bg-ink-deep/4 px-2.5 py-1.75">
      <Button
        aria-expanded={open}
        className="h-auto w-full justify-start gap-1.25 p-0 text-left text-[11.5px] font-medium text-muted-foreground hover:bg-transparent hover:text-foreground"
        onClick={() => setOpen(current => !current)}
        size="sm"
        type="button"
        variant="ghost"
      >
        <ChevronRight className={cn('size-3 transition-transform duration-200', open && 'rotate-90')} />
        {active ? <AgentStateOrb activity="reasoning" className="-my-0.5" /> : null}
        <span className={cn(active && 'mona-agent-shimmer')}>
          {active
            ? t('foundation.editor.agent.thinking')
            : seconds >= 1
              ? t('foundation.editor.agent.thoughtFor', { seconds })
              : t('foundation.editor.agent.thought')}
        </span>
      </Button>
      {open ? (
        <p className="m-0 mt-1 text-[11.5px] leading-[1.5] whitespace-pre-wrap text-muted-foreground/85">{value}</p>
      ) : null}
    </div>
  )
}

function ToolBlock({ run }: { run: AgentToolRun }) {
  return (
    <div className="flex items-center gap-1.75 rounded-overlay bg-ink-deep/4 px-2.5 py-1.5 text-[11.5px]">
      <span className="grid size-5 shrink-0 place-items-center">
        {run.status === 'running' ? (
          <AgentStateOrb activity={activityForTool(run.toolName)} />
        ) : run.status === 'error' ? <TriangleAlert className="size-3 text-destructive" />
          : <Check className="size-3 text-[var(--success,#16a34a)]" />}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className={cn('min-w-0 truncate', run.status === 'running' ? 'text-foreground' : 'text-muted-foreground')}>
          {run.label}
        </span>
        {run.detail && run.status !== 'done' ? (
          <span className={cn('min-w-0 truncate text-mini', run.status === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
            {run.detail}
          </span>
        ) : null}
      </span>
    </div>
  )
}

function CopyAnswer({ text }: { text: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return undefined
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  if (!text.trim()) return null
  return (
    <Button
      aria-label={copied ? t('common.copied') : t('common.copy')}
      className="h-6 gap-1 self-start rounded-action px-1.5 text-[11.5px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/message:opacity-100 [&_svg]:size-3"
      onClick={() => {
        void navigator.clipboard?.writeText(text)
          .then(() => setCopied(true))
          .catch(() => undefined)
      }}
      size="sm"
      type="button"
      variant="ghost"
    >
      {copied ? <Check /> : <Clipboard />}
      <span>{copied ? t('common.copied') : t('common.copy')}</span>
    </Button>
  )
}

export function AgentMessage({
  message,
  streaming,
  toolLabel,
}: {
  message: unknown
  streaming: boolean
  toolLabel: (name: string, input: unknown) => string
}) {
  const parts = renderableAgentParts(message)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [message])

  if (!parts.length) return null
  return (
    <div className="group/message grid w-full gap-1.5">
      {parts.map(part => {
        const active = streaming && part.state !== 'done' && part.state !== 'output-available'
        if (part.type === 'reasoning') {
          return <ThinkingBlock active={active} key={part.index} value={part.text ?? ''} />
        }
        const toolName = agentToolName(part)
        if (toolName) {
          return (
            <ToolBlock
              key={part.index}
              run={{
                detail: part.state === 'output-error' ? part.errorText : undefined,
                label: toolLabel(toolName, part.input),
                status: TOOL_STATUS[part.state ?? ''] ?? 'running',
                toolCallId: part.toolCallId ?? String(part.index),
                toolName,
              }}
            />
          )
        }
        return <StreamedText active={active} key={part.index} value={part.text ?? ''} />
      })}
      {streaming ? null : <CopyAnswer text={agentMessageText(message)} />}
      <div ref={endRef} />
    </div>
  )
}

export function AgentActivity({ startedAt }: { startedAt?: number | null }) {
  const { t } = useTranslation()
  const [mountedAt] = useState(() => Date.now())
  const [elapsed, setElapsed] = useState(0)
  const origin = startedAt ?? mountedAt

  useEffect(() => {
    setElapsed(Math.max(0, Math.round((Date.now() - origin) / 1000)))
    const timer = window.setInterval(() => {
      setElapsed(Math.max(0, Math.round((Date.now() - origin) / 1000)))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [origin])

  return (
    <output className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
      <AgentStateOrb activity="waiting" className="size-8" size={64} />
      <span className="mona-agent-shimmer">{t('foundation.editor.agent.working')}</span>
      {elapsed >= 1 ? <span className="tabular-nums opacity-70">{t('foundation.editor.agent.elapsed', { seconds: elapsed })}</span> : null}
    </output>
  )
}
