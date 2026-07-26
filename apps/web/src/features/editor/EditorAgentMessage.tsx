import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'
import { Check, ChevronRight, Clipboard, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { activityForTool, AgentStateOrb } from '@/features/editor/agent/AgentStateOrb'
import { useSmoothText } from '@/features/editor/agent/use-smooth-text'
import { cn } from '@/lib/utils'

const REMARK_PLUGINS = [remarkGfm]

export interface AgentToolRun {
  args?: unknown
  /** Progress the tool reported while running. */
  detail?: string
  isError?: boolean
  label: string
  status: 'done' | 'error' | 'running'
  toolCallId: string
  toolName: string
}

/**
 * One renderable piece of an assistant message.
 *
 * The SDK delivers `UIMessage.parts` in the order the model produced them, each
 * carrying its own `state`. Reading them in order is what makes the transcript
 * legible: reasoning appears where it happened, and a tool call sits between the
 * sentences that led to it and followed it.
 */
interface Part {
  errorText?: string
  index: number
  input?: unknown
  state?: string
  text?: string
  toolCallId?: string
  type: string
}

/** `tool-look`, `tool-edit`, … or `dynamic-tool` for anything unregistered. */
const toolNameOf = (part: Part): string | undefined => (
  part.type === 'dynamic-tool'
    ? 'tool'
    : part.type.startsWith('tool-') ? part.type.slice('tool-'.length) : undefined
)

const TOOL_STATUS: Record<string, AgentToolRun['status']> = {
  'input-available': 'running',
  'input-streaming': 'running',
  'output-available': 'done',
  'output-error': 'error',
}

const SETTLED = new Set(['done', 'output-available', 'output-error'])

const renderableParts = (message: unknown): Part[] => (
  ((message as { parts?: Part[] } | undefined)?.parts ?? [])
    .map((part, index) => ({ ...part, index }))
    .filter(part => part.type === 'text' || part.type === 'reasoning' || toolNameOf(part))
)

/** The prose of a message, which is what a reader wants on the clipboard. */
export const messageAnswerText = (message: unknown): string => (
  renderableParts(message)
    .filter(part => part.type === 'text')
    .map(part => part.text ?? '')
    .join('\n\n')
    .trim()
)

/**
 * Whether this message already has a block showing its own live state.
 *
 * The standalone activity line exists for the gaps when nothing is printing.
 * While a thinking block or a tool row is running it is redundant, and showing
 * both reads as two things happening at once when only one is.
 */
export const messageHasLiveBlock = (message: unknown): boolean => (
  renderableParts(message).some(part => !SETTLED.has(part.state ?? ''))
)

/**
 * Assistant prose is markdown, so it renders as markdown.
 *
 * Treating it as plain text leaves headings, emphasis, lists and fenced code
 * as literal characters on screen. It renders live rather than only once
 * settled: partial markdown degrades to plain text on its own, and swapping
 * representations at the end would reflow the message under the reader.
 */
function StreamedText({ active, value }: { active: boolean; value: string }) {
  // Reveal is paced here rather than by arrival, so bursty chunks read as an
  // even stream. Settled text renders whole. Deliberately no caret: a blinking
  // cursor makes smooth text read as someone typing at a keyboard, which is a
  // different and busier effect than prose simply arriving.
  const shown = useSmoothText(value, active)
  return (
    <div className="mona-agent-prose text-[12.5px] leading-[1.55] text-ink/88">
      <Markdown remarkPlugins={REMARK_PLUGINS}>{shown}</Markdown>
    </div>
  )
}

/**
 * Reasoning is secondary: dim, collapsed once it has settled, and never
 * competing with the answer for attention. It stays open while it is the live
 * block so the wait is legible, then folds itself away.
 */
function ThinkingBlock({ active, value }: { active: boolean; value: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(active)
  const [seconds, setSeconds] = useState(0)
  const startedRef = useRef<number | null>(null)

  useEffect(() => {
    // Timed here because the model never reports how long it thought.
    if (active) {
      startedRef.current ??= Date.now()
      const timer = window.setInterval(() => {
        setSeconds(Math.round((Date.now() - (startedRef.current ?? Date.now())) / 1000))
      }, 500)
      return () => window.clearInterval(timer)
    }
    setOpen(false)
    // Measure once more on settling. Relying only on the interval lost any run
    // shorter than a single tick, which left `seconds` at zero and the label
    // stuck reading "Thinking" forever on a block that had already finished.
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
              // A replayed message settles without ever streaming, so there is
              // nothing to have timed - say it thought, not how long.
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

/** A tool call as a step with a state, not a spinner with a name. */
function ToolBlock({ run }: { run: AgentToolRun }) {
  return (
    <div className="flex items-center gap-1.75 rounded-overlay bg-ink-deep/4 px-2.5 py-1.5 text-[11.5px]">
      <span className="grid size-5 shrink-0 place-items-center">
        {/* Only the running row animates. A settled row keeps a static mark, so
            a long transcript never holds more than one live canvas. */}
        {run.status === 'running' ? (
          <AgentStateOrb activity={activityForTool(run.toolName)} />
        ) : run.status === 'error' ? <TriangleAlert className="size-3 text-destructive" />
          : <Check className="size-3 text-[var(--success,#16a34a)]" />}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className={cn('min-w-0 truncate', run.status === 'running' ? 'text-foreground' : 'text-muted-foreground')}>
          {run.label}
        </span>
        {/* Shown while running as progress, and on failure as the reason. A
            red mark with no explanation tells the user nothing. */}
        {run.detail && run.status !== 'done' ? (
          <span className={cn('min-w-0 truncate text-mini', run.status === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
            {run.detail}
          </span>
        ) : null}
      </span>
    </div>
  )
}

/**
 * Copies the answer, not the transcript around it.
 *
 * A reply is usually wanted as text to paste elsewhere, so reasoning summaries
 * and tool rows are left out - they are how the answer was reached, not the
 * answer. Revealed on hover rather than always shown, because a control on every
 * message competes with the reading.
 */
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

/**
 * Renders one assistant message as the ordered blocks it actually is.
 *
 * `content` interleaves text, reasoning and tool calls in the order the model
 * produced them, each with its own index. Flattening it into "some text" and
 * "some thinking" loses the sequence - which is the difference between reading
 * the agent work and watching a progress bar.
 */
export function EditorAgentMessage({
  message,
  streaming,
  toolLabel,
}: {
  message: unknown
  streaming: boolean
  /** Turns a tool name and its input into the line the user reads. */
  toolLabel: (name: string, input: unknown) => string
}) {
  const parts = renderableParts(message)
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [message])

  if (!parts.length) return null
  return (
    // `w-full` because this is a flex child: without it the grid sizes to its
    // content, so a thinking or tool block started narrow and widened as text
    // arrived. Only user messages are meant to hug their content.
    <div className="group/message grid w-full gap-1.5">
      {parts.map(part => {
        // `state` comes from the part itself rather than being inferred from
        // position, so the live edge is always the one the SDK says it is.
        const active = streaming && part.state !== 'done' && part.state !== 'output-available'
        if (part.type === 'reasoning') {
          return <ThinkingBlock active={active} key={part.index} value={part.text ?? ''} />
        }
        const toolName = toolNameOf(part)
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
      {/* Only once the answer has settled: a control that appears mid-stream
          invites copying half a sentence. */}
      {streaming ? null : <CopyAnswer text={messageAnswerText(message)} />}
      <div ref={endRef} />
    </div>
  )
}

/**
 * Proof the agent is alive while nothing is printing.
 *
 * There are real gaps in an agent run - waiting on the first token, running a
 * tool, waiting on the next turn - and a UI that shows nothing during them is
 * indistinguishable from one that has died. Elapsed time makes the difference
 * legible without the reader having to guess.
 */
export function EditorAgentActivity({ startedAt }: { startedAt: number | null }) {
  const { t } = useTranslation()
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (startedAt === null) return undefined
    setElapsed(Math.max(0, Math.round((Date.now() - startedAt) / 1000)))
    const timer = window.setInterval(() => {
      setElapsed(Math.max(0, Math.round((Date.now() - startedAt) / 1000)))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])

  return (
    <output className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
      {/* The standalone design, not the inline one: this line appears on its own
          and is the only signal the agent is alive, so a 20px mark beside 10px
          text made the shimmer illegible. */}
      <AgentStateOrb activity="waiting" className="size-8" size={64} />
      <span className="mona-agent-shimmer">{t('foundation.editor.agent.working')}</span>
      {elapsed >= 1 ? <span className="tabular-nums opacity-70">{t('foundation.editor.agent.elapsed', { seconds: elapsed })}</span> : null}
    </output>
  )
}
