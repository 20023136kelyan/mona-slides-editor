export interface Shadow {
  h: number
  v: number
  blur: number
  color: string
}

export interface ColorFill {
  type: 'color'
  value: string
}

export interface PictureFillFit {
  /** Tile alignment, tile mode only. */
  alignment?: string
  mode: 'stretch' | 'tile'
  /**
   * Destination rectangle for a stretch, as fractions of the shape inset from
   * each edge. Negative values push the edge outward so the picture overflows
   * and is cropped by the shape.
   */
  rect?: { b: number; l: number; r: number; t: number }
  scaleX?: number
  scaleY?: number
}

export interface ImageFill {
  type: 'image'
  value: {
    ref: string
    base64: string
    blob: string
    opacity: number
    fit?: PictureFillFit
  }
}

export interface GradientFill {
  type: 'gradient'
  value: {
    path: 'line' | 'circle' | 'rect' | 'shape'
    rot: number
    colors: {
      pos: string
      color: string
    }[]
  }
}

export interface PatternFill {
  type: 'pattern'
  value: {
    type: string
    foregroundColor: string
    backgroundColor: string
  }
}

export type Fill = ColorFill | ImageFill | GradientFill | PatternFill

export interface BackgroundFills {
  effective: Fill
  layout?: Fill
  master?: Fill
  slide?: Fill
  source: 'default' | 'layout' | 'master' | 'slide'
}

export interface Border {
  borderColor: string
  borderWidth: number
  borderType:'solid' | 'dashed' | 'dotted'
}

export interface AutoFit {
  type: 'shape' | 'text'
  fontScale?: number
}

export interface StructuredTextColor {
  alpha?: number
  type: 'preset' | 'scheme' | 'srgb' | 'system'
  value: string
}

export interface StructuredTextSpacing {
  unit: 'percent' | 'points'
  value: number
}

export interface StructuredTextRunProperties {
  alternativeLanguage?: string
  baseline?: number
  bold?: boolean
  capitalization?: string
  color?: StructuredTextColor
  complexScriptFontFamily?: string
  eastAsianFontFamily?: string
  fontFamily?: string
  fontSize?: number
  italic?: boolean
  language?: string
  normalizeHeight?: boolean
  spacing?: number
  strike?: string
  underline?: string
}

export interface StructuredTextParagraphProperties {
  alignment?: string
  bullet?: {
    character?: string
    color?: StructuredTextColor
    fontFamily?: string
    numberingScheme?: string
    size?: StructuredTextSpacing
    startAt?: number
    type: 'auto-number' | 'character' | 'none' | 'picture'
  }
  defaultRun?: StructuredTextRunProperties
  defaultTabSize?: number
  eastAsianLineBreak?: boolean
  fontAlignment?: string
  hangingPunctuation?: boolean
  indent?: number
  latinLineBreak?: boolean
  lineSpacing?: StructuredTextSpacing
  marginLeft?: number
  rightToLeft?: boolean
  spaceAfter?: StructuredTextSpacing
  spaceBefore?: StructuredTextSpacing
  tabs?: Array<{ alignment?: string; position: number }>
}

export interface StructuredTextBody {
  bodyProperties?: {
    anchor?: string
    anchorCenter?: boolean
    autoFit?: {
      fontScale?: number
      lineSpacingReduction?: number
      type: 'none' | 'normal' | 'shape'
    }
    columnCount?: number
    columnSpacing?: number
    insets?: [number, number, number, number]
    rightToLeftColumns?: boolean
    rotation?: number
    verticalMode?: string
    wrap?: string
  }
  defaultParagraph?: StructuredTextParagraphProperties
  listStyle: Array<{ level: number; paragraph?: StructuredTextParagraphProperties }>
  paragraphs: Array<{
    endProperties?: StructuredTextRunProperties
    level: number
    properties?: StructuredTextParagraphProperties
    runs: Array<{
      fieldId?: string
      fieldType?: string
      hyperlink?: string
      kind: 'break' | 'field' | 'tab' | 'text'
      properties?: StructuredTextRunProperties
      sourceId: string
      text?: string
    }>
    sourceId: string
  }>
  scale: number
  schemaVersion: 1
}

export interface TextInset {
  l: number
  t: number
  r: number
  b: number
}

