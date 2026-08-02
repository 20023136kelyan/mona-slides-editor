import type { UIMessageChunk } from 'ai'

import type { AgentContextMessage, AgentProviderId } from '@mona/agent-protocol'

export interface ProviderSessionPrompt {
  assistantMessageId: string
  handoff?: readonly AgentContextMessage[]
  text: string
  userMessageId: string
}

export interface ProviderSession {
  readonly modelId: string
  readonly providerId: AgentProviderId
  close: () => void
  interrupt: () => Promise<void>
  run: () => AsyncGenerator<UIMessageChunk>
  send: (prompt: ProviderSessionPrompt) => void
}
