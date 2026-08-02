import { useChat } from '@ai-sdk/react'
import { useEffect, useMemo } from 'react'
import type { UIMessage } from 'ai'
import type { AgentProviderId } from '@mona/agent-protocol'

import type { ProjectRecord } from '@mona/project-core'

import { monaBridge } from '@/lib/mona-bridge'

import { ProjectAgentIpcTransport } from './project-agent-ipc-transport'

export const projectMessageText = (message: Pick<UIMessage, 'parts'>): string => (
  message.parts
    .filter(part => part.type === 'text')
    .map(part => (part as { text: string }).text)
    .join('\n')
    .trim()
)

const initialMessages = (project: ProjectRecord): UIMessage[] => (
  project.messages.map(message => ({
    id: message.id,
    parts: [{ text: message.content, type: 'text' }],
    role: message.role,
  }))
)

export const useProjectAgentChat = ({
  effort,
  model,
  onProjectChange,
  project,
  providerId,
}: {
  effort?: string
  model: string
  onProjectChange: (project: ProjectRecord) => void
  project: ProjectRecord
  providerId: AgentProviderId
}) => {
  const transport = useMemo(() => new ProjectAgentIpcTransport({
    model: '',
    projectId: project.id,
    providerId: 'anthropic',
  }), [project.id])

  useEffect(() => {
    transport.updateSelection({ effort, model, providerId })
  }, [effort, model, providerId, transport])
  return useChat({
    id: `project:${project.id}`,
    messages: initialMessages(project),
    onFinish: event => {
      const content = projectMessageText(event.message)
      if (!content) return
      void monaBridge().projects.appendMessage(project.id, {
        content,
        id: event.message.id,
        role: 'assistant',
        status: event.isError
          ? 'error'
          : event.isAbort || event.isDisconnect
            ? 'interrupted'
            : 'complete',
      }).then(onProjectChange)
    },
    transport,
  })
}
