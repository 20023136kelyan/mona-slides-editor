import { configure } from 'vitest-browser-react/pure'

import '@/index.css'
import type { MonaBridge } from '@/lib/mona-bridge'

configure({ reactStrictMode: true })

/**
 * A stand-in for the desktop shell.
 *
 * The renderer reaches its host through a preload-injected bridge, and these tests
 * run in a plain browser with no preload. Rather than let every consumer carry a
 * branch for "no shell" — a state that cannot occur in the real application — the
 * shell is stubbed here, the way a server gets stubbed for a page that fetches.
 *
 * Signed in on purpose: a signed-out dock replaces its composer with a prompt to go
 * and sign in, so anything testing the dock would be testing that instead.
 */
const bridge: MonaBridge = {
  account: async () => ({ accountLabel: 'test@example.com', connected: true, planLabel: 'Claude Max' }),
  agent: {
    interrupt: () => {},
    onChunk: () => () => {},
    onToolRequest: () => () => {},
    respondTool: () => {},
    send: () => {},
  },
  browseMedia: async <Result>() => ({ data: [], total: 0, videos: [] }) as Result,
  /**
   * Every dialog reads as cancelled.
   *
   * A test that wants a file to arrive stubs this itself; defaulting to "the
   * user picked nothing" keeps the ones that merely render an import button from
   * appearing to open a dialog that could never be answered here.
   */
  files: {
    open: async () => null,
    printToPdf: async () => null,
    save: async () => null,
  },
  deck: {
    clear: async () => {},
    collectGarbage: async () => {},
    // Nothing closes a test window, so nothing ever asks for a flush.
    onFlushRequest: () => () => {},
    // No deck on disk: every test builds the state it needs.
    read: async () => null,
    write: async () => Date.now(),
    /**
     * Returns something the browser can actually load.
     *
     * The real shell answers `mona://asset/…` from its own protocol handler, which
     * plain Chromium has no idea about — an `<img>` pointed at one simply fails, and
     * an insert that measures the image before placing it would never place it. A
     * test that cares about the *shape* of the URL stubs this itself.
     */
    writeAsset: async (_name: string, bytes: ArrayBuffer) => URL.createObjectURL(new Blob([bytes])),
  },
  models: async () => [
    { effortLevels: ['low', 'medium', 'high'], id: 'default', name: 'Default (recommended)' },
    { effortLevels: ['low', 'medium', 'high'], id: 'sonnet', name: 'Sonnet' },
  ],
  onMenuCommand: () => () => {},
  // No second window in a test page; nothing sends and nothing arrives.
  screen: {
    closeAudience: async () => {},
    onSync: () => () => {},
    openAudience: async () => {},
    sync: () => {},
  },
  // Not darwin: the tests assert the in-window menu bar, which is what Windows
  // and Linux get. The macOS chrome is verified in the running application.
  platform: 'linux',
}

window.mona = bridge
