import { useEffect, useRef, type ReactNode } from 'react'
import type { UIMessage } from 'ai'

import { AgentActivity, AgentMessage } from '@/features/agent/AgentMessage'
import {
  agentMessageHasLiveBlock,
  agentMessageText,
} from '@/features/agent/agent-message-parts'
import { cn } from '@/lib/utils'

export function AgentTranscript({
  busy,
  className,
  empty,
  error,
  messages,
  toolLabel,
}: {
  busy: boolean
  className?: string
  empty?: ReactNode
  error?: Error | null
  messages: UIMessage[]
  toolLabel: (name: string, input: unknown) => string
}) {
  const endRef = useRef<HTMLDivElement>(null)
  const lastMessage = messages.at(-1)
  const liveBlockShowing = busy
    && lastMessage?.role === 'assistant'
    && agentMessageHasLiveBlock(lastMessage)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, busy])

  return (
    <div
      aria-live="polite"
      className={cn('flex min-h-full flex-1 flex-col gap-2.5', className)}
      data-agent-transcript
    >
      {!messages.length ? empty : null}
      {messages.map((message, index) => (
        <div
          className={cn('flex max-w-full', message.role === 'user' && 'max-w-[88%] self-end')}
          key={message.id}
        >
          {message.role === 'user' ? (
            <p className="m-0 rounded-overlay bg-ink-deep/6 px-3 py-2 text-[12.5px] leading-[1.55] whitespace-pre-wrap">
              {agentMessageText(message)}
            </p>
          ) : (
            <AgentMessage
              message={message}
              streaming={busy && index === messages.length - 1}
              toolLabel={toolLabel}
            />
          )}
        </div>
      ))}
      {error ? (
        <p className="m-0 rounded-overlay bg-[color-mix(in_oklab,var(--destructive)_7%,var(--background))] px-3 py-2 text-[12.5px] text-destructive">
          {error.message}
        </p>
      ) : null}
      {busy && !liveBlockShowing ? <AgentActivity /> : null}
      <div ref={endRef} />
    </div>
  )
}
