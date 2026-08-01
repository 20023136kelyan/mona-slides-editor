// Document-owned PowerPoint archives and sketches live in the desktop document
// directory. IndexedDB remains only as a compatibility source for the one-time
// migration of the previous singleton deck and as a browser-test fallback.

import { LEGACY_DECK_DATABASE_NAME } from '@/lib/legacy-compatibility'
import { maybeActiveDocumentId } from '@/features/documents/active-document'
import { maybeMonaBridge } from '@/lib/mona-bridge'

const DATABASE_NAME = 'mona'
const POWERPOINT_PACKAGE_STORE = 'powerpoint-packages'
const SKETCH_STORE = 'sketches'
const DATABASE_VERSION = 3

const databasePromises = new Map<string, Promise<IDBDatabase>>()

const asPromise = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
})

const openDatabase = (name: string): Promise<IDBDatabase> => {
  const request = indexedDB.open(name, DATABASE_VERSION)
  request.onupgradeneeded = () => {
    const database = request.result
    if (!database.objectStoreNames.contains(POWERPOINT_PACKAGE_STORE)) database.createObjectStore(POWERPOINT_PACKAGE_STORE)
    if (!database.objectStoreNames.contains(SKETCH_STORE)) database.createObjectStore(SKETCH_STORE)
  }
  return asPromise(request)
}

const database = (name = DATABASE_NAME): Promise<IDBDatabase> => {
  const existing = databasePromises.get(name)
  if (existing) return existing
  const pending = openDatabase(name).catch(error => {
    databasePromises.delete(name)
    throw error
  })
  databasePromises.set(name, pending)
  return pending
}

const inStore = async <T>(
  databaseName: string,
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const store = (await database(databaseName)).transaction(storeName, mode).objectStore(storeName)
  return asPromise(run(store))
}

const readIndexedPowerPointPackage = (packageId: string): Promise<unknown> =>
  inStore(DATABASE_NAME, POWERPOINT_PACKAGE_STORE, 'readonly', store => store.get(packageId))

const writeIndexedPowerPointPackage = (packageId: string, value: unknown): Promise<IDBValidKey> =>
  inStore(DATABASE_NAME, POWERPOINT_PACKAGE_STORE, 'readwrite', store => store.put(value, packageId))

const listIndexedPowerPointPackageIds = (): Promise<IDBValidKey[]> =>
  inStore(DATABASE_NAME, POWERPOINT_PACKAGE_STORE, 'readonly', store => store.getAllKeys())

const deleteIndexedPowerPointPackage = (packageId: IDBValidKey): Promise<undefined> =>
  inStore(DATABASE_NAME, POWERPOINT_PACKAGE_STORE, 'readwrite', store => store.delete(packageId))

const readIndexedSketchRecords = (): Promise<unknown[]> =>
  inStore(DATABASE_NAME, SKETCH_STORE, 'readonly', store => store.getAll())

const writeIndexedSketchRecord = (slideId: string, value: unknown): Promise<IDBValidKey> =>
  inStore(DATABASE_NAME, SKETCH_STORE, 'readwrite', store => store.put(value, slideId))

const deleteIndexedSketchRecord = (slideId: string): Promise<undefined> =>
  inStore(DATABASE_NAME, SKETCH_STORE, 'readwrite', store => store.delete(slideId))

const activeDocumentData = () => {
  const documentId = maybeActiveDocumentId()
  const data = maybeMonaBridge()?.documentData
  return documentId && data ? { data, documentId } : null
}

const documentDataFor = (documentId: string) => {
  const data = maybeMonaBridge()?.documentData
  return data ? { data, documentId } : null
}

const migrationPromises = new Map<string, Promise<void>>()

const migrateLegacyPowerPointPackages = async (
  context: NonNullable<ReturnType<typeof activeDocumentData>>,
): Promise<void> => {
  if (!await context.data.legacyMigration.pending(context.documentId, 'powerpoint-packages')) return
  const ids = await listIndexedPowerPointPackageIds()
  for (const packageId of ids) {
    if (typeof packageId !== 'string') continue
    const value = await readIndexedPowerPointPackage(packageId)
    if (value !== undefined) {
      await context.data.powerpointPackages.write(context.documentId, packageId, value)
    }
  }
  await context.data.legacyMigration.complete(context.documentId, 'powerpoint-packages')
}

