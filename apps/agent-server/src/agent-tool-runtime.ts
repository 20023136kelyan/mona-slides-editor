import { z } from 'zod'

export type AgentToolContent =
  | { data: string; mediaType: string; type: 'image' }
  | { text: string; type: 'text' }

export interface AgentToolResult {
  content: AgentToolContent[]
}

export interface AgentRuntimeTool {
  description: string
  inputSchema: Record<string, unknown>
  name: string
}

export interface AgentToolRuntime {
  readonly root: string
  readonly tools: readonly AgentRuntimeTool[]
  dispose: () => Promise<void>
  execute: (name: string, input: unknown) => Promise<AgentToolResult>
}

export const jsonSchemaFor = (schema: z.ZodType): Record<string, unknown> => (
  z.toJSONSchema(schema) as Record<string, unknown>
)
