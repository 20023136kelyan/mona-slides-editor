import { ipcMain, type BrowserWindow, type IpcMainEvent } from 'electron'

import { readLocalClaudeLogin } from '@mona/agent-server/agent-sdk-auth'
import { readAnthropicModels } from '@mona/agent-server/agent-sdk-models'
import { AgentSdkSession } from '@mona/agent-server/agent-sdk-session'
import { AgentStreamTranslator } from '@mona/agent-server/agent-sdk-stream'
import { AgentToolBridge } from '@mona/agent-server/agent-tool-bridge'
import { browsePexelsImages, browsePexelsVideos } from '@mona/agent-server/assets'
import { ProjectAgentSdkSession } from '@mona/agent-server/project-agent-sdk-session'
import type { ProjectAgentExecutor } from '@mona/agent-server/project-agent-sdk-session'
import { isProjectId, type ProjectRecord } from '@mona/project-core'
import { resolveClaudeExecutable } from './claude-binary.js'
import { projectStore, type ProjectStore } from './project-store.js'

/**
 * The agent, wired straight to the window.
 *
 * This replaces a WebSocket, its JSON framing, a 64 MiB frame cap, an Origin check
 * on the upgrade, a CORS layer and a signed session cookie — roughly 790 lines that
 * existed only because the editor was a web page talking to a separate process.
 * Electron gives the same shape for free: `invoke`/`handle` for request-response,
 * `webContents.send` for the stream.
 *
 * One thing does not simplify away. The agent still has to ask the *renderer* to
 * act, because the renderer owns the live deck, and Electron has no main→renderer
 * `invoke`. So `AgentToolBridge` keeps its id correlation and its timeout; only the
 * transport under it changes.
 */

const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

const isEffortLevel = (value: unknown): value is 'low' | 'medium' | 'high' | 'xhigh' | 'max' => (
  typeof value === 'string' && EFFORT_LEVELS.has(value)
)

interface PromptMessage {
  effort?: unknown
  model?: unknown
  text?: unknown
}

interface ProjectPromptMessage extends PromptMessage {
  projectId?: unknown
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
  readonly #executor: ProjectAgentExecutor
  readonly #projectId: string
  readonly #store: ProjectStore
  readonly #window: BrowserWindow
  #session?: ProjectAgentSdkSession
  #start?: Promise<ProjectAgentSdkSession>
  #turn?: Promise<void>

  constructor(
    window: BrowserWindow,
    projectId: string,
    store: ProjectStore,
    executor: ProjectAgentExecutor,
  ) {
    this.#executor = executor
    this.#projectId = projectId
    this.#store = store
    this.#window = window
  }

  prompt(message: ProjectPromptMessage): void {
    if (typeof message.text !== 'string' || !message.text.trim()) return
    void this.#send(message)
  }

  async interrupt(): Promise<void> {
    await this.#session?.interrupt()
  }

  close(): void {
    this.#session?.close()
    void this.#turn?.catch(() => undefined)
  }

  async #send(message: ProjectPromptMessage): Promise<void> {
    try {
      const project = await this.#store.peek(this.#projectId)
      if (!project) throw new Error('This project no longer exists.')
      const session = await (this.#start ??= this.#startSession(message, project))
      session.send(projectContext(project, message.text as string))
    }
    catch (error) {
      this.#emit({
        errorText: error instanceof Error ? error.message : 'The project agent failed.',
        type: 'error',
      })
      this.#emit({ type: 'finish' })
    }
  }

  async #startSession(
    message: ProjectPromptMessage,
    project: ProjectRecord,
  ): Promise<ProjectAgentSdkSession> {
    const claudeExecutable = resolveClaudeExecutable()
    const session = new ProjectAgentSdkSession({
      ...(isEffortLevel(message.effort) ? { effort: message.effort } : {}),
      executor: this.#executor,
      ...(claudeExecutable ? { executablePath: claudeExecutable } : {}),
      modelId: typeof message.model === 'string' && message.model ? message.model : 'default',
      onSessionId: sessionId => {
        void this.#store.setAgentSessionId(this.#projectId, sessionId).catch(() => undefined)
      },
      ...(project.agentSessionId ? { resumeSessionId: project.agentSessionId } : {}),
    })
    this.#session = session
    this.#turn = this.#stream(session)
    return session
  }

  async #stream(session: ProjectAgentSdkSession): Promise<void> {
    const translator = new AgentStreamTranslator()
    try {
      for await (const sdkMessage of session.run()) {
        for (const chunk of translator.translate(sdkMessage)) this.#emit(chunk)
      }
    }
    catch (error) {
      this.#emit({
        errorText: error instanceof Error ? error.message : 'The project agent failed.',
        type: 'error',
      })
      this.#emit({ type: 'finish' })
    }
  }

  #emit(chunk: unknown): void {
    if (this.#window.isDestroyed()) return
    this.#window.webContents.send('mona:project-agent:chunk', {
      chunk,
      projectId: this.#projectId,
    })
  }
}

