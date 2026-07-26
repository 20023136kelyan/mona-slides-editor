// A promisified IndexedDB layer for what has not moved to disk yet: the original
// .pptx archive behind an imported deck, and per-slide sketches. Every caller
// treats failure as "unavailable", never as a fatal error.
//
// The deck and its binary used to live here too. They are files now - the deck was
// the reason this existed, and the media store is what made images vanish after a
// restart when a `blob:` key and its bytes fell out of step.

import { LEGACY_DECK_DATABASE_NAME } from '@/lib/legacy-compatibility'

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
