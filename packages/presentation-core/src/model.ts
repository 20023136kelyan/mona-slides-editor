import type {
  PowerPointConnectorRelationships,
  PowerPointElementSource,
  PowerPointSlideSource,
} from './source'

export const ShapePathFormulasKeys = {
  BULLET: 'bullet',
  CUT_RECT_DIAGONAL: 'cutRectDiagonal',
  CUT_RECT_SAMESIDE: 'cutRectSameSide',
  CUT_RECT_SINGLE: 'cutRectSingle',
  CUT_ROUND_RECT: 'cutRoundRect',
  DIAGSTRIPE: 'diagStripe',
  DONUT: 'donut',
  INDICATOR: 'indicator',
  L: 'L',
  MESSAGE: 'message',
  PARALLELOGRAM_LEFT: 'parallelogramLeft',
  PARALLELOGRAM_RIGHT: 'parallelogramRight',
  PLUS: 'plus',
  RING_RECT: 'ringRect',
  ROUND_MESSAGE: 'roundMessage',
  ROUND_RECT: 'roundRect',
  ROUND_RECT_DIAGONAL: 'roundRectDiagonal',
  ROUND_RECT_SAMESIDE: 'roundRectSameSide',
  ROUND_RECT_SINGLE: 'roundRectSingle',
  TRAPEZOID: 'trapezoid',
  TRIANGLE: 'triangle',
} as const
export type ShapePathFormulasKeys = (
  typeof ShapePathFormulasKeys[keyof typeof ShapePathFormulasKeys]
)

export const ElementTypes = {
  AUDIO: 'audio',
  CHART: 'chart',
  GROUP: 'group',
  IMAGE: 'image',
  LATEX: 'latex',
  LINE: 'line',
  OPAQUE: 'opaque',
  SHAPE: 'shape',
  TABLE: 'table',
  TEXT: 'text',
  VIDEO: 'video',
} as const
export type ElementTypes = typeof ElementTypes[keyof typeof ElementTypes]

/**
 * 渐变
 *
 * type: 渐变类型（径向、线性）
 *
 * colors: 渐变颜色列表（pos: 百分比位置；color: 颜色）
 *
 * rotate: 渐变角度（线性渐变）
 */
export type GradientType = 'linear' | 'radial'
export type GradientColor = {
  pos: number
  color: string
}
export interface Gradient {
  type: GradientType
  colors: GradientColor[]
  rotate: number
}

export interface PatternFill {
  backgroundColor: string
  foregroundColor: string
  patternType: string
}

export type LineStyleType = 'solid' | 'dashed' | 'dotted'

/**
 * 元素阴影
 *
 * h: 水平偏移量
 *
 * v: 垂直偏移量
 *
 * blur: 模糊程度
 *
 * color: 阴影颜色
 */
export interface PPTElementShadow {
  h: number
  v: number
  blur: number
  color: string
}

/**
 * 元素边框
 *
 * style?: 边框样式（实线或虚线）
 *
 * width?: 边框宽度
 *
 * color?: 边框颜色
 */
export interface PPTElementOutline {
  style?: LineStyleType
  width?: number
  color?: string
}

export type ElementLinkType = 'web' | 'slide'

/**
 * 元素超链接
 *
 * type: 链接类型（网页、幻灯片页面）
 *
 * target: 目标地址（网页链接、幻灯片页面ID）
 */
export interface PPTElementLink {
  type: ElementLinkType
  target: string
}

/**
 * Editable effects which have native DrawingML equivalents. Measurements use
 * Mona canvas units; angles use degrees and opacity is normalized to 0..1.
 * The retained source payload still carries unsupported effect-graph data.
 */
export interface PPTElementEffects {
  glow?: {
    color: string
    opacity: number
    radius: number
  }
  innerShadow?: PPTElementShadow & {
    opacity: number
  }
  reflection?: {
    blur: number
    direction: number
    distance: number
    opacity: number
    scaleY: number
  }
  softEdge?: {
    radius: number
  }
}

export interface PPTElementThreeDRotation {
  latitude: number
  longitude: number
  revolution: number
}

/**
 * Editable DrawingML scene/shape 3D semantics. Measurements use Mona canvas
 * units and rotations use degrees. Unknown native attributes remain retained
 * in the immutable PowerPoint source package.
 */
