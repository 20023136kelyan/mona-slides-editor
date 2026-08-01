import type {
  PPTElement,
  SlideBackground,
  StructuredTextParagraphProperties,
  StructuredTextRunProperties,
} from './model'

export type PowerPointPackagePartKind =
  | 'chart'
  | 'comments'
  | 'custom'
  | 'diagram'
  | 'embedded'
  | 'layout'
  | 'master'
  | 'media'
  | 'metadata'
  | 'notes'
  | 'presentation'
  | 'relationships'
  | 'slide'
  | 'theme'
  | 'unknown'

export interface PowerPointPackagePart {
  contentType?: string
  kind: PowerPointPackagePartKind
  path: string
}

export type PowerPointSourceObjectKind =
  | 'connector'
  | 'content'
  | 'graphic-frame'
  | 'group'
  | 'picture'
  | 'shape'
  | 'unknown'

export interface PowerPointConnectorEndpoint {
  /** PowerPoint's non-visual drawing id for the connected shape. */
  nativeShapeId: string
  /** Connection-site index on the target shape. */
  siteIndex: string
  /** Exact package-scoped target when the native id resolves uniquely. */
  targetObjectId?: string
}

export interface PowerPointConnectorRelationships {
  end?: PowerPointConnectorEndpoint
  start?: PowerPointConnectorEndpoint
}

/**
 * Stable identity read directly from a PowerPoint shape-tree part.
 *
 * `nativeId` is PowerPoint's non-visual drawing ID. `stableId` scopes it to
 * the source package and part so imported objects can be addressed without
 * depending on Mona's generated editor IDs.
 */
export interface PowerPointSourceObjectIdentity {
  connector?: PowerPointConnectorRelationships
  creationId?: string
  decorative?: boolean
  description?: string
  hidden?: boolean
  kind: PowerPointSourceObjectKind
  locks?: Record<string, boolean>
  name?: string
  nativeId: string
  parentStableId?: string
  partPath: string
  placeholderIndex?: string
  placeholderType?: string
  relationshipIds?: string[]
  sourceIndex: number
  stableId: string
  title?: string
  visual?: PowerPointVisualMetadata
}

export interface PowerPointVisualEffect {
  attributes: Record<string, string>
  type: string
}

export interface PowerPointVisualMetadata {
  effects: PowerPointVisualEffect[]
  hasScene3d: boolean
  hasShape3d: boolean
}

export interface PowerPointPresentationProperties {
  firstSlideNumber?: number
  rightToLeft?: boolean
  showSpecialPlaceholdersOnTitleSlide?: boolean
  slideHeightEmu?: number
  slideWidthEmu?: number
  strictFirstAndLastChars?: boolean
}

export interface PowerPointSection {
  id: string
  name?: string
  slideIds: string[]
}

export interface PowerPointCustomShow {
  id?: string
  name: string
  relationshipIds: string[]
}

export interface PowerPointNotesTextRun {
  bold?: boolean
  fontFamily?: string
  fontSize?: number
  italic?: boolean
  language?: string
  text: string
  underline?: string
}

export interface PowerPointNotesParagraph {
  alignment?: string
  level?: number
  runs: PowerPointNotesTextRun[]
}

export interface PowerPointNotesPlaceholder {
  nativeShapeId: string
  paragraphs: PowerPointNotesParagraph[]
  placeholderIndex?: string
  placeholderType?: string
}

export interface PowerPointNotesMaster {
  objectIds: string[]
  partPath: string
  placeholders: PowerPointNotesPlaceholder[]
  themePart?: string
}

export interface PowerPointNotesSlide {
  masterPart?: string
  objectIds: string[]
  partPath: string
  placeholders: PowerPointNotesPlaceholder[]
  slidePart: string
}

export interface PowerPointCommentAuthor {
  id: string
  initials?: string
  lastIndex?: number
  name?: string
  providerId?: string
  userId?: string
}

