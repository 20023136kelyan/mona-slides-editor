import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join, normalize, resolve, sep } from 'node:path'

import type {
  ProjectAgentExecutor,
} from '@mona/agent-server/project-agent-sdk-session'
import type {
  ProjectWorkspaceDocument,
} from '@mona/agent-server/project-agent-workspace'
import type {
  DocumentJobRecord,
  DocumentSourceRevision,
  PresentationDocumentChange,
} from '@mona/document-jobs'
import { ingestPowerPoint } from '@mona/pptx-ingestion'
import { writeBackPowerPoint } from '@mona/pptx-writeback'
import {
  validatePresentationState,
  type PresentationState,
} from '@mona/presentation-core'
import type { ProjectArtifact } from '@mona/project-core'

import type { DataSourceService } from './data-source-service.js'
import {
  documentAssetsRoot,
  documentRoot,
  importPackagedDocument,
  readDocument,
} from './document-library.js'
import {
  buildMonaDocumentPackage,
  readMonaDocumentManifest,
} from './native-document-package.js'
import {
  projectJobStore,
  type ProjectJobStore,
} from './project-job-store.js'
import {
  projectStore,
  type ProjectStore,
} from './project-store.js'
import { DEFAULT_POWERPOINT_THEME } from './powerpoint-ingestion.js'

const MAX_PRESENTATION_BYTES = 64 * 1024 * 1024
const MAX_ADDED_ASSET_BYTES = 64 * 1024 * 1024
const MAX_ADDED_ASSETS_BYTES = 256 * 1024 * 1024
const MAX_ADDED_ASSET_COUNT = 100
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

const mediaTypes = new Map([
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.mp4', 'video/mp4'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
])

const contentHash = (bytes: ArrayBuffer): string => (
  createHash('sha256').update(Buffer.from(bytes)).digest('hex')
)

const sourceRevision = (
  bytes: ArrayBuffer,
  modifiedAt: number,
  size: number,
): DocumentSourceRevision => ({
  contentHash: contentHash(bytes),
  modifiedAt,
  size,
})

const sameRevision = (
  left: DocumentSourceRevision,
  right: DocumentSourceRevision,
): boolean => (
  left.contentHash === right.contentHash
  && left.modifiedAt === right.modifiedAt
  && left.size === right.size
)

const isPresentationState = (value: unknown): value is PresentationState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const state = value as Partial<PresentationState>
  return typeof state.title === 'string'
    && !!state.theme
    && typeof state.theme === 'object'
    && Array.isArray(state.slides)
    && Number.isInteger(state.slideIndex)
    && typeof state.viewportSize === 'number'
    && Number.isFinite(state.viewportSize)
    && typeof state.viewportRatio === 'number'
    && Number.isFinite(state.viewportRatio)
    && Array.isArray(state.templates)
}

const assertSafeMarkup = (value: string): void => {
  if (
    /<\s*(?:script|iframe|object|embed|link|meta)\b/i.test(value)
    || /\bon[a-z]+\s*=/i.test(value)
    || /(?:javascript|vbscript)\s*:/i.test(value)
    || /data\s*:\s*text\/html/i.test(value)
  ) {
    throw new Error('The presentation contains unsafe markup or a scriptable URL.')
  }
}

const assertSafePresentation: (
  value: unknown,
) => asserts value is PresentationState = value => {
  if (!isPresentationState(value)) throw new Error('The workspace is not a complete presentation.')
  const serialized = JSON.stringify(value)
  if (Buffer.byteLength(serialized) > MAX_PRESENTATION_BYTES) {
    throw new Error('The presentation model is too large to apply safely.')
  }
  const validation = validatePresentationState(value)
  if (!validation.valid) {
    throw new Error(
      `The presentation is invalid: ${validation.issues
        .filter(issue => issue.severity === 'error')
        .slice(0, 5)
        .map(issue => `${issue.path}: ${issue.message}`)
        .join('; ')}`,
    )
  }
  const visit = (node: unknown, key = ''): void => {
    if (typeof node === 'string') {
      if (key === 'content' || key === 'text' || node.includes('<')) assertSafeMarkup(node)
      if (/(?:javascript|vbscript)\s*:/i.test(node)) {
        throw new Error('The presentation contains a scriptable URL.')
      }
      return
    }
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry, key)
      return
    }
    if (!node || typeof node !== 'object') return
    for (const [field, entry] of Object.entries(node)) visit(entry, field)
  }
  visit(value)
}