export interface PPTElementThreeD {
  camera?: {
    preset: string
    rotation?: PPTElementThreeDRotation
    zoom?: number
  }
  light?: {
    direction: string
    rig: string
    rotation?: PPTElementThreeDRotation
  }
  shape?: {
    bevelBottom?: {
      height: number
      preset: string
      width: number
    }
    bevelTop?: {
      height: number
      preset: string
      width: number
    }
    contourColor?: string
    contourWidth?: number
    extrusionColor?: string
    extrusionHeight?: number
    material?: string
    z?: number
  }
}

export type TextAlign = 'left' | 'center' | 'right' | 'justify'

export type TextAlignVertical = 'top' | 'middle' | 'bottom'


/**
 * 元素通用属性
 *
 * id: 元素ID
 *
 * left: 元素水平方向位置（距离画布左侧）
 *
 * top: 元素垂直方向位置（距离画布顶部）
 *
 * lock?: 锁定元素
 *
 * groupId?: 组合ID（拥有相同组合ID的元素即为同一组合元素成员）
 *
 * width: 元素宽度
 *
 * height: 元素高度
 *
 * rotate: 旋转角度
 *
 * link?: 超链接
 *
 * name?: 元素名
 */
export interface PPTBaseElement {
  accessibility?: {
    decorative?: boolean
    description?: string
    hidden?: boolean
    title?: string
  }
  id: string
  left: number
  top: number
  lock?: boolean
  groupId?: string
  width: number
  height: number
  rotate: number
  link?: PPTElementLink
  name?: string
  effects?: PPTElementEffects
  threeD?: PPTElementThreeD
  source?: PowerPointElementSource
}


export type TextType = 'title' | 'subtitle' | 'content' | 'item' | 'itemTitle' | 'notes' | 'header' | 'footer' | 'partNumber' | 'itemNumber'
export type TextInset = [number, number, number, number]

export interface StructuredTextColor {
  alpha?: number
  type: 'preset' | 'scheme' | 'srgb' | 'system'
  value: string
}

export interface StructuredTextSpacing {
  unit: 'percent' | 'points'
  value: number
}

export interface StructuredTextTabStop {
  alignment?: string
  position: number
}

export interface StructuredTextBullet {
  character?: string
  color?: StructuredTextColor
  fontFamily?: string
  numberingScheme?: string
  size?: StructuredTextSpacing
  startAt?: number
  type: 'auto-number' | 'character' | 'none' | 'picture'
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
  bullet?: StructuredTextBullet
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
  tabs?: StructuredTextTabStop[]
}

export interface StructuredTextStyleLevel {
  level: number
  paragraph?: StructuredTextParagraphProperties
}

export interface StructuredTextRun {
  fieldId?: string
  fieldType?: string
  hyperlink?: string
  kind: 'break' | 'field' | 'tab' | 'text'
  properties?: StructuredTextRunProperties
  sourceId: string
  text?: string
}

export interface StructuredTextParagraph {
  endProperties?: StructuredTextRunProperties
  level: number
  properties?: StructuredTextParagraphProperties
  runs: StructuredTextRun[]
  sourceId: string
}

export interface StructuredTextBodyProperties {
  anchor?: string
  anchorCenter?: boolean
  autoFit?: {
    fontScale?: number
    lineSpacingReduction?: number
    type: 'none' | 'normal' | 'shape'
  }
  columnCount?: number
  columnSpacing?: number
  insets?: TextInset
  rightToLeftColumns?: boolean
  rotation?: number
  textWarp?: {
    adjustments: Record<string, number>
    preset: string
  }
  verticalMode?: string
  wrap?: string
}

/**
 * Typed rich-text representation retained alongside Mona's current HTML
 * compatibility adapter. Dimensional values are authored PowerPoint points;
 * `scale` converts those values into Mona canvas units at render time.
 */
export interface StructuredTextBody {
  bodyProperties?: StructuredTextBodyProperties
  defaultParagraph?: StructuredTextParagraphProperties
  listStyle: StructuredTextStyleLevel[]
  paragraphs: StructuredTextParagraph[]
  scale: number
  schemaVersion: 1
}

/**
 * 文本元素
 *
 * type: 元素类型（text）
 *
 * content: 文本内容（HTML字符串）
 *
 * defaultFontName: 默认字体（会被文本内容中的HTML内联样式覆盖）
 *
 * defaultColor: 默认颜色（会被文本内容中的HTML内联样式覆盖）
 *
 * outline?: 边框
 *
 * fill?: 填充色
 *
 * lineHeight?: 行高（倍），默认1.5
 *
 * wordSpace?: 字间距，默认0
 *
 * opacity?: 不透明度，默认1
 *
 * shadow?: 阴影
 *
 * paragraphSpace?: 段间距，默认5px
 *
 * vertical?: 竖向文本
 *
 * textType?: 文本类型
 *
 * inset?: 内边距（上、右、下、左），默认[10, 10, 10, 10]
 *
 * fixedHeight?: 固定文本框自适应轴尺寸，横排文本固定高度，竖排文本固定宽度
 *
 * vAlign?: 文本框内垂直对齐方向，仅fixedHeight为真时有效，默认top
 */
