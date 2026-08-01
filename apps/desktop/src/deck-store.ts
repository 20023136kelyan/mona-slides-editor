import { createReadStream } from 'node:fs'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, normalize, sep } from 'node:path'
import { Readable } from 'node:stream'
import { app, ipcMain } from 'electron'

import type { DataSourceDocumentReference } from '@mona/data-source'

import {
  createDocument,
  deleteDocument,
  documentAssetsRoot,
  duplicateDocument,
  importPackagedDocument,
  isDocumentId,
  linkDocumentToSource,
  listDocuments,
  packageDocument,
  readDocument,
  readDocumentPreview,
  renameDocument,
  writeDocument,
  writeDocumentPreview,
} from './document-library.js'
import type { DataSourceService } from './data-source-service.js'
import {
  DEFAULT_POWERPOINT_THEME,
  ingestPowerPointForDocument,
} from './powerpoint-ingestion.js'
import { exportPowerPointForDocument } from './powerpoint-writeback.js'
import {
  completeLegacyDocumentDataMigration,
  deletePowerPointPackageRecord,
  deleteSketchRecord,
  isLegacyDocumentDataMigrationPending,
  listPowerPointPackageRecordIds,
  listSketchRecords,
  readPowerPointPackageRecord,
  writePowerPointPackageRecord,
  writeSketchRecord,
} from './document-data.js'

/**
 * The deck, on disk.
 *
 * `deck.json` beside an `assets/` directory — the layout `agent-workspace.ts`
 * already writes for the agent, so the two are now the same shape rather than one
 * being a translation of the other.
 *
 * This replaces a model that kept binary in IndexedDB keyed by `blob:` URLs. That
 * arrangement had a failure with no recovery: an object URL is only a handle, so
 * every save had to fetch the bytes back through it, and any fetch that failed left
 * the deck referencing bytes that existed nowhere. The images came back blank on the
 * next launch and no amount of re-saving could fix it. A path does not have that
 * property — the reference *is* the location.
 */

/**
 * Assets are addressed by name, never by path.
 *
 * The name reaches here from deck JSON, which the agent can write, so a value like
 * `../../../.ssh/id_rsa` must not resolve. Taking the basename makes traversal
 * impossible rather than merely checked for.
 */
const assetPath = (documentId: string, name: string): string | undefined => {
  if (!isDocumentId(documentId)) return undefined
  const safe = basename(normalize(name))
  if (!safe || safe.startsWith('.')) return undefined
  const root = documentAssetsRoot(documentId)
  const target = join(root, safe)
  return target.startsWith(root + sep) ? target : undefined
}

const MIME = new Map(Object.entries({
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
}))

/**
 * Serves `mona://asset/<document-id>/<name>` straight off disk.
 *
 * Registered alongside the renderer's own handler, which is why both share a scheme
 * and differ by host. Range requests are not implemented, so long video seeks will
 * be poor — worth knowing before someone puts an hour of footage on a slide.
 */
