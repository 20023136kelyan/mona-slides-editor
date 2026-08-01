import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { deserialize, serialize } from 'node:v8'

import {
  documentDeckFile,
  documentRoot,
  isDocumentId,
} from './document-library.js'

/**
 * Document-owned records that should not inflate deck.json.
 *
 * Retained source PPTX archives can be hundreds of megabytes and Excalidraw
 * scenes change frequently. They still belong to a document, so they live
 * beneath that document directory rather than in a global renderer database:
 *
 *   documents/<id>/data/powerpoint-packages/<key-hash>.record
 *   documents/<id>/data/sketches/<key-hash>.record
 *
 * A document directory can now be copied, moved, backed up, or deleted as one
 * coherent unit.
 */

type RecordKind = 'powerpoint-packages' | 'sketches'
export type LegacyDocumentDataKind = RecordKind

interface StoredRecord {
  key: string
  value: unknown
  version: 1
}

const recordRoot = (documentId: string, kind: RecordKind) => (
  join(documentRoot(documentId), 'data', kind)
)

const legacyMigrationMarker = (documentId: string, kind: LegacyDocumentDataKind) => (
  join(documentRoot(documentId), 'data', `migrate-${kind}`)
)

const recordName = (key: string) => (
  `${createHash('sha256').update(key).digest('hex')}.record`
)

const assertDocument = async (documentId: string): Promise<void> => {
  if (
    !isDocumentId(documentId)
    || !await stat(documentDeckFile(documentId)).then(entry => entry.isFile()).catch(() => false)
  ) {
    throw new Error('This presentation no longer exists.')
  }
}

const recordFile = (documentId: string, kind: RecordKind, key: string) => (
  join(recordRoot(documentId, kind), recordName(key))
)

const readRecordFile = async (path: string): Promise<StoredRecord | null> => {
  try {
    const value = deserialize(await readFile(path)) as Partial<StoredRecord>
    if (
      !value
      || typeof value !== 'object'
      || typeof value.key !== 'string'
      || value.version !== 1
    ) return null
    return value as StoredRecord
  }
  catch {
    return null
  }
}

const readRecord = async (
  documentId: string,
  kind: RecordKind,
  key: string,
): Promise<unknown> => {
  await assertDocument(documentId)
  const record = await readRecordFile(recordFile(documentId, kind, key))
  return record?.key === key ? record.value : undefined
}

const writeRecord = async (
  documentId: string,
  kind: RecordKind,
  key: string,
  value: unknown,
): Promise<string> => {
  await assertDocument(documentId)
  if (!key) throw new Error('A document data key is required.')
  const root = recordRoot(documentId, kind)
  const target = recordFile(documentId, kind, key)
  const pending = `${target}.pending`
  await mkdir(root, { recursive: true })
  await writeFile(pending, serialize({ key, value, version: 1 } satisfies StoredRecord))
  await rename(pending, target)
  return key
}

const deleteRecord = async (
  documentId: string,
  kind: RecordKind,
  key: string,
): Promise<void> => {
  await assertDocument(documentId)
  await rm(recordFile(documentId, kind, key), { force: true })
}

const listRecords = async (
  documentId: string,
  kind: RecordKind,
): Promise<StoredRecord[]> => {
  await assertDocument(documentId)
  const root = recordRoot(documentId, kind)
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const records = await Promise.all(entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.record'))
    .map(entry => readRecordFile(join(root, entry.name))))
  return records.filter((record): record is StoredRecord => record !== null)
}

export const readPowerPointPackageRecord = (
  documentId: string,
  packageId: string,
): Promise<unknown> => readRecord(documentId, 'powerpoint-packages', packageId)

export const writePowerPointPackageRecord = (
  documentId: string,
  packageId: string,
  value: unknown,
): Promise<string> => writeRecord(documentId, 'powerpoint-packages', packageId, value)

export const deletePowerPointPackageRecord = (
  documentId: string,
  packageId: string,
): Promise<void> => deleteRecord(documentId, 'powerpoint-packages', packageId)

export const listPowerPointPackageRecordIds = async (
  documentId: string,
): Promise<string[]> => (await listRecords(documentId, 'powerpoint-packages')).map(record => record.key)

export const listSketchRecords = async (documentId: string): Promise<unknown[]> => (
  (await listRecords(documentId, 'sketches')).map(record => record.value)
)

export const writeSketchRecord = (
  documentId: string,
  slideId: string,
  value: unknown,
): Promise<string> => writeRecord(documentId, 'sketches', slideId, value)

export const deleteSketchRecord = (
  documentId: string,
  slideId: string,
): Promise<void> => deleteRecord(documentId, 'sketches', slideId)

export const isLegacyDocumentDataMigrationPending = async (
  documentId: string,
  kind: LegacyDocumentDataKind,
): Promise<boolean> => {
  await assertDocument(documentId)
  return stat(legacyMigrationMarker(documentId, kind))
    .then(entry => entry.isFile())
    .catch(() => false)
}

export const completeLegacyDocumentDataMigration = async (
  documentId: string,
  kind: LegacyDocumentDataKind,
): Promise<void> => {
  await assertDocument(documentId)
  await rm(legacyMigrationMarker(documentId, kind), { force: true })
}