export interface PPTTextElement extends PPTBaseElement {
  type: 'text'
  content: string
  structuredText?: StructuredTextBody
  columns?: number
  columnGap?: number
  defaultFontName: string
  defaultColor: string
  outline?: PPTElementOutline
  fill?: string
  lineHeight?: number
  wordSpace?: number
  opacity?: number
  shadow?: PPTElementShadow
  paragraphSpace?: number
  vertical?: boolean
  textType?: TextType
  inset?: TextInset
  fixedHeight?: boolean
  vAlign?: TextAlignVertical
}


/**
 * 图片翻转、形状翻转
 *
 * flipH?: 水平翻转
 *
 * flipV?: 垂直翻转
 */
export interface ImageOrShapeFlip {
  flipH?: boolean
  flipV?: boolean
}

/**
 * 图片滤镜
 *
 * https://developer.mozilla.org/zh-CN/docs/Web/CSS/filter
 *
 * 'blur'?: 模糊，默认0（px）
 *
 * 'brightness'?: 亮度，默认100（%）
 *
 * 'contrast'?: 对比度，默认100（%）
 *
 * 'grayscale'?: 灰度，默认0（%）
 *
 * 'saturate'?: 饱和度，默认100（%）
 *
 * 'hue-rotate'?: 色相旋转，默认0（deg）
 *
 * 'opacity'?: 不透明度，默认100（%）
 */
export type ImageElementFilterKeys = 'blur' | 'brightness' | 'contrast' | 'grayscale' | 'saturate' | 'hue-rotate' | 'opacity' | 'sepia' | 'invert'
export interface ImageElementFilters {
  'blur'?: string
  'brightness'?: string
  'contrast'?: string
  'grayscale'?: string
  'saturate'?: string
  'hue-rotate'?: string
  'sepia'?: string
  'invert'?: string
  'opacity'?: string
}

export type ImageClipDataRange = [[number, number], [number, number]]

/**
 * 图片裁剪
 *
 * range: 裁剪范围，例如：[[10, 10], [90, 90]] 表示裁取原图从左上角 10%, 10% 到 90%, 90% 的范围
 *
 * shape: 裁剪形状，见 configs/imageClip.ts CLIPPATHS
 */
export interface ImageElementClip {
  range: ImageClipDataRange
  shape: string
}

export type ImageType = 'pageFigure' | 'itemFigure' | 'background'

/**
 * 图片元素
 *
 * type: 元素类型（image）
 *
 * fixedRatio: 固定图片宽高比例
 *
 * src: 图片地址
 *
 * outline?: 边框
 *
 * filters?: 图片滤镜
 *
 * clip?: 裁剪信息
 *
 * flipH?: 水平翻转
 *
 * flipV?: 垂直翻转
 *
 * shadow?: 阴影
 *
 * radius?: 圆角半径
 *
 * colorMask?: 颜色蒙版
 *
 * imageType?: 图片类型
 */
export interface PPTImageElement extends PPTBaseElement {
  type: 'image'
  fixedRatio: boolean
  src: string
  outline?: PPTElementOutline
  filters?: ImageElementFilters
  clip?: ImageElementClip
  flipH?: boolean
  flipV?: boolean
  shadow?: PPTElementShadow
  radius?: number
  colorMask?: string
  imageType?: ImageType
  opacity?: number
  /** Native picture semantics retained beside Mona's crop/filter adapter. */
  powerPointImage?: {
    crop?: { b?: number; l?: number; r?: number; t?: number }
    geometry: string
    mediaPart?: string
    relationshipId?: string
  }
}

/**
 * 形状内文本
 *
 * content: 文本内容（HTML字符串）
 *
 * defaultFontName: 默认字体（会被文本内容中的HTML内联样式覆盖）
 *
 * defaultColor: 默认颜色（会被文本内容中的HTML内联样式覆盖）
 *
 * align: 文本对齐方向（垂直方向）
 *
 * lineHeight?: 行高（倍），默认1.5
 *
 * wordSpace?: 字间距，默认0
 *
 * paragraphSpace?: 段间距，默认5px
 *
 * type: 文本类型
 *
 * inset?: 文本内边距（上、右、下、左），默认[10, 10, 10, 10]
 */
