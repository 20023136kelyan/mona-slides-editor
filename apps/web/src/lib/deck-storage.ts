// Minimal promisified IndexedDB layer for the working-copy autosave. Every
// caller treats failures as "persistence unavailable" (private browsing,
// storage pressure), never as fatal application errors.

import { LEGACY_DECK_DATABASE_NAME } from '@/lib/legacy-compatibility'

const DATABASE_NAME = 'mona'
const DECK_STORE = 'decks'
const MEDIA_STORE = 'media'
const POWERPOINT_PACKAGE_STORE = 'powerpoint-packages'
const SKETCH_STORE = 'sketches'
const WORKING_DECK_KEY = 'working-deck'
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
    if (!database.objectStoreNames.contains(DECK_STORE)) database.createObjectStore(DECK_STORE)
    if (!database.objectStoreNames.contains(MEDIA_STORE)) database.createObjectStore(MEDIA_STORE)
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

const readDeckFrom = (databaseName: string): Promise<unknown> =>
  inStore(databaseName, DECK_STORE, 'readonly', store => store.get(WORKING_DECK_KEY))

const writeDeckTo = (databaseName: string, value: unknown): Promise<IDBValidKey> =>
  inStore(databaseName, DECK_STORE, 'readwrite', store => store.put(value, WORKING_DECK_KEY))

export const readDeckSlot = async (): Promise<unknown> => {
  const current = await readDeckFrom(DATABASE_NAME)
  if (current !== undefined) return current
  const legacy = await readDeckFrom(LEGACY_DECK_DATABASE_NAME)
  if (legacy === undefined) return undefined
  await writeDeckTo(DATABASE_NAME, legacy)
  return legacy
}

export const writeDeckSlot = (value: unknown): Promise<IDBValidKey> =>
  writeDeckTo(DATABASE_NAME, value)

export const clearDeckSlot = async (): Promise<undefined> => {
  await Promise.all([
    inStore(DATABASE_NAME, DECK_STORE, 'readwrite', store => store.delete(WORKING_DECK_KEY)),
    inStore(LEGACY_DECK_DATABASE_NAME, DECK_STORE, 'readwrite', store => store.delete(WORKING_DECK_KEY)),
  ])
  return undefined
}

export const readMediaBlob = async (key: string): Promise<unknown> => {
  const current = await inStore(DATABASE_NAME, MEDIA_STORE, 'readonly', store => store.get(key))
  if (current !== undefined) return current
  const legacy = await inStore(LEGACY_DECK_DATABASE_NAME, MEDIA_STORE, 'readonly', store => store.get(key))
  if (legacy !== undefined) await inStore(DATABASE_NAME, MEDIA_STORE, 'readwrite', store => store.put(legacy, key))
  return legacy
}

export const writeMediaBlob = (key: string, blob: Blob): Promise<IDBValidKey> =>
  inStore(DATABASE_NAME, MEDIA_STORE, 'readwrite', store => store.put(blob, key))

export const listMediaKeys = async (): Promise<IDBValidKey[]> => {
  const [current, legacy] = await Promise.all([
    inStore(DATABASE_NAME, MEDIA_STORE, 'readonly', store => store.getAllKeys()),
    inStore(LEGACY_DECK_DATABASE_NAME, MEDIA_STORE, 'readonly', store => store.getAllKeys()),
  ])
  return [...new Set([...current, ...legacy])]
}

export const deleteMediaBlob = async (key: IDBValidKey): Promise<undefined> => {
  await Promise.all([
    inStore(DATABASE_NAME, MEDIA_STORE, 'readwrite', store => store.delete(key)),
    inStore(LEGACY_DECK_DATABASE_NAME, MEDIA_STORE, 'readwrite', store => store.delete(key)),
  ])
  return undefined
}

export const readPowerPointPackage = (packageId: string): Promise<unknown> =>
  inStore(DATABASE_NAME, POWERPOINT_PACKAGE_STORE, 'readonly', store => store.get(packageId))

export const writePowerPointPackage = (packageId: string, value: unknown): Promise<IDBValidKey> =>
  inStore(DATABASE_NAME, POWERPOINT_PACKAGE_STORE, 'readwrite', store => store.put(value, packageId))

export const listPowerPointPackageIds = (): Promise<IDBValidKey[]> =>
  inStore(DATABASE_NAME, POWERPOINT_PACKAGE_STORE, 'readonly', store => store.getAllKeys())

export const deletePowerPointPackage = (packageId: IDBValidKey): Promise<undefined> =>
  inStore(DATABASE_NAME, POWERPOINT_PACKAGE_STORE, 'readwrite', store => store.delete(packageId))

export const clearPowerPointPackages = async (): Promise<undefined> => {
  await inStore(DATABASE_NAME, POWERPOINT_PACKAGE_STORE, 'readwrite', store => store.clear())
  return undefined
}

export const readSketchRecords = (): Promise<unknown[]> =>
  inStore(DATABASE_NAME, SKETCH_STORE, 'readonly', store => store.getAll())

export const writeSketchRecord = (slideId: string, value: unknown): Promise<IDBValidKey> =>
  inStore(DATABASE_NAME, SKETCH_STORE, 'readwrite', store => store.put(value, slideId))

export const deleteSketchRecord = (slideId: string): Promise<undefined> =>
  inStore(DATABASE_NAME, SKETCH_STORE, 'readwrite', store => store.delete(slideId))

export const clearSketchRecords = async (): Promise<undefined> => {
  await Promise.all([
    inStore(DATABASE_NAME, SKETCH_STORE, 'readwrite', store => store.clear()),
    inStore(LEGACY_DECK_DATABASE_NAME, SKETCH_STORE, 'readwrite', store => store.clear()),
  ])
  return undefined
}
