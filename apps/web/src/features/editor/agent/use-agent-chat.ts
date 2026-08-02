import { useChat } from '@ai-sdk/react'
import { useEffect, useMemo } from 'react'
import type { AgentProviderId } from '@mona/agent-protocol'

import { AgentIpcTransport } from '@/features/editor/agent/agent-ipc-transport'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

/**
 * The agent, as the dock consumes it.
 *
 * The loop runs in the Electron main process and the transport answers its tool
 * requests from this window, which is why there is no `onToolCall` here — the
 * transport handles them itself.
 *
 * Claude and Codex keep their own native sessions in Electron. This hook remains
 * provider-neutral: the shared IPC transport carries canonical context, while the
 * main process pins the selected provider for the duration of each generation.
 */
export const useAgentChat = ({
  effort,
  model,
  providerId,
  runtime,
}: {
  /** Reasoning depth, when the chosen model accepts one. */
  effort?: string
  model: string
  providerId: AgentProviderId
  runtime: EditorRuntime
}) => {
  // The transport owns a tool-request subscription, so it must survive re-renders.
  const transport = useMemo(
    () => new AgentIpcTransport({
      model: '',
      providerId: 'anthropic',
      runtime,
    }),
    [runtime],
  )

  useEffect(() => {
    transport.updateSelection({ effort, model, providerId })
  }, [effort, model, providerId, transport])
  useEffect(() => {
    transport.open()
    return () => transport.close()
  }, [transport])

  return useChat({ transport })
}