export interface ShapeText {
  content: string
  structuredText?: StructuredTextBody
  columns?: number
  columnGap?: number
  defaultFontName: string
  defaultColor: string
  align: TextAlignVertical
  lineHeight?: number
  wordSpace?: number
  paragraphSpace?: number
  inset?: TextInset
  type?: TextType
}

/**
 * 形状元素
 *
 * type: 元素类型（shape）
 *
 * viewBox: SVG的viewBox属性，例如 [1000, 1000] 表示 '0 0 1000 1000'
 *
 * path: 形状路径，SVG path 的 d 属性
 *
 * fixedRatio: 固定形状宽高比例
 *
 * fill: 填充，不存在渐变时生效
 *
 * gradient?: 渐变，该属性存在时将优先作为填充
 *
 * pattern?: 图案，该属性存在时将优先作为填充
 *
 * outline?: 边框
 *
 * opacity?: 不透明度
 *
 * flipH?: 水平翻转
 *
 * flipV?: 垂直翻转
 *
 * shadow?: 阴影
 *
 * special?: 特殊形状（标记一些难以解析的形状，例如路径使用了 L Q C A 以外的类型，该类形状在导出后将变为图片的形式）
 *
 * text?: 形状内文本
 *
 * pathFormula?: 形状路径计算公式
 * 一般情况下，形状的大小变化时仅由宽高基于 viewBox 的缩放比例来调整形状，而 viewBox 本身和 path 不会变化，
 * 但也有一些形状希望能更精确的控制一些关键点的位置，此时就需要提供路径计算公式，通过在缩放时更新 viewBox 并重新计算 path 来重新绘制形状
 *
 * keypoints?: 关键点位置百分比
 */
/**
 * How a picture fill is laid into its shape.
 *
 * PowerPoint's `a:stretch` fits the picture to the shape's bounds and distorts
 * it when the aspect ratios differ; it is not a cover-crop. `rect` insets the
 * destination from each edge as a fraction of the shape, and negative values
 * push an edge outward so the picture overflows and the shape crops it.
 */
export interface PicturePatternFit {
  alignment?: string
  mode: 'stretch' | 'tile'
  rect?: { b: number; l: number; r: number; t: number }
  scaleX?: number
  scaleY?: number
}

export interface PPTShapeElement extends PPTBaseElement {
  type: 'shape'
  viewBox: [number, number]
  path: string
  fixedRatio: boolean
  fill: string
  gradient?: Gradient
  pattern?: string
  /**
   * How an imported picture fill is laid into the shape. Absent for a
   * Mona-authored pattern, which keeps the editor's cover-crop behaviour.
   */
  patternFit?: PicturePatternFit
  powerPointPattern?: PatternFill
  outline?: PPTElementOutline
  opacity?: number
  flipH?: boolean
  flipV?: boolean
  shadow?: PPTElementShadow
  special?: boolean
  text?: ShapeText
  pathFormula?: ShapePathFormulasKeys
  keypoints?: number[]
  /** Preset geometry and its named adjustment values in native units. */
  powerPointGeometry?: {
    adjustments: Record<string, number>
    preset: string
  }
}


export type LinePoint = '' | 'arrow' | 'dot'
export type Broken2LineDirection = 'horizontal' | 'vertical'

/**
 * 线条元素
 *
 * type: 元素类型（line）
 *
 * start: 起点位置（[x, y]）
 *
 * end: 终点位置（[x, y]）
 *
 * style: 线条样式（实线、虚线、点线）
 *
 * color: 线条颜色
 *
 * points: 端点样式（[起点样式, 终点样式]，可选：无、箭头、圆点）
 *
 * shadow?: 阴影
 *
 * broken?: 折线控制点位置（[x, y]）
 *
 * broken2?: 双折线控制点位置（[x, y]）
 *
 * broken2Direction?: 双折线方向
 *
 * curve?: 二次曲线控制点位置（[x, y]）
 *
 * cubic?: 三次曲线控制点位置（[[x1, y1], [x2, y2]]）
 */
