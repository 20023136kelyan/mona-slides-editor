import { useCallback } from 'react'
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector'

import type { EditorRootState, EditorStore } from '@mona/editor-state'

export const useEditorSelector = <Value>(
  store: EditorStore,
  selector: (state: EditorRootState) => Value,
  equalityFn: (previous: Value, next: Value) => boolean = Object.is,
): Value => useSyncExternalStoreWithSelector(
    // A stable subscribe identity keeps React from unsubscribing and
    // resubscribing the store on every render of every consumer.
    useCallback(listener => store.subscribe(listener), [store]),
    useCallback(() => store.getState(), [store]),
    useCallback(() => store.getState(), [store]),
    selector,
    equalityFn,
  )
