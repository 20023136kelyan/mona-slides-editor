import type { PPTElement } from '@mona/presentation-core/model'

export type ElementCapabilityKind =
  | 'chart'
  | 'equation'
  | 'image'
  | 'line'
  | 'media'
  | 'native-group'
  | 'opaque'
  | 'shape'
  | 'table'
  | 'text'

export type ContextualSelectionKind =
  | 'empty'
  | 'group'
  | 'group-child'
  | 'mixed'
  | 'page'
  | ElementCapabilityKind

export type ContextualMode = 'create' | 'crop' | 'draw' | 'select' | 'text-edit'

export type MixedCapabilityKey =
  | 'fill'
  | 'flipH'
  | 'flipV'
  | 'fontFamily'
  | 'lock'
  | 'stroke'
  | 'textColor'
  | 'transparency'

export type CapabilityValue<T> = T | 'mixed' | undefined

export interface SelectionCapabilityValues {
  fill: CapabilityValue<string>
  flipH: CapabilityValue<boolean>
  flipV: CapabilityValue<boolean>
  fontFamily: CapabilityValue<string>
  lock: CapabilityValue<boolean>
  stroke: CapabilityValue<string>
  textColor: CapabilityValue<string>
  transparency: CapabilityValue<number>
}

export interface SelectionCapabilities {
  canAnimate: boolean
  canCrop: boolean
  canDelete: boolean
  canDuplicate: boolean
  canEditChartData: boolean
  canEditEquation: boolean
  canEditMedia: boolean
  canEditTable: boolean
  canEditText: boolean
  canFill: boolean
  canFlip: boolean
  canGroup: boolean
  canLink: boolean
  canLock: boolean
  canPosition: boolean
  canStroke: boolean
  canTransparency: boolean
  canUngroup: boolean
  mode: ContextualMode
  mixedValues: ReadonlySet<MixedCapabilityKey>
  selectedElements: readonly PPTElement[]
  selectionKind: ContextualSelectionKind
  targetElement?: PPTElement
  targetKind?: ElementCapabilityKind
  values: SelectionCapabilityValues
}

export interface ResolveSelectionCapabilitiesInput {
  activeElementIds: readonly string[]
  activeGroupElementId: string | null
  activeMode?: Exclude<ContextualMode, 'crop' | 'text-edit'>
  canEdit?: boolean
  cropElementId: string | null
  editingTextElementId: string | null
  elements: readonly PPTElement[]
  handleElementId: string | null
  pageSelected: boolean
}

interface ElementCapabilityProfile {
  animate: boolean
  crop: boolean
  editChartData: boolean
  editEquation: boolean
  editMedia: boolean
  editTable: boolean
  editText: boolean
  fill: boolean
  flip: boolean
  position: boolean
  stroke: boolean
  transparency: boolean
}

const elementKind = (element: PPTElement): ElementCapabilityKind => {
  if (element.type === 'latex') return 'equation'
  if (element.type === 'video' || element.type === 'audio') return 'media'
  if (element.type === 'group') return 'native-group'
  return element.type
}

const profileFor = (element: PPTElement): ElementCapabilityProfile => {
  const kind = elementKind(element)
  return {
    animate: true,
    crop: kind === 'image',
    editChartData: kind === 'chart',
    editEquation: kind === 'equation',
    editMedia: kind === 'media',
    editTable: kind === 'table',
    editText: kind === 'text' || (kind === 'shape' && Boolean(element.type === 'shape' && element.text)),
    fill: kind === 'shape' || kind === 'chart' || kind === 'table',
    flip: kind === 'shape' || kind === 'image',
    position: true,
    stroke: kind === 'shape' || kind === 'line' || kind === 'image' || kind === 'chart' || kind === 'table',
    transparency: kind === 'shape' || kind === 'text' || kind === 'image',
  }
}

const everyProfile = (
  elements: readonly PPTElement[],
  key: keyof ElementCapabilityProfile,
) => elements.length > 0 && elements.every(element => profileFor(element)[key])

const someProfile = (
  elements: readonly PPTElement[],
  key: keyof ElementCapabilityProfile,
) => elements.some(element => profileFor(element)[key])

const commonValue = <T,>(
  elements: readonly PPTElement[],
  read: (element: PPTElement) => T | undefined,
): CapabilityValue<T> => {
  const values = elements.map(read).filter((value): value is T => value !== undefined)
  if (!values.length) return undefined
  const first = values[0]
  return values.every(value => Object.is(value, first)) ? first : 'mixed'
}

const fillValue = (element: PPTElement) => {
  if (element.type === 'shape' || element.type === 'chart') return element.fill
  if (element.type === 'table') return element.data[0]?.[0]?.style?.backcolor
  return undefined
}

const strokeValue = (element: PPTElement) => {
  if (element.type === 'line') return element.color
  if ('outline' in element) return element.outline?.color
  return undefined
}

const textColorValue = (element: PPTElement) => {
  if (element.type === 'text') return element.defaultColor
  if (element.type === 'shape') return element.text?.defaultColor
  return undefined
}

const fontFamilyValue = (element: PPTElement) => {
  if (element.type === 'text') return element.defaultFontName
  if (element.type === 'shape') return element.text?.defaultFontName
  return undefined
}

const transparencyValue = (element: PPTElement) => {
  if (element.type === 'image') {
    const opacity = Number.parseFloat(element.filters?.opacity ?? '100')
    return Number.isFinite(opacity) ? 100 - opacity : 0
  }
  if (element.type === 'shape' || element.type === 'text') return Math.round((1 - (element.opacity ?? 1)) * 100)
  return undefined
}

