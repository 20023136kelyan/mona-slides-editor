import type { PresentationState } from '@mona/presentation-core'

const hashText = (value: string): string => {
  let first = 0x811c9dc5
  let second = 0x01000193
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ code, 0x811c9dc5)
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`
}

const compactBinarySources = (_key: string, value: unknown) => {
  if (typeof value !== 'string') return value
  if (!value.startsWith('data:') && !value.startsWith('blob:')) return value
  return `binary:${value.length}:${hashText(value)}`
}

/**
 * A deterministic document revision used to guard agent previews. It includes
 * every serializable presentation field while compacting embedded media so a
 * large image does not make every revision check expensive.
 */
export const getAgentDocumentRevision = (presentation: PresentationState): string => (
  `mona-${hashText(JSON.stringify(presentation, compactBinarySources))}`
)