export interface PowerPointComment {
  authorId?: string
  createdAt?: string
  id: string
  parentId?: string
  partPath: string
  position?: { x: number; y: number }
  slidePart?: string
  status?: string
  text: string
}

export const powerPointCommentNoteId = (
  comment: Pick<PowerPointComment, 'id' | 'partPath'>,
): string => `pptx-comment:${encodeURIComponent(comment.partPath)}:${encodeURIComponent(comment.id)}`

export interface PowerPointTransitionEffect {
  attributes: Record<string, string>
  type: string
}

export interface PowerPointSlideTransition {
  advanceAfterMs?: number
  advanceOnClick?: boolean
  durationMs?: number
  effect?: PowerPointTransitionEffect
  soundRelationshipId?: string
  speed?: string
  sourceLayer: 'layout' | 'master' | 'slide'
}

export interface PowerPointTimingCondition {
  delay?: string
  event?: string
  relationshipId?: string
  targetObjectId?: string
  targetShapeId?: string
}

export interface PowerPointTimingNode {
  attributes: Record<string, string>
  children: PowerPointTimingNode[]
  conditions?: PowerPointTimingCondition[]
  id?: string
  nodeType: string
  targetObjectId?: string
  targetShapeId?: string
}

export interface PowerPointBuild {
  attributes: Record<string, string>
  kind: string
  targetObjectId?: string
  targetShapeId?: string
}

export interface PowerPointSlideTiming {
  builds: PowerPointBuild[]
  roots: PowerPointTimingNode[]
  slidePart: string
  transition?: PowerPointSlideTransition
}

export interface PowerPointDocumentSemantics {
  commentAuthors: PowerPointCommentAuthor[]
  comments: PowerPointComment[]
  customShows: PowerPointCustomShow[]
  notesMasters: PowerPointNotesMaster[]
  notesSlides: PowerPointNotesSlide[]
  properties: PowerPointPresentationProperties
  sections: PowerPointSection[]
  timings: PowerPointSlideTiming[]
}

export interface PowerPointThemeColor {
  name: string
  type: 'preset' | 'scheme' | 'srgb' | 'system'
  value: string
}

export interface PowerPointThemeFont {
  complexScript?: string
  eastAsian?: string
  latin?: string
  supplemental: Array<{
    script: string
    typeface: string
  }>
}

export interface PowerPointThemeStyleEntry {
  attributes: Record<string, string>
  childTypes: string[]
  colors: PowerPointThemeColor[]
  index: number
  kind: string
}

export interface PowerPointColorScheme {
  colors: PowerPointThemeColor[]
  name?: string
}

export interface PowerPointTheme {
  backgroundFillStyles?: PowerPointThemeStyleEntry[]
  colorSchemeName?: string
  colors: PowerPointThemeColor[]
  extraColorSchemes?: PowerPointColorScheme[]
  effectStyles?: PowerPointThemeStyleEntry[]
  fillStyles?: PowerPointThemeStyleEntry[]
  formatSchemeName?: string
  id: string
  majorFont?: PowerPointThemeFont
  majorLatinFont?: string
  minorFont?: PowerPointThemeFont
  minorLatinFont?: string
  isOverride?: boolean
  lineStyles?: PowerPointThemeStyleEntry[]
  name?: string
  packageId: string
  partPath: string
}

export type PowerPointColorMap = Record<string, string>

export interface PowerPointHeaderFooterPolicy {
  dateTime: boolean
  footer: boolean
  header: boolean
  slideNumber: boolean
}

export interface PowerPointTextStyleLevel {
  alignment?: string
  bold?: boolean
  bulletCharacter?: string
  fontColor?: PowerPointThemeColor
  fontFamily?: string
  fontSize?: number
  indent?: number
  italic?: boolean
  language?: string
  level: number
  marginLeft?: number
  rightToLeft?: boolean
  paragraph?: StructuredTextParagraphProperties
  run?: StructuredTextRunProperties
  underline?: string
}

