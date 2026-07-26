import type { ParsedPptxPresentation } from '@/features/editor/editor-pptx-import'
import type { PowerPointPackageBacking } from '@/features/editor/editor-pptx-backing-store'

export type PowerPointImportStage = 'inventory' | 'parse'

export interface ParsePowerPointOptions {
  onProgress?: (stage: PowerPointImportStage) => void
  signal?: AbortSignal
}

export interface ParsedPowerPointPackage {
  backing: PowerPointPackageBacking
  parsed: ParsedPptxPresentation
}

type WorkerResponse =
  | { backing: PowerPointPackageBacking; parsed: ParsedPptxPresentation; type: 'complete' }
  | { message: string; type: 'error' }
  | { stage: PowerPointImportStage; type: 'progress' }

const abortError = (): Error => {
  const error = new Error('PowerPoint import was cancelled')
  error.name = 'AbortError'
  return error
}

const parseWithoutWorker = async (
  source: ArrayBuffer,
  fileName: string,
  options: ParsePowerPointOptions,
): Promise<ParsedPowerPointPackage> => {
  if (options.signal?.aborted) throw abortError()
  const [{ parse }, { createPowerPointPackageBacking }] = await Promise.all([
    import('@mona/pptx-parser'),
    import('@/features/editor/editor-pptx-package'),
  ])
  options.onProgress?.('inventory')
  const packagePromise = createPowerPointPackageBacking(source, fileName)
  options.onProgress?.('parse')
  const parsedPromise = parse(source, {
    audioMode: 'base64',
    imageMode: 'base64',
    videoMode: 'base64',
  }) as Promise<ParsedPptxPresentation>
  const [backing, parsed] = await Promise.all([packagePromise, parsedPromise])
  if (options.signal?.aborted) throw abortError()
  return { backing, parsed }
}

export const parsePowerPointPackage = (
  source: ArrayBuffer,
  fileName: string,
  options: ParsePowerPointOptions = {},
): Promise<ParsedPowerPointPackage> => {
  if (options.signal?.aborted) return Promise.reject(abortError())
  if (typeof Worker === 'undefined') return parseWithoutWorker(source, fileName, options)

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./editor-pptx-worker.ts', import.meta.url), {
      name: 'mona-powerpoint-import',
      type: 'module',
    })
    let settled = false
    const finish = (result: { error: Error } | { value: ParsedPowerPointPackage }) => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', onAbort)
      worker.terminate()
      if ('error' in result) reject(result.error)
      else resolve(result.value)
    }
    const onAbort = () => finish({ error: abortError() })
    options.signal?.addEventListener('abort', onAbort, { once: true })
    worker.addEventListener('error', event => {
      finish({ error: new Error(event.message || 'PowerPoint import worker failed') })
    })
    worker.addEventListener('message', event => {
      const response = event.data as WorkerResponse
      if (response.type === 'progress') options.onProgress?.(response.stage)
      else if (response.type === 'error') finish({ error: new Error(response.message) })
      else finish({ value: { backing: response.backing, parsed: response.parsed } })
    })
    worker.postMessage({ fileName, source }, [source])
  })
}