export interface PPTLineElement extends Omit<PPTBaseElement, 'height' | 'rotate'> {
  type: 'line'
  start: [number, number]
  end: [number, number]
  style: LineStyleType
  color: string
  points: [LinePoint, LinePoint]
  shadow?: PPTElementShadow
  broken?: [number, number]
  broken2?: [number, number]
  broken2Direction?: Broken2LineDirection
  curve?: [number, number]
  cubic?: [[number, number], [number, number]]
  /**
   * Current connector attachments. Source provenance stays immutable in
   * `source.connector`; this value changes only through an explicit edit and
   * is serialized back to `p:cNvCxnSpPr`.
   */
  connections?: PowerPointConnectorRelationships
  /** Native geometry retained beside Mona's editable route controls. */
  powerPointGeometry?: {
    adjustments: Record<string, number>
    preset: string
  }
}


export type ChartType = 'bar' | 'column' | 'line' | 'pie' | 'ring' | 'area' | 'radar' | 'scatter'

export interface ChartOptions {
  categoryAxisTitle?: string
  gapWidth?: number
  holeSize?: number
  legendPosition?: 'bottom' | 'left' | 'right' | 'top'
  lineSmooth?: boolean
  marker?: boolean
  maximumValue?: number
  minimumValue?: number
  overlap?: number
  percentStacked?: boolean
  showCategoryName?: boolean
  showDataLabels?: boolean
  showLegend?: boolean
  showMajorGridlines?: boolean
  showSeriesName?: boolean
  showValue?: boolean
  seriesTypes?: ChartType[]
  seriesAxisIndexes?: number[]
  valueAxes?: Array<{
    id?: string
    maximumValue?: number
    minimumValue?: number
    numberFormat?: string
    position?: string
    title?: string
  }>
  stack?: boolean
  title?: string
  valueAxisTitle?: string
}

export interface ChartData {
  labels: string[]
  legends: string[]
  series: number[][]
}

/**
 * 图表元素
 *
 * type: 元素类型（chart）
 *
 * fill?: 填充色
 *
 * chartType: 图表基础类型（bar/line/pie），所有图表类型都是由这三种基本类型衍生而来
 *
 * data: 图表数据
 *
 * options: 扩展选项
 *
 * outline?: 边框
 *
 * themeColors: 主题色
 *
 * textColor?: 坐标和文字颜色
 *
 * lineColor?: 网格颜色
 */
/**
 * A chart part's own structure, retained beside the simplified view Mona's
 * current renderer consumes.
 *
 * A chart part is a chart *space*: a plot area holding one or more families,
 * each with its own series and axis references. The flat `chartType` union
 * cannot express a combo chart, a series on a secondary axis, or a number
 * format, so it remains a compatibility adapter while this is the record of
 * what the deck declared.
 */
export interface PowerPointChartReference {
  /** Number format the cache itself declares, such as `General`. */
  formatCode?: string
  /** The workbook range the cached points came from. */
  formula?: string
  kind: 'multiLevelString' | 'number' | 'numberLiteral' | 'string' | 'stringLiteral'
  pointCount?: number
}

export interface PowerPointChartSeriesReferences {
  bubbleSizes?: PowerPointChartReference
  categories?: PowerPointChartReference
  name?: PowerPointChartReference
  values?: PowerPointChartReference
  xValues?: PowerPointChartReference
  yValues?: PowerPointChartReference
}

export interface PowerPointChartNumberFormat {
  formatCode: string
  sourceLinked?: boolean
}

export interface PowerPointChartDataLabels {
  numberFormat?: PowerPointChartNumberFormat
  position?: string
  showBubbleSize?: boolean
  showCategoryName?: boolean
  showLegendKey?: boolean
  showPercent?: boolean
  showSeriesName?: boolean
  showValue?: boolean
}

export interface PowerPointChartSeries {
  bubbleSizes?: Array<number | undefined>
  categories?: Array<string | undefined>
  dataLabels?: PowerPointChartDataLabels
  index: number
  markerSymbol?: string
  name?: string
  order: number
  /** Where each cached array came from in the workbook. */
  references?: PowerPointChartSeriesReferences
  smooth?: boolean
  values?: Array<number | undefined>
  xValues?: Array<number | undefined>
  yValues?: Array<number | undefined>
}

export interface PowerPointChartFamily {
  /** Axis ids this family plots against; a secondary axis is a second pair. */
  axisIds: string[]
  barDirection?: string
  dataLabels?: PowerPointChartDataLabels
  gapWidth?: number
  grouping?: string
  holeSize?: number
  /** The OOXML element name, such as `barChart` or `lineChart`. */
  kind: string
  marker?: boolean
  overlap?: number
  series: PowerPointChartSeries[]
  style?: string
  varyColors?: boolean
}