const assertAddedAssets = (
  assets: PresentationDocumentChange['addedAssets'],
): void => {
  const entries = Object.entries(assets)
  if (entries.length > MAX_ADDED_ASSET_COUNT) {
    throw new Error(`A document can add at most ${MAX_ADDED_ASSET_COUNT} assets in one job.`)
  }
  let total = 0
  for (const [path, asset] of entries) {
    if (!path.startsWith('assets/') || path.slice('assets/'.length).includes('/')) {
      throw new Error(`The asset path "${path}" is not inside deck/assets/.`)
    }
    if (!asset.base64 || !BASE64.test(asset.base64)) {
      throw new Error(`The asset "${path}" is not valid base64.`)
    }
    const size = Buffer.byteLength(asset.base64, 'base64')
    if (size > MAX_ADDED_ASSET_BYTES) {
      throw new Error(`The asset "${path}" exceeds the safe size limit.`)
    }
    total += size
  }
  if (total > MAX_ADDED_ASSETS_BYTES) {
    throw new Error('The added assets exceed the safe per-job size limit.')
  }
}

const replaceReferences = (
  value: unknown,
  replacements: ReadonlyMap<string, string>,
): unknown => {
  if (typeof value === 'string') return replacements.get(value) ?? value
  if (Array.isArray(value)) return value.map(entry => replaceReferences(entry, replacements))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      replaceReferences(entry, replacements),
    ]),
  )
}

const assertLocalAssets = (value: unknown): void => {
  const visit = (node: unknown, key = ''): void => {
    if (typeof node === 'string') {
      if (
        ['src', 'poster', 'preview'].includes(key)
        && node
        && !node.startsWith('mona://asset/')
      ) {
        throw new Error(`The media reference "${node.slice(0, 80)}" is not a stored deck asset.`)
      }
      return
    }
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry, key)
      return
    }
    if (!node || typeof node !== 'object') return
    for (const [field, entry] of Object.entries(node)) visit(entry, field)
  }
  visit(value)
}

interface PreflightStep {
  artifact: ProjectArtifact
  bytes: ArrayBuffer
  change: PresentationDocumentChange
  revision: DocumentSourceRevision
  sourceExtension: string
}

export class ProjectDocumentJobEngine {
  readonly #dataSources: DataSourceService
  readonly #jobs: ProjectJobStore
  readonly #projects: ProjectStore

  constructor({
    dataSources,
    jobs = projectJobStore,
    projects = projectStore,
  }: {
    dataSources: DataSourceService
    jobs?: ProjectJobStore
    projects?: ProjectStore
  }) {
    this.#dataSources = dataSources
    this.#jobs = jobs
    this.#projects = projects
  }

