import { z } from 'zod'

import type {
  AgentRuntimeTool,
  AgentToolResult,
  AgentToolRuntime,
} from './agent-tool-runtime.js'
import { jsonSchemaFor } from './agent-tool-runtime.js'
import type { ProjectAgentExecutor } from './project-agent-contract.js'
import { ProjectAgentWorkspace } from './project-agent-workspace.js'

export const projectAgentToolSchemas = {
  apply_changes: z.object({
    documentIds: z.array(z.string()).optional()
      .describe('Artifact ids to apply. Omit to apply every changed editable document.'),
    explanation: z.string()
      .describe('One short sentence describing the multi-document change for the user.'),
  }),
  project_documents: z.object({}),
  sync_documents: z.object({}),
} as const

const TOOLS: readonly AgentRuntimeTool[] = [
  {
    description: 'List the project documents, their workspace paths, and whether they can be edited.',
    inputSchema: jsonSchemaFor(projectAgentToolSchemas.project_documents),
    name: 'project_documents',
  },
  {
    description: 'Validate and durably write changed presentation workspaces back to their data sources as one ordered job.',
    inputSchema: jsonSchemaFor(projectAgentToolSchemas.apply_changes),
    name: 'apply_changes',
  },
  {
    description: 'Discard uncommitted workspace changes and reload every attached document from its source.',
    inputSchema: jsonSchemaFor(projectAgentToolSchemas.sync_documents),
    name: 'sync_documents',
  },
]

/** Multi-document project mount shared by Claude MCP and Codex dynamic tools. */
export class ProjectAgentRuntime implements AgentToolRuntime {
  readonly #executor: ProjectAgentExecutor
  readonly #workspace: ProjectAgentWorkspace
  readonly tools = TOOLS

  private constructor(executor: ProjectAgentExecutor, workspace: ProjectAgentWorkspace) {
    this.#executor = executor
    this.#workspace = workspace
  }

  static async create(executor: ProjectAgentExecutor): Promise<ProjectAgentRuntime> {
    return new ProjectAgentRuntime(
      executor,
      await ProjectAgentWorkspace.create(await executor.prepare()),
    )
  }

  get root(): string {
    return this.#workspace.root
  }

  async execute(name: string, input: unknown): Promise<AgentToolResult> {
    if (name === 'project_documents') {
      projectAgentToolSchemas.project_documents.parse(input)
      return {
        content: [{ text: JSON.stringify(this.#workspace.describe(), null, 2), type: 'text' }],
      }
    }
    if (name === 'apply_changes') {
      const args = projectAgentToolSchemas.apply_changes.parse(input)
      const changes = await this.#workspace.changes(args.documentIds)
      if (!changes.length) {
        return {
          content: [{
            text: 'No changed editable documents were found, so no job was created.',
            type: 'text',
          }],
        }
      }
      const job = await this.#executor.apply(args.explanation, changes)
      await this.#workspace.take(await this.#executor.prepare())
      const succeeded = job.steps.filter(step => step.status === 'succeeded')
      const failed = job.steps.filter(step => step.status === 'failed')
      return {
        content: [{
          text: [
            `Document job ${job.status}.`,
            `${succeeded.length} of ${job.steps.length} document steps succeeded.`,
            ...failed.map(step => `${step.name}: ${step.error ?? 'failed'}`),
          ].join('\n'),
          type: 'text',
        }],
      }
    }
    if (name === 'sync_documents') {
      projectAgentToolSchemas.sync_documents.parse(input)
      await this.#workspace.take(await this.#executor.prepare())
      return {
        content: [{
          text: 'The project workspace now matches the current source documents.',
          type: 'text',
        }],
      }
    }
    throw new Error(`Unknown Mona project tool: ${name}`)
  }

  async dispose(): Promise<void> {
    await this.#workspace.dispose()
  }
}
