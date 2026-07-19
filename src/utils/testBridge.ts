import type { Pinia } from 'pinia'
import {
  useKeyboardStore,
  useMainStore,
  useScreenStore,
  useSlidesStore,
  useSnapshotStore,
} from '@/store'

export interface MonaReferenceState {
  schemaVersion: 1
  presentation: ReturnType<typeof useSlidesStore>['$state']
  editor: ReturnType<typeof useMainStore>['$state']
  keyboard: ReturnType<typeof useKeyboardStore>['$state']
  screen: ReturnType<typeof useScreenStore>['$state']
  history: ReturnType<typeof useSnapshotStore>['$state']
}

interface MonaTestBridge {
  readonly schemaVersion: 1
  isReady: () => boolean
  getState: () => MonaReferenceState
}

declare global {
  interface Window {
    __MONA_TEST__?: MonaTestBridge
  }
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/**
 * Development-only compatibility contract used by the Vue/React parity suite.
 * It exposes serializable product state, never store mutation methods.
 */
export const installTestBridge = (pinia: Pinia) => {
  const slidesStore = useSlidesStore(pinia)
  const mainStore = useMainStore(pinia)
  const keyboardStore = useKeyboardStore(pinia)
  const screenStore = useScreenStore(pinia)
  const snapshotStore = useSnapshotStore(pinia)

  window.__MONA_TEST__ = Object.freeze({
    schemaVersion: 1 as const,
    isReady: () => slidesStore.slides.length > 0 && snapshotStore.snapshotLength > 0,
    getState: (): MonaReferenceState => clone({
      schemaVersion: 1,
      presentation: slidesStore.$state,
      editor: mainStore.$state,
      keyboard: keyboardStore.$state,
      screen: screenStore.$state,
      history: snapshotStore.$state,
    }),
  })
}