const emptyValues = (): SelectionCapabilityValues => ({
  fill: undefined,
  flipH: undefined,
  flipV: undefined,
  fontFamily: undefined,
  lock: undefined,
  stroke: undefined,
  textColor: undefined,
  transparency: undefined,
})

export const resolveSelectionCapabilities = (
  input: ResolveSelectionCapabilitiesInput,
): SelectionCapabilities => {
  const canEdit = input.canEdit ?? true
  const selectedIds = new Set(input.activeElementIds)
  const selectedElements = input.elements.filter(element => selectedIds.has(element.id))
  const targetElement = selectedElements.find(element => element.id === input.activeGroupElementId)
    ?? selectedElements.find(element => element.id === input.handleElementId)
    ?? (selectedElements.length === 1 ? selectedElements[0] : undefined)
  const activeMode = input.activeMode ?? 'select'
  const mode: ContextualMode = activeMode !== 'select'
    ? activeMode
    : targetElement?.id === input.cropElementId
      ? 'crop'
      : targetElement?.id === input.editingTextElementId
        ? 'text-edit'
        : 'select'

  if (activeMode !== 'select') {
    return {
      canAnimate: false,
      canCrop: false,
      canDelete: false,
      canDuplicate: false,
      canEditChartData: false,
      canEditEquation: false,
      canEditMedia: false,
      canEditTable: false,
      canEditText: false,
      canFill: false,
      canFlip: false,
      canGroup: false,
      canLink: false,
      canLock: false,
      canPosition: false,
      canStroke: false,
      canTransparency: false,
      canUngroup: false,
      mode,
      mixedValues: new Set(),
      selectedElements,
      selectionKind: 'empty',
      values: emptyValues(),
    }
  }

  if (!selectedElements.length) {
    const page = input.pageSelected
    return {
      canAnimate: page && canEdit,
      canCrop: false,
      canDelete: page && canEdit,
      canDuplicate: page && canEdit,
      canEditChartData: false,
      canEditEquation: false,
      canEditMedia: false,
      canEditTable: false,
      canEditText: false,
      canFill: page && canEdit,
      canFlip: false,
      canGroup: false,
      canLink: false,
      canLock: page && canEdit,
      canPosition: page && canEdit,
      canStroke: false,
      canTransparency: false,
      canUngroup: false,
      mode,
      mixedValues: new Set(),
      selectedElements,
      selectionKind: page ? 'page' : 'empty',
      values: emptyValues(),
    }
  }

  const commonGroupId = selectedElements[0]?.groupId
  const grouped = Boolean(commonGroupId && selectedElements.every(element => element.groupId === commonGroupId))
  const targetKind = targetElement ? elementKind(targetElement) : undefined
  const selectionKind: ContextualSelectionKind = input.activeGroupElementId && targetElement
    ? 'group-child'
    : selectedElements.length > 1
      ? grouped ? 'group' : 'mixed'
      : targetKind!
  const values: SelectionCapabilityValues = {
    fill: commonValue(selectedElements, fillValue),
    flipH: commonValue(selectedElements, element => (
      element.type === 'image' || element.type === 'shape' ? Boolean(element.flipH) : undefined
    )),
    flipV: commonValue(selectedElements, element => (
      element.type === 'image' || element.type === 'shape' ? Boolean(element.flipV) : undefined
    )),
    fontFamily: commonValue(selectedElements, fontFamilyValue),
    lock: commonValue(selectedElements, element => Boolean(element.lock)),
    stroke: commonValue(selectedElements, strokeValue),
    textColor: commonValue(selectedElements, textColorValue),
    transparency: commonValue(selectedElements, transparencyValue),
  }
  const mixedValues = new Set<MixedCapabilityKey>()
  for (const key of Object.keys(values) as MixedCapabilityKey[]) {
    if (values[key] === 'mixed') mixedValues.add(key)
  }
  const effectiveElements = selectionKind === 'group-child' && targetElement ? [targetElement] : selectedElements
  const composedSelection = selectionKind === 'group' || selectionKind === 'mixed'
  const hasProfile = (key: keyof ElementCapabilityProfile) => (
    composedSelection ? someProfile(effectiveElements, key) : everyProfile(effectiveElements, key)
  )
  const textEditing = mode === 'text-edit'
  const cropping = mode === 'crop'

  return {
    canAnimate: canEdit && everyProfile(effectiveElements, 'animate'),
    canCrop: canEdit && everyProfile(effectiveElements, 'crop'),
    canDelete: canEdit && !textEditing && !cropping,
    canDuplicate: canEdit && !textEditing && !cropping,
    canEditChartData: canEdit && everyProfile(effectiveElements, 'editChartData'),
    canEditEquation: canEdit && everyProfile(effectiveElements, 'editEquation'),
    canEditMedia: canEdit && everyProfile(effectiveElements, 'editMedia'),
    canEditTable: canEdit && everyProfile(effectiveElements, 'editTable'),
    canEditText: canEdit && hasProfile('editText'),
    canFill: canEdit && hasProfile('fill'),
    canFlip: canEdit && hasProfile('flip'),
    canGroup: canEdit && selectedElements.length > 1 && !grouped,
    canLink: canEdit && Boolean(targetElement) && (selectedElements.length === 1 || selectionKind === 'group-child'),
    canLock: canEdit,
    canPosition: canEdit && everyProfile(effectiveElements, 'position'),
    canStroke: canEdit && hasProfile('stroke'),
    canTransparency: canEdit && hasProfile('transparency'),
    canUngroup: canEdit && grouped,
    mode,
    mixedValues,
    selectedElements,
    selectionKind,
    targetElement,
    targetKind,
    values,
  }
}
