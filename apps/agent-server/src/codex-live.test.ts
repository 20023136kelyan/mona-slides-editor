import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessageChunk } from 'ai'
import { afterEach, expect, it } from 'vitest'

import { readLocalCodexAccount } from './codex-account.js'
import { readCodexModels } from './codex-models.js'
import { CodexSession } from './codex-session.js'
import type { AgentToolRuntime } from './agent-tool-runtime.js'

const live = process.env.MONA_LIVE_CODEX_TEST === '1'
const executablePath = process.env.MONA_CODEX_EXECUTABLE ?? 'codex'
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true })))
})

it.runIf(live)('uses the local ChatGPT login and completes a streamed app-server turn', async () => {
  const account = await readLocalCodexAccount(executablePath)
  expect(account).toMatchObject({ connected: true, providerId: 'openai' })
  const models = await readCodexModels(executablePath)
  expect(models.length).toBeGreaterThan(0)

  const root = await mkdtemp(join(tmpdir(), 'mona-codex-live-'))
  roots.push(root)
  let probeCalls = 0
  const runtime: AgentToolRuntime = {
    dispose: async () => undefined,
    execute: async name => {
      expect(name).toBe('mona_probe')
      probeCalls += 1
      return { content: [{ text: 'The Mona probe succeeded.', type: 'text' }] }
    },
    root,
    tools: [{
      description: 'Required smoke-test probe. Call it exactly once before replying.',
      inputSchema: { additionalProperties: false, properties: {}, type: 'object' },
      name: 'mona_probe',
    }],
  }
  let threadId = ''
  const session = new CodexSession({
    effort: models[0]?.effortLevels?.includes('low') ? 'low' : undefined,
    executablePath,
    modelId: models[0]!.id,
    onSessionId: value => { threadId = value },
    runtime,
    systemInstruction: 'Follow the user precisely. Call Mona tools whenever the user explicitly requires one.',
  })
  const chunks: UIMessageChunk[] = []
  const completed = (async () => {
    for await (const chunk of session.run()) {
      chunks.push(chunk)
      if (chunk.type === 'finish') return
    }
  })()
  session.send({
    assistantMessageId: 'assistant-live',
    text: 'Call mona_probe exactly once, then reply with exactly MONA_CODEX_SMOKE_OK and nothing else.',
    userMessageId: 'user-live',
  })
  await completed
  session.close()
  const text = chunks
    .flatMap(chunk => chunk.type === 'text-delta' ? [chunk.delta] : [])
    .join('')
  expect(probeCalls).toBe(1)
  expect(chunks.some(chunk => chunk.type === 'tool-input-available')).toBe(true)
  expect(chunks.some(chunk => chunk.type === 'tool-output-available')).toBe(true)
  expect(text).toContain('MONA_CODEX_SMOKE_OK')
  expect(threadId).toBeTruthy()

  const resumed = new CodexSession({
    effort: models[0]?.effortLevels?.includes('low') ? 'low' : undefined,
    executablePath,
    modelId: models[0]!.id,
    resumeSessionId: threadId,
    runtime,
    systemInstruction: 'Follow the user precisely. Call Mona tools whenever the user explicitly requires one.',
  })
  const resumedChunks: UIMessageChunk[] = []
  const resumedCompleted = (async () => {
    for await (const chunk of resumed.run()) {
      resumedChunks.push(chunk)
      if (chunk.type === 'finish') return
    }
  })()
  resumed.send({
    assistantMessageId: 'assistant-resumed',
    handoff: [
      { content: 'Remember the transfer token MONA_HANDOFF_42.', id: 'handoff-user', role: 'user' },
      { content: 'I will remember MONA_HANDOFF_42.', id: 'handoff-assistant', role: 'assistant' },
    ],
    text: 'Call mona_probe exactly once, then reply with exactly the transfer token from the handoff and nothing else.',
    userMessageId: 'user-resumed',
  })
  await resumedCompleted
  resumed.close()
  const resumedText = resumedChunks
    .flatMap(chunk => chunk.type === 'text-delta' ? [chunk.delta] : [])
    .join('')
  expect(probeCalls).toBe(2)
  expect(resumedText).toContain('MONA_HANDOFF_42')
}, 60_000)
