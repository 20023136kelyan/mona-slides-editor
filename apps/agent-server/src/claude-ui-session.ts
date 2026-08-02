import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { UIMessageChunk } from 'ai'

import { buildAgentContextHandoff } from '@mona/agent-protocol'

import { AgentStreamTranslator } from './agent-sdk-stream.js'
import type { ProviderSession, ProviderSessionPrompt } from './provider-session.js'

export interface ClaudeNativeSession {
  close: () => void
  interrupt: () => Promise<void>
  run: () => AsyncGenerator<SDKMessage>
  send: (text: string) => void
}

class AsyncQueue<Value> {
  #closed = false
  readonly #queued: Value[] = []
  #wake?: () => void

  push(value: Value): void {
    if (this.#closed) return
    this.#queued.push(value)
    this.#release()
  }

  close(): void {
    this.#closed = true
    this.#release()
  }

  async *stream(): AsyncGenerator<Value> {
    for (;;) {
      const value = this.#queued.shift()
      if (value !== undefined) {
        yield value
        continue
      }
      if (this.#closed) return
      await new Promise<void>(resolve => { this.#wake = resolve })
    }
  }

  #release(): void {
    const wake = this.#wake
    this.#wake = undefined
    wake?.()
  }
}

/** Provider-session adapter that keeps the existing Claude Agent SDK loop intact. */
export class ClaudeUiSession implements ProviderSession {
  readonly modelId: string
  readonly providerId = 'anthropic' as const
  readonly #native: ClaudeNativeSession
  readonly #output = new AsyncQueue<UIMessageChunk>()
  readonly #translator = new AgentStreamTranslator()
  #active = false
  #closed = false

  constructor(native: ClaudeNativeSession, modelId: string) {
    this.#native = native
    this.modelId = modelId
  }

  async *run(): AsyncGenerator<UIMessageChunk> {
    void this.#pump()
    yield* this.#output.stream()
  }

  send(prompt: ProviderSessionPrompt): void {
    if (!this.#active) {
      this.#active = true
      this.#output.push(this.#translator.startTurn(prompt.assistantMessageId))
    }
    const handoff = buildAgentContextHandoff(prompt.handoff ?? [])
    this.#native.send(handoff ? `${handoff}\n\n${prompt.text}` : prompt.text)
  }

  async interrupt(): Promise<void> {
    await this.#native.interrupt()
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#native.close()
    this.#output.close()
  }

  async #pump(): Promise<void> {
    try {
      for await (const message of this.#native.run()) {
        const chunks = this.#translator.translate(message)
        for (const chunk of chunks) {
          if (chunk.type === 'finish') this.#active = false
          this.#output.push(chunk)
        }
      }
    }
    catch (error) {
      this.#active = false
      this.#output.push({
        errorText: error instanceof Error ? error.message : 'The Claude agent failed.',
        type: 'error',
      })
      this.#output.push({ type: 'finish' })
    }
    finally {
      this.#output.close()
    }
  }
}
