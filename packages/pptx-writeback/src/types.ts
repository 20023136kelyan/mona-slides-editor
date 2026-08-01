import type {
  ChartData,
  ChartOptions,
  PPTElement,
  PPTChartElement,
  PPTElementOutline,
  PPTImageElement,
  PPTShapeElement,
  PPTLineElement,
  PPTTableElement,
  PowerPointConnectorRelationships,
  PowerPointPackageManifest,
  PresentationState,
  SlideBackground,
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

export interface PowerPointAccessibilityPatch {
  after?: PPTElement['accessibility']
  before?: PPTElement['accessibility']
  elementId: string
  kind: 'accessibility'
  objectId: string
  partPath: string
  slideId: string
}

export interface PowerPointBackgroundPatch {
  after?: SlideBackground
  before?: SlideBackground
  kind: 'background'
  partPath: string
  slideId: string
}

export interface PowerPointNotesPatch {
  after: string
  before: string
  kind: 'notes'
  notesPart: string
  partPath: string
  scale?: number
  slideId: string
}

export interface PowerPointCommentTextPatch {
  after: string
  before: string
  id: string
}

export interface PowerPointCommentsPatch {
  changes: PowerPointCommentTextPatch[]
  kind: 'comments'
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
  fill?: string
  gradient?: PPTShapeElement['gradient']
  outline?: PPTElementOutline
  pattern?: string
  patternFit?: PPTShapeElement['patternFit']
  powerPointPattern?: PPTShapeElement['powerPointPattern']
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

export interface PowerPointShapeGeometrySnapshot {
  powerPointGeometry?: Extract<PPTElement, { type: 'shape' }>['powerPointGeometry']
}

export interface PowerPointShapeGeometryPatch {
  after: PowerPointShapeGeometrySnapshot
  before: PowerPointShapeGeometrySnapshot
  elementId: string
  kind: 'shape-geometry'
  objectId: string
  partPath: string
  slideId: string
}

export interface PowerPointImageSnapshot {
  clip?: PPTImageElement['clip']
  filters?: PPTImageElement['filters']
  opacity?: number
  outline?: PPTImageElement['outline']
  powerPointImage?: PPTImageElement['powerPointImage']
  shadow?: PPTImageElement['shadow']
  src: string
}

export interface PowerPointImagePatch {
  after: PowerPointImageSnapshot
  before: PowerPointImageSnapshot
  elementId: string
  kind: 'image'
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
  connections?: PowerPointConnectorRelationships
  curve?: [number, number]
  end: [number, number]
  left: number
  points: PPTLineElement['points']
  start: [number, number]
  style: PPTLineElement['style']
  top: number
  width: number
  powerPointGeometry?: PPTLineElement['powerPointGeometry']
}

export interface PowerPointConnectorPatch {
  after: PowerPointConnectorSnapshot
  before: PowerPointConnectorSnapshot
  elementId: string
  kind: 'connector'
  objectId: string
  parentObjectId?: string
  partPath: string
  /** Mona canvas units per PowerPoint point for this imported package. */
  scale?: number
  slideId: string
}

export interface PowerPointTableSnapshot {
  cellMinHeight: number
  colWidths: number[]
  data: PPTTableElement['data']
  outline: PPTTableElement['outline']
  powerPointTable?: PPTTableElement['powerPointTable']
  rowHeights?: number[]
  theme?: PPTTableElement['theme']
  width: number
}

export interface PowerPointTablePatch {
  after: PowerPointTableSnapshot
  before: PowerPointTableSnapshot
  beforeWidth: number
  elementId: string
  kind: 'table'
  objectId: string
  partPath: string
  scale?: number
  slideId: string
}

export interface PowerPointChartSnapshot {
  chartSpace?: PPTChartElement['chartSpace']
  chartType: PPTChartElement['chartType']
  data: ChartData
  options?: ChartOptions
  themeColors: string[]
}

/**
 * A native chart edit is addressed through the graphic frame on the slide,
 * but its semantic content lives in a chart part and (usually) an embedded
 * Excel package. Keeping all three addresses on the operation lets writeback
 * verify the source object while mutating only the parts that own the data.
 */
export interface PowerPointChartPatch {
  after: PowerPointChartSnapshot
  before: PowerPointChartSnapshot
  chartPart: string
  elementId: string
  kind: 'chart'
  objectId: string
  partPath: string
  slideId: string
  workbookPart?: string
}

export type PowerPointPatchOperation =
  | PowerPointAccessibilityPatch
  | PowerPointBackgroundPatch
  | PowerPointChartPatch
  | PowerPointCommentsPatch
  | PowerPointConnectorPatch
  | PowerPointDeletePatch
  | PowerPointImagePatch
  | PowerPointNotesPatch
  | PowerPointShapeGeometryPatch
  | PowerPointShapeStylePatch
  | PowerPointTablePatch
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
