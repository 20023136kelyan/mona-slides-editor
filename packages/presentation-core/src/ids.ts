import { nanoid } from 'nanoid'

export const DEFAULT_PRESENTATION_ID_LENGTH = 10

export type PresentationIdFactory = (length?: number) => string

/** IDs are opaque, URL-safe, and generated outside mutation commands. */
export const createPresentationId: PresentationIdFactory = (
  length = DEFAULT_PRESENTATION_ID_LENGTH,
) => nanoid(length)

/** Deterministic IDs keep operation and agent-transaction fixtures reproducible. */
export const createDeterministicIdFactory = (prefix = 'fixture'): PresentationIdFactory => {
  let sequence = 0
  return () => `${prefix}-${++sequence}`
}
