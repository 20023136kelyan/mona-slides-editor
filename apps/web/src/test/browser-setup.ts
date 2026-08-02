import { configure } from 'vitest-browser-react/pure'

import '@/index.css'
import type { MonaBridge } from '@/lib/mona-bridge'

configure({ reactStrictMode: true })

const powerpointPackageRecords = new Map<string, unknown>()
const sketchRecords = new Map<string, unknown>()

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
  accounts: {
    connect: async providerId => ({
      accountLabel: 'test@example.com',
      connected: true,
      planLabel: providerId === 'anthropic' ? 'Claude Max' : 'ChatGPT Plus',
      providerId,
    }),
    list: async () => [
      {
        accountLabel: 'test@example.com',
        connected: true,
        planLabel: 'Claude Max',
        providerId: 'anthropic',
      },
      {
        accountLabel: 'test@example.com',
        connected: true,
        planLabel: 'ChatGPT Plus',
        providerId: 'openai',
      },
    ],
  },
  agent: {
    interrupt: () => {},
    onChunk: () => () => {},
    onToolRequest: () => () => {},
    respondTool: () => {},
    send: () => {},
  },
  projectAgent: {
    interrupt: () => {},
    onChunk: () => () => {},
    send: () => {},
  },
  projectJobs: {
    cancel: async () => {
      throw new Error('No project job is configured in this browser test.')
    },
    list: async () => [],
    onChange: () => () => {},
    read: async () => null,
  },
  projects: {
    addArtifact: async id => ({
      artifacts: [],
      createdAt: Date.now(),
      id,
      lastOpenedAt: Date.now(),
      messages: [],
      title: '',
      updatedAt: Date.now(),
      version: 2,
    }),
    appendMessage: async id => ({
      artifacts: [],
      createdAt: Date.now(),
      id,
      lastOpenedAt: Date.now(),
      messages: [],
      title: '',
      updatedAt: Date.now(),
      version: 2,
    }),
    create: async () => ({
      artifacts: [],
      createdAt: Date.now(),
      id: 'browser-test-project',
      lastOpenedAt: Date.now(),
      messages: [],
      title: '',
      updatedAt: Date.now(),
      version: 2,
    }),
    delete: async () => {},
    list: async () => [],
    onChange: () => () => {},
    read: async () => null,
    removeArtifact: async id => ({
      artifacts: [],
      createdAt: Date.now(),
      id,
      lastOpenedAt: Date.now(),
      messages: [],
      title: '',
      updatedAt: Date.now(),
      version: 2,
    }),
    rename: async (id, title) => ({
      artifacts: [],
      createdAt: Date.now(),
      id,
      lastOpenedAt: Date.now(),
      messages: [],
      title,
      updatedAt: Date.now(),
      version: 2,
    }),
  },
  browseMedia: async <Result>() => ({ data: [], total: 0, videos: [] }) as Result,
  documents: {
    cancelPowerPoint: async () => false,
    create: async presentation => ({
      createdAt: Date.now(),
      id: 'browser-test-document',
      lastOpenedAt: Date.now(),
      slideCount: typeof presentation === 'object' && presentation && 'slides' in presentation && Array.isArray(presentation.slides)
        ? presentation.slides.length
        : 0,
      title: '',
      updatedAt: Date.now(),
    }),
    createLocal: async presentation => ({
      createdAt: Date.now(),
      id: 'browser-test-local-document',
      lastOpenedAt: Date.now(),
      slideCount: typeof presentation === 'object' && presentation && 'slides' in presentation && Array.isArray(presentation.slides)
        ? presentation.slides.length
        : 0,
      title: '',
      updatedAt: Date.now(),
    }),
    delete: async () => {},
    discardRecovery: async () => {},
    duplicate: async (_id, title = '') => ({
      createdAt: Date.now(),
      id: 'browser-test-duplicate',
      lastOpenedAt: Date.now(),
      slideCount: 1,
      title,
      updatedAt: Date.now(),
    }),
    exportPowerPoint: async () => {
      throw new Error('No desktop PowerPoint writeback is configured in this browser test.')
    },
    ingestPowerPoint: async () => {
      throw new Error('No desktop PowerPoint ingestion is configured in this browser test.')
    },
    list: async () => [],
    moveToSource: async id => ({
      createdAt: Date.now(),
      id,
      lastOpenedAt: Date.now(),
      slideCount: 1,
      title: '',
      updatedAt: Date.now(),
    }),
    openSource: async () => {
      throw new Error('No source document is configured in this browser test.')
    },
    package: async () => new ArrayBuffer(0),
    read: async () => null,
    rename: async (id, title) => ({
      createdAt: Date.now(),
      id,
      lastOpenedAt: Date.now(),
      slideCount: 1,
      title,
      updatedAt: Date.now(),
    }),
    write: async () => Date.now(),
    writePreview: async () => null,
  },
  dataSources: {
    addLocalFolder: async () => null,
    chooseDefaultLocalFolder: async () => null,
    list: async () => [],
    listChildren: async () => [],
    listDocuments: async () => [],
    onChange: () => () => {},
    readDocument: async () => {
      throw new Error('No data source document is configured in this browser test.')
    },
    remove: async () => {},
    setDefaultSaveLocation: async () => {
      throw new Error('No data source is configured in this browser test.')
    },
  },
  documentData: {
    legacyMigration: {
      complete: async () => {},
      pending: async () => false,
    },
    powerpointPackages: {
      delete: async (_id, packageId) => { powerpointPackageRecords.delete(packageId) },
      listIds: async () => [...powerpointPackageRecords.keys()],
      read: async (_id, packageId) => powerpointPackageRecords.get(packageId),
      write: async (_id, packageId, value) => {
        powerpointPackageRecords.set(packageId, structuredClone(value))
        return packageId
      },
    },
    sketches: {
      delete: async (_id, slideId) => { sketchRecords.delete(slideId) },
      list: async () => [...sketchRecords.values()].map(value => structuredClone(value)),
      write: async (_id, slideId, value) => {
        sketchRecords.set(slideId, structuredClone(value))
        return slideId
      },
    },
  },
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
    collectGarbage: async () => {},
    flushPending: async () => {},
    // Nothing closes a test window, so nothing ever asks for a flush.
    onFlushRequest: () => () => {},
    /**
     * Returns something the browser can actually load.
     *
     * The real shell answers `mona://asset/…` from its own protocol handler, which
     * plain Chromium has no idea about — an `<img>` pointed at one simply fails, and
     * an insert that measures the image before placing it would never place it. A
     * test that cares about the *shape* of the URL stubs this itself.
     */
    writeAsset: async (_id: string, _name: string, bytes: ArrayBuffer) => URL.createObjectURL(new Blob([bytes])),
  },
  models: async () => [
    { effortLevels: ['low', 'medium', 'high'], id: 'default', name: 'Default (recommended)', providerId: 'anthropic' },
    { effortLevels: ['low', 'medium', 'high'], id: 'sonnet', name: 'Sonnet', providerId: 'anthropic' },
    { effortLevels: ['low', 'medium', 'high', 'xhigh'], id: 'gpt-test', name: 'Codex Test', providerId: 'openai' },
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
