import { useSyncExternalStore } from 'react'

import type { EditorRootState, EditorStore } from '@mona/editor-state'

export const useEditorSelector = <Value>(
  store: EditorStore,
  selector: (state: EditorRootState) => Value,
): Value => useSyncExternalStore(
  listener => store.subscribe(listener),
  () => selector(store.getState()),
  () => selector(store.getState()),
)