export interface PowerPointMasterTextStyles {
  body: PowerPointTextStyleLevel[]
  other: PowerPointTextStyleLevel[]
  title: PowerPointTextStyleLevel[]
}

export interface PowerPointSlideMaster {
  background?: SlideBackground
  colorMap?: PowerPointColorMap
  elements?: PPTElement[]
  headerFooter?: PowerPointHeaderFooterPolicy
  id: string
  layoutIds: string[]
  objectIds: string[]
  packageId: string
  partPath: string
  preserve: boolean
  textStyles?: PowerPointMasterTextStyles
  themeId?: string
}

export interface PowerPointSlideLayout {
  background?: SlideBackground
  colorMapOverride?: PowerPointColorMap
  elements?: PPTElement[]
  id: string
  matchingName?: string
  masterId?: string
  name?: string
  objectIds: string[]
  packageId: string
  partPath: string
  preserve: boolean
  showMasterPlaceholderAnimations: boolean
  showMasterShapes: boolean
  type?: string
}

export interface PowerPointPlaceholder {
  elementId?: string
  index?: string
  layer: 'layout' | 'master' | 'slide'
  objectId: string
  partId: string
  partPath: string
  textStyleKind?: 'body' | 'other' | 'title'
  type?: string
}

export interface PowerPointHierarchy {
  defaultTextStyle?: PowerPointTextStyleLevel[]
  layouts: PowerPointSlideLayout[]
  masters: PowerPointSlideMaster[]
  placeholders: PowerPointPlaceholder[]
  themes: PowerPointTheme[]
}

export interface PowerPointDirtyPart {
  objectIds: string[]
  partPath: string
  properties?: string[]
  reasons: string[]
}

export interface PowerPointDirtyPartJournal {
  parts: PowerPointDirtyPart[]
  revision: number
}

export interface PowerPointRelationship {
  external: boolean
  id: string
  sourcePart: string
  target: string
  type: string
}

export interface PowerPointPackageIssue {
  code: string
  message: string
  relationshipId?: string
  severity: 'error' | 'warning'
  sourcePart?: string
  target?: string
}

export interface PowerPointSlideDependency {
  backgroundSource?: 'default' | 'layout' | 'master' | 'slide'
  colorMapOverride?: PowerPointColorMap
  layoutId?: string
  layoutPart?: string
  masterId?: string
  masterPart?: string
  notesPart?: string
  presentationSlideId?: string
  relationshipId?: string
  slidePart: string
  showMasterPlaceholderAnimations?: boolean
  showMasterShapes?: boolean
  themeId?: string
  themePart?: string
}

export type PowerPointImportDisposition = 'approximated' | 'dropped' | 'modeled' | 'opaque'

export interface PowerPointImportDispositionCounts {
  approximated: number
  dropped: number
  modeled: number
  opaque: number
}

export interface PowerPointImportCapabilityReport extends PowerPointImportDispositionCounts {
  sourceType: string
}

export interface PowerPointImportIssue {
  code: string
  disposition: PowerPointImportDisposition
  message: string
  sourceLayer: PowerPointElementSourceLayer
  sourceOrder?: number
  sourceType: string
}

export interface PowerPointImportSlideReport {
  capabilities: PowerPointImportCapabilityReport[]
  counts: PowerPointImportDispositionCounts
  issues: PowerPointImportIssue[]
  outputElementCount: number
  slideIndex: number
  slidePart?: string
  sourceObjectCount: number
}

export interface PowerPointImportReport {
  counts: PowerPointImportDispositionCounts
  packageId: string
  packageIssues: PowerPointPackageIssue[]
  packageParts: {
    preserved: number
    relationships: number
    total: number
    unknown: number
  }
  schemaVersion: 1
  slides: PowerPointImportSlideReport[]
  status: 'complete' | 'complete-with-approximations' | 'complete-with-loss'
}

/**
 * Serializable reference to an imported PowerPoint package.
 *
 * The original package bytes live outside the presentation state so history,
 * collaboration, and normal element edits do not clone a potentially large
 * archive. The package ID addresses those bytes in the editor backing store.
 */
