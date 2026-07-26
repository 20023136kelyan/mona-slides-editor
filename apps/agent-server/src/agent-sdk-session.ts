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
import {
  agentToolDescriptions,
  agentToolSchemas,
  buildAgentSystemInstruction,
} from '@mona/agent-protocol'

import { monaAgentEnv } from './agent-sdk-env.js'
import { AgentToolBridge } from './agent-tool-bridge.js'
import { AgentWorkspace, type FetchAsset } from './agent-workspace-disk.js'
import type { AssetBytes, DeckSnapshot } from './agent-workspace.js'

/**
 * How many model turns one prompt may take before the SDK stops it.
 *
 * Higher than it first looks necessary because the agent verifies its own work: a
 * single edit observed live cost nine calls once it re-looked, re-inspected and
 * retried. The ceiling only costs tokens when it is generous, but a low one
 * truncates a deck halfway through building it.
 */
const MAX_TURNS = 25

/**
 * The ordinary tools, which are the point.
 *
 * The deck is a directory, so the tools that work on directories are the right
 * ones. The previous surface deleted all of these and left the model reading the
 * document through a single custom tool - which is how a 23-slide deck arrived as
 * one 193 MB result, and why every edit had to be spelled in a vocabulary the
 * model could only guess at.
 *
 * `Bash` is here deliberately. Bulk document work - merging PDFs, converting
 * images, running a script over twenty slides - is what a shell is for, and the
 * alternative is a tool per operation, forever.
 */
const BUILT_IN_TOOLS = [
  'Bash', 'Edit', 'Glob', 'Grep', 'Read', 'WebFetch', 'WebSearch', 'Write',
]

/**
 * The workflow, shipped with the app rather than written into the workspace.
 *
 * Loading it as a local plugin is what lets `settingSources: []` stay: project
 * settings are discovered by walking *up* from `cwd`, measured, so a skill in the
 * workspace would mean opening that door. The workspace holds data; instructions
 * come from here.
 */
const pluginPath = (): string => (
  // Read when the turn starts rather than when this module loads, so a host that
  // configures its environment during startup is not racing the import. Relative to
  // this source when run directly; the desktop shell bundles this module somewhere
  // else entirely and points the variable at the shipped copy.
  process.env.MONA_AGENT_PLUGIN_DIR
  ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'agent-plugin')
)

/**
 * Only ours. Claude Code ships fourteen of its own - dataviz, security-review,
 * loop - none of which are about editing a deck, and together they cost 1,811
 * tokens of every turn's context against 20 for this one.
 */
const SKILLS = ['mona-deck']

interface LookImage {
  base64: string
  mediaType: string
  slideId: string
}

/**
 * A prompt stream the caller can push into after the turn has started.
 *
 * The SDK takes an async iterable rather than a single string, which is what makes
 * steering possible: a message pushed mid-run is queued onto the same session
 * instead of starting a new one.
 */
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

/** What the browser returns for a `snapshot` request. */
interface SnapshotOutput extends DeckSnapshot {
  revision: string
}

export interface AgentSdkSessionOptions {
  bridge: AgentToolBridge
  /**
   * How hard the model should think. Omitted leaves the SDK's own default of
   * `high`; a model that reports no supported levels must not be sent one.
   */
  effort?: EffortLevel
  /**
   * The `claude` binary to run, when the caller knows better than the SDK's own
   * search. It does once the application is packaged: the SDK resolves from its
   * own location, which stops being a real directory inside an archive.
   */
  executablePath?: string
  modelId: string
}

/**
 * One conversation, backed by the Agent SDK.
 *
 * The loop, compaction and tool dispatch are the SDK's. What this owns is the
 * prompt queue, the deck workspace, and the decision to run with neither the
 * host's settings nor its credentials.
 */
export class AgentSdkSession {
  readonly #bridge: AgentToolBridge
  readonly #effort?: EffortLevel
  readonly #executablePath?: string
  readonly #modelId: string
  readonly #queue = new PromptQueue()
  #query?: Query
  #workspace?: AgentWorkspace

  constructor({ bridge, effort, executablePath, modelId }: AgentSdkSessionOptions) {
    this.#bridge = bridge
    this.#effort = effort
    this.#executablePath = executablePath
    this.#modelId = modelId
  }

