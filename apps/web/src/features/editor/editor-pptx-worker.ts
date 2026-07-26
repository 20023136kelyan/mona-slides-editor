/// <reference lib="webworker" />

import { parse } from '@mona/pptx-parser'

import type { ParsedPptxPresentation } from '@/features/editor/editor-pptx-import'
import { createPowerPointPackageBacking } from '@/features/editor/editor-pptx-package'

interface ParsePowerPointRequest {
  fileName: string
  source: ArrayBuffer
}

const workerScope = self as DedicatedWorkerGlobalScope

workerScope.addEventListener('message', event => {
  const request = event.data as ParsePowerPointRequest
  void (async () => {
    try {
      workerScope.postMessage({ stage: 'inventory', type: 'progress' })
      const packagePromise = createPowerPointPackageBacking(request.source, request.fileName)
      workerScope.postMessage({ stage: 'parse', type: 'progress' })
      const parsedPromise = parse(request.source, {
        audioMode: 'base64',
        imageMode: 'base64',
        videoMode: 'base64',
      }) as Promise<ParsedPptxPresentation>
      const [backing, parsed] = await Promise.all([packagePromise, parsedPromise])
      workerScope.postMessage(
        { backing, parsed, type: 'complete' },
        [backing.bytes.buffer],
      )
    }
    catch (error) {
      workerScope.postMessage({
        message: error instanceof Error ? error.message : 'Unable to parse the PowerPoint package',
        type: 'error',
      })
    }
  })()
})
