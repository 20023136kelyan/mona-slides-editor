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
import type {
  DocumentJobRecord,
  PresentationDocumentChange,
} from '@mona/document-jobs'
import { z } from 'zod'

import { monaAgentEnv } from './agent-sdk-env.js'
import {
  ProjectAgentWorkspace,
  type ProjectWorkspaceDocument,
} from './project-agent-workspace.js'

const MAX_TURNS = 25
const BUILT_IN_TOOLS = [
  'Bash', 'Edit', 'Glob', 'Grep', 'Read', 'WebFetch', 'WebSearch', 'Write',
]
const SKILLS = ['mona-project']

const pluginPath = (): string => (
  process.env.MONA_AGENT_PLUGIN_DIR
  ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'agent-plugin')
)

const SYSTEM_INSTRUCTION = `You are Mona's project agent. A project is a durable
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

export interface ProjectAgentExecutor {
  apply: (
    explanation: string,
    changes: PresentationDocumentChange[],
  ) => Promise<DocumentJobRecord>
  prepare: () => Promise<ProjectWorkspaceDocument[]>
}

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
  #workspace?: ProjectAgentWorkspace

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
    const workspace = await this.#openWorkspace()
    const running = query({
      options: {
        allowedTools: ['mcp__mona_project__*', ...BUILT_IN_TOOLS],
        cwd: workspace.root,
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
        systemPrompt: SYSTEM_INSTRUCTION,
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
    void this.#workspace?.dispose().catch(() => undefined)
    this.#workspace = undefined
  }

  async #openWorkspace(): Promise<ProjectAgentWorkspace> {
    if (this.#workspace) return this.#workspace
    const workspace = await ProjectAgentWorkspace.create(await this.#executor.prepare())
    this.#workspace = workspace
    return workspace
  }

  #projectTools() {
    return [
      tool(
        'project_documents',
        'List the project documents, their workspace paths, and whether they can be edited.',
        z.object({}).shape,
        async () => {
          const workspace = await this.#openWorkspace()
          return {
            content: [{
              text: JSON.stringify(workspace.describe(), null, 2),
              type: 'text' as const,
            }],
          }
        },
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        'apply_changes',
        'Validate and durably write changed presentation workspaces back to their data sources as one ordered job.',
        z.object({
          documentIds: z.array(z.string()).optional()
            .describe('Artifact ids to apply. Omit to apply every changed editable document.'),
          explanation: z.string()
            .describe('One short sentence describing the multi-document change for the user.'),
        }).shape,
        async args => {
          const workspace = await this.#openWorkspace()
          const changes = await workspace.changes(args.documentIds)
          if (!changes.length) {
            return {
              content: [{
                text: 'No changed editable documents were found, so no job was created.',
                type: 'text' as const,
              }],
            }
          }
          const job = await this.#executor.apply(args.explanation, changes)
          await workspace.take(await this.#executor.prepare())
          const succeeded = job.steps.filter(step => step.status === 'succeeded')
          const failed = job.steps.filter(step => step.status === 'failed')
          return {
            content: [{
              text: [
                `Document job ${job.status}.`,
                `${succeeded.length} of ${job.steps.length} document steps succeeded.`,
                ...failed.map(step => `${step.name}: ${step.error ?? 'failed'}`),
              ].join('\n'),
              type: 'text' as const,
            }],
          }
        },
      ),
      tool(
        'sync_documents',
        'Discard uncommitted workspace changes and reload every attached document from its source.',
        z.object({}).shape,
        async () => {
          const workspace = await this.#openWorkspace()
          await workspace.take(await this.#executor.prepare())
          return {
            content: [{
              text: 'The project workspace now matches the current source documents.',
              type: 'text' as const,
            }],
          }
        },
      ),
    ]
  }
}