/**
 * One window's conversation.
 *
 * Scoped to the window rather than to a connection, because a window is what owns a
 * deck. Closing it ends the turn and fails any handler the agent is blocked on —
 * without that the subprocess would sit waiting on a renderer that has gone.
 */
class WindowAgent {
  readonly #bridge: AgentToolBridge
  readonly #window: BrowserWindow
  #session?: AgentSdkSession
  #turn?: Promise<void>
  readonly #projectAgents = new Map<string, WindowProjectAgent>()
  readonly #projectExecutor: (projectId: string) => ProjectAgentExecutor
  readonly #projectStore: ProjectStore

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
  }

  prompt(message: PromptMessage): void {
    if (typeof message.text !== 'string' || !message.text) return
    // Started on the first prompt and never again: a later one is queued onto the
    // same session, which is what makes steering work rather than opening a second
    // conversation over the top of the first.
    this.#session ??= this.#start(message)
    this.#session.send(message.text)
  }

  fulfil(id: unknown, outcome: { errorText?: unknown; output?: unknown }): void {
    if (typeof id !== 'string') return
    this.#bridge.fulfil(id, {
      errorText: typeof outcome.errorText === 'string' ? outcome.errorText : undefined,
      output: outcome.output,
    })
  }

  async interrupt(): Promise<void> {
    await this.#session?.interrupt()
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
    this.#session?.close()
    for (const projectAgent of this.#projectAgents.values()) projectAgent.close()
    this.#projectAgents.clear()
    void this.#turn?.catch(() => undefined)
  }

  #start(message: PromptMessage): AgentSdkSession {
    const claudeExecutable = resolveClaudeExecutable()
    const session = new AgentSdkSession({
      bridge: this.#bridge,
      // Validated against the SDK's own levels rather than trusted from the
      // renderer, so a bad value is dropped instead of failing the turn.
      ...(isEffortLevel(message.effort) ? { effort: message.effort } : {}),
      // Resolved per turn rather than cached: a build that unpacks the binary
      // somewhere else should be picked up without a restart.
      ...(claudeExecutable ? { executablePath: claudeExecutable } : {}),
      modelId: typeof message.model === 'string' && message.model ? message.model : 'default',
    })
    this.#turn = this.#stream(session)
    return session
  }

  async #stream(session: AgentSdkSession): Promise<void> {
    const translator = new AgentStreamTranslator()
    try {
      for await (const sdkMessage of session.run()) {
        for (const chunk of translator.translate(sdkMessage)) this.#emit('mona:agent:chunk', chunk)
      }
    }
    catch (error) {
      this.#emit('mona:agent:chunk', {
        errorText: error instanceof Error ? error.message : 'The agent failed.',
        type: 'error',
      })
    }
  }

  #emit(channel: string, payload: unknown): void {
    if (this.#window.isDestroyed()) return
    this.#window.webContents.send(channel, payload)
  }
}

const agents = new Map<number, WindowAgent>()

const agentFor = (event: IpcMainEvent): WindowAgent | undefined => agents.get(event.sender.id)

/** Attaches a window to the agent host, and detaches it when the window goes. */
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

/**
 * Registered once for the process, not per window.
 *
 * `ipcMain` is global, so handlers are keyed by the sender's id rather than closed
 * over a single window — otherwise a second window would silently drive the first
 * one's conversation.
 */
export const registerAgentIpc = (): void => {
  ipcMain.handle('mona:account', async () => {
    const login = await readLocalClaudeLogin()
    return {
      connected: login.connected,
      ...(login.connected
        ? {
            accountLabel: login.email ?? 'Claude account connected',
            ...(login.plan ? { planLabel: login.plan } : {}),
          }
        : {}),
    }
  })

  ipcMain.handle('mona:models', () => readAnthropicModels())

  ipcMain.handle('mona:media:browse', async (_event, kind: unknown, query: unknown) => (
    kind === 'videos'
      ? browsePexelsVideos((query ?? {}) as never)
      : browsePexelsImages((query ?? {}) as never)
  ))

  ipcMain.on('mona:agent:prompt', (event, message: PromptMessage) => {
    agentFor(event)?.prompt(message ?? {})
  })

  ipcMain.on('mona:agent:tool-result', (event, result: { errorText?: unknown; id?: unknown; output?: unknown }) => {
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