  async run(
    projectId: string,
    explanation: string,
    changes: PresentationDocumentChange[],
  ): Promise<DocumentJobRecord> {
    const project = await this.#projects.peek(projectId)
    if (!project) throw new Error('This project no longer exists.')
    const artifacts = new Map(project.artifacts.map(artifact => [artifact.id, artifact]))
    const job = await this.#jobs.create({
      explanation,
      projectId,
      steps: changes.map(change => {
        const artifact = artifacts.get(change.artifactId)
        if (!artifact) throw new Error('A changed document is no longer attached to this project.')
        return {
          artifactId: artifact.id,
          expectedRevision: change.expectedRevision,
          name: artifact.name,
          operation: 'presentation.replace' as const,
          reference: artifact.reference,
        }
      }),
    })
    await this.#jobs.start(projectId, job.id)

    const preflight = new Map<string, PreflightStep>()
    for (const step of job.steps) {
      const change = changes.find(candidate => candidate.artifactId === step.artifactId)
      const artifact = artifacts.get(step.artifactId)
      if (!change || !artifact) {
        await this.#jobs.updateStep(projectId, job.id, step.id, 'failed', 'The project document is missing.')
        continue
      }
      try {
        assertSafePresentation(change.presentation)
        assertAddedAssets(change.addedAssets)
        const source = await this.#dataSources.getDocument(artifact.reference)
        if (source.extension !== '.mona' && source.extension !== '.pptx') {
          throw new Error('Direct agent writeback is available only for Mona and PowerPoint presentations.')
        }
        const picked = await this.#dataSources.readDocument(artifact.reference)
        const revision = sourceRevision(picked.bytes, source.modifiedAt, source.size)
        if (!sameRevision(revision, change.expectedRevision)) {
          throw new Error('The source changed after the agent opened it. Sync the project and redo this edit.')
        }
        preflight.set(step.id, {
          artifact,
          bytes: picked.bytes,
          change,
          revision,
          sourceExtension: source.extension,
        })
      }
      catch (error) {
        await this.#jobs.updateStep(
          projectId,
          job.id,
          step.id,
          'failed',
          error instanceof Error ? error.message : 'Preflight failed.',
        )
      }
    }

    for (const step of job.steps) {
      const latest = await this.#jobs.read(projectId, job.id)
      if (!latest) throw new Error('The document job disappeared while it was running.')
      if (latest.cancelRequested) {
        for (const remaining of latest.steps.filter(candidate => candidate.status === 'pending')) {
          await this.#jobs.updateStep(projectId, job.id, remaining.id, 'cancelled')
        }
        break
      }
      const ready = preflight.get(step.id)
      if (!ready) continue
      await this.#jobs.updateStep(projectId, job.id, step.id, 'running')
      try {
        await this.#applyStep(ready)
        await this.#jobs.updateStep(projectId, job.id, step.id, 'succeeded')
        await this.#projects.updateArtifactState(projectId, step.artifactId, 'modified')
      }
      catch (error) {
        await this.#jobs.updateStep(
          projectId,
          job.id,
          step.id,
          'failed',
          error instanceof Error ? error.message : 'The document could not be written.',
        )
      }
    }
    return this.#jobs.finish(projectId, job.id)
  }

  async #applyStep(step: PreflightStep): Promise<void> {
    const currentSource = await this.#dataSources.getDocument(step.artifact.reference)
    const currentPicked = await this.#dataSources.readDocument(step.artifact.reference)
    const currentRevision = sourceRevision(
      currentPicked.bytes,
      currentSource.modifiedAt,
      currentSource.size,
    )
    if (!sameRevision(currentRevision, step.revision)) {
      throw new Error('The source changed while this job was running. This step was not written.')
    }

    if (step.sourceExtension === '.pptx') {
      assertSafePresentation(step.change.presentation)
      const presentation = step.change.presentation
      const ingested = await ingestPowerPoint(currentPicked.bytes, {
        assetUrl: ({ name }) => `pptx-asset://${encodeURIComponent(name)}`,
        fileName: currentSource.name,
        theme: presentation.theme,
      })
      const sourceAssets = new Map(ingested.assets.map(asset => [asset.url, asset]))
      const addedAssets = new Map(Object.entries(step.change.addedAssets))
      const result = await writeBackPowerPoint({
        baseline: ingested.presentation,
        bytes: currentPicked.bytes,
        manifest: ingested.backing.manifest,
        presentation,
        resolveAsset: async reference => {
          const retained = sourceAssets.get(reference)
          if (retained) return { bytes: retained.bytes, mediaType: retained.mediaType }
          const added = addedAssets.get(reference)
          return added
            ? {
                bytes: Buffer.from(added.base64, 'base64'),
                mediaType: added.mediaType,
              }
            : undefined
        },
      })
      if (result.plan.mode === 'noop') {
        throw new Error(
          'This request did not contain a source-writable PowerPoint object change.',
        )
      }
      await this.#dataSources.writeDocument(step.artifact.reference, result.bytes)
      return
    }

    const manifest = await readMonaDocumentManifest(new Uint8Array(step.bytes))
    if (!manifest) throw new Error('The source is not a valid native Mona presentation.')
    const recovery = await importPackagedDocument(step.bytes, step.artifact.reference)
    const stored = await readDocument(recovery.id)
    if (!stored) throw new Error('The recovery copy could not be prepared.')
    const staging = await mkdtemp(join(tmpdir(), 'mona-document-job-'))
    try {
      await cp(documentRoot(recovery.id), staging, { recursive: true })
      const replacements = new Map<string, string>()
      for (const [path, asset] of Object.entries(step.change.addedAssets)) {
        const requested = basename(normalize(path))
        if (!requested || requested.startsWith('.')) {
          throw new Error(`The asset name "${path}" is not safe.`)
        }
        const name = `agent-${randomUUID()}-${requested}`.slice(0, 240)
        await mkdir(join(staging, 'assets'), { recursive: true })
        await writeFile(join(staging, 'assets', name), Buffer.from(asset.base64, 'base64'))
        replacements.set(
          path,
          `mona://asset/${encodeURIComponent(recovery.id)}/${encodeURIComponent(name)}`,
        )
      }
      const presentation = replaceReferences(
        step.change.presentation,
        replacements,
      )
      assertSafePresentation(presentation)
      assertLocalAssets(presentation)
      const savedAt = Date.now()
      await writeFile(join(staging, 'deck.json'), JSON.stringify({
        ...stored,
        presentation,
        savedAt,
      }))
      const bytes = await buildMonaDocumentPackage(
        recovery.id,
        stored.portableDocumentId ?? manifest.documentId,
        staging,
        manifest.createdAt,
      )
      await this.#dataSources.writeDocument(step.artifact.reference, bytes)
      await importPackagedDocument(bytes, step.artifact.reference)
    }
    finally {
      await rm(staging, { force: true, recursive: true })
    }
  }
}

