import { useChat } from '@ai-sdk/react'
import { useEffect, useMemo, useRef } from 'react'

import { AgentSocketTransport } from '@/features/editor/agent/agent-socket-transport'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

/**
 * The agent, as the dock consumes it.
 *
 * One harness: the Claude Agent SDK, over a socket. The loop runs in a subprocess
 * on the server and the transport fulfils its tool requests from this tab, which is
 * why there is no `onToolCall` here - the socket answers them itself.
 *
 * There used to be a second path, an AI SDK POST route serving Google and OpenAI.
 * It went when the deck became a directory of files: that design needs a workspace
 * and a subprocess, and a request/response route has neither. Google offers no
 * subscription path for third-party apps, so it was BYOK-only anyway; Codex will
 * arrive as its own adapter over the same file-based workflow.
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

  // The transport owns a connection, so it must survive re-renders.
  const socket = useMemo(
    () => new AgentSocketTransport({
      effort: () => effortRef.current,
      model: () => modelRef.current,
      runtime,
    }),
    [runtime],
  )

  useEffect(() => () => socket.close(), [socket])

  return useChat({ transport: socket })
}
