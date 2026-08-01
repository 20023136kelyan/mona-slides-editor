import { useChat } from '@ai-sdk/react'
import { useMemo } from 'react'
import type { UIMessage } from 'ai'

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
}: {
  effort?: string
  model: string
  onProjectChange: (project: ProjectRecord) => void
  project: ProjectRecord
}) => {
  const transport = useMemo(() => new ProjectAgentIpcTransport({
    effort: () => effort,
    model: () => model,
    projectId: project.id,
  }), [effort, model, project.id])

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
