import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'

import type {
  DocumentSourceRevision,
  PresentationDocumentChange,
} from '@mona/document-jobs'

import {
  planWorkspace,
  readWorkspace,
  type AssetBytes,
  type DeckSnapshot,
  type WorkspaceReadback,
} from './agent-workspace.js'

export interface ProjectWorkspaceDocument {
  artifactId: string
  basePresentation?: unknown
  fetchAsset?: (url: string) => Promise<AssetBytes | undefined>
  name: string
  readOnlyReason?: string
  revision?: DocumentSourceRevision
  snapshot?: DeckSnapshot
}

interface EditableWorkspaceDocument extends ProjectWorkspaceDocument {
  basePresentation: Record<string, unknown>
  fetchAsset: (url: string) => Promise<AssetBytes | undefined>
  revision: DocumentSourceRevision
  snapshot: DeckSnapshot
}

interface ReadableWorkspaceDocument extends ProjectWorkspaceDocument {
  fetchAsset: (url: string) => Promise<AssetBytes | undefined>
  snapshot: DeckSnapshot
}

const isReadable = (
  document: ProjectWorkspaceDocument,
): document is ReadableWorkspaceDocument => (
  !!document.fetchAsset
  && !!document.snapshot
)

const isEditable = (
  document: ProjectWorkspaceDocument,
): document is EditableWorkspaceDocument => (
  !!document.basePresentation
  && typeof document.basePresentation === 'object'
  && !Array.isArray(document.basePresentation)
  && !!document.fetchAsset
  && !!document.revision
  && !!document.snapshot
  && !document.readOnlyReason
)

const safeId = (value: string): string => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) {
    throw new Error('The project contains an invalid artifact identity.')
  }
  return value
}

const mediaTypeFor = (path: string): string => {
  const extension = path.split('.').at(-1)?.toLocaleLowerCase()
  return {
    gif: 'image/gif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    mp4: 'video/mp4',
    png: 'image/png',
    svg: 'image/svg+xml',
    webp: 'image/webp',
  }[extension ?? ''] ?? 'application/octet-stream'
}

const documentRoot = (root: string, artifactId: string): string => (
  join(root, 'documents', safeId(artifactId))
)

const mergeReadback = (
  base: Record<string, unknown>,
  readback: WorkspaceReadback,
): Record<string, unknown> => {
  const merged: Record<string, unknown> = {
    ...structuredClone(base),
    slideIndex: readback.slideIndex,
    slides: readback.slides,
    theme: readback.theme,
    title: readback.title,
  }
  if (!readback.powerPointSharedLayers) return merged
  if (readback.powerPointSharedLayers.schemaVersion !== 1) {
    throw new Error('powerpoint/shared-layers.json has an unsupported schema.')
  }
  const desiredByPackage = new Map(readback.powerPointSharedLayers.packages.map(entry => [
    entry.packageId,
    entry,
  ]))
  const sourcePackages = Array.isArray(merged.sourcePackages)
    ? merged.sourcePackages as Array<Record<string, unknown>>
    : []
  const editablePackageIds = sourcePackages.flatMap(sourcePackage => (
    sourcePackage.hierarchy && typeof sourcePackage.packageId === 'string'
      ? [sourcePackage.packageId]
      : []
  ))
  if (
    desiredByPackage.size !== readback.powerPointSharedLayers.packages.length
    || desiredByPackage.size !== editablePackageIds.length
    || editablePackageIds.some(packageId => !desiredByPackage.has(packageId))
  ) {
    throw new Error('Keep every PowerPoint package in powerpoint/shared-layers.json exactly once.')
  }
  merged.sourcePackages = sourcePackages.map(sourcePackage => {
    const packageId = typeof sourcePackage.packageId === 'string' ? sourcePackage.packageId : ''
    const desired = desiredByPackage.get(packageId)
    const hierarchy = sourcePackage.hierarchy
    if (!desired || !hierarchy || typeof hierarchy !== 'object' || Array.isArray(hierarchy)) {
      return sourcePackage
    }
    const baselineHierarchy = hierarchy as Record<string, unknown>
    const baselineLayers = [
      ...(Array.isArray(baselineHierarchy.masters) ? baselineHierarchy.masters : []),
      ...(Array.isArray(baselineHierarchy.layouts) ? baselineHierarchy.layouts : []),
    ] as Array<Record<string, unknown>>
    const desiredLayers = [...desired.masters, ...desired.layouts]
    const desiredByPart = new Map(desiredLayers.flatMap(layer => (
      typeof layer.partPath === 'string' ? [[layer.partPath, layer] as const] : []
    )))
    const changedParts = baselineLayers.flatMap(layer => {
      const partPath = typeof layer.partPath === 'string' ? layer.partPath : ''
      const next = desiredByPart.get(partPath)
      return next && JSON.stringify(next) !== JSON.stringify(layer) ? [partPath] : []
    })
    return {
      ...sourcePackage,
      hierarchy: {
        ...baselineHierarchy,
        layouts: desired.layouts,
        masters: desired.masters,
      },
      ...(changedParts.length
        ? {
            sharedAuthoring: {
              partPaths: [...new Set(changedParts)].sort(),
              revision: Number((sourcePackage.sharedAuthoring as { revision?: unknown } | undefined)?.revision ?? 0) + 1,
            },
          }
        : {}),
    }
  })
  return merged
}

export class ProjectAgentWorkspace {
  readonly root: string
  #documents = new Map<string, ProjectWorkspaceDocument>()
  readonly #assetSources = new Map<string, Map<string, string>>()