export interface PowerPointChartAxis {
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
  numberFormat?: PowerPointChartNumberFormat
  position?: string
  scaling?: { logBase?: number; max?: number; min?: number; orientation?: string }
  tickLabelPosition?: string
  title?: string
}

export interface PowerPointChartSpace {
  autoTitleDeleted?: boolean
  displayBlanksAs?: string
  /** Relationship tying the chart's formulas to a workbook part. */
  externalData?: { autoUpdate?: boolean; relationshipId?: string }
  legend?: { overlay?: boolean; position?: string }
  plotArea: { axes: PowerPointChartAxis[]; families: PowerPointChartFamily[] }
  plotVisibleOnly?: boolean
  schemaVersion: 1
  title?: { overlay?: boolean; text?: string }
}

/**
 * Where an imported chart's parts live inside the retained package.
 *
 * A chart is not a single part: its data sits in an embedded workbook, and it
 * may own a drawing overlay and a theme override. Holding the addresses keeps
 * the retained bytes reachable — an edit can find the workbook, and an export
 * can copy what it did not touch rather than regenerating it.
 */
export interface PowerPointChartSource {
  /** Target of a workbook the deck links to but does not embed. */
  externalWorkbook?: string
  partPath: string
  relationshipIds?: Record<string, string>
  themeOverridePart?: string
  userShapesPart?: string
  workbookPart?: string
}

export interface PPTChartElement extends PPTBaseElement {
  type: 'chart'
  /** Addresses of this chart's parts in the retained package. */
  chartSource?: PowerPointChartSource
  /** What the chart part declares, retained without interpretation. */
  chartSpace?: PowerPointChartSpace
  fill?: string
  chartType: ChartType
  data: ChartData
  options?: ChartOptions
  outline?: PPTElementOutline
  themeColors: string[]
  textColor?: string
  lineColor?: string
}


/**
 * 表格单元格样式
 *
 * bold?: 加粗
 *
 * em?: 斜体
 *
 * underline?: 下划线
 *
 * strikethrough?: 删除线
 *
 * color?: 字体颜色
 *
 * backcolor?: 填充色
 *
 * fontsize?: 字体大小
 *
 * fontname?: 字体
 *
 * align?: 对齐方式
 */
export interface TableCellStyle {
  bold?: boolean
  em?: boolean
  underline?: boolean
  strikethrough?: boolean
  color?: string
  backcolor?: string
  fontsize?: string
  fontname?: string
  align?: TextAlign
  vAlign?: TextAlignVertical
}


/**
 * 表格单元格
 *
 * id: 单元格ID
 *
 * colspan: 合并列数
 *
 * rowspan: 合并行数
 *
 * text: 文字内容
 *
 * style?: 单元格样式
 */
export interface TableCell {
  borders?: Partial<Record<
    'bottom' | 'diagonalDown' | 'diagonalUp' | 'left' | 'right' | 'top',
    PPTElementOutline
  >>
  id: string
  colspan: number
  rowspan: number
  margin?: TextInset
  /** Original table-grid coordinate used for source-preserving cell edits. */
  powerPointCell?: { columnIndex: number; rowIndex: number }
  text: string
  /**
   * Imported paragraph/run model for the cell. `text` stays the editing
   * surface and is recompiled from this body until a direct edit detaches it.
   */
  structuredText?: StructuredTextBody
  style?: TableCellStyle
}

/**
 * 表格主题
 *
 * color: 主题色
 *
 * rowHeader: 标题行
 *
 * rowFooter: 汇总行
 *
 * colHeader: 第一列
 *
 * colFooter: 最后一列
 */
export interface TableTheme {
  color: string
  rowHeader: boolean
  rowFooter: boolean
  colHeader: boolean
  colFooter: boolean
}

/**
 * 表格元素
 *
 * type: 元素类型（table）
 *
 * outline: 边框
 *
 * theme?: 主题
 *
 * colWidths: 列宽数组，如[0.3, 0.5, 0.2]表示三列宽度分别占总宽度的30%, 50%, 20%
 *
 * cellMinHeight: 单元格最小高度
 *
 * data: 表格数据
 */
export interface PPTTableElement extends PPTBaseElement {
  type: 'table'
  outline: PPTElementOutline
  theme?: TableTheme
  colWidths: number[]
  cellMinHeight: number
  data: TableCell[][]
  rowHeights?: number[]
  powerPointTable?: {
    bandColumn: boolean
    bandRow: boolean
    firstColumn: boolean
    firstRow: boolean
    lastColumn: boolean
    lastRow: boolean
    rightToLeft: boolean
    styleId?: string
  }
}


