import type { PPTElement, SlideBackground } from './model'

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

/**
 * Stable identity read directly from a PowerPoint shape-tree part.
 *
 * `nativeId` is PowerPoint's non-visual drawing ID. `stableId` scopes it to
 * the source package and part so imported objects can be addressed without
 * depending on Mona's generated editor IDs.
 */
export interface PowerPointSourceObjectIdentity {
  creationId?: string
  description?: string
  kind: PowerPointSourceObjectKind
  name?: string
  nativeId: string
  parentStableId?: string
  partPath: string
  placeholderIndex?: string
  placeholderType?: string
  sourceIndex: number
  stableId: string
  title?: string
}

export interface PowerPointThemeColor {
  name: string
  type: 'preset' | 'scheme' | 'srgb' | 'system'
  value: string
}

export interface PowerPointTheme {
  colorSchemeName?: string
  colors: PowerPointThemeColor[]
  id: string
  majorLatinFont?: string
  minorLatinFont?: string
  name?: string
  packageId: string
  partPath: string
}

export interface PowerPointSlideMaster {
  background?: SlideBackground
  elements?: PPTElement[]
  id: string
  layoutIds: string[]
  objectIds: string[]
  packageId: string
  partPath: string
  preserve: boolean
  themeId?: string
}

export interface PowerPointSlideLayout {
  background?: SlideBackground
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
  index?: string
  objectId: string
  partId: string
  partPath: string
  type?: string
}

export interface PowerPointHierarchy {
  layouts: PowerPointSlideLayout[]
  masters: PowerPointSlideMaster[]
  placeholders: PowerPointPlaceholder[]
  themes: PowerPointTheme[]
}

export interface PowerPointDirtyPart {
  objectIds: string[]
  partPath: string
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
  layoutId?: string
  layoutPart?: string
  masterId?: string
  masterPart?: string
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
  dirty?: PowerPointDirtyPartJournal
  fileName: string
  importReport?: PowerPointImportReport
  hierarchy?: PowerPointHierarchy
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
  kind: 'pptx'
  packageId: string
}

export type PowerPointElementSourceLayer = 'inherited' | 'layout' | 'master' | 'slide'

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
  kind: 'pptx'
  nativeShapeId?: string
  packageId: string
  placeholderIndex?: string
  placeholderType?: string
  slidePart: string
  stableId: string
  sourceLayer: PowerPointElementSourceLayer
  sourceOrder?: number
  sourceObjectId?: string
  sourcePart?: string
}
