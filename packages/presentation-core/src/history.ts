import type { PresentationState } from './state'
import type { PresentationTransaction } from './transactions'

export interface PresentationHistoryEntry {
  transaction: PresentationTransaction
  state: PresentationState
  slideIndex: number
}

/**
 * Contract around the existing Dexie snapshot implementation.
 * History storage remains framework-neutral and serializable.
 */
export interface PresentationHistoryAdapter {
  initialize(state: PresentationState): Promise<void>
  commit(entry: PresentationHistoryEntry): Promise<void>
  canUndo(): boolean
  canRedo(): boolean
  undo(): Promise<PresentationHistoryEntry | undefined>
  redo(): Promise<PresentationHistoryEntry | undefined>
}
