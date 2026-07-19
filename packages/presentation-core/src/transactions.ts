import {
  applyPresentationCommand,
  type PresentationChange,
  type PresentationCommand,
} from './commands'
import {
  createPresentationId,
  type PresentationIdFactory,
} from './ids'
import type { PresentationState } from './state'
import {
  validatePresentationState,
  type PresentationValidationIssue,
} from './validation'

export type PresentationTransactionOrigin = 'user' | 'agent' | 'import' | 'system' | 'test'

export interface PresentationTransaction {
  id: string
  label: string
  origin: PresentationTransactionOrigin
  commands: PresentationCommand[]
}

export interface CreatePresentationTransactionInput {
  id?: string
  label: string
  origin: PresentationTransactionOrigin
  commands: PresentationCommand[]
}

export interface AppliedPresentationTransaction {
  ok: true
  state: PresentationState
  transaction: PresentationTransaction
  changes: PresentationChange[]
}

export interface RejectedPresentationTransaction {
  ok: false
  state: PresentationState
  transaction: PresentationTransaction
  reason: string
  issues: PresentationValidationIssue[]
}

export type PresentationTransactionResult =
  | AppliedPresentationTransaction
  | RejectedPresentationTransaction

export const createPresentationTransaction = (
  input: CreatePresentationTransactionInput,
  idFactory: PresentationIdFactory = createPresentationId,
): PresentationTransaction => ({
  id: input.id ?? idFactory(),
  label: input.label,
  origin: input.origin,
  commands: input.commands,
})

export const applyPresentationTransaction = (
  state: PresentationState,
  transaction: PresentationTransaction,
  options: { validate?: boolean } = {},
): PresentationTransactionResult => {
  const validate = options.validate ?? true
  let candidate = state
  const changes: PresentationChange[] = []

  try {
    for (const command of transaction.commands) {
      const result = applyPresentationCommand(candidate, command)
      candidate = result.state
      changes.push(result.change)
    }
  }
  catch (error) {
    return {
      ok: false,
      state,
      transaction,
      reason: error instanceof Error ? error.message : 'Unknown command failure',
      issues: [],
    }
  }

  if (validate) {
    const validation = validatePresentationState(candidate)
    if (!validation.valid) {
      return {
        ok: false,
        state,
        transaction,
        reason: 'Transaction produced an invalid presentation',
        issues: validation.issues,
      }
    }
  }

  return { ok: true, state: candidate, transaction, changes }
}
