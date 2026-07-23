import { afterEach, describe, expect, it, vi } from 'vitest'

import { parsePowerPointPackage } from '@/features/editor/editor-pptx-worker-client'

class FakeWorker extends EventTarget {
  terminated = false

  postMessage(): void {}

  terminate(): void {
    this.terminated = true
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PowerPoint import worker client', () => {
  it('rejects an already-cancelled import without creating a worker', async () => {
    const worker = vi.fn()
    vi.stubGlobal('Worker', worker)
    const controller = new AbortController()
    controller.abort()

    await expect(parsePowerPointPackage(new ArrayBuffer(1), 'cancelled.pptx', {
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker).not.toHaveBeenCalled()
  })

  it('terminates an in-flight worker when the caller cancels', async () => {
    const worker = new FakeWorker()
    class WorkerStub {
      constructor() {
        return worker
      }
    }
    vi.stubGlobal('Worker', WorkerStub)
    const controller = new AbortController()

    const pending = parsePowerPointPackage(new ArrayBuffer(1), 'cancelled.pptx', {
      signal: controller.signal,
    })
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminated).toBe(true)
  })
})
