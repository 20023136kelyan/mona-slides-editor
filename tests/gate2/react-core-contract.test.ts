import { describe, expect, it } from 'vitest'
import {
  applyPresentationCommand,
  cloneSerializable,
  createPresentationTransaction,
  normalizeSerializable,
} from '@mona/presentation-core'
import { createEditorStore, editorActions } from '@mona/editor-state'
import {
  createGate2OperationScenarios,
  createGate2Presentation,
} from '@mona/parity-fixtures'

describe('React presentation adapter and framework-neutral core', () => {
  for (const [index, scenario] of createGate2OperationScenarios().entries()) {
    it(`produces identical normalized state: ${scenario.name}`, () => {
      const initial = createGate2Presentation()
      const expected = applyPresentationCommand(
        cloneSerializable(initial),
        cloneSerializable(scenario.command),
      ).state
      const store = createEditorStore({ presentation: cloneSerializable(initial) })

      store.dispatch(editorActions.transactionCommitted(createPresentationTransaction({
        id: `gate2-react-adapter-${index}`,
        label: scenario.name,
        origin: 'test',
        commands: [cloneSerializable(scenario.command)],
      })))

      expect(store.getState().lastRejectedTransaction).toBeNull()
      expect(normalizeSerializable(store.getState().presentation)).toEqual(normalizeSerializable(expected))
    })
  }
})
