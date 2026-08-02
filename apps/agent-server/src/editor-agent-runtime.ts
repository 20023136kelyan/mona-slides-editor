import {
  agentToolDescriptions,
  agentToolSchemas,
} from '@mona/agent-protocol'

import type {
  AgentRuntimeTool,
  AgentToolResult,
  AgentToolRuntime,
} from './agent-tool-runtime.js'
import { jsonSchemaFor } from './agent-tool-runtime.js'
import { AgentToolBridge } from './agent-tool-bridge.js'
import { AgentWorkspace, type FetchAsset } from './agent-workspace-disk.js'
import type { AssetBytes, DeckSnapshot } from './agent-workspace.js'

interface LookImage {
  base64: string
  mediaType: string
  slideId: string
}

interface SnapshotOutput extends DeckSnapshot {
  revision: string
}

const TOOLS: readonly AgentRuntimeTool[] = [
  {
    description: agentToolDescriptions.look,
    inputSchema: jsonSchemaFor(agentToolSchemas.look),
    name: 'look',
  },
  {
    description: agentToolDescriptions.apply,
    inputSchema: jsonSchemaFor(agentToolSchemas.apply),
    name: 'apply',
  },
  {
    description: agentToolDescriptions.sync,
    inputSchema: jsonSchemaFor(agentToolSchemas.sync),
    name: 'sync',
  },
]

/** One live editor deck mounted as an agent filesystem and three commit tools. */
export class EditorAgentRuntime implements AgentToolRuntime {
  readonly #bridge: AgentToolBridge
  readonly #workspace: AgentWorkspace
  readonly tools = TOOLS

  private constructor(bridge: AgentToolBridge, workspace: AgentWorkspace) {
    this.#bridge = bridge
    this.#workspace = workspace
  }

  static async create(bridge: AgentToolBridge): Promise<EditorAgentRuntime> {
    const snapshot = await bridge.request('snapshot', {}) as SnapshotOutput
    const fetchAsset: FetchAsset = async url => (
      await bridge.request('asset', { url }) as AssetBytes | undefined
    )
    return new EditorAgentRuntime(bridge, await AgentWorkspace.create({
      fetchAsset,
      revision: snapshot.revision,
      snapshot,
    }))
  }

  get root(): string {
    return this.#workspace.root
  }

  async execute(name: string, input: unknown): Promise<AgentToolResult> {
    if (name === 'look') return await this.#look(input)
    if (name === 'apply') return await this.#apply(input)
    if (name === 'sync') return await this.#sync(input)
    throw new Error(`Unknown Mona editor tool: ${name}`)
  }

  async dispose(): Promise<void> {
    await this.#workspace.dispose()
  }

  async #snapshot(): Promise<SnapshotOutput> {
    return await this.#bridge.request('snapshot', {}) as SnapshotOutput
  }

  readonly #fetchAsset: FetchAsset = async url => (
    await this.#bridge.request('asset', { url }) as AssetBytes | undefined
  )

  async #look(input: unknown): Promise<AgentToolResult> {
    const args = agentToolSchemas.look.parse(input)
    const output = await this.#bridge.request('look', args)
    const images = (output as { images?: LookImage[] } | undefined)?.images ?? []
    if (!images.length) {
      return { content: [{ text: 'No slides could be rendered.', type: 'text' }] }
    }
    return {
      content: images.flatMap(image => [
        { text: `Slide ${image.slideId}:`, type: 'text' as const },
        {
          data: image.base64,
          mediaType: image.mediaType,
          type: 'image' as const,
        },
      ]),
    }
  }

  async #apply(input: unknown): Promise<AgentToolResult> {
    const args = agentToolSchemas.apply.parse(input)
    const deck = await this.#workspace.read()
    if (deck.invalid.length) {
      throw new Error(
        `These files are not valid JSON, so nothing was applied: ${deck.invalid.join(', ')}. Fix them and apply again.`,
      )
    }

    const addedAssets: Record<string, { base64: string; mediaType: string }> = {}
    const missing: string[] = []
    for (const path of deck.addedAssets) {
      const asset = await this.#workspace.addedAsset(path)
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
      expectedRevision: this.#workspace.revision,
      explanation: args.explanation,
      powerPointSharedLayers: deck.powerPointSharedLayers,
      slides: deck.slides,
      theme: deck.theme,
      title: deck.title,
    })
    const { slideCount } = (output ?? {}) as { slideCount?: number }
    const snapshot = await this.#snapshot()
    await this.#workspace.take({
      fetchAsset: this.#fetchAsset,
      revision: snapshot.revision,
      snapshot,
    })
    return {
      content: [{
        text: `Applied to the deck${slideCount ? ` (${slideCount} slides)` : ''}. The change is committed and visible to the user.`,
        type: 'text',
      }],
    }
  }

  async #sync(input: unknown): Promise<AgentToolResult> {
    agentToolSchemas.sync.parse(input)
    const snapshot = await this.#snapshot()
    await this.#workspace.take({
      fetchAsset: this.#fetchAsset,
      revision: snapshot.revision,
      snapshot,
    })
    return {
      content: [{
        text: `Re-read the deck: ${snapshot.slides.length} slides in deck/slides/. Any file changes you had not applied are gone.`,
        type: 'text',
      }],
    }
  }
}