export interface PathViewBox {
  x: number
  y: number
  width: number
  height: number
}

export interface LineEnd {
  type: 'none' | 'triangle' | 'stealth' | 'diamond' | 'oval' | 'arrow'
  width?: 'sm' | 'med' | 'lg'
  length?: 'sm' | 'med' | 'lg'
}

export interface NativeObjectIdentity {
  creationId?: string
  description?: string
  id: string
  kind: 'connector' | 'graphic-frame' | 'group' | 'math' | 'picture' | 'shape'
  name?: string
  partPath: string
  placeholderIndex?: string
  placeholderType?: string
  sourceLayer: 'diagram' | 'layout' | 'master' | 'slide'
  title?: string
}

export interface NativeObjectCarrier {
  /**
   * Identity read from the same OOXML node that produced this element.
   * Missing only when the input package contains a malformed object without
   * a cNvPr id or a source part cannot be resolved.
   */
  native?: NativeObjectIdentity
}

export interface Shape extends NativeObjectCarrier {
  type: 'shape'
  left: number
  top: number
  width: number
  height: number
  borderColor: string
  borderWidth: number
  borderType: 'solid' | 'dashed' | 'dotted'
  borderStrokeDasharray: string
  shadow?: Shadow
  fill: Fill
  content: string
  textBody?: StructuredTextBody
  isFlipV: boolean
  isFlipH: boolean
  rotate: number
  shapType: string
  vAlign: string
  path?: string
  pathViewBox?: PathViewBox
  headEnd?: LineEnd
  tailEnd?: LineEnd
  strokeOnly?: boolean
  keypoints?: Record<string, number>
  name: string
  order: number
  autoFit?: AutoFit
  textInset?: TextInset
  link?: string
}

export interface Text extends NativeObjectCarrier {
  type: 'text'
  left: number
  top: number
  width: number
  height: number
  borderColor: string
  borderWidth: number
  borderType: 'solid' | 'dashed' | 'dotted'
  borderStrokeDasharray: string
  shadow?: Shadow
  fill: Fill
  isFlipV: boolean
  isFlipH: boolean
  isVertical: boolean
  rotate: number
  content: string
  textBody?: StructuredTextBody
  vAlign: string
  name: string
  order: number
  autoFit?: AutoFit
  textInset?: TextInset
  link?: string
}

export interface Image extends NativeObjectCarrier {
  type: 'image'
  left: number
  top: number
  width: number
  height: number
  ref: string
  base64: string
  blob: string
  rotate: number
  isFlipH: boolean
  isFlipV: boolean
  order: number
  rect?: {
    t?: number
    b?: number
    l?: number
    r?: number
  }
  geom: string
  borderColor: string
  borderWidth: number
  borderType: 'solid' | 'dashed' | 'dotted'
  borderStrokeDasharray: string
  filters?: {
    sharpen?: number
    colorTemperature?: number
    saturation?: number
    brightness?: number
    contrast?: number
  }
  opacity?: number
  shadow?: Shadow
  link?: string
}

export interface TableCell {
  text: string
  /** Retained paragraph/run model for the cell, parallel to `text`. */
  textBody?: StructuredTextBody
  rowSpan?: number
  colSpan?: number
  vMerge?: number
  hMerge?: number
  fillColor?: string
  fontColor?: string
  fontBold?: boolean
  vAlign: string
  borders: {
    top?: Border
    bottom?: Border
    left?: Border
    right?: Border
  }
}
export interface Table extends NativeObjectCarrier {
  type: 'table'
  left: number
  top: number
  width: number
  height: number
  data: TableCell[][]
  borders: {
    top?: Border
    bottom?: Border
    left?: Border
    right?: Border
  }
  order: number
  rotate?: number
  rowHeights: number[]
  colWidths: number[]
}

export type ChartType = 'lineChart' |
  'line3DChart' |
  'barChart' |
  'bar3DChart' |
  'pieChart' |
  'pie3DChart' |
  'doughnutChart' |
  'areaChart' |
  'area3DChart' |
  'scatterChart' |
  'bubbleChart' |
  'radarChart' |
  'surfaceChart' |
  'surface3DChart' |
  'stockChart'

