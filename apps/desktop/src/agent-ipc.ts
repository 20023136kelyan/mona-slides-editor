import { randomUUID } from 'node:crypto'
import { ipcMain, shell, type BrowserWindow, type IpcMainEvent } from 'electron'
import type { UIMessageChunk } from 'ai'

import {
  AgentSdkSession,
} from '@mona/agent-server/agent-sdk-session'
import {
  loginLocalClaudeAccount,
  readLocalClaudeLogin,
} from '@mona/agent-server/agent-sdk-auth'
import { readAnthropicModels } from '@mona/agent-server/agent-sdk-models'
import { AgentToolBridge } from '@mona/agent-server/agent-tool-bridge'
import { browsePexelsImages, browsePexelsVideos } from '@mona/agent-server/assets'
import {
  loginLocalCodexAccount,
  readLocalCodexAccount,
} from '@mona/agent-server/codex-account'
import { readCodexModels } from '@mona/agent-server/codex-models'
import { CodexSession } from '@mona/agent-server/codex-session'
import { ClaudeUiSession } from '@mona/agent-server/claude-ui-session'
import { EditorAgentRuntime } from '@mona/agent-server/editor-agent-runtime'
import type { ProjectAgentExecutor } from '@mona/agent-server/project-agent-contract'
import { ProjectAgentRuntime } from '@mona/agent-server/project-agent-runtime'
import { ProviderConversation } from '@mona/agent-server/provider-conversation'
import {
  PROJECT_AGENT_SYSTEM_INSTRUCTION,
  ProjectAgentSdkSession,
} from '@mona/agent-server/project-agent-sdk-session'
import {
  buildAgentSystemInstruction,
  isAgentContextMessage,
  isAgentProviderId,
  type AgentAccountDescriptor,
  type AgentContextMessage,
  type AgentModelDescriptor,
  type AgentProviderId,
} from '@mona/agent-protocol'
import { isProjectId, type ProjectRecord } from '@mona/project-core'

import { resolveClaudeExecutable } from './claude-binary.js'
import { resolveCodexExecutable } from './codex-binary.js'
import { projectStore, type ProjectStore } from './project-store.js'

const EFFORT_LEVELS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

const isEffortLevel = (value: unknown): value is string => (
  typeof value === 'string' && EFFORT_LEVELS.has(value)
)

interface PromptMessage {
  context?: unknown
  effort?: unknown
  model?: unknown
  providerId?: unknown
  text?: unknown
  userMessageId?: unknown
}

interface ProjectPromptMessage extends PromptMessage {
  projectId?: unknown
}

interface ValidPrompt {
  context: AgentContextMessage[]
  effort?: string
  modelId: string
  providerId: AgentProviderId
  text: string
  userMessageId: string
}

const readPrompt = (message: PromptMessage): ValidPrompt | null => {
  if (typeof message.text !== 'string' || !message.text.trim()) return null
  const text = message.text.trim()
  const rawContext = Array.isArray(message.context)
    ? message.context.filter(isAgentContextMessage)
    : []
  const context: AgentContextMessage[] = []
  const ids = new Set<string>()
  for (const candidate of rawContext) {
    if (ids.has(candidate.id)) continue
    ids.add(candidate.id)
    context.push({ ...candidate, content: candidate.content.trim() })
  }
  const requestedId = typeof message.userMessageId === 'string' && message.userMessageId
    ? message.userMessageId
    : undefined
  const newestUser = [...context].reverse().find(candidate => candidate.role === 'user')
  const userMessageId = requestedId ?? newestUser?.id ?? randomUUID()
  if (!context.some(candidate => candidate.id === userMessageId)) {
    context.push({ content: text, id: userMessageId, role: 'user' })
  }
  const providerId = isAgentProviderId(message.providerId) ? message.providerId : 'anthropic'
  const modelId = typeof message.model === 'string' && message.model.trim()
    ? message.model.trim()
    : 'default'
  return {
    context,
    ...(isEffortLevel(message.effort) ? { effort: message.effort } : {}),
    modelId,
    providerId,
    text,
    userMessageId,
  }
}

const projectContext = (project: ProjectRecord, text: string): string => {
  const artifacts = project.artifacts.length
    ? project.artifacts.map(artifact => (
        `- ${artifact.name} (${artifact.documentType}, ${artifact.state})`
      )).join('\n')
    : '- No documents are attached yet.'
  return `<current_project>
Title: ${project.title || 'Untitled project'}
Documents:
${artifacts}
</current_project>

<user_request>
${text}
</user_request>`
}

class WindowProjectAgent {
  readonly #conversation: ProviderConversation
  readonly #projectId: string
  readonly #store: ProjectStore
  readonly #window: BrowserWindow