const collectAssetUrls = (value: unknown, found = new Set<string>()): Set<string> => {
  if (typeof value === 'string') {
    if (value.startsWith('mona://asset/') || value.startsWith('pptx-asset://')) {
      found.add(value)
    }
  }
  else if (Array.isArray(value)) {
    for (const entry of value) collectAssetUrls(entry, found)
  }
  else if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) collectAssetUrls(entry, found)
  }
  return found
}

const sharedLayerSnapshot = (presentation: PresentationState) => {
  const packages = (presentation.sourcePackages ?? []).flatMap(source => (
    source.hierarchy
      ? [{
          layouts: structuredClone(source.hierarchy.layouts) as unknown as Array<Record<string, unknown>>,
          masters: structuredClone(source.hierarchy.masters) as unknown as Array<Record<string, unknown>>,
          packageId: source.packageId,
        }]
      : []
  ))
  return packages.length ? { packages, schemaVersion: 1 as const } : undefined
}

const assetPath = (documentId: string, url: string): string | null => {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'mona:' || parsed.hostname !== 'asset') return null
    const [encodedOwner, ...encodedNames] = parsed.pathname.replace(/^\//, '').split('/')
    if (!encodedOwner || encodedNames.length !== 1) return null
    if (decodeURIComponent(encodedOwner) !== documentId) return null
    const name = decodeURIComponent(encodedNames[0] ?? '')
    if (!name || basename(normalize(name)) !== name || name.startsWith('.')) return null
    const root = resolve(documentAssetsRoot(documentId))
    const target = resolve(root, name)
    return target.startsWith(root + sep) ? target : null
  }
  catch {
    return null
  }
}

export class ProjectDocumentAgentExecutor implements ProjectAgentExecutor {
  readonly #dataSources: DataSourceService
  readonly #engine: ProjectDocumentJobEngine
  readonly #projectId: string
  readonly #projects: ProjectStore

  constructor({
    dataSources,
    engine,
    projectId,
    projects = projectStore,
  }: {
    dataSources: DataSourceService
    engine: ProjectDocumentJobEngine
    projectId: string
    projects?: ProjectStore
  }) {
    this.#dataSources = dataSources
    this.#engine = engine
    this.#projectId = projectId
    this.#projects = projects
  }

  apply(
    explanation: string,
    changes: PresentationDocumentChange[],
  ): Promise<DocumentJobRecord> {
    return this.#engine.run(this.#projectId, explanation, changes)
  }