export interface ChartValue {
  x: string
  y: number
}
export interface ChartXLabel {
  [key: string]: string
}
export interface ChartSpaceReference {
  /** Number format the cache itself declares, such as `General`. */
  formatCode?: string
  /** The workbook range the cached points came from. */
  formula?: string
  kind: 'multiLevelString' | 'number' | 'numberLiteral' | 'string' | 'stringLiteral'
  pointCount?: number
}

export interface ChartSpaceNumberFormat {
  formatCode: string
  sourceLinked?: boolean
}

export interface ChartSpaceDataLabels {
  numberFormat?: ChartSpaceNumberFormat
  position?: string
  showBubbleSize?: boolean
  showCategoryName?: boolean
  showLegendKey?: boolean
  showPercent?: boolean
  showSeriesName?: boolean
  showValue?: boolean
}

export interface ChartSpaceSeriesReferences {
  bubbleSizes?: ChartSpaceReference
  categories?: ChartSpaceReference
  name?: ChartSpaceReference
  values?: ChartSpaceReference
  xValues?: ChartSpaceReference
  yValues?: ChartSpaceReference
}

export interface ChartSpaceSeries {
  bubbleSizes?: Array<number | undefined>
  categories?: Array<string | undefined>
  dataLabels?: ChartSpaceDataLabels
  index: number
  markerSymbol?: string
  name?: string
  order: number
  /** Where each cached array came from in the workbook. */
  references?: ChartSpaceSeriesReferences
  smooth?: boolean
  values?: Array<number | undefined>
  xValues?: Array<number | undefined>
  yValues?: Array<number | undefined>
}

export interface ChartSpaceFamily {
  /** Axis ids this family plots against; a secondary axis is a second pair. */
  axisIds: string[]
  barDirection?: string
  dataLabels?: ChartSpaceDataLabels
  gapWidth?: number
  grouping?: string
  holeSize?: number
  /** The OOXML element name, such as `barChart` or `lineChart`. */
  kind: string
  marker?: boolean
  overlap?: number
  series: ChartSpaceSeries[]
  style?: string
  varyColors?: boolean
}

export interface ChartSpaceAxis {
  baseTimeUnit?: string
  crossAxisId?: string
  deleted?: boolean
  id: string
  kind: 'category' | 'date' | 'series' | 'value'
  majorGridlines?: boolean
  majorTickMark?: string
  majorUnit?: number
  minorGridlines?: boolean
  minorTickMark?: string
  minorUnit?: number
  numberFormat?: ChartSpaceNumberFormat
  position?: string
  scaling?: { logBase?: number; max?: number; min?: number; orientation?: string }
  tickLabelPosition?: string
  title?: string
}

export interface ChartSpace {
  autoTitleDeleted?: boolean
  displayBlanksAs?: string
  /** Relationship tying the chart's formulas to a workbook part. */
  externalData?: { autoUpdate?: boolean; relationshipId?: string }
  legend?: { overlay?: boolean; position?: string }
  plotArea: { axes: ChartSpaceAxis[]; families: ChartSpaceFamily[] }
  plotVisibleOnly?: boolean
  schemaVersion: 1
  title?: { overlay?: boolean; text?: string }
}

export interface ChartResources {
  /** Target of a workbook the deck links to but does not embed. */
  externalWorkbook?: string
  /** The chart part itself. */
  partPath: string
  relationshipIds: Record<string, string>
  themeOverridePart?: string
  /** Drawing overlay a chart may carry. */
  userShapesPart?: string
  /** Embedded workbook holding the chart's data, when the deck ships one. */
  workbookPart?: string
}

