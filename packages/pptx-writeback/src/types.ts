import type {
  PPTElement,
  PPTElementOutline,
  PPTLineElement,
  PowerPointPackageManifest,
  PresentationState,
  StructuredTextBody,
  TextAlignVertical,
  TextInset,
} from '@mona/presentation-core'

export interface PowerPointWritebackIssue {
  code: string
  elementId?: string
  message: string
  objectId?: string
  partPath?: string
  slideId?: string
}

export interface PowerPointTransformSnapshot {
  flipH?: boolean
  flipV?: boolean
  height: number
  left: number
  rotate: number
  top: number
  width: number
}

export interface PowerPointTransformPatch {
  after: PowerPointTransformSnapshot
  before: PowerPointTransformSnapshot
  elementId: string
  kind: 'transform'
  objectId: string
  partPath: string
  slideId: string
}

export interface PowerPointDeletePatch {
  elementId: string
  kind: 'delete'
  objectId: string
  partPath: string
  slideId: string
}

export interface PowerPointTextSnapshot {
  columnGap?: number
  columns?: number
  content: string
  defaultColor: string
  defaultFontName: string
  fixedHeight?: boolean
  inset?: TextInset
  lineHeight?: number
  paragraphSpace?: number
  structuredText?: StructuredTextBody
  vAlign?: TextAlignVertical
  wordSpace?: number
}

export interface PowerPointTextPatch {
  after: PowerPointTextSnapshot
  before: PowerPointTextSnapshot
  beforeWidth: number
  elementId: string
  kind: 'text'
  objectId: string
  partPath: string
  scale?: number
  slideId: string
}

export interface PowerPointShapeStyleSnapshot {
  complexFill?: boolean
  fill?: string
  outline?: PPTElementOutline
}

export interface PowerPointShapeStylePatch {
  after: PowerPointShapeStyleSnapshot
  before: PowerPointShapeStyleSnapshot
  beforeWidth: number
  elementId: string
  kind: 'style'
  objectId: string
  partPath: string
  scale?: number
  slideId: string
}

export interface PowerPointConnectorSnapshot {
  broken?: [number, number]
  broken2?: [number, number]
  broken2Direction?: PPTLineElement['broken2Direction']
  color: string
  cubic?: [[number, number], [number, number]]
  curve?: [number, number]
  end: [number, number]
  left: number
  points: PPTLineElement['points']
  start: [number, number]
  style: PPTLineElement['style']
  top: number
  width: number
}

export interface PowerPointConnectorPatch {
  after: PowerPointConnectorSnapshot
  before: PowerPointConnectorSnapshot
  elementId: string
  kind: 'connector'
  objectId: string
  partPath: string
  /** Mona canvas units per PowerPoint point for this imported package. */
  scale?: number
  slideId: string
}

export type PowerPointPatchOperation =
  | PowerPointConnectorPatch
  | PowerPointDeletePatch
  | PowerPointShapeStylePatch
  | PowerPointTextPatch
  | PowerPointTransformPatch

export interface PowerPointWritebackPlan {
  mode: 'noop' | 'patch' | 'unsupported'
  operations: PowerPointPatchOperation[]
  touchedParts: string[]
  unsupported: PowerPointWritebackIssue[]
}

export interface PowerPointWritebackInput {
  baseline: PresentationState
  bytes: ArrayBuffer
  manifest: PowerPointPackageManifest
  presentation: PresentationState
}

export interface PowerPointWritebackResult {
  bytes: ArrayBuffer
  plan: PowerPointWritebackPlan
}

export interface PowerPointElementEntry {
  element: PPTElement
  parentObjectId?: string
  slideId: string
}

export class PowerPointWritebackError extends Error {
  readonly issues: PowerPointWritebackIssue[]

  constructor(issues: readonly PowerPointWritebackIssue[]) {
    super(
      issues.length === 1
        ? issues[0]!.message
        : `This PowerPoint contains ${issues.length} edits that cannot be written back safely.`,
    )
    this.name = 'PowerPointWritebackError'
    this.issues = structuredClone([...issues])
  }
}