/**
 * LaTeX元素（公式）
 *
 * type: 元素类型（latex）
 *
 * latex: latex代码
 *
 * path: svg path
 *
 * color: 颜色
 *
 * strokeWidth: 路径宽度
 *
 * viewBox: SVG的viewBox属性
 *
 * fixedRatio: 固定形状宽高比例
 */
export interface PPTLatexElement extends PPTBaseElement {
  type: 'latex'
  latex: string
  path: string
  color: string
  strokeWidth: number
  viewBox: [number, number]
  fixedRatio: boolean
  fallbackImage?: string
  powerPointMath?: { omml: Record<string, unknown> }
}

/**
 * 视频元素
 *
 * type: 元素类型（video）
 *
 * src: 视频地址
 *
 * autoplay: 自动播放
 *
 * poster: 预览封面
 *
 * ext: 视频后缀，当资源链接缺少后缀时用该字段确认资源类型
 */
export interface PPTVideoElement extends PPTBaseElement {
  type: 'video'
  src: string
  autoplay: boolean
  poster?: string
  ext?: string
}

/**
 * 音频元素
 *
 * type: 元素类型（audio）
 *
 * fixedRatio: 固定图标宽高比例
 *
 * color: 图标颜色
 *
 * loop: 循环播放
 *
 * autoplay: 自动播放
 *
 * src: 音频地址
 *
 * ext: 音频后缀，当资源链接缺少后缀时用该字段确认资源类型
 */
export interface PPTAudioElement extends PPTBaseElement {
  type: 'audio'
  fixedRatio: boolean
  color: string
  loop: boolean
  autoplay: boolean
  src: string
  ext?: string
}

/**
 * A native semantic group. Child geometry is expressed in the group's local
 * coordinate space. coordinateWidth/coordinateHeight retain that coordinate
 * space when the group itself is resized.
 *
 * groupId remains supported separately for Mona's legacy flat grouping model.
 */
export interface PPTGroupElement extends PPTBaseElement {
  type: 'group'
  elements: PPTElement[]
  coordinateWidth: number
  coordinateHeight: number
  flipH?: boolean
  flipV?: boolean
  semanticType?: 'diagram' | 'group'
  powerPointDiagram?: {
    colorsPart?: string
    dataPart?: string
    drawingPart?: string
    layoutPart?: string
    model?: {
      colors?: Record<string, unknown>
      data?: Record<string, unknown>
      layout?: Record<string, unknown>
      quickStyle?: Record<string, unknown>
    }
    quickStylePart?: string
    relationshipIds: Record<string, string>
  }
}

/**
 * A source-backed PowerPoint object that Mona cannot interpret semantically
 * yet. It remains selectable and transformable while the original package
 * bytes and OOXML identity stay available for future native patching/export.
 */
export interface PPTOpaqueElement extends PPTBaseElement {
  type: 'opaque'
  opaqueType: string
  label?: string
  preview?: string
  relationshipIds?: string[]
  reason?: string
}

export type PPTElement =
  | PPTTextElement
  | PPTImageElement
  | PPTShapeElement
  | PPTLineElement
  | PPTChartElement
  | PPTTableElement
  | PPTLatexElement
  | PPTVideoElement
  | PPTAudioElement
  | PPTGroupElement
  | PPTOpaqueElement

export type AnimationType = 'in' | 'out' | 'attention'
export type AnimationTrigger = 'click' | 'meantime' | 'auto'

/**
 * 元素动画
 *
 * id: 动画id
 *
 * elId: 元素ID
 *
 * effect: 动画效果
 *
 * type: 动画类型（入场、退场、强调）
 *
 * duration: 动画持续时间
 *
 * trigger: 动画触发方式(click - 单击时、meantime - 与上一动画同时、auto - 上一动画之后)
 */
export interface PPTAnimation {
  id: string
  elId: string
  effect: string
  type: AnimationType
  duration: number
  trigger: AnimationTrigger
  /** Retained native timing identity used for lossless PowerPoint round trips. */
  powerPointTiming?: {
    nodeId?: string
    presetClass?: string
    presetId?: string
    sourceObjectId?: string
  }
}

export type SlideBackgroundType = 'solid' | 'image' | 'gradient' | 'pattern'
export type SlideBackgroundImageSize = 'cover' | 'contain' | 'repeat' | 'stretch'
export interface SlideBackgroundImage {
  src: string
  size: SlideBackgroundImageSize,
}