  async prepare(): Promise<ProjectWorkspaceDocument[]> {
    const project = await this.#projects.peek(this.#projectId)
    if (!project) throw new Error('This project no longer exists.')
    return Promise.all(project.artifacts.map(async artifact => {
      const base = {
        artifactId: artifact.id,
        name: artifact.name,
      }
      try {
        const source = await this.#dataSources.getDocument(artifact.reference)
        if (artifact.documentType !== 'presentation') {
          return { ...base, readOnlyReason: 'This document type has no editing capability yet.' }
        }
        if (source.extension === '.pptx') {
          const picked = await this.#dataSources.readDocument(artifact.reference)
          const ingested = await ingestPowerPoint(picked.bytes, {
            assetUrl: ({ name }) => `pptx-asset://${encodeURIComponent(name)}`,
            fileName: source.name,
            theme: DEFAULT_POWERPOINT_THEME,
          })
          const validation = validatePresentationState(ingested.presentation)
          if (!validation.valid) {
            return {
              ...base,
              readOnlyReason: 'The PowerPoint presentation did not pass semantic validation.',
            }
          }
          const assetByUrl = new Map(
            ingested.assets.map(asset => [asset.url, asset]),
          )
          return {
            ...base,
            basePresentation: structuredClone(ingested.presentation),
            fetchAsset: async (url: string) => {
              const asset = assetByUrl.get(url)
              return asset
                ? {
                    base64: Buffer.from(asset.bytes).toString('base64'),
                    mediaType: asset.mediaType,
                  }
                : undefined
            },
            revision: sourceRevision(picked.bytes, source.modifiedAt, source.size),
            snapshot: {
              assets: Object.fromEntries(ingested.assets.map(asset => [
                asset.url,
                {
                  byteLength: asset.bytes.byteLength,
                  mediaType: asset.mediaType,
                },
              ])),
              ...(sharedLayerSnapshot(ingested.presentation)
                ? { powerPointSharedLayers: sharedLayerSnapshot(ingested.presentation) }
                : {}),
              slideIndex: ingested.presentation.slideIndex,
              slides: ingested.presentation.slides as unknown as (
                NonNullable<ProjectWorkspaceDocument['snapshot']>['slides']
              ),
              theme: ingested.presentation.theme,
              title: ingested.presentation.title,
              viewportRatio: ingested.presentation.viewportRatio,
              viewportSize: ingested.presentation.viewportSize,
            },
          }
        }
        if (source.extension !== '.mona') {
          return {
            ...base,
            readOnlyReason: 'PowerPoint is preserved as an external source but must be opened and converted before direct agent writeback.',
          }
        }
        const picked = await this.#dataSources.readDocument(artifact.reference)
        const summary = await importPackagedDocument(picked.bytes, artifact.reference)
        const stored = await readDocument(summary.id)
        if (!stored || !isPresentationState(stored.presentation)) {
          return { ...base, readOnlyReason: 'The native presentation model is incomplete.' }
        }
        const validation = validatePresentationState(stored.presentation)
        if (!validation.valid) {
          return { ...base, readOnlyReason: 'The native presentation did not pass validation.' }
        }
        const assets: Record<string, { byteLength?: number; mediaType: string }> = {}
        for (const url of collectAssetUrls(stored.presentation)) {
          const path = assetPath(summary.id, url)
          const details = path ? await stat(path).catch(() => null) : null
          if (path && details?.isFile()) {
            assets[url] = {
              byteLength: details.size,
              mediaType: mediaTypes.get(extname(path).toLocaleLowerCase())
                ?? 'application/octet-stream',
            }
          }
        }
        return {
          ...base,
          basePresentation: structuredClone(stored.presentation),
          fetchAsset: async (url: string) => {
            const path = assetPath(summary.id, url)
            if (!path) return undefined
            const bytes = await readFile(path).catch(() => null)
            return bytes
              ? {
                  base64: bytes.toString('base64'),
                  mediaType: mediaTypes.get(extname(path).toLocaleLowerCase())
                    ?? 'application/octet-stream',
                }
              : undefined
          },
          revision: sourceRevision(picked.bytes, source.modifiedAt, source.size),
          snapshot: {
            assets,
            ...(sharedLayerSnapshot(stored.presentation)
              ? { powerPointSharedLayers: sharedLayerSnapshot(stored.presentation) }
              : {}),
            slideIndex: stored.presentation.slideIndex,
            slides: stored.presentation.slides as unknown as (
              NonNullable<ProjectWorkspaceDocument['snapshot']>['slides']
            ),
            theme: stored.presentation.theme,
            title: stored.presentation.title,
            viewportRatio: stored.presentation.viewportRatio,
            viewportSize: stored.presentation.viewportSize,
          },
        }
      }
      catch (error) {
        return {
          ...base,
          readOnlyReason: error instanceof Error
            ? error.message
            : 'This document is currently unavailable.',
        }
      }
    }))
  }
}