  constructor(
    window: BrowserWindow,
    projectId: string,
    store: ProjectStore,
    executor: ProjectAgentExecutor,
  ) {
    this.#projectId = projectId
    this.#store = store
    this.#window = window
    this.#conversation = new ProviderConversation({
      createSession: async options => {
        if (options.providerId === 'openai') {
          const runtime = await ProjectAgentRuntime.create(executor)
          return new CodexSession({
            ...(options.effort ? { effort: options.effort } : {}),
            executablePath: resolveCodexExecutable(),
            modelId: options.modelId,
            onSessionId: options.onSessionId,
            ...(options.binding ? { resumeSessionId: options.binding.sessionId } : {}),
            runtime,
            systemInstruction: PROJECT_AGENT_SYSTEM_INSTRUCTION,
          })
        }
        const executablePath = resolveClaudeExecutable()
        return new ClaudeUiSession(new ProjectAgentSdkSession({
          ...(options.effort ? { effort: options.effort as never } : {}),
          executor,
          ...(executablePath ? { executablePath } : {}),
          modelId: options.modelId,
          onSessionId: options.onSessionId,
          ...(options.binding ? { resumeSessionId: options.binding.sessionId } : {}),
        }), options.modelId)
      },
      emit: chunk => {
        if (window.isDestroyed()) return
        window.webContents.send('mona:project-agent:chunk', { chunk, projectId })
      },
      onAssistant: async message => {
        await store.appendMessage(projectId, { ...message, role: 'assistant' })
      },
      onBinding: async (providerId, binding) => {
        await store.setAgentSessionBinding(projectId, providerId, binding)
      },
    })
  }

  prompt(message: ProjectPromptMessage): void {
    void this.#send(message)
  }

  async interrupt(): Promise<void> {
    await this.#conversation.interrupt()
  }

  close(): void {
    this.#conversation.close()
  }

  async #send(message: ProjectPromptMessage): Promise<void> {
    const prompt = readPrompt(message)
    if (!prompt) return
    try {
      const project = await this.#store.peek(this.#projectId)
      if (!project) throw new Error('This project no longer exists.')
      this.#conversation.hydrate(project.agentSessions)
      const context = project.messages.map(({ content, id, role }) => ({ content, id, role }))
      this.#conversation.prompt(
        { ...prompt, context },
        text => projectContext(project, text),
      )
    }
    catch (error) {
      this.#emit({
        errorText: error instanceof Error ? error.message : 'The project agent failed.',
        type: 'error',
      })
      this.#emit({ type: 'finish' })
    }
  }

  #emit(chunk: UIMessageChunk): void {
    if (this.#window.isDestroyed()) return
    this.#window.webContents.send('mona:project-agent:chunk', {
      chunk,
      projectId: this.#projectId,
    })
  }
}

class WindowAgent {
  readonly #bridge: AgentToolBridge
  readonly #conversation: ProviderConversation
  readonly #projectAgents = new Map<string, WindowProjectAgent>()
  readonly #projectExecutor: (projectId: string) => ProjectAgentExecutor
  readonly #projectStore: ProjectStore
  readonly #window: BrowserWindow

  constructor(
    window: BrowserWindow,
    store: ProjectStore,
    projectExecutor: (projectId: string) => ProjectAgentExecutor,
  ) {
    this.#window = window
    this.#projectExecutor = projectExecutor
    this.#projectStore = store
    this.#bridge = new AgentToolBridge({
      send: request => this.#emit('mona:agent:tool-request', request),
    })
    this.#conversation = new ProviderConversation({
      createSession: async options => {
        if (options.providerId === 'openai') {
          const runtime = await EditorAgentRuntime.create(this.#bridge)
          return new CodexSession({
            ...(options.effort ? { effort: options.effort } : {}),
            executablePath: resolveCodexExecutable(),
            modelId: options.modelId,
            onSessionId: options.onSessionId,
            ...(options.binding ? { resumeSessionId: options.binding.sessionId } : {}),
            runtime,
            systemInstruction: buildAgentSystemInstruction(),
          })
        }
        const executablePath = resolveClaudeExecutable()
        return new ClaudeUiSession(new AgentSdkSession({
          bridge: this.#bridge,
          ...(options.effort ? { effort: options.effort as never } : {}),
          ...(executablePath ? { executablePath } : {}),
          modelId: options.modelId,
          onSessionId: options.onSessionId,
          ...(options.binding ? { resumeSessionId: options.binding.sessionId } : {}),
        }), options.modelId)
      },
      emit: chunk => this.#emit('mona:agent:chunk', chunk),
    })
  }

  prompt(message: PromptMessage): void {
    const prompt = readPrompt(message)
    if (prompt) this.#conversation.prompt(prompt)
  }

  fulfil(id: unknown, outcome: { errorText?: unknown; output?: unknown }): void {
    if (typeof id !== 'string') return
    this.#bridge.fulfil(id, {
      errorText: typeof outcome.errorText === 'string' ? outcome.errorText : undefined,
      output: outcome.output,
    })
  }

  async interrupt(): Promise<void> {
    await this.#conversation.interrupt()
  }

  promptProject(message: ProjectPromptMessage): void {
    if (!isProjectId(message.projectId)) return
    let agent = this.#projectAgents.get(message.projectId)
    if (!agent) {
      agent = new WindowProjectAgent(
        this.#window,
        message.projectId,
        this.#projectStore,
        this.#projectExecutor(message.projectId),
      )
      this.#projectAgents.set(message.projectId, agent)
    }
    agent.prompt(message)
  }

  async interruptProject(projectId: unknown): Promise<void> {
    if (!isProjectId(projectId)) return
    await this.#projectAgents.get(projectId)?.interrupt()
  }

  close(): void {
    this.#bridge.closeAll('The editor window closed.')
    this.#conversation.close()
    for (const projectAgent of this.#projectAgents.values()) projectAgent.close()
    this.#projectAgents.clear()
  }

  #emit(channel: string, payload: unknown): void {
    if (this.#window.isDestroyed()) return
    this.#window.webContents.send(channel, payload)
  }
}

