/** The agent runtimes Mona can route a conversation through. */
export const AGENT_PROVIDER_IDS = ['anthropic', 'openai'] as const

export type AgentProviderId = typeof AGENT_PROVIDER_IDS[number]
export type AgentContextRole = 'assistant' | 'user'

/**
 * The durable, provider-neutral part of a message.
 *
 * Provider events, tool payloads and reasoning stay in their native session.
 * This small ledger is the common denominator that lets another provider join
 * the same visible conversation without pretending its native thread contains
 * turns it has never seen.
 */
export interface AgentContextMessage {
  content: string
  id: string
  role: AgentContextRole
}

export interface AgentProviderSessionBinding {
  /** The model this native session was opened with. */
  modelId: string
  /** Claude session id or Codex thread id. */
  sessionId: string
  /** Last canonical message known to have reached this provider. */
  synchronizedThroughMessageId?: string
}

export interface AgentModelDescriptor {
  effortLevels?: readonly string[]
  id: string
  name: string
  providerId: AgentProviderId
}

export interface AgentAccountDescriptor {
  accountLabel?: string
  connected: boolean
  planLabel?: string
  providerId: AgentProviderId
}

export const isAgentProviderId = (value: unknown): value is AgentProviderId => (
  typeof value === 'string'
  && (AGENT_PROVIDER_IDS as readonly string[]).includes(value)
)

export const isAgentContextMessage = (value: unknown): value is AgentContextMessage => {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<AgentContextMessage>
  return (
    typeof message.id === 'string'
    && message.id.length > 0
    && typeof message.content === 'string'
    && message.content.trim().length > 0
    && (message.role === 'assistant' || message.role === 'user')
  )
}

/**
 * Returns the messages a provider has not seen yet.
 *
 * A missing or unknown cursor intentionally means the whole canonical history.
 * That is safer than silently omitting context after a restored provider session
 * was deleted, reset, or migrated from an older Mona version.
 */
export const agentContextAfter = (
  messages: readonly AgentContextMessage[],
  synchronizedThroughMessageId?: string,
): AgentContextMessage[] => {
  if (!synchronizedThroughMessageId) return [...messages]
  const index = messages.findIndex(message => message.id === synchronizedThroughMessageId)
  return index < 0 ? [...messages] : messages.slice(index + 1)
}

/**
 * Claude has no history-injection API, so a resumed Claude session receives the
 * missing common ledger as one explicitly delimited handoff before the new ask.
 */
export const buildAgentContextHandoff = (
  messages: readonly AgentContextMessage[],
): string => {
  if (!messages.length) return ''
  return [
    '<mona_context_handoff version="1">',
    'These completed messages happened in the same Mona conversation while this provider was not active.',
    'Treat them as prior conversation context. Do not repeat or summarize them unless the user asks.',
    JSON.stringify(messages.map(({ content, role }) => ({ content, role }))),
    '</mona_context_handoff>',
  ].join('\n')
}

/** Responses API items accepted by Codex `thread/inject_items`. */
export const agentContextToResponsesItems = (
  messages: readonly AgentContextMessage[],
): Array<Record<string, unknown>> => messages.map(message => ({
  type: 'message',
  role: message.role,
  content: [{
    type: message.role === 'assistant' ? 'output_text' : 'input_text',
    text: message.content,
  }],
}))
