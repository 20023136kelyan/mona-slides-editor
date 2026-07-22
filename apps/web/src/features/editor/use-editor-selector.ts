import { useCallback, useSyncExternalStore } from 'react'

import type { EditorRootState, EditorStore } from '@mona/editor-state'

export const useEditorSelector = <Value>(
  store: EditorStore,
  selector: (state: EditorRootState) => Value,
): Value => useSyncExternalStore(
    // A stable subscribe identity keeps React from unsubscribing and
    // resubscribing the store on every render of every consumer.
    useCallback(listener => store.subscribe(listener), [store]),
    () => selector(store.getState()),
    () => selector(store.getState()),
  )