export const handleAssetRequest = async (
  request: Request,
  dataSources?: DataSourceService,
): Promise<Response | undefined> => {
  const { hostname, pathname } = new URL(request.url)
  if (hostname === 'preview') {
    const noPreview = () => new Response(null, {
      headers: { 'cache-control': 'public, max-age=300' },
      status: 204,
    })
    const [kind, encodedOwner, ...encodedItemParts] = pathname.replace(/^\//, '').split('/')
    if (kind === 'document' && encodedOwner) {
      const preview = await readDocumentPreview(decodeURIComponent(encodedOwner))
      if (!preview) return noPreview()
      return new Response(Readable.toWeb(createReadStream(preview.path)) as ReadableStream, {
        headers: {
          'cache-control': 'public, max-age=31536000, immutable',
          'content-type': preview.mediaType,
        },
      })
    }
    if (kind === 'source' && encodedOwner && encodedItemParts.length && dataSources) {
      const thumbnail = await dataSources.readThumbnail({
        itemId: decodeURIComponent(encodedItemParts.join('/')),
        sourceId: decodeURIComponent(encodedOwner),
      })
      if (!thumbnail) return noPreview()
      return new Response(thumbnail.bytes, {
        headers: {
          'cache-control': 'public, max-age=31536000, immutable',
          'content-type': thumbnail.mediaType,
        },
      })
    }
    return new Response('Not found', { status: 404 })
  }
  if (hostname !== 'asset') return undefined
  const [documentId, ...nameParts] = pathname.replace(/^\//, '').split('/')
  const name = nameParts.join('/')
  const target = documentId && name
    ? assetPath(decodeURIComponent(documentId), decodeURIComponent(name))
    : undefined
  if (!target || !await stat(target).then(entry => entry.isFile()).catch(() => false)) {
    return new Response('Not found', { status: 404 })
  }
  return new Response(Readable.toWeb(createReadStream(target)) as ReadableStream, {
    headers: { 'content-type': MIME.get(extname(target)) ?? 'application/octet-stream' },
  })
}

/**
 * Writes an asset and returns the URL the deck will refer to it by.
 *
 * The bytes land before the reference exists anywhere, which is the whole point:
 * there is no window in which the deck names something unwritten.
 */
export const writeAsset = async (documentId: string, name: string, bytes: ArrayBuffer): Promise<string> => {
  const target = assetPath(documentId, name)
  if (!target) throw new Error(`Refusing to write an asset named ${name}`)
  await mkdir(documentAssetsRoot(documentId), { recursive: true })
  await writeFile(target, Buffer.from(bytes))
  return `mona://asset/${encodeURIComponent(documentId)}/${encodeURIComponent(basename(target))}`
}

/**
 * Deletes assets the deck no longer names.
 *
 * Called after a successful save, so the surviving set is known. Failure is
 * survivable — an orphan costs disk, where deleting one still referenced costs a
 * picture — so this never throws.
 */
const collectGarbage = async (documentId: string, keep: readonly string[]): Promise<void> => {
  if (!isDocumentId(documentId)) throw new Error('Invalid document id.')
  const root = documentAssetsRoot(documentId)
  const wanted = new Set(keep.map(name => basename(normalize(name))))
  const present = await readdir(root).catch(() => [] as string[])
  await Promise.all(present
    .filter(name => !wanted.has(name))
    .map(name => rm(join(root, name), { force: true }).catch(() => undefined)))
}

const safeDocumentFilename = (presentation: unknown, fallback = 'Untitled presentation'): string => {
  const title = presentation && typeof presentation === 'object'
    && typeof (presentation as { title?: unknown }).title === 'string'
    ? (presentation as { title: string }).title
    : ''
  const stem = (title || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return `${stem || fallback}.mona`
}

const activePowerPointImports = new Map<string, AbortController>()

export const registerDeckIpc = (dataSources: DataSourceService): void => {
  ipcMain.handle('mona:documents:list', () => listDocuments())
  ipcMain.handle(
    'mona:documents:create',
    (_event, presentation: unknown, sourceReference?: DataSourceDocumentReference) => (
      createDocument(presentation, sourceReference)
    ),
  )
  ipcMain.handle(
    'mona:documents:create-local',
    async (_event, presentation: unknown, sourceId: string) => {
      const recovery = await createDocument(presentation)
      try {
        const bytes = await packageDocument(recovery.id)
        const created = await dataSources.createDocument(
          sourceId,
          safeDocumentFilename(presentation),
          bytes,
        )
        return linkDocumentToSource(recovery.id, created.reference)
      }
      catch (error) {
        await deleteDocument(recovery.id).catch(() => undefined)
        throw error
      }
    },
  )
  ipcMain.handle(
    'mona:documents:move-to-source',
    async (_event, id: string, sourceId: string) => {
      if (!isDocumentId(id)) throw new Error('Invalid document id.')
      const stored = await readDocument(id)
      if (!stored) throw new Error('This presentation no longer exists.')
      const bytes = await packageDocument(id)
      const created = await dataSources.createDocument(
        sourceId,
        safeDocumentFilename(stored.presentation),
        bytes,
      )
      return linkDocumentToSource(id, created.reference)
    },
  )
  ipcMain.handle(
    'mona:documents:open-source',
    async (_event, reference: DataSourceDocumentReference) => {
      const document = await dataSources.getDocument(reference)
      const picked = await dataSources.readDocument(reference)
      if (document.extension === '.mona') {
        return importPackagedDocument(picked.bytes, reference)
      }
      if (document.extension !== '.pptx') {
        throw new Error('This presentation format is not supported.')
      }
      const recovery = await createDocument({
        slideIndex: 0,
        slides: [],
        templates: [],
        theme: DEFAULT_POWERPOINT_THEME,
        title: document.name.replace(/\.pptx$/i, ''),
        viewportRatio: 0.5625,
        viewportSize: 1000,
      }, reference)
      try {
        const ingested = await ingestPowerPointForDocument({
          bytes: picked.bytes,
          documentId: recovery.id,
          fileName: document.name,
          theme: DEFAULT_POWERPOINT_THEME,
          writeAsset,
        })
        await writeDocument(recovery.id, ingested.presentation)
        return (await listDocuments()).find(summary => summary.id === recovery.id) ?? recovery
      }
      catch (error) {
        await deleteDocument(recovery.id).catch(() => undefined)
        throw error
      }
    },
  )
  ipcMain.handle(
    'mona:documents:ingest-powerpoint',
    async (
      _event,
      id: string,
      bytes: unknown,
      request: {
        coordinateLabels?: unknown
        fileName?: unknown
        fixedViewport?: unknown
        operationId?: unknown
        theme?: unknown
      },
    ) => {
      const operationId = typeof request?.operationId === 'string'
        && /^[a-zA-Z0-9-]{16,128}$/.test(request.operationId)
        ? request.operationId
        : ''
      if (!operationId) throw new Error('A valid PowerPoint import operation is required.')
      if (activePowerPointImports.has(operationId)) {
        throw new Error('This PowerPoint import operation is already running.')
      }
      const controller = new AbortController()
      activePowerPointImports.set(operationId, controller)
      try {
        return await ingestPowerPointForDocument({
          bytes,
          coordinateLabels: Array.isArray(request.coordinateLabels)
            ? request.coordinateLabels.filter(
                (label): label is string => typeof label === 'string',
              ).slice(0, 512)
            : undefined,
          documentId: id,
          fileName: typeof request?.fileName === 'string' ? request.fileName : '',
          fixedViewport: request?.fixedViewport === true,
          signal: controller.signal,
          theme: request?.theme,
          writeAsset,
        })
      }
      finally {
        activePowerPointImports.delete(operationId)
      }
    },
  )
  ipcMain.handle('mona:documents:cancel-powerpoint', (_event, operationId: unknown) => {
    if (typeof operationId !== 'string') return false
    const controller = activePowerPointImports.get(operationId)
    controller?.abort()
    return Boolean(controller)
  })
  ipcMain.handle(
    'mona:documents:export-powerpoint',
    (_event, id: string, presentation: unknown, packageId?: string) => (
      exportPowerPointForDocument({
        documentId: id,
        packageId: typeof packageId === 'string' ? packageId : undefined,
        presentation,
      })
    ),
  )
  ipcMain.handle('mona:documents:package', (_event, id: string) => packageDocument(id))
  ipcMain.handle('mona:documents:read', (_event, id: string) => readDocument(id))
  ipcMain.handle('mona:documents:write', async (_event, id: string, presentation: unknown) => {
    const savedAt = await writeDocument(id, presentation)
    const summary = (await listDocuments()).find(document => document.id === id)
    if (summary?.sourceReference) {
      const sourceDocument = await dataSources.getDocument(summary.sourceReference)
      if (sourceDocument.extension === '.mona') {
        await dataSources.writeDocument(summary.sourceReference, await packageDocument(id))
        await dataSources.renameDocument(
          summary.sourceReference,
          safeDocumentFilename(presentation),
        )
      }
    }
    return savedAt
  })
  ipcMain.handle(
    'mona:documents:write-preview',
    async (
      _event,
      id: string,
      bytes: ArrayBuffer,
      request: { expectedSavedAt: number; mediaType: string; slideId: string },
    ) => {
      const summary = await writeDocumentPreview(id, bytes, request)
      if (summary?.sourceReference) {
        const sourceDocument = await dataSources.getDocument(summary.sourceReference)
        if (sourceDocument.extension === '.mona') {
          await dataSources.writeDocument(summary.sourceReference, await packageDocument(id))
        }
      }
      return summary
    },
  )
  ipcMain.handle('mona:documents:rename', async (_event, id: string, title: string) => {
    const summary = await renameDocument(id, title)
    if (summary.sourceReference) {
      const sourceDocument = await dataSources.getDocument(summary.sourceReference)
      if (sourceDocument.extension === '.mona') {
        await dataSources.writeDocument(summary.sourceReference, await packageDocument(id))
        await dataSources.renameDocument(
          summary.sourceReference,
          safeDocumentFilename({ title }),
        )
      }
    }
    return summary
  })
  ipcMain.handle('mona:documents:duplicate', async (_event, id: string, title?: string) => {
    const source = (await listDocuments()).find(document => document.id === id)
    const duplicated = await duplicateDocument(id, title)
    if (!source?.sourceReference) return duplicated
    const sourceDocument = await dataSources.getDocument(source.sourceReference)
    if (sourceDocument.extension !== '.mona') return duplicated
    try {
      const created = await dataSources.createDocument(
        source.sourceReference.sourceId,
        safeDocumentFilename({ title: duplicated.title }),
        await packageDocument(duplicated.id),
      )
      return linkDocumentToSource(duplicated.id, created.reference)
    }
    catch (error) {
      await deleteDocument(duplicated.id).catch(() => undefined)
      throw error
    }
  })
  ipcMain.handle('mona:documents:delete', async (_event, id: string) => {
    const summary = (await listDocuments()).find(document => document.id === id)
    if (summary?.sourceReference) {
      const sourceDocument = await dataSources.getDocument(summary.sourceReference)
      if (sourceDocument.extension === '.mona') {
        await dataSources.deleteDocument(summary.sourceReference)
      }
    }
    await deleteDocument(id)
  })
  ipcMain.handle('mona:documents:discard-recovery', (_event, id: string) => deleteDocument(id))
  ipcMain.handle('mona:document-data:pptx:list', (_event, id: string) => listPowerPointPackageRecordIds(id))
  ipcMain.handle('mona:document-data:pptx:read', (_event, id: string, packageId: string) => readPowerPointPackageRecord(id, packageId))
  ipcMain.handle('mona:document-data:pptx:write', (_event, id: string, packageId: string, value: unknown) => writePowerPointPackageRecord(id, packageId, value))
  ipcMain.handle('mona:document-data:pptx:delete', (_event, id: string, packageId: string) => deletePowerPointPackageRecord(id, packageId))
  ipcMain.handle('mona:document-data:sketches:list', (_event, id: string) => listSketchRecords(id))
  ipcMain.handle('mona:document-data:sketches:write', (_event, id: string, slideId: string, value: unknown) => writeSketchRecord(id, slideId, value))
  ipcMain.handle('mona:document-data:sketches:delete', (_event, id: string, slideId: string) => deleteSketchRecord(id, slideId))
  ipcMain.handle('mona:document-data:legacy:pending', (_event, id: string, kind: 'powerpoint-packages' | 'sketches') => isLegacyDocumentDataMigrationPending(id, kind))
  ipcMain.handle('mona:document-data:legacy:complete', (_event, id: string, kind: 'powerpoint-packages' | 'sketches') => completeLegacyDocumentDataMigration(id, kind))
  ipcMain.handle('mona:deck:write-asset', (_event, id: string, name: string, bytes: ArrayBuffer) => writeAsset(id, name, bytes))
  ipcMain.handle('mona:deck:collect-garbage', (_event, id: string, keep: string[]) => collectGarbage(id, keep ?? []))
  // Where the agent's workspace should copy assets from, so it can read them off
  // disk instead of asking the renderer for base64 one at a time.
  ipcMain.handle('mona:deck:assets-directory', (_event, id: string) => (
    isDocumentId(id) ? documentAssetsRoot(id) : null
  ))
}

/**
 * Lets the renderer finish writing before a window closes.
 *
 * The renderer used to guard this with `window.onbeforeunload`, which is a web
 * page's only move: ask the browser to talk the user out of leaving. A window
 * is not a tab, that prompt arrives as a native modal the application does not
 * control, and there is nothing to argue about — the right answer is simply to
 * wait for the write.
 *
 * The wait is bounded. A renderer that is wedged or already gone must not make
 * a window unclosable, so after `FLUSH_TIMEOUT_MS` the window closes anyway.
 */
const FLUSH_TIMEOUT_MS = 2_000

/**
 * Cancelling a close also cancels a quit, and on macOS destroying the last
 * window does not resume one — the application simply stays running with
 * nothing on screen. So a quit that was interrupted to flush is resumed here.
 */
let quitting = false
app.on('before-quit', () => { quitting = true })

export const flushBeforeClose = (window: Electron.BrowserWindow): void => {
  let closing = false
  window.on('close', event => {
    if (closing || window.webContents.isDestroyed()) return
    event.preventDefault()
    closing = true
    const done = new Promise<void>(resolve => {
      ipcMain.once(`mona:deck:flushed:${window.webContents.id}`, () => resolve())
      window.webContents.send('mona:deck:flush', window.webContents.id)
    })
    const deadline = new Promise<void>(resolve => setTimeout(resolve, FLUSH_TIMEOUT_MS))
    void Promise.race([done, deadline]).then(() => {
      window.destroy()
      if (quitting) app.quit()
    })
  })
}
