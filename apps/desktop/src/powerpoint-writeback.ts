import { createHash } from 'node:crypto'

import {
  validatePresentationState,
  type PowerPointPackageManifest,
  type PowerPointPackageReference,
  type PresentationState,
} from '@mona/presentation-core'
import {
  writeBackPowerPoint,
  type PowerPointWritebackPlan,
} from '@mona/pptx-writeback'

import { readPowerPointPackageRecord } from './document-data.js'
import { isDocumentId, readDocument } from './document-library.js'

interface StoredPowerPointPackage {
  baselinePresentation?: PresentationState
  bytes: Uint8Array
  manifest: PowerPointPackageManifest
  reference: PowerPointPackageReference
  version: 1
}

export interface DesktopPowerPointWriteback {
  bytes: ArrayBuffer
  plan: PowerPointWritebackPlan
}

const storedBytes = (value: unknown): Uint8Array | undefined => {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return undefined
}

const isStoredPackage = (value: unknown): value is StoredPowerPointPackage => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<StoredPowerPointPackage>
  return record.version === 1
    && !!storedBytes(record.bytes)
    && !!record.manifest
    && record.manifest.schemaVersion === 1
    && !!record.reference
    && record.reference.kind === 'pptx'
    && record.reference.packageId === record.manifest.packageId
}

const packageIdFor = (bytes: Uint8Array): string => (
  `pptx:${createHash('sha256').update(bytes).digest('hex')}`
)

const assertPresentation = (value: unknown): PresentationState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The presentation is not safe to export.')
  }
  const presentation = value as PresentationState
  const validation = validatePresentationState(presentation)
  if (!validation.valid) {
    throw new Error(
      `The presentation is not safe to export: ${validation.issues
        .filter(issue => issue.severity === 'error')
        .slice(0, 5)
        .map(issue => `${issue.path}: ${issue.message}`)
        .join('; ')}`,
    )
  }
  return structuredClone(presentation)
}

const sourceReference = (
  presentation: PresentationState,
  requestedPackageId?: string,
): PowerPointPackageReference => {
  const candidates = (presentation.sourcePackages ?? []).filter(source => (
    !requestedPackageId || source.packageId === requestedPackageId
  ))
  if (candidates.length !== 1) {
    throw new Error(
      candidates.length
        ? 'PowerPoint writeback currently requires one retained source package.'
        : 'This presentation has no retained PowerPoint source package.',
    )
  }
  return candidates[0]!
}

export const exportPowerPointForDocument = async ({
  documentId,
  packageId,
  presentation: candidate,
}: {
  documentId: string
  packageId?: string
  presentation: unknown
}): Promise<DesktopPowerPointWriteback> => {
  if (!isDocumentId(documentId) || !await readDocument(documentId)) {
    throw new Error('This presentation no longer exists.')
  }
  const presentation = assertPresentation(candidate)
  const reference = sourceReference(presentation, packageId)
  const stored = await readPowerPointPackageRecord(documentId, reference.packageId)
  if (!isStoredPackage(stored)) {
    throw new Error('The retained PowerPoint source package is missing or invalid.')
  }
  const bytes = storedBytes(stored.bytes)!.slice()
  if (
    bytes.byteLength !== reference.byteLength
    || packageIdFor(bytes) !== reference.packageId
  ) {
    throw new Error('The retained PowerPoint source package failed its identity check.')
  }
  if (!stored.baselinePresentation) {
    throw new Error(
      'Re-import this PowerPoint once to establish a source-preserving writeback baseline.',
    )
  }
  const baseline = assertPresentation(stored.baselinePresentation)
  const result = await writeBackPowerPoint({
    baseline,
    bytes: bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
    manifest: stored.manifest,
    presentation,
  })
  return {
    bytes: result.bytes,
    plan: structuredClone(result.plan),
  }
}