/**
 * 幻灯片背景
 *
 * type: 背景类型（纯色、图片、渐变）
 *
 * color?: 背景颜色（纯色）
 *
 * image?: 图片背景
 *
 * gradientType?: 渐变背景
 */
export interface SlideBackground {
  type: SlideBackgroundType
  color?: string
  image?: SlideBackgroundImage
  gradient?: Gradient
  pattern?: PatternFill
}


export type TurningMode = 'no' | 'fade' | 'slideX' | 'slideY' | 'random' | 'slideX3D' | 'slideY3D' | 'rotate' | 'scaleY' | 'scaleX' | 'scale' | 'scaleReverse'

export interface NoteReply {
  id: string
  content: string
  time: number
  user: string
}

export interface Note {
  id: string
  content: string
  time: number
  user: string
  elId?: string
  replies?: NoteReply[]
}

export interface SectionTag {
  id: string
  title?: string
}

export type SlideType = 'cover' | 'contents' | 'transition' | 'content' | 'end'

/**
 * 幻灯片页面
 *
 * id: 页面ID
 *
 * elements: 元素集合
 *
 * notes?: 批注
 *
 * remark?: 备注
 *
 * background?: 页面背景
 *
 * animations?: 元素动画集合
 *
 * turningMode?: 翻页方式
 *
 * slideType?: 页面类型
 */
export interface Slide {
  id: string
  elements: PPTElement[]
  title?: string
  hidden?: boolean
  durationMs?: number
  notes?: Note[]
  remark?: string
  background?: SlideBackground
  animations?: PPTAnimation[]
  turningMode?: TurningMode
  sectionTag?: SectionTag
  type?: SlideType
  source?: PowerPointSlideSource
}

/**
 * 幻灯片主题
 *
 * backgroundColor: 页面背景颜色
 *
 * themeColor: 主题色，用于默认创建的形状颜色等
 *
 * fontColor: 字体颜色
 *
 * fontName: 字体
 */
export interface SlideTheme {
  backgroundColor: string
  themeColors: string[]
  fontColor: string
  fontName: string
  outline: PPTElementOutline
  shadow: PPTElementShadow
}

/**
 * How a provider's templates are obtained.
 *
 * `native` templates ship as a payload we can render and insert directly.
 * `link` templates are catalogued but not held: the drawer shows what a
 * provider offers and sends the user to the provider's own page for the file.
 * That distinction is a licensing one as much as a technical one — several
 * template libraries permit listing and linking but not redistribution.
 */
export type TemplateProviderMode = 'link' | 'native'

/**
 * Who supplies a group of templates.
 *
 * Providers exist so attribution has somewhere to live. Licences like CC BY
 * make credit mandatory, and credit has to name a specific source, so the
 * drawer groups templates by provider and labels each group rather than
 * presenting one anonymous pile.
 */
export interface TemplateProvider {
  /** Attribution line for the group; required by most content licences. */
  attribution?: string
  /** Provider's own site, linked from the section header. */
  homepage?: string
  id: string
  /** Default licence for this provider's templates; a template may override. */
  license?: TemplateLicense
  mode: TemplateProviderMode
  name: string
  /**
   * Where this provider's payloads live, e.g. `/mocks/` for bundled templates
   * or a bucket/CDN origin for hosted ones. A template id is appended as
   * `<base><id>.json`; a template can override the whole URL when the host
   * does not use predictable filenames.
   *
   * Cross-origin bases need CORS on the bucket — the payload is fetched by the
   * browser, not proxied.
   */
  payloadBaseUrl?: string
  /**
   * Where this provider's cover images live. Same joining rule as
   * `payloadBaseUrl`, applied to the template's `cover` value.
   */
  coverBaseUrl?: string
}

export interface TemplateLicense {
  name: string
  url?: string
}

export interface SlideTemplate {
  /** Overrides the provider's licence — corpora are often mixed. */
  license?: TemplateLicense
  name: string
  id: string
  cover: string
  origin?: string
  /** Credit for the individual work, where the licence requires it. */
  author?: string
  /**
   * Full URL to this template's payload, overriding the provider's base. For
   * hosted catalogues whose filenames are hashed or otherwise unpredictable.
   */
  payloadUrl?: string
  /** Falls back to the built-in provider when absent. */
  providerId?: string
  /**
   * How many slides/pages this template has. Carried in the catalogue so the
   * count can be shown before the payload is fetched.
   */
  slideCount?: number
  /**
   * The provider's page for this template. Required for `link` providers,
   * which open it instead of inserting; optional elsewhere as a credit link.
   */
  sourceUrl?: string
}
