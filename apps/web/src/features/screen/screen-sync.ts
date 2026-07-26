import { monaBridge } from '@/lib/mona-bridge'

import type { ScreenSyncMessage } from '@/features/screen/screen-types'

/**
 * The channel the presenter and audience windows talk over.
 *
 * Deliberately shaped like the `BroadcastChannel` it replaces — same
 * `postMessage`, same `onmessage`, same `close` — because the protocol running
 * over it is worth keeping and the transport is not. Four files exchange a
 * dozen message types across two windows; none of that had to change, and none
 * of it did.
 *
 * A `BroadcastChannel` reaches every context of one origin *in one process*.
 * Two `BrowserWindow`s are two renderer processes, so it reaches neither of
 * them from the other. The main process relays instead, sending to every window
 * except the one that spoke — which is the rule `BroadcastChannel` followed too,
 * and the reason a sender never has to filter out its own messages.
 */

export interface ScreenSyncEvent {
  data: ScreenSyncMessage
}

export class ScreenSyncChannel {
  onmessage: ((event: ScreenSyncEvent) => void) | null = null
  readonly #unsubscribe: () => void

  constructor() {
    this.#unsubscribe = monaBridge().screen.onSync(message => {
      this.onmessage?.({ data: message as ScreenSyncMessage })
    })
  }

  postMessage(message: ScreenSyncMessage): void {
    monaBridge().screen.sync(message)
  }

  close(): void {
    this.#unsubscribe()
    this.onmessage = null
  }
}
