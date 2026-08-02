import type { UIMessage } from 'ai'

import type { AgentContextMessage } from '@mona/agent-protocol'

export const uiMessageText = (message: Pick<UIMessage, 'parts'>): string => (
  message.parts
    .filter(part => part.type === 'text')
    .map(part => (part as { text: string }).text)
    .join('\n')
    .trim()
)

/** The common ledger sent to Electron; tool details stay in native sessions. */
export const agentContextFromUiMessages = (
  messages: readonly UIMessage[],
): AgentContextMessage[] => messages.flatMap(message => {
  if (message.role !== 'assistant' && message.role !== 'user') return []
  const content = uiMessageText(message)
  return content ? [{ content, id: message.id, role: message.role }] : []
})

export const newestUserMessage = (
  messages: readonly UIMessage[],
): { id: string; text: string } | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user') continue
    const text = uiMessageText(message)
    if (text) return { id: message.id, text }
  }
  return null
}
