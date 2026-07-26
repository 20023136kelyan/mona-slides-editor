import { useChat } from '@ai-sdk/react'
import { useEffect, useMemo, useRef } from 'react'

import { AgentIpcTransport } from '@/features/editor/agent/agent-ipc-transport'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

/**
 * The agent, as the dock consumes it.
 *
 * The loop runs in the Electron main process and the transport answers its tool
 * requests from this window, which is why there is no `onToolCall` here — the
 * transport handles them itself.
 *
 * There used to be two transports and, before that, two harnesses: an AI SDK POST
 * route for Google and OpenAI, then a WebSocket for the Agent SDK. Both were shapes
 * a web page needed. On the desktop the agent host is in the same application, so
 * the conversation is IPC and nothing above this line noticed the change.
 */
export const useAgentChat = ({
  effort,
  model,
  runtime,
}: {
  /** Reasoning depth, when the chosen model accepts one. */
  effort?: string
  model: string
  runtime: EditorRuntime
}) => {
  // Read through refs so the memoised transport never holds a stale value.
  const modelRef = useRef(model)
  modelRef.current = model
  const effortRef = useRef(effort)
  effortRef.current = effort

  // The transport owns a tool-request subscription, so it must survive re-renders.
  const transport = useMemo(
    () => new AgentIpcTransport({
      effort: () => effortRef.current,
      model: () => modelRef.current,
      runtime,
    }),
    [runtime],
  )

  useEffect(() => () => transport.close(), [transport])

  return useChat({ transport })
}