  private constructor(root: string) {
    this.root = root
  }

  static async create(
    documents: ProjectWorkspaceDocument[],
  ): Promise<ProjectAgentWorkspace> {
    const root = await mkdtemp(join(tmpdir(), 'mona-project-'))
    const workspace = new ProjectAgentWorkspace(root)
    await workspace.take(documents)
    return workspace
  }

  async take(documents: ProjectWorkspaceDocument[]): Promise<void> {
    await rm(join(this.root, 'documents'), { force: true, recursive: true })
    await mkdir(join(this.root, 'documents'), { recursive: true })
    this.#documents = new Map(documents.map(document => [document.artifactId, document]))
    this.#assetSources.clear()

    for (const document of documents) {
      if (isReadable(document)) await this.#writeDocument(document)
    }
    await writeFile(join(this.root, 'project.json'), `${JSON.stringify({
      documents: documents.map(document => ({
        editable: isEditable(document),
        id: document.artifactId,
        name: document.name,
        path: isReadable(document) ? `documents/${document.artifactId}/deck` : undefined,
        readOnlyReason: document.readOnlyReason,
      })),
    }, null, 2)}\n`)
  }

  describe(): Array<{
    editable: boolean
    id: string
    name: string
    path?: string
    readOnlyReason?: string
  }> {
    return [...this.#documents.values()].map(document => ({
      editable: isEditable(document),
      id: document.artifactId,
      name: document.name,
      ...(isReadable(document) ? { path: `documents/${document.artifactId}/deck` } : {}),
      ...(document.readOnlyReason ? { readOnlyReason: document.readOnlyReason } : {}),
    }))
  }

  async changes(artifactIds?: string[]): Promise<PresentationDocumentChange[]> {
    const requested = artifactIds?.length ? new Set(artifactIds) : null
    const changes: PresentationDocumentChange[] = []
    for (const document of this.#documents.values()) {
      if (!isEditable(document) || (requested && !requested.has(document.artifactId))) continue
      const readback = await this.#readDocument(document)
      const presentation = mergeReadback(document.basePresentation, readback)
      if (JSON.stringify(presentation) === JSON.stringify(document.basePresentation)) continue
      const addedAssets: PresentationDocumentChange['addedAssets'] = {}
      for (const path of readback.addedAssets) {
        const asset = await this.#readAddedAsset(document.artifactId, path)
        if (!asset) {
          throw new Error(
            `${document.name} references ${path}, but that asset is missing from its deck/assets directory.`,
          )
        }
        addedAssets[path] = asset
      }
      changes.push({
        addedAssets,
        artifactId: document.artifactId,
        expectedRevision: document.revision,
        presentation,
      })
    }
    return changes
  }

  async dispose(): Promise<void> {
    await rm(this.root, { force: true, recursive: true })
  }

  async #writeDocument(document: ReadableWorkspaceDocument): Promise<void> {
    const root = documentRoot(this.root, document.artifactId)
    const { assetSources, assets, files } = planWorkspace(document.snapshot)
    for (const file of files) {
      const target = join(root, file.path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, file.data)
    }
    for (const asset of assets) {
      const bytes = await document.fetchAsset(asset.url).catch(() => undefined)
      if (!bytes) continue
      const target = join(root, asset.path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, Buffer.from(bytes.base64, 'base64'))
    }
    this.#assetSources.set(document.artifactId, assetSources)
  }

  async #readDocument(
    document: EditableWorkspaceDocument,
  ): Promise<WorkspaceReadback> {
    const root = documentRoot(this.root, document.artifactId)
    const cache = new Map<string, unknown>()
    const invalid: string[] = []
    const load = async (path: string): Promise<void> => {
      try {
        cache.set(path, JSON.parse(await readFile(join(root, path), 'utf8')))
      }
      catch (error) {
        cache.set(path, undefined)
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') invalid.push(path)
      }
    }
    await load('deck/deck.json')
    const index = cache.get('deck/deck.json') as {
      powerPointSharedLayers?: string
      slides?: { file?: string }[]
    } | undefined
    for (const entry of index?.slides ?? []) {
      if (entry.file) await load(`deck/${entry.file}`)
    }
    if (index?.powerPointSharedLayers) {
      const path = 'deck/powerpoint/shared-layers.json'
      if (index.powerPointSharedLayers !== 'powerpoint/shared-layers.json') {
        invalid.push('deck/deck.json')
      }
      await load(path)
      if (cache.get(path) === undefined && !invalid.includes(path)) invalid.push(path)
    }
    if (invalid.length) {
      throw new Error(
        `${document.name} contains invalid JSON in: ${invalid.join(', ')}. Fix those files before applying.`,
      )
    }
    return readWorkspace({
      assetSources: this.#assetSources.get(document.artifactId) ?? new Map(),
      readJson: path => cache.get(path),
    })
  }

  async #readAddedAsset(
    artifactId: string,
    path: string,
  ): Promise<AssetBytes | undefined> {
    const deckRoot = resolve(documentRoot(this.root, artifactId), 'deck')
    const target = resolve(deckRoot, path)
    if (target !== deckRoot && !target.startsWith(deckRoot + sep)) return undefined
    try {
      const bytes = await readFile(target)
      return {
        base64: bytes.toString('base64'),
        mediaType: mediaTypeFor(relative(deckRoot, target)),
      }
    }
    catch {
      return undefined
    }
  }
}
