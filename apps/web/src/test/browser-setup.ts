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
  models: async () => [
    { effortLevels: ['low', 'medium', 'high'], id: 'default', name: 'Default (recommended)' },
    { effortLevels: ['low', 'medium', 'high'], id: 'sonnet', name: 'Sonnet' },
  ],
}

window.mona = bridge
