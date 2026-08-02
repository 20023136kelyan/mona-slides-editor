import type {
  ChartData,
  ChartOptions,
  PPTElement,
  PPTElementEffects,
  PPTElementShadow,
  PPTElementThreeD,
  PPTChartElement,
  PPTElementOutline,
  PPTImageElement,
  PPTShapeElement,
  PPTLineElement,
  PPTAnimation,
  PPTTableElement,
  PowerPointConnectorRelationships,
  PowerPointHeaderFooterPolicy,
  PowerPointPackageManifest,
  PresentationState,
  SlideTheme,
  SlideBackground,
  StructuredTextBody,
  TextAlignVertical,
  TextInset,
  TurningMode,
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

/** Clone one retained native drawing object into a slide shape tree. */
export interface PowerPointObjectInsertPatch {
  after: PPTElement
  before: PPTElement
  elementId: string
  kind: 'insert-object'
  mode: 'copy' | 'override'
  /** Existing native group which receives the clone; absent means slide root. */
  parentObjectId?: string
  slideId: string
  sourceObjectId: string
  sourcePart: string
  targetPart: string
}

/** Materialize slide-local visibility for shared layout/master objects. */
export interface PowerPointInheritedVisibilityPatch {
  hiddenObjectIds: string[]
  kind: 'inherited-visibility'
  layoutPart: string
  masterPart?: string
  partPath: string
  slideId: string
}

/** Clone one retained native slide and register it in presentation order. */
export interface PowerPointSlideInsertPatch {
  after: import('@mona/presentation-core').Slide
  before: import('@mona/presentation-core').Slide
  index: number
  /** Effective retained layout/master objects available to slide-local overrides. */
  inheritedBefore?: PPTElement[]
  kind: 'insert-slide'
  slideId: string
  sourcePart: string
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

/** Insert one Mona-authored semantic element without a retained native payload. */
export interface PowerPointElementInsertPatch {
  after: PPTElement
  elementId: string
  /** Sibling position in the target shape tree. */
  index: number
  kind: 'insert-element'
  /** Existing native group which receives the element; absent means part root. */
  parentObjectId?: string
  slideId: string
  targetPart: string
}

/** Replace one retained drawing object with a newly serialized semantic object. */
export interface PowerPointElementReplacePatch {
  after: PPTElement
  elementId: string
  kind: 'replace-element'
  objectId: string
  slideId: string
  targetPart: string
}

export interface PowerPointNotesPatch {
  after: string
  before: string
  kind: 'notes'
  notesPart: string
  partPath: string
  scale?: number
  slidePart: string
  slideId: string
}

export interface PowerPointCommentDraft {
  content: string
  index: number
  key: string
  parentKey?: string
  position?: { x: number; y: number }
  status?: string
  time: number
  user: string
}

export interface PowerPointCommentsPatch {
  authors: string[]
  comments: PowerPointCommentDraft[]
  authorsPart: string
  kind: 'comments'
  partPath: string
  removePartPaths?: string[]
  slidePart: string
  slideId: string
}

/** Map Mona's presentation-wide theme controls onto a retained OOXML theme part. */
export interface PowerPointThemePatch {
  after: SlideTheme
  before: SlideTheme
  kind: 'theme'
  partPath: string
}

/** Author the slide-master switches controlling native header/footer families. */
export interface PowerPointHeaderFooterPatch {
  after?: PowerPointHeaderFooterPolicy
  before?: PowerPointHeaderFooterPolicy
  kind: 'header-footer'
  partPath: string
}

export interface PowerPointTimingPatch {
  after: PPTAnimation[]
  before: PPTAnimation[]
  kind: 'timing'
  partPath: string
  slideId: string
  targets: Record<string, string>
}

export interface PowerPointTransitionPatch {
  after: { durationMs?: number; turningMode?: TurningMode }
  before: { durationMs?: number; turningMode?: TurningMode }
  kind: 'transition'
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

export interface PowerPointEffectsPatch {
  after?: PPTElementEffects
  afterOuterShadow?: PPTElementShadow
  before?: PPTElementEffects
  beforeOuterShadow?: PPTElementShadow
  elementId: string
  kind: 'effects'
  objectId: string
  partPath: string
  /** Mona canvas units per PowerPoint point for this imported package. */
  scale?: number
  slideId: string
}

export interface PowerPointThreeDPatch {
  after?: PPTElementThreeD
  before?: PPTElementThreeD
  elementId: string
  kind: 'three-d'
  materializeInherited?: boolean
  objectId: string
  partPath: string
  /** Mona canvas units per PowerPoint point for this imported package. */
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
  | PowerPointEffectsPatch
  | PowerPointHeaderFooterPatch
  | PowerPointElementInsertPatch
  | PowerPointElementReplacePatch
  | PowerPointImagePatch
  | PowerPointInheritedVisibilityPatch
  | PowerPointObjectInsertPatch
  | PowerPointNotesPatch
  | PowerPointShapeGeometryPatch
  | PowerPointShapeStylePatch
  | PowerPointTablePatch
  | PowerPointTextPatch
  | PowerPointThemePatch
  | PowerPointThreeDPatch
  | PowerPointTimingPatch
  | PowerPointTransformPatch
  | PowerPointTransitionPatch
  | PowerPointSlideInsertPatch

export interface PowerPointWritebackPlan {
  mode: 'noop' | 'patch' | 'unsupported'
  operations: PowerPointPatchOperation[]
  touchedParts: string[]
  unsupported: PowerPointWritebackIssue[]
}

export interface PowerPointWritebackInput {
  /** Resolve a document-owned URL or agent workspace path to durable bytes. */
  resolveAsset?: PowerPointAssetResolver
  baseline: PresentationState
  bytes: ArrayBuffer
  manifest: PowerPointPackageManifest
  presentation: PresentationState
}

export interface PowerPointAssetPayload {
  bytes: ArrayBuffer | Uint8Array
  mediaType: string
}

export type PowerPointAssetResolver = (
  reference: string,
) => Promise<PowerPointAssetPayload | undefined>

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