export interface ChartItem {
  key: string
  values: ChartValue[]
  xlabels: ChartXLabel
}
export type ScatterChartData = number[][]
export interface ChartMetadata {
  /** Structure the chart part declares, retained beside the simplified view. */
  chartSpace?: ChartSpace
  /** The chart part and the parts it owns. */
  resources?: ChartResources
  categoryAxisTitle?: string
  gapWidth?: string
  holeSize?: string
  legendPosition?: string
  maximumValue?: number
  marker?: boolean
  minimumValue?: number
  overlap?: string
  showCategoryName?: boolean
  showDataLabels?: boolean
  showLegend?: boolean
  showMajorGridlines?: boolean
  showSeriesName?: boolean
  showValue?: boolean
  seriesChartTypes?: ChartType[]
  title?: string
  valueAxisTitle?: string
}
export interface CommonChart extends NativeObjectCarrier, ChartMetadata {
  type: 'chart'
  left: number
  top: number
  width: number
  height: number
  data: ChartItem[]
  colors: string[]
  chartType: Exclude<ChartType, 'scatterChart' | 'bubbleChart'>
  barDir?: 'bar' | 'col'
  marker?: boolean
  holeSize?: string
  grouping?: string
  style?: string
  order: number
  rotate?: number
}
export interface ScatterChart extends NativeObjectCarrier, ChartMetadata {
  type: 'chart'
  left: number
  top: number
  width: number
  height: number
  data: ScatterChartData
  colors: string[]
  chartType: 'scatterChart' | 'bubbleChart'
  order: number
  rotate?: number
}
export type Chart = CommonChart | ScatterChart

export interface Video extends NativeObjectCarrier {
  type: 'video'
  left: number
  top: number
  width: number
  height: number
  ref: string
  blob: string
  posterBase64?: string
  order: number
  rotate?: number
}

export interface Audio extends NativeObjectCarrier {
  type: 'audio'
  left: number
  top: number
  width: number
  height: number
  ref: string
  blob: string
  order: number
  rotate?: number
}

export interface Diagram extends NativeObjectCarrier {
  type: 'diagram'
  left: number
  top: number
  width: number
  height: number
  elements: Element[]
  textList: string[]
  order: number
}

export interface Math extends NativeObjectCarrier {
  type: 'math'
  left: number
  top: number
  width: number
  height: number
  latex: string
  picRef: string
  picBase64: string
  picBlob: string
  order: number
  rotate?: number
  text?: string
}

export interface Opaque extends NativeObjectCarrier {
  type: 'opaque'
  left: number
  top: number
  width: number
  height: number
  rotate: number
  opaqueType: string
  label?: string
  reason?: string
  relationshipIds: string[]
  order: number
}

export type BaseElement = Shape | Text | Image | Table | Chart | Video | Audio | Diagram | Math | Opaque

export interface Group extends NativeObjectCarrier {
  type: 'group'
  left: number
  top: number
  width: number
  height: number
  rotate: number
  elements: Element[]
  order: number
  isFlipH: boolean
  isFlipV: boolean
}
export type Element = BaseElement | Group

export interface SlideTransition {
  autoNextAfter?: number
  type: string
  duration: number
  direction: string | null
}

export interface Slide {
  backgrounds?: BackgroundFills
  fill: Fill
  elements: Element[]
  layoutElements: Element[]
  masterElements?: Element[]
  hidden?: boolean
  name?: string
  note: string
  sourcePart?: string
  themeColors?: string[]
  transition?: SlideTransition | null
}

export interface Options {
  imageMode?: 'base64' | 'blob' | 'both' | 'none'
  videoMode?: 'blob' | 'none'
  audioMode?: 'blob' | 'none'
}

export interface EmbeddedFont {
  /** Base64 payload of the font part, exactly as stored in the package. */
  data: string
  italic: boolean
  partPath: string
  typeface: string
  weight: number
}

export const parse: (file: ArrayBuffer, options?: Options) => Promise<{
  slides: Slide[]
  embeddedFonts: EmbeddedFont[]
  themeColors: string[]
  usedFonts: string[]
  size: {
    width: number
    height: number
  }
}>

export type WorkbookCellValue = boolean | number | string | undefined

export interface EmbeddedWorkbook {
  /**
   * Resolves a range such as `Sheet1!$B$2:$B$5` in reading order. A cell the
   * workbook never stored comes back `undefined` rather than shifting the
   * values after it.
   */
  readRange: (formula: string) => Promise<WorkbookCellValue[] | undefined>
  sheetNames: string[]
}

/**
 * Opens a chart's embedded workbook for reading. The bytes are never written
 * back, so the retained part stays exactly as the deck shipped it.
 */
export const openEmbeddedWorkbook: (bytes: ArrayBuffer | Uint8Array) => Promise<EmbeddedWorkbook>

export const parseRangeFormula: (formula: string) => {
  end: { column: number; row: number }
  sheet: string
  start: { column: number; row: number }
} | undefined