  /** Start the turn and stream everything the SDK emits. */
  async *run(): AsyncGenerator<SDKMessage> {
    const workspace = await this.#openWorkspace()
    const running = query({
      options: {
        allowedTools: ['mcp__mona__*', ...BUILT_IN_TOOLS],
        // The deck's own directory, so `Read deck/slides/02.json` is what the
        // model writes and `Grep` searches the deck rather than the machine.
        cwd: workspace.root,
        // Only sent when chosen: a model that supports no levels rejects one, and
        // omitting it keeps the SDK's own default.
        ...(this.#effort ? { effort: this.#effort } : {}),
        env: monaAgentEnv(),
        // Thinking is `omitted` by default: the deltas arrive carrying only a
        // token estimate, so a reasoning panel would open on nothing. Measured
        // live - summarized returns ~590 characters where omitted returns zero.
        // `summarized` is as much as the SDK offers; there is no raw mode.
        extraArgs: { 'thinking-display': 'summarized' },
        includePartialMessages: true,
        // Only when the caller resolved one; omitted, the SDK searches itself.
        ...(this.#executablePath ? { pathToClaudeCodeExecutable: this.#executablePath } : {}),
        maxTurns: MAX_TURNS,
        mcpServers: {
          mona: createSdkMcpServer({
            name: 'mona',
            tools: this.#monaTools(),
            version: '1.0.0',
          }),
        },
        model: this.#modelId,
        plugins: [{ path: pluginPath(), skipMcpDiscovery: true, type: 'local' }],
        // Isolation mode: do not read this machine's ~/.claude, project settings
        // or CLAUDE.md. The skill arrives as a plugin instead, by absolute path.
        settingSources: [],
        skills: SKILLS,
        systemPrompt: buildAgentSystemInstruction(),
        tools: BUILT_IN_TOOLS,
      },
      prompt: this.#queue.stream(),
    })
    this.#query = running
    yield* running
  }

  /** Queue a message. Mid-run this is steering; before the run it is the prompt. */
  send(text: string): void {
    this.#queue.push(text)
  }

  async interrupt(): Promise<void> {
    await this.#query?.interrupt()
  }

  close(): void {
    this.#queue.close()
    this.#bridge.closeAll('The editor disconnected.')
    // Fire and forget: the socket is already going away, and a temp directory left
    // behind is a leak worth logging rather than something to block a close on.
    void this.#workspace?.dispose().catch(() => undefined)
    this.#workspace = undefined
  }

  async #openWorkspace(): Promise<AgentWorkspace> {
    const existing = this.#workspace
    if (existing) return existing
    const snapshot = await this.#snapshot()
    const workspace = await AgentWorkspace.create({
      fetchAsset: this.#fetchAsset,
      revision: snapshot.revision,
      snapshot,
    })
    this.#workspace = workspace
    return workspace
  }

  async #snapshot(): Promise<SnapshotOutput> {
    return await this.#bridge.request('snapshot', {}) as SnapshotOutput
  }

  /**
   * One asset, one round trip.
   *
   * They cannot travel with the snapshot: one real deck's images came to 342 MB
   * of base64 in a single frame, against a 100 MiB socket limit, which closed the
   * connection before the agent had begun. Per-asset keeps every frame small and
   * costs only latency we are already paying for the render.
   */
  readonly #fetchAsset: FetchAsset = async url => (
    await this.#bridge.request('asset', { url }) as AssetBytes | undefined
  )

  /**
   * The tools a filesystem cannot provide.
   *
   * Each runs here, in this process, but the deck is in the browser - so it asks
   * the browser and waits. A failure throws: the MCP server turns that into an
   * error result the model can read and recover from, which is why every message
   * from the browser is phrased for it.
   */
  #monaTools() {
    return [
      /**
       * Raw base64 becomes image content, because the point is that the model
       * actually sees the slide rather than reading a string about it. Images
       * below a few pixels are rejected upstream with "Could not process image";
       * real renders are never that small.
       */
      tool(
        'look',
        agentToolDescriptions.look,
        agentToolSchemas.look.shape,
        async args => {
          const output = await this.#bridge.request('look', args)
          const images = (output as { images?: LookImage[] } | undefined)?.images ?? []
          if (!images.length) {
            return { content: [{ text: 'No slides could be rendered.', type: 'text' as const }] }
          }
          return {
            content: images.flatMap(image => [
              { text: `Slide ${image.slideId}:`, type: 'text' as const },
              { data: image.base64, mimeType: image.mediaType, type: 'image' as const },
            ]),
          }
        },
        { annotations: { readOnlyHint: true } },
      ),

      /**
       * The commit boundary. Not marked read-only, so it is never batched
       * alongside another call: two of these racing would each read a workspace
       * the other was still writing.
       */
      tool(
        'apply',
        agentToolDescriptions.apply,
        agentToolSchemas.apply.shape,
        async args => {
          const workspace = await this.#openWorkspace()
          const deck = await workspace.read()
          if (deck.invalid.length) {
            // Named, because the model can fix a file it knows is broken.
            throw new Error(
              `These files are not valid JSON, so nothing was applied: ${deck.invalid.join(', ')}. Fix them and apply again.`,
            )
          }

          // Bytes for anything the agent created, so the browser can ingest it.
          const addedAssets: Record<string, { base64: string; mediaType: string }> = {}
          const missing: string[] = []
          for (const path of deck.addedAssets) {
            const asset = await workspace.addedAsset(path)
            if (asset) addedAssets[path] = asset
            else missing.push(path)
          }
          if (missing.length) {
            throw new Error(
              `These assets are referenced but not in deck/assets/: ${missing.join(', ')}. Write the file, then apply again.`,
            )
          }

          const output = await this.#bridge.request('apply', {
            addedAssets,
            expectedRevision: workspace.revision,
            explanation: args.explanation,
            slides: deck.slides,
            theme: deck.theme,
            title: deck.title,
          })
          const { slideCount } = (output ?? {}) as { slideCount?: number }
          // Re-taken so the workspace matches what was just committed: the deck's
          // revision has moved, and a second apply against the old one would be
          // refused as stale even though nothing else changed.
          const snapshot = await this.#snapshot()
          await workspace.take({ fetchAsset: this.#fetchAsset, revision: snapshot.revision, snapshot })
          return {
            content: [{
              text: `Applied to the deck${slideCount ? ` (${slideCount} slides)` : ''}. The change is committed and visible to the user.`,
              type: 'text' as const,
            }],
          }
        },
      ),

      /** The recovery path when the user has edited the deck mid-run. */
      tool(
        'sync',
        agentToolDescriptions.sync,
        agentToolSchemas.sync.shape,
        async () => {
          const workspace = await this.#openWorkspace()
          const snapshot = await this.#snapshot()
          await workspace.take({ fetchAsset: this.#fetchAsset, revision: snapshot.revision, snapshot })
          return {
            content: [{
              text: `Re-read the deck: ${snapshot.slides.length} slides in deck/slides/. Any file changes you had not applied are gone.`,
              type: 'text' as const,
            }],
          }
        },
      ),
    ]
  }
}