const migrateLegacySketches = async (
  context: NonNullable<ReturnType<typeof activeDocumentData>>,
): Promise<void> => {
  if (!await context.data.legacyMigration.pending(context.documentId, 'sketches')) return
  const records = await readIndexedSketchRecords()
  for (const record of records) {
    if (!record || typeof record !== 'object') continue
    const slideId = (record as { slideId?: unknown }).slideId
    if (typeof slideId === 'string' && slideId) {
      await context.data.sketches.write(context.documentId, slideId, record)
    }
  }
  await context.data.legacyMigration.complete(context.documentId, 'sketches')
}

const ensureLegacyMigration = (
  context: NonNullable<ReturnType<typeof activeDocumentData>>,
  kind: 'powerpoint-packages' | 'sketches',
): Promise<void> => {
  const key = `${context.documentId}:${kind}`
  const existing = migrationPromises.get(key)
  if (existing) return existing
  const pending = (
    kind === 'powerpoint-packages'
      ? migrateLegacyPowerPointPackages(context)
      : migrateLegacySketches(context)
  ).catch(error => {
    migrationPromises.delete(key)
    throw error
  })
  migrationPromises.set(key, pending)
  return pending
}

export const readPowerPointPackage = async (packageId: string): Promise<unknown> => {
  const context = activeDocumentData()
  if (!context) return readIndexedPowerPointPackage(packageId)
  await ensureLegacyMigration(context, 'powerpoint-packages')
  return context.data.powerpointPackages.read(context.documentId, packageId)
}

export const writePowerPointPackage = async (
  packageId: string,
  value: unknown,
): Promise<IDBValidKey> => {
  const context = activeDocumentData()
  if (!context) return writeIndexedPowerPointPackage(packageId, value)
  await ensureLegacyMigration(context, 'powerpoint-packages')
  return context.data.powerpointPackages.write(context.documentId, packageId, value)
}

export const listPowerPointPackageIds = async (): Promise<IDBValidKey[]> => {
  const context = activeDocumentData()
  if (!context) return listIndexedPowerPointPackageIds()
  await ensureLegacyMigration(context, 'powerpoint-packages')
  return context.data.powerpointPackages.listIds(context.documentId)
}

export const deletePowerPointPackage = async (packageId: IDBValidKey): Promise<undefined> => {
  const context = activeDocumentData()
  if (!context) return deleteIndexedPowerPointPackage(packageId)
  if (typeof packageId === 'string') {
    await ensureLegacyMigration(context, 'powerpoint-packages')
    await context.data.powerpointPackages.delete(context.documentId, packageId)
  }
  return undefined
}

export const clearPowerPointPackages = async (): Promise<undefined> => {
  const context = activeDocumentData()
  if (!context) {
    await inStore(DATABASE_NAME, POWERPOINT_PACKAGE_STORE, 'readwrite', store => store.clear())
    return undefined
  }
  await ensureLegacyMigration(context, 'powerpoint-packages')
  const ids = await context.data.powerpointPackages.listIds(context.documentId)
  await Promise.all(ids.map(id => context.data.powerpointPackages.delete(context.documentId, id)))
  return undefined
}

export const readSketchRecords = async (): Promise<unknown[]> => {
  const context = activeDocumentData()
  if (!context) return readIndexedSketchRecords()
  await ensureLegacyMigration(context, 'sketches')
  return context.data.sketches.list(context.documentId)
}

export const writeSketchRecord = async (
  slideId: string,
  value: unknown,
): Promise<IDBValidKey> => {
  const context = activeDocumentData()
  if (!context) return writeIndexedSketchRecord(slideId, value)
  await ensureLegacyMigration(context, 'sketches')
  return context.data.sketches.write(context.documentId, slideId, value)
}

