import type {
  DataSourceChangeEvent,
  DataSourceDocument,
  DataSourceDocumentReference,
  DataSourceItem,
  DataSourcePickedDocument,
  DataSourceQuery,
  DataSourceSummary,
} from '@mona/data-source'
import type { DocumentJobRecord } from '@mona/document-jobs'
import type { EmbeddedFont } from '@mona/pptx-ingestion'
import type {
  PowerPointImportReport,
  PowerPointPackageReference,
  PresentationState,
  SlideTheme,
} from '@mona/presentation-core'
import type {
  AddProjectArtifactInput,
  AppendProjectMessageInput,
  CreateProjectInput,
  ProjectRecord,
  ProjectSummary,
} from '@mona/project-core'
import type {
  AgentAccountDescriptor,
  AgentContextMessage,
  AgentModelDescriptor,
  AgentProviderId,
} from '@mona/agent-protocol'

/**
 * The desktop shell, as the renderer sees it.
 *
 * Everything the editor cannot do for itself arrives through this one object,
 * exposed by a sandboxed preload. There is no fetch, no origin, and no port: the
 * renderer has no network surface at all, which is why the CORS layer, the Origin
 * gate and the signed session cookie could all go.
 *
 * Typed here rather than in the preload so the renderer's own type-check enforces
 * the contract; the two must be changed together.
 */
export type MonaAccount = AgentAccountDescriptor
export type MonaModel = AgentModelDescriptor

export interface MonaAgentPrompt {
  context: AgentContextMessage[]
  effort?: string
  model: string
  providerId: AgentProviderId
  text: string
  userMessageId: string
}

export interface MonaToolRequest {
  id: string
  input: unknown
  name: string
}

/** A file the user chose, as bytes; the renderer has no path to open. */
export interface MonaPickedFile {
  bytes: ArrayBuffer
  mediaType: string
  name: string
}

/** What a dialog will accept, in the shape the platform dialogs want. */
export interface MonaFileFilter {
  extensions: string[]
  name: string
}

export interface MonaDocumentSummary {
  createdAt: number
  id: string
  lastOpenedAt: number
  slideCount: number
  sourceReference?: DataSourceDocumentReference
  thumbnailRevision?: number
  title: string
  updatedAt: number
}

export interface MonaStoredDocument {
  presentation: unknown
  savedAt: number
  version: number
}

export interface MonaPowerPointIngestion {
  embeddedFonts: EmbeddedFont[]
  presentation: PresentationState
  report: PowerPointImportReport
  sourcePackage: PowerPointPackageReference
  usedFonts: string[]
}

export interface MonaPowerPointWriteback {
  bytes: ArrayBuffer
  plan: {
    mode: 'noop' | 'patch' | 'unsupported'
    operations: unknown[]
    touchedParts: string[]
    unsupported: Array<{ code: string; message: string }>
  }
}

