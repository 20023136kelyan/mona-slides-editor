export interface AgentMessagePart {
  errorText?: string
  index: number
  input?: unknown
  state?: string
  text?: string
  toolCallId?: string
  toolName?: string
  type: string
}

export const agentToolName = (part: AgentMessagePart): string | undefined => (
  part.type === 'dynamic-tool'
    ? part.toolName ?? 'tool'
    : part.type.startsWith('tool-') ? part.type.slice('tool-'.length) : undefined
)

const SETTLED = new Set(['done', 'output-available', 'output-error'])

export const renderableAgentParts = (message: unknown): AgentMessagePart[] => (
  ((message as { parts?: AgentMessagePart[] } | undefined)?.parts ?? [])
    .map((part, index) => ({ ...part, index }))
    .filter(part => part.type === 'text' || part.type === 'reasoning' || agentToolName(part))
)

export const agentMessageText = (message: unknown): string => (
  renderableAgentParts(message)
    .filter(part => part.type === 'text')
    .map(part => part.text ?? '')
    .join('\n\n')
    .trim()
)

export const agentMessageHasLiveBlock = (message: unknown): boolean => (
  renderableAgentParts(message).some(part => !SETTLED.has(part.state ?? ''))
)