export const deleteSketchRecord = async (slideId: string): Promise<undefined> => {
  const context = activeDocumentData()
  if (!context) return deleteIndexedSketchRecord(slideId)
  await ensureLegacyMigration(context, 'sketches')
  await context.data.sketches.delete(context.documentId, slideId)
  return undefined
}

export const clearSketchRecords = async (): Promise<undefined> => {
  const context = activeDocumentData()
  if (context) {
    await ensureLegacyMigration(context, 'sketches')
    const records = await context.data.sketches.list(context.documentId)
    await Promise.all(records.map(record => {
      const slideId = record && typeof record === 'object'
        ? (record as { slideId?: unknown }).slideId
        : undefined
      return typeof slideId === 'string'
        ? context.data.sketches.delete(context.documentId, slideId)
        : Promise.resolve()
    }))
    return undefined
  }
  await Promise.all([
    inStore(DATABASE_NAME, SKETCH_STORE, 'readwrite', store => store.clear()),
    inStore(LEGACY_DECK_DATABASE_NAME, SKETCH_STORE, 'readwrite', store => store.clear()),
  ])
  return undefined
}

/**
 * Fixed-document variants for stateful stores.
 *
 * A React route can unmount one editor while the next route is already mounting.
 * Capturing the owner when the store is created keeps a late sketch flush or
 * retained-PPTX write attached to the document that produced it.
 */
export const readDocumentPowerPointPackage = async (
  documentId: string,
  packageId: string,
): Promise<unknown> => {
  const context = documentDataFor(documentId)
  if (!context) return readIndexedPowerPointPackage(packageId)
  await ensureLegacyMigration(context, 'powerpoint-packages')
  return context.data.powerpointPackages.read(documentId, packageId)
}

export const writeDocumentPowerPointPackage = async (
  documentId: string,
  packageId: string,
  value: unknown,
): Promise<IDBValidKey> => {
  const context = documentDataFor(documentId)
  if (!context) return writeIndexedPowerPointPackage(packageId, value)
  await ensureLegacyMigration(context, 'powerpoint-packages')
  return context.data.powerpointPackages.write(documentId, packageId, value)
}

export const listDocumentPowerPointPackageIds = async (
  documentId: string,
): Promise<IDBValidKey[]> => {
  const context = documentDataFor(documentId)
  if (!context) return listIndexedPowerPointPackageIds()
  await ensureLegacyMigration(context, 'powerpoint-packages')
  return context.data.powerpointPackages.listIds(documentId)
}

export const deleteDocumentPowerPointPackage = async (
  documentId: string,
  packageId: IDBValidKey,
): Promise<undefined> => {
  const context = documentDataFor(documentId)
  if (!context) return deleteIndexedPowerPointPackage(packageId)
  if (typeof packageId === 'string') {
    await ensureLegacyMigration(context, 'powerpoint-packages')
    await context.data.powerpointPackages.delete(documentId, packageId)
  }
  return undefined
}

export const readDocumentSketchRecords = async (
  documentId: string,
): Promise<unknown[]> => {
  const context = documentDataFor(documentId)
  if (!context) return readIndexedSketchRecords()
  await ensureLegacyMigration(context, 'sketches')
  return context.data.sketches.list(documentId)
}

export const writeDocumentSketchRecord = async (
  documentId: string,
  slideId: string,
  value: unknown,
): Promise<IDBValidKey> => {
  const context = documentDataFor(documentId)
  if (!context) return writeIndexedSketchRecord(slideId, value)
  await ensureLegacyMigration(context, 'sketches')
  return context.data.sketches.write(documentId, slideId, value)
}

export const deleteDocumentSketchRecord = async (
  documentId: string,
  slideId: string,
): Promise<undefined> => {
  const context = documentDataFor(documentId)
  if (!context) return deleteIndexedSketchRecord(slideId)
  await ensureLegacyMigration(context, 'sketches')
  await context.data.sketches.delete(documentId, slideId)
  return undefined
}