export interface MonaBridge {
  accounts: {
    connect: (providerId: AgentProviderId) => Promise<MonaAccount>
    list: () => Promise<MonaAccount[]>
  }
  agent: {
    interrupt: () => void
    /** Returns an unsubscribe, because a dock can be opened and closed repeatedly. */
    onChunk: (listener: (chunk: unknown) => void) => () => void
    onToolRequest: (listener: (request: MonaToolRequest) => void) => () => void
    respondTool: (id: string, outcome: { errorText?: string; output?: unknown }) => void
    send: (prompt: MonaAgentPrompt) => void
  }
  projectAgent: {
    interrupt: (projectId: string) => void
    onChunk: (listener: (event: {
      chunk: unknown
      projectId: string
    }) => void) => () => void
    send: (prompt: MonaAgentPrompt & {
      projectId: string
    }) => void
  }
  projectJobs: {
    cancel: (projectId: string, jobId: string) => Promise<DocumentJobRecord>
    list: (projectId: string) => Promise<DocumentJobRecord[]>
    onChange: (listener: (projectId: string) => void) => () => void
    read: (projectId: string, jobId: string) => Promise<DocumentJobRecord | null>
  }
  projects: {
    addArtifact: (id: string, artifact: AddProjectArtifactInput) => Promise<ProjectRecord>
    appendMessage: (id: string, message: AppendProjectMessageInput) => Promise<ProjectRecord>
    create: (input?: CreateProjectInput) => Promise<ProjectRecord>
    delete: (id: string) => Promise<void>
    list: () => Promise<ProjectSummary[]>
    onChange: (listener: () => void) => () => void
    read: (id: string) => Promise<ProjectRecord | null>
    removeArtifact: (id: string, artifactId: string) => Promise<ProjectRecord>
    rename: (id: string, title: string) => Promise<ProjectRecord>
  }
  browseMedia: <Result>(kind: 'images' | 'videos', query: unknown) => Promise<Result>
  documents: {
    cancelPowerPoint: (operationId: string) => Promise<boolean>
    create: (
      presentation: unknown,
      sourceReference?: DataSourceDocumentReference,
    ) => Promise<MonaDocumentSummary>
    createLocal: (presentation: unknown, sourceId: string) => Promise<MonaDocumentSummary>
    delete: (id: string) => Promise<void>
    discardRecovery: (id: string) => Promise<void>
    duplicate: (id: string, title?: string) => Promise<MonaDocumentSummary>
    exportPowerPoint: (
      id: string,
      presentation: unknown,
      packageId?: string,
    ) => Promise<MonaPowerPointWriteback>
    ingestPowerPoint: (
      id: string,
      bytes: ArrayBuffer,
      request: {
        coordinateLabels?: string[]
        fileName: string
        fixedViewport?: boolean
        operationId: string
        theme: SlideTheme
      },
    ) => Promise<MonaPowerPointIngestion>
    list: () => Promise<MonaDocumentSummary[]>
    moveToSource: (id: string, sourceId: string) => Promise<MonaDocumentSummary>
    openSource: (reference: DataSourceDocumentReference) => Promise<MonaDocumentSummary>
    package: (id: string) => Promise<ArrayBuffer>
    read: (id: string) => Promise<MonaStoredDocument | null>
    rename: (id: string, title: string) => Promise<MonaDocumentSummary>
    write: (id: string, presentation: unknown) => Promise<number>
    writePreview: (
      id: string,
      bytes: ArrayBuffer,
      request: { expectedSavedAt: number; mediaType: string; slideId: string },
    ) => Promise<MonaDocumentSummary | null>
  }
  dataSources: {
    addLocalFolder: () => Promise<DataSourceSummary | null>
    chooseDefaultLocalFolder: () => Promise<DataSourceSummary | null>
    list: () => Promise<DataSourceSummary[]>
    listChildren: (sourceId: string, parentItemId: string) => Promise<DataSourceItem[]>
    listDocuments: (query?: DataSourceQuery) => Promise<DataSourceDocument[]>
    onChange: (listener: (event: DataSourceChangeEvent) => void) => () => void
    readDocument: (reference: DataSourceDocumentReference) => Promise<DataSourcePickedDocument>
    remove: (sourceId: string) => Promise<void>
    setDefaultSaveLocation: (sourceId: string) => Promise<DataSourceSummary>
  }
  documentData: {
    legacyMigration: {
      complete: (id: string, kind: 'powerpoint-packages' | 'sketches') => Promise<void>
      pending: (id: string, kind: 'powerpoint-packages' | 'sketches') => Promise<boolean>
    }
    powerpointPackages: {
      delete: (id: string, packageId: string) => Promise<void>
      listIds: (id: string) => Promise<string[]>
      read: (id: string, packageId: string) => Promise<unknown>
      write: (id: string, packageId: string, value: unknown) => Promise<string>
    }
    sketches: {
      delete: (id: string, slideId: string) => Promise<void>
      list: (id: string) => Promise<unknown[]>
      write: (id: string, slideId: string, value: unknown) => Promise<string>
    }
  }
  /** Null from any of these means the user cancelled, which is not a failure. */
  files: {
    open: (request: { filters: MonaFileFilter[]; multiple?: boolean; title?: string }) => Promise<MonaPickedFile[] | null>
    printToPdf: (request: {
      defaultName: string
      html: string
      page: { height: number; margin: number; width: number }
    }) => Promise<string | null>
    save: (request: { bytes: ArrayBuffer; defaultName: string; filters: MonaFileFilter[] }) => Promise<string | null>
  }
  deck: {
    collectGarbage: (id: string, keep: readonly string[]) => Promise<void>
    /** Flushes every mounted document store before an in-app route change. */
    flushPending: () => Promise<void>
    /**
     * The shell asking for anything unsaved, before it lets a window close.
     * Returns an unsubscribe. The shell waits for the listener to settle.
     */
    onFlushRequest: (listener: () => Promise<void>) => () => void
    writeAsset: (id: string, name: string, bytes: ArrayBuffer) => Promise<string>
  }
  models: () => Promise<MonaModel[]>
  /** The slideshow's second window, and the channel the two talk over. */
  screen: {
    closeAudience: () => Promise<void>
    onSync: (listener: (message: unknown) => void) => () => void
    openAudience: (documentPath: string) => Promise<void>
    sync: (message: unknown) => void
  }
  /** Returns an unsubscribe. Only ever fires on macOS, where the menu bar exists. */
  onMenuCommand: (listener: (command: string) => void) => () => void
  platform: NodeJS.Platform
}

declare global {
  interface Window {
    mona?: MonaBridge
  }
}

/**
 * Throws rather than returning undefined.
 *
 * Mona is a desktop application; a renderer without the bridge is not a degraded
 * mode to code around, it is a build that cannot work. Failing loudly at the call
 * site beats every consumer carrying a branch that will never be taken.
 */
export const monaBridge = (): MonaBridge => {
  const bridge = window.mona
  if (!bridge) throw new Error('The Mona desktop bridge is unavailable in this window.')
  return bridge
}

/** For the few places that would rather show nothing than throw. */
export const maybeMonaBridge = (): MonaBridge | undefined => window.mona

/**
 * Whether the window's chrome belongs to macOS.
 *
 * Decides two things together, and they have to stay together: the menus live in
 * the system menu bar, and the editor's own header has to keep clear of the traffic
 * lights floating over its top-left. Split them and you get either two menu bars or
 * a close button sitting on top of a control.
 */
export const isMacChrome = (): boolean => window.mona?.platform === 'darwin'