export interface PowerPointPackageReference {
  byteLength: number
  /** Mona canvas units per PowerPoint point for this specific import. */
  coordinateScale?: number
  dirty?: PowerPointDirtyPartJournal
  document?: PowerPointDocumentSemantics
  fileName: string
  importReport?: PowerPointImportReport
  hierarchy?: PowerPointHierarchy
  /**
   * Parts deliberately opened through Mona's shared-layer authoring surface.
   *
   * Ordinary slide editing never populates this record. Keeping the intent
   * beside the edited hierarchy lets writeback distinguish a requested master
   * or layout change from accidental mutation of retained source metadata.
   */
  sharedAuthoring?: {
    partPaths: string[]
    revision: number
  }
  kind: 'pptx'
  packageId: string
  slides: PowerPointSlideDependency[]
}

/**
 * Full, read-only inventory produced when a PowerPoint package is ingested.
 * Unknown parts and relationships intentionally remain in this inventory.
 */
export interface PowerPointPackageManifest extends PowerPointPackageReference {
  issues: PowerPointPackageIssue[]
  objects: PowerPointSourceObjectIdentity[]
  parts: PowerPointPackagePart[]
  relationships: PowerPointRelationship[]
  schemaVersion: 1
}

export interface PowerPointSlideSource extends PowerPointSlideDependency {
  /**
   * The retained slide part behind a newly duplicated Mona slide.
   *
   * `slidePart` continues to resolve the hierarchy while the presentation is
   * open. `copyOnWrite` is the crucial distinction at export: this slide is a
   * new native slide cloned from that part, never another alias for it.
   */
  copyOnWrite?: {
    packageId: string
    sourceSlidePart: string
  }
  /**
   * Inherited drawing objects intentionally hidden only on this slide.
   *
   * PowerPoint does not give every master/layout object a slide-local delete
   * switch. Mona keeps the intent here and native writeback derives a private
   * layout/master chain for this slide, so the shared source hierarchy is never
   * mutated as a side effect.
   */
  hiddenInheritedObjectIds?: string[]
  kind: 'pptx'
  packageId: string
}

export type PowerPointElementSourceLayer = 'inherited' | 'layout' | 'master' | 'slide'

/**
 * The native object retained behind a Mona-created copy or slide-local
 * override.
 *
 * This is deliberately not a new exact source identity. `sourceObjectId`
 * continues to mean "this element is that OOXML object"; `copyOnWrite` means
 * "this element was forked from that object". Keeping the distinction prevents
 * a duplicate from ever patching or deleting its original by accident.
 */
export interface PowerPointCopyOnWriteSource {
  mode: 'copy' | 'override'
  packageId: string
  sourceLayer: PowerPointElementSourceLayer
  sourceObjectId: string
  sourcePart: string
}

/**
 * Provenance for a Mona element derived from a PowerPoint object.
 *
 * Mona's parser carries the OOXML part and non-visual drawing ID from the
 * source node into every supported converted element. Provenance is attached
 * only after that pair resolves to one unique package-inventory object.
 * Elements from malformed or unsupported XML remain editable in Mona but do
 * not receive a source identity and are never treated as exact patch targets.
 */
export interface PowerPointElementSource {
  connector?: PowerPointConnectorRelationships
  copyOnWrite?: PowerPointCopyOnWriteSource
  decorative?: boolean
  description?: string
  hidden?: boolean
  kind: 'pptx'
  locks?: Record<string, boolean>
  nativeShapeId?: string
  packageId: string
  placeholderIndex?: string
  placeholderLayoutObjectId?: string
  placeholderMasterObjectId?: string
  placeholderType?: string
  relationshipIds?: string[]
  slidePart: string
  stableId: string
  sourceLayer: PowerPointElementSourceLayer
  sourceOrder?: number
  sourceObjectId?: string
  sourcePart?: string
  title?: string
  visual?: PowerPointVisualMetadata
}
