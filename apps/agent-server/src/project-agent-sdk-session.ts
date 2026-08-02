import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  createSdkMcpServer,
  query,
  tool,
  type EffortLevel,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { monaAgentEnv } from './agent-sdk-env.js'
import type { ProjectAgentExecutor } from './project-agent-contract.js'
import type { AgentToolResult } from './agent-tool-runtime.js'
import {
  ProjectAgentRuntime,
  projectAgentToolSchemas,
} from './project-agent-runtime.js'

const MAX_TURNS = 25
const BUILT_IN_TOOLS = [
  'Bash', 'Edit', 'Glob', 'Grep', 'Read', 'WebFetch', 'WebSearch', 'Write',
]
const SKILLS = ['mona-project']

const pluginPath = (): string => (
  process.env.MONA_AGENT_PLUGIN_DIR
  ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'agent-plugin')
)

export const PROJECT_AGENT_SYSTEM_INSTRUCTION = `You are Mona's project agent. A project is a durable
conversation over references to user-owned documents that may live in several data
sources. The current project context is included with every user turn.

Editable presentations are ordinary files under documents/<id>/deck. Read and edit
those files with the built-in filesystem tools, then call apply_changes once to
validate and write all changed documents through a durable job. Nothing written in
the workspace reaches the user's files until that tool succeeds.

Coordinate work across the attached documents, research current information when
useful, and report progress precisely. Never claim that a document changed unless
apply_changes reports that its step succeeded. If a document is read-only, state
that plainly instead of inventing a result. Do not expose internal storage
identifiers unless the user explicitly asks for diagnostics.`

export type { ProjectAgentExecutor } from './project-agent-contract.js'

class PromptQueue {
  #closed = false
  readonly #queued: SDKUserMessage[] = []
  #wake?: () => void

  push(text: string): void {
    this.#queued.push({
      message: { content: text, role: 'user' },
      parent_tool_use_id: null,
      type: 'user',
    })
    this.#release()
  }

  close(): void {
    this.#closed = true
    this.#release()
  }

  async *stream(): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      const next = this.#queued.shift()
      if (next) {
        yield next
        continue
      }
      if (this.#closed) return
      await new Promise<void>(resolve => {
        this.#wake = resolve
      })
    }
  }

  #release(): void {
    const wake = this.#wake
    this.#wake = undefined
    wake?.()
  }
}

export interface ProjectAgentSdkSessionOptions {
  effort?: EffortLevel
  executor: ProjectAgentExecutor
  executablePath?: string
  modelId: string
  onSessionId?: (sessionId: string) => void
  resumeSessionId?: string
}

/**
 * A project-scoped Claude Agent SDK conversation.
 *
 * It deliberately shares Mona's auth, model, streaming and local execution
 * machinery while mounting a project toolset rather than pretending that the
 * editor's one-live-deck snapshot is a multi-document workspace.
 */
export class ProjectAgentSdkSession {
  readonly #effort?: EffortLevel
  readonly #executor: ProjectAgentExecutor
  readonly #executablePath?: string
  readonly #modelId: string
  readonly #onSessionId?: (sessionId: string) => void
  readonly #queue = new PromptQueue()
  readonly #resumeSessionId?: string
  #query?: Query
  #reportedSessionId?: string
  #runtime?: ProjectAgentRuntime

  constructor({
    effort,
    executor,
    executablePath,
    modelId,
    onSessionId,
    resumeSessionId,
  }: ProjectAgentSdkSessionOptions) {
    this.#effort = effort
    this.#executor = executor
    this.#executablePath = executablePath
    this.#modelId = modelId
    this.#onSessionId = onSessionId
    this.#resumeSessionId = resumeSessionId
  }

  async *run(): AsyncGenerator<SDKMessage> {
    const runtime = await this.#openRuntime()
    const running = query({
      options: {
        allowedTools: ['mcp__mona_project__*', ...BUILT_IN_TOOLS],
        cwd: runtime.root,
        ...(this.#effort ? { effort: this.#effort } : {}),
        env: monaAgentEnv(),
        extraArgs: { 'thinking-display': 'summarized' },
        includePartialMessages: true,
        ...(this.#executablePath ? { pathToClaudeCodeExecutable: this.#executablePath } : {}),
        maxTurns: MAX_TURNS,
        mcpServers: {
          mona_project: createSdkMcpServer({
            name: 'mona-project',
            tools: this.#projectTools(),
            version: '1.0.0',
          }),
        },
        model: this.#modelId,
        plugins: [{ path: pluginPath(), skipMcpDiscovery: true, type: 'local' }],
        ...(this.#resumeSessionId ? { resume: this.#resumeSessionId } : {}),
        settingSources: [],
        skills: SKILLS,
        systemPrompt: PROJECT_AGENT_SYSTEM_INSTRUCTION,
        tools: BUILT_IN_TOOLS,
      },
      prompt: this.#queue.stream(),
    })
    this.#query = running
    for await (const message of running) {
      const sessionId = (message as { session_id?: unknown }).session_id
      if (
        typeof sessionId === 'string'
        && sessionId
        && sessionId !== this.#reportedSessionId
      ) {
        this.#reportedSessionId = sessionId
        this.#onSessionId?.(sessionId)
      }
      yield message
    }
  }

  send(text: string): void {
    this.#queue.push(text)
  }

  async interrupt(): Promise<void> {
    await this.#query?.interrupt()
  }

  close(): void {
    this.#queue.close()
    void this.#runtime?.dispose().catch(() => undefined)
    this.#runtime = undefined
  }

  async #openRuntime(): Promise<ProjectAgentRuntime> {
    if (this.#runtime) return this.#runtime
    const runtime = await ProjectAgentRuntime.create(this.#executor)
    this.#runtime = runtime
    return runtime
  }

  #projectTools() {
    const run = async (name: string, args: unknown) => (
      toClaudeToolResult(await (await this.#openRuntime()).execute(name, args))
    )
    return [
      tool(
        'project_documents',
        'List the project documents, their workspace paths, and whether they can be edited.',
        projectAgentToolSchemas.project_documents.shape,
        async args => run('project_documents', args),
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        'apply_changes',
        'Validate and durably write changed presentation workspaces back to their data sources as one ordered job.',
        projectAgentToolSchemas.apply_changes.shape,
        async args => run('apply_changes', args),
      ),
      tool(
        'sync_documents',
        'Discard uncommitted workspace changes and reload every attached document from its source.',
        projectAgentToolSchemas.sync_documents.shape,
        async args => run('sync_documents', args),
      ),
    ]
  }
}

const toClaudeToolResult = (result: AgentToolResult) => ({
  content: result.content.map(content => content.type === 'text'
    ? { text: content.text, type: 'text' as const }
    : {
        data: content.data,
        mimeType: content.mediaType,
        type: 'image' as const,
      }),
})
