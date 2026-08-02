import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { expect, it } from 'vitest'

import {
  CodexAppServerClient,
  type CodexProcess,
} from './codex-app-server.js'

const fakeCodexProcess = () => {
  const events = new EventEmitter()
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  stdin.setEncoding('utf8')
  stdin.on('data', value => {
    for (const line of String(value).trim().split('\n')) {
      const request = JSON.parse(line) as { id?: number; method?: string }
      if (request.method === 'initialize') {
        stdout.write(`${JSON.stringify({ id: request.id, result: {} })}\n`)
      }
    }
  })
  const process = {
    kill: () => true,
    once: events.once.bind(events),
    stderr,
    stdin,
    stdout,
  } as unknown as CodexProcess
  return { events, process }
}

it('reports a native app-server exit after initialization', async () => {
  const fake = fakeCodexProcess()
  const client = await CodexAppServerClient.connect({
    executablePath: 'unused',
    processFactory: () => fake.process,
  })
  const failed = new Promise<Error>(resolve => client.onFailure(resolve))

  fake.events.emit('exit', 17, null)

  await expect(failed).resolves.toMatchObject({
    message: 'Codex app-server exited with code 17.',
  })
  await expect(client.request('model/list')).rejects.toThrow('closed')
})