const agents = new Map<number, WindowAgent>()

const agentFor = (event: IpcMainEvent): WindowAgent | undefined => agents.get(event.sender.id)

export const attachWindowAgent = (
  window: BrowserWindow,
  store: ProjectStore = projectStore,
  projectExecutor: (projectId: string) => ProjectAgentExecutor = () => ({
    apply: async () => {
      throw new Error('Project document capabilities are not configured.')
    },
    prepare: async () => [],
  }),
): void => {
  const id = window.webContents.id
  agents.set(id, new WindowAgent(window, store, projectExecutor))
  window.once('closed', () => {
    agents.get(id)?.close()
    agents.delete(id)
  })
}

const disconnectedAccount = (providerId: AgentProviderId): AgentAccountDescriptor => ({
  connected: false,
  providerId,
})

const readAccounts = async (): Promise<AgentAccountDescriptor[]> => {
  const claudePath = resolveClaudeExecutable() ?? 'claude'
  const codexPath = resolveCodexExecutable()
  const [anthropic, openai] = await Promise.allSettled([
    readLocalClaudeLogin(Date.now(), claudePath),
    readLocalCodexAccount(codexPath),
  ])
  return [
    anthropic.status === 'fulfilled'
      ? {
          accountLabel: anthropic.value.email ?? 'Claude account connected',
          connected: anthropic.value.connected,
          ...(anthropic.value.plan ? { planLabel: anthropic.value.plan } : {}),
          providerId: 'anthropic',
        }
      : disconnectedAccount('anthropic'),
    openai.status === 'fulfilled' ? openai.value : disconnectedAccount('openai'),
  ]
}

const readModels = async (): Promise<AgentModelDescriptor[]> => {
  const [anthropic, openai] = await Promise.allSettled([
    readAnthropicModels(Date.now(), resolveClaudeExecutable()),
    readCodexModels(resolveCodexExecutable()),
  ])
  return [
    ...(anthropic.status === 'fulfilled'
      ? anthropic.value.map(model => ({ ...model, providerId: 'anthropic' as const }))
      : []),
    ...(openai.status === 'fulfilled' ? openai.value : []),
  ]
}

export const registerAgentIpc = (): void => {
  ipcMain.handle('mona:accounts', readAccounts)
  ipcMain.handle('mona:account:connect', async (_event, providerId: unknown) => {
    if (!isAgentProviderId(providerId)) throw new Error('Unknown agent provider.')
    if (providerId === 'openai') {
      return await loginLocalCodexAccount({
        executablePath: resolveCodexExecutable(),
        openExternal: url => shell.openExternal(url),
      })
    }
    const executablePath = resolveClaudeExecutable() ?? 'claude'
    const login = await loginLocalClaudeAccount(executablePath)
    return {
      accountLabel: login.email ?? 'Claude account connected',
      connected: login.connected,
      ...(login.plan ? { planLabel: login.plan } : {}),
      providerId: 'anthropic',
    } satisfies AgentAccountDescriptor
  })
  ipcMain.handle('mona:models', readModels)

  ipcMain.handle('mona:media:browse', async (_event, kind: unknown, query: unknown) => (
    kind === 'videos'
      ? browsePexelsVideos((query ?? {}) as never)
      : browsePexelsImages((query ?? {}) as never)
  ))

  ipcMain.on('mona:agent:prompt', (event, message: PromptMessage) => {
    agentFor(event)?.prompt(message ?? {})
  })
  ipcMain.on('mona:agent:tool-result', (event, result: {
    errorText?: unknown
    id?: unknown
    output?: unknown
  }) => {
    agentFor(event)?.fulfil(result?.id, result ?? {})
  })
  ipcMain.on('mona:agent:interrupt', event => {
    void agentFor(event)?.interrupt()
  })
  ipcMain.on('mona:project-agent:prompt', (event, message: ProjectPromptMessage) => {
    agentFor(event)?.promptProject(message ?? {})
  })
  ipcMain.on('mona:project-agent:interrupt', (event, projectId: unknown) => {
    void agentFor(event)?.interruptProject(projectId)
  })
}
