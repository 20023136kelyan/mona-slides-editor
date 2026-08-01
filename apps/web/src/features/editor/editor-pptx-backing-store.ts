import type {
  PowerPointPackageManifest,
  PowerPointPackageReference,
} from '@mona/presentation-core'
import type { PowerPointPackageBacking } from '@mona/pptx-ingestion'

import {
  deleteDocumentPowerPointPackage,
  deletePowerPointPackage,
  listDocumentPowerPointPackageIds,
  listPowerPointPackageIds,
  readDocumentPowerPointPackage,
  readPowerPointPackage,
  writeDocumentPowerPointPackage,
  writePowerPointPackage,
} from '@/lib/deck-storage'
import { maybeActiveDocumentId } from '@/features/documents/active-document'

export type { PowerPointPackageBacking } from '@mona/pptx-ingestion'

interface StoredPowerPointPackage {
  bytes: Uint8Array
  manifest: PowerPointPackageManifest
  reference: PowerPointPackageReference
  version: 1
}

export interface PowerPointPackagePersistence {
  delete: (packageId: IDBValidKey) => Promise<undefined>
  listIds: () => Promise<IDBValidKey[]>
  read: (packageId: string) => Promise<unknown>
  write: (packageId: string, value: unknown) => Promise<IDBValidKey>
}

const indexedDbPersistence: PowerPointPackagePersistence = {
  delete: deletePowerPointPackage,
  listIds: listPowerPointPackageIds,
  read: readPowerPointPackage,
  write: writePowerPointPackage,
}

const defaultPersistence = (): PowerPointPackagePersistence => {
  const documentId = maybeActiveDocumentId()
  if (!documentId) return indexedDbPersistence
  return {
    delete: packageId => deleteDocumentPowerPointPackage(documentId, packageId),
    listIds: () => listDocumentPowerPointPackageIds(documentId),
    read: packageId => readDocumentPowerPointPackage(documentId, packageId),
    write: (packageId, value) => writeDocumentPowerPointPackage(documentId, packageId, value),
  }
}

const cloneBacking = (backing: PowerPointPackageBacking): PowerPointPackageBacking => ({
  bytes: backing.bytes.slice(),
  manifest: structuredClone(backing.manifest),
  reference: structuredClone(backing.reference),
})

const packageIdFor = async (bytes: Uint8Array): Promise<string> => {
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const digest = await globalThis.crypto.subtle.digest('SHA-256', source)
  const hex = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
  return `pptx:${hex}`
}

const storedBytes = (value: unknown): Uint8Array | undefined => {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return undefined
}

const isStoredPowerPointPackage = (value: unknown): value is StoredPowerPointPackage => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<StoredPowerPointPackage>
  const bytes = storedBytes(record.bytes)
  return record.version === 1
    && !!bytes
    && !!record.reference
    && typeof record.reference === 'object'
    && typeof record.reference.packageId === 'string'
    && record.reference.kind === 'pptx'
    && !!record.manifest
    && typeof record.manifest === 'object'
    && record.manifest.packageId === record.reference.packageId
}

/**
 * Large source archives stay outside Redux/history. Presentation state keeps
 * only serializable package references that address entries in this store.
 *
 * The memory cache is hydrated from the active document's retained source files.
 * Every record is re-hashed before use so corrupt or mismatched package bytes
 * can never masquerade as the source referenced by the presentation.
 */
export class PowerPointPackageBackingStore {
  readonly #packages = new Map<string, PowerPointPackageBacking>()
  readonly #persistence: PowerPointPackagePersistence
  readonly #ready: Promise<void>
  readonly #restoreIssues: string[] = []

  constructor(
    references: readonly PowerPointPackageReference[] = [],
    persistence: PowerPointPackagePersistence = defaultPersistence(),
  ) {
    this.#persistence = persistence
    this.#ready = this.#hydrate(references)
  }

  async #hydrate(references: readonly PowerPointPackageReference[]): Promise<void> {
    await Promise.all(references.map(async reference => {
      try {
        const stored = await this.#persistence.read(reference.packageId)
        if (!isStoredPowerPointPackage(stored)) {
          this.#restoreIssues.push(`Missing retained PowerPoint package: ${reference.fileName}`)
          return
        }
        const bytes = storedBytes(stored.bytes)!.slice()
        if (
          bytes.byteLength !== reference.byteLength
          || await packageIdFor(bytes) !== reference.packageId
        ) {
          this.#restoreIssues.push(`Corrupt retained PowerPoint package: ${reference.fileName}`)
          return
        }
        this.#packages.set(reference.packageId, {
          bytes,
          manifest: structuredClone(stored.manifest),
          reference: structuredClone(reference),
        })
      }
      catch {
        this.#restoreIssues.push(`Unable to restore retained PowerPoint package: ${reference.fileName}`)
      }
    }))
  }

  getManifest(packageId: string): PowerPointPackageManifest | undefined {
    const manifest = this.#packages.get(packageId)?.manifest
    return manifest ? structuredClone(manifest) : undefined
  }

  getRestoreIssues(): readonly string[] {
    return [...this.#restoreIssues]
  }

  has(packageId: string): boolean {
    return this.#packages.has(packageId)
  }

  put(backing: PowerPointPackageBacking): void {
    const cloned = cloneBacking(backing)
    this.#packages.set(cloned.reference.packageId, cloned)
  }

  async persist(backing: PowerPointPackageBacking): Promise<void> {
    await this.#ready
    const cloned = cloneBacking(backing)
    if (
      cloned.bytes.byteLength !== cloned.reference.byteLength
      || await packageIdFor(cloned.bytes) !== cloned.reference.packageId
    ) {
      throw new Error('PowerPoint source package identity does not match its retained bytes')
    }
    const stored: StoredPowerPointPackage = {
      bytes: cloned.bytes.slice(),
      manifest: structuredClone(cloned.manifest),
      reference: structuredClone(cloned.reference),
      version: 1,
    }
    await this.#persistence.write(cloned.reference.packageId, stored)
    this.#packages.set(cloned.reference.packageId, cloned)
  }

  async ready(): Promise<void> {
    await this.#ready
  }

  /**
   * Hydrates one package that the desktop process has just ingested.
   *
   * Main owns source bytes and writes the retained package directly to the
   * document store. The renderer then loads that record instead of receiving a
   * second copy of a potentially hundreds-of-megabytes archive over IPC.
   */
  async restore(reference: PowerPointPackageReference): Promise<boolean> {
    await this.#ready
    if (!this.#packages.has(reference.packageId)) await this.#hydrate([reference])
    return this.#packages.has(reference.packageId)
  }

  readBytes(packageId: string): Uint8Array | undefined {
    return this.#packages.get(packageId)?.bytes.slice()
  }

  async retain(packageIds: readonly string[]): Promise<void> {
    await this.#ready
    const retained = new Set(packageIds)
    for (const packageId of this.#packages.keys()) {
      if (!retained.has(packageId)) this.#packages.delete(packageId)
    }
    const persisted = await this.#persistence.listIds()
    await Promise.all(persisted.map(async packageId => {
      if (typeof packageId === 'string' && !retained.has(packageId)) {
        await this.#persistence.delete(packageId)
      }
    }))
  }
}
