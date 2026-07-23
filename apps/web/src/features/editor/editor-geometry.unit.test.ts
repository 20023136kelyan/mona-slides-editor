import { describe, expect, it } from 'vitest'

import { SHAPE_PATH_FORMULAS } from '@mona/presentation-core/shape-path-formulas'
import { ShapePathFormulasKeys } from '@mona/presentation-core/model'
import type {
  PPTElement,
  PPTChartElement,
  PPTImageElement,
  PPTLineElement,
  PPTShapeElement,
  PPTTableElement,
  PPTTextElement,
} from '@mona/presentation-core/model'

import {
  alignActiveElements,
  alignElementsToCanvas,
  buildEditorGridPath,
  buildSnapCandidates,
  buildResizeSnapCandidates,
  canResizeSelection,
  canRotateSelection,
  commitImageCropGeometry,
  constrainCreateGesturePoint,
  getImageCropGeometry,
  getGroupRotationCenter,
  getGroupRotationReference,
  getLassoSelectionIds,
  getLineControlPoints,
  getMinimumElementSize,
  getMultiSelectionState,
  getShapeKeypointPositions,
  groupElements,
  moveLineControlPoint,
  moveShapeKeypoint,
  normalizeAngle,
  orderElement,
  rotateElementsAround,
  resolveCreateGestureSelection,
  scaleElementsIntoBounds,
  setElementLocks,
  snapResizePoint,
  updateImageCropGeometry,
  ungroupElements,
  distributeElements,
} from '@/features/editor/editor-geometry'

const shape = (overrides: Partial<PPTShapeElement> = {}): PPTShapeElement => ({
  type: 'shape',
  id: 'shape',
  left: 10,
  top: 20,
  width: 100,
  height: 80,
  rotate: 0,
  viewBox: [100, 80],
  path: 'M 0 0',
  fixedRatio: false,
  fill: '#fff',
  ...overrides,
})

const textElement = (overrides: Partial<PPTTextElement> = {}): PPTTextElement => ({
  type: 'text',
  id: 'text',
  left: 20,
  top: 30,
  width: 200,
  height: 60,
  rotate: 0,
  content: '<p>Text</p>',
  defaultFontName: 'Arial',
  defaultColor: '#000',
  ...overrides,
})

const image = (overrides: Partial<PPTImageElement> = {}): PPTImageElement => ({
  type: 'image',
  id: 'image',
  left: 30,
  top: 40,
  width: 160,
  height: 90,
  rotate: 0,
  fixedRatio: false,
  src: 'data:image/svg+xml,',
  ...overrides,
})

const line = (overrides: Partial<PPTLineElement> = {}): PPTLineElement => ({
  type: 'line',
  id: 'line',
  left: 10,
  top: 20,
  width: 2,
  start: [0, 0],
  end: [100, 0],
  style: 'solid',
  color: '#000',
  points: ['', ''],
  ...overrides,
})

describe('editor geometry contracts', () => {
  it('preserves every multi-alignment and distribution vector exactly', () => {
    const elements: PPTElement[] = [
      shape({ id: 'rotated', left: 70, top: 65, width: 145, height: 95, rotate: 31 }),
      line({ id: 'line', left: 360, top: 90, end: [165, 48] }),
      shape({ id: 'group-shape', groupId: 'group', left: 650, top: 65, width: 115, height: 85, rotate: -23 }),
      textElement({ id: 'group-text', groupId: 'group', left: 790, top: 120, width: 145, height: 64 }),
      image({ id: 'image', left: 285, top: 375, width: 145, height: 105 }),
    ]
    const selectedIds = new Set(elements.map(element => element.id))
    const positions = (items: PPTElement[]) => items.map(({ id, left, top }) => ({ id, left, top }))
    const align = (command: 'left' | 'horizontal' | 'right' | 'top' | 'vertical' | 'bottom') => positions(
      alignActiveElements({ command, elements, selectedIds }),
    )

    expect(align('left')).toEqual([
      { id: 'rotated', left: 70, top: 65 },
      { id: 'line', left: 55.89106214086928, top: 90 },
      { id: 'group-shape', left: 67.92616417517877, top: 65 },
      { id: 'group-text', left: 207.92616417517877, top: 120 },
      { id: 'image', left: 55.89106214086928, top: 375 },
    ])
    expect(align('horizontal')).toEqual([
      { id: 'rotated', left: 422.94553107043464, top: 65 },
      { id: 'line', left: 412.94553107043464, top: 90 },
      { id: 'group-shape', left: 358.96308208758944, top: 65 },
      { id: 'group-text', left: 498.96308208758944, top: 120 },
      { id: 'image', left: 422.94553107043464, top: 375 },
    ])
    expect(align('right')).toEqual([
      { id: 'rotated', left: 775.8910621408693, top: 65 },
      { id: 'line', left: 770, top: 90 },
      { id: 'group-shape', left: 650, top: 65 },
      { id: 'group-text', left: 790, top: 120 },
      { id: 'image', left: 790, top: 375 },
    ])
    expect(align('top')).toEqual([
      { id: 'rotated', left: 70, top: 64.99999999999997 },
      { id: 'line', left: 360, top: 34.44429278567074 },
      { id: 'group-shape', left: 650, top: 53.53278894553269 },
      { id: 'group-text', left: 790, top: 108.53278894553269 },
      { id: 'image', left: 285, top: 34.44429278567074 },
    ])
    expect(align('vertical')).toEqual([
      { id: 'rotated', left: 70, top: 209.72214639283538 },
      { id: 'line', left: 360, top: 233.22214639283538 },
      { id: 'group-shape', left: 650, top: 207.26639447276636 },
      { id: 'group-text', left: 790, top: 262.26639447276636 },
      { id: 'image', left: 285, top: 204.72214639283538 },
    ])
    expect(align('bottom')).toEqual([
      { id: 'rotated', left: 70, top: 354.44429278567077 },
      { id: 'line', left: 360, top: 432 },
      { id: 'group-shape', left: 650, top: 361 },
      { id: 'group-text', left: 790, top: 416 },
      { id: 'image', left: 285, top: 375 },
    ])

    expect(positions(distributeElements({ axis: 'horizontal', elements, selectedIds }))).toEqual([
      { id: 'rotated', left: 70, top: 65 },
      { id: 'line', left: 440.01291126350395, top: 90 },
      { id: 'group-shape', left: 650, top: 65 },
      { id: 'group-text', left: 790, top: 120 },
      { id: 'image', left: 262.06092456131734, top: 375 },
    ])
    expect(positions(distributeElements({ axis: 'vertical', elements, selectedIds }))).toEqual([
      { id: 'rotated', left: 70, top: 64.99999999999997 },
      { id: 'line', left: 360, top: 327.54806779139705 },
      { id: 'group-shape', left: 650, top: 209.09613558279415 },
      { id: 'group-text', left: 790, top: 264.09613558279415 },
      { id: 'image', left: 285, top: 374.99999999999994 },
    ])
    expect(getMultiSelectionState(elements, selectedIds)).toEqual({ canCombine: true, displayItemCount: 4 })
    expect(getMultiSelectionState(elements, new Set(['group-shape', 'group-text'])))
      .toEqual({ canCombine: false, displayItemCount: 1 })
  })
  it('ports the source editor canvas alignment with its rotated-range and whole-slide clone boundary', () => {
    const elements: PPTElement[] = [
      shape({ id: 'rotated', left: 80, top: 60, width: 120, height: 80, rotate: 30 }),
      line({ id: 'line', left: 300, top: 220, start: [0, 0], end: [180, 40] }),
      textElement({ id: 'untouched', left: 600, top: 300 }),
    ]
    const aligned = alignElementsToCanvas({
      command: 'center',
      elements,
      selectedIds: new Set(['rotated', 'line']),
      viewportHeight: 562.5,
      viewportWidth: 1000,
    })
    expect(aligned).not.toBe(elements)
    expect(aligned[2]).toEqual(elements[2])
    const sourceCenter = {
      x: (Math.min(68.03847577293368, 300) + Math.max(211.96152422706632, 480)) / 2,
      y: (Math.min(35.35898384862245, 220) + Math.max(164.64101615137756, 260)) / 2,
    }
    expect(aligned[0]!.left).toBeCloseTo(80 + 500 - sourceCenter.x, 10)
    expect(aligned[0]!.top).toBeCloseTo(60 + 281.25 - sourceCenter.y, 10)
    expect(aligned[1]!.left).toBeCloseTo(300 + 500 - sourceCenter.x, 10)
    expect(aligned[1]!.top).toBeCloseTo(220 + 281.25 - sourceCenter.y, 10)
  })

  it('ports every layer command including neighboring-group atomicity and edge no-ops', () => {
    const elements: PPTElement[] = [
      shape({ id: 'a1', groupId: 'a' }),
      textElement({ id: 'a2', groupId: 'a' }),
      shape({ id: 'b' }),
      shape({ id: 'c1', groupId: 'c' }),
      textElement({ id: 'c2', groupId: 'c' }),
      shape({ id: 'd' }),
    ]
    const ids = (items: readonly PPTElement[] | undefined) => items?.map(element => element.id)
    expect(ids(orderElement(elements, 'b', 'up'))).toEqual(['a1', 'a2', 'c1', 'c2', 'b', 'd'])
    expect(ids(orderElement(elements, 'b', 'down'))).toEqual(['b', 'a1', 'a2', 'c1', 'c2', 'd'])
    expect(ids(orderElement(elements, 'a1', 'up'))).toEqual(['b', 'a1', 'a2', 'c1', 'c2', 'd'])
    expect(ids(orderElement(elements, 'c1', 'down'))).toEqual(['a1', 'a2', 'c1', 'c2', 'b', 'd'])
    expect(ids(orderElement(elements, 'b', 'top'))).toEqual(['a1', 'a2', 'c1', 'c2', 'd', 'b'])
    expect(ids(orderElement(elements, 'c1', 'bottom'))).toEqual(['c1', 'c2', 'a1', 'a2', 'b', 'd'])
    expect(orderElement(elements, 'a1', 'down')).toBeUndefined()
    expect(orderElement(elements, 'd', 'up')).toBeUndefined()
  })

  it('ports contiguous grouping, selective ungrouping, and clicked-target unlock selection', () => {
    const elements: PPTElement[] = [
      shape({ id: 'a' }),
      shape({ id: 'between' }),
      textElement({ id: 'b' }),
      shape({ id: 'locked-group-a', groupId: 'locked', lock: true }),
      textElement({ id: 'locked-group-b', groupId: 'locked', lock: true }),
    ]
    const grouped = groupElements(elements, new Set(['a', 'b']), 'new-group')
    expect(grouped.map(element => element.id)).toEqual(['between', 'a', 'b', 'locked-group-a', 'locked-group-b'])
    expect(grouped.slice(1, 3).map(element => element.groupId)).toEqual(['new-group', 'new-group'])
    const ungrouped = ungroupElements(grouped, new Set(['a']))!
    expect(ungrouped.find(element => element.id === 'a')?.groupId).toBeUndefined()
    expect(ungrouped.find(element => element.id === 'b')?.groupId).toBe('new-group')
    expect(ungroupElements(elements, new Set(['a']))).toBeUndefined()

    const locked = setElementLocks({ elements, lock: true, selectedIds: new Set(['a', 'between']) })!
    expect(locked.selectedIds).toEqual([])
    expect(locked.elements.filter(element => ['a', 'between'].includes(element.id)).every(element => element.lock)).toBe(true)
    const unlocked = setElementLocks({ elements, lock: false, targetElementId: 'locked-group-b' })!
    expect(unlocked.selectedIds).toEqual(['locked-group-a', 'locked-group-b'])
    expect(unlocked.elements.slice(-2).every(element => element.lock === false)).toBe(true)
  })

  it('matches source create-selection modifier geometry in every direction and tie branch', () => {
    const start = { x: 100, y: 100 }
    expect(constrainCreateGesturePoint('shape', start, { x: 180, y: 120 }, { shift: true })).toEqual({ x: 180, y: 180 })
    expect(constrainCreateGesturePoint('shape', start, { x: 20, y: 120 }, { control: true })).toEqual({ x: 20, y: 180 })
    expect(constrainCreateGesturePoint('shape', start, { x: 180, y: 80 }, { meta: true })).toEqual({ x: 180, y: 20 })
    expect(constrainCreateGesturePoint('shape', start, { x: 20, y: 80 }, { shift: true })).toEqual({ x: 20, y: 20 })
    expect(constrainCreateGesturePoint('shape', start, { x: 140, y: 140 }, { shift: true })).toEqual({ x: 140, y: 140 })
    expect(constrainCreateGesturePoint('line', start, { x: 180, y: 120 }, { shift: true })).toEqual({ x: 180, y: 100 })
    expect(constrainCreateGesturePoint('line', start, { x: 140, y: 140 }, { shift: true })).toEqual({ x: 100, y: 140 })
    expect(constrainCreateGesturePoint('text', start, { x: 180, y: 120 }, { shift: true })).toEqual({ x: 180, y: 120 })
  })

  it('matches source create thresholds, raw fallback dimensions, and last-move modifier ownership', () => {
    expect(resolveCreateGestureSelection({
      lastPointer: { x: 129, y: 200 }, modifiers: {}, rawPointer: { x: 129, y: 200 }, start: { x: 100, y: 100 }, tool: 'shape',
    })).toEqual({ start: { x: 100, y: 100 }, end: { x: 300, y: 200 } })
    expect(resolveCreateGestureSelection({
      lastPointer: { x: 71, y: 71 }, modifiers: {}, rawPointer: { x: 71, y: 71 }, start: { x: 100, y: 100 }, tool: 'text',
    })).toEqual({ start: { x: 71, y: 71 }, end: { x: 271, y: 271 } })
    expect(resolveCreateGestureSelection({
      lastPointer: { x: 110, y: 180 }, modifiers: { shift: true }, rawPointer: { x: 110, y: 180 }, start: { x: 100, y: 100 }, tool: 'line',
    })).toEqual({ start: { x: 100, y: 100 }, end: { x: 100, y: 180 } })
    expect(resolveCreateGestureSelection({
      lastPointer: { x: 180, y: 140 }, modifiers: { shift: true }, rawPointer: { x: 180, y: 140 }, start: { x: 100, y: 100 }, tool: 'shape',
    })).toEqual({ start: { x: 100, y: 100 }, end: { x: 180, y: 180 } })
  })

  it('builds the source grid path with both zero axes and floored far edges', () => {
    expect(buildEditorGridPath(1000, 0.5625, 250)).toBe(
      'M0 0 L1000 0 M0 250 L1000 250 M0 500 L1000 500 ' +
      'M0 0 L0 562.5 M250 0 L250 562.5 M500 0 L500 562.5 M750 0 L750 562.5 M1000 0 L1000 562.5 ',
    )
  })

  it('uses the original selection eligibility rules', () => {
    const groupShape = shape({ groupId: 'group' })
    const groupText = textElement({ groupId: 'group' })
    const simpleGroupLine = line({ groupId: 'group' })
    const curvedGroupLine = line({ groupId: 'group', curve: [50, 40] })
    const chart: PPTChartElement = {
      type: 'chart',
      id: 'chart',
      left: 0,
      top: 0,
      width: 300,
      height: 200,
      rotate: 0,
      chartType: 'bar',
      data: { labels: [], legends: [], series: [] },
      options: {},
      themeColors: [],
      textColor: '#000',
      lineColor: '#ddd',
    }

    expect(canRotateSelection([shape()])).toBe(true)
    expect(canRotateSelection([chart])).toBe(false)
    expect(canRotateSelection([line()])).toBe(false)
    expect(canRotateSelection([groupShape, groupText, simpleGroupLine])).toBe(true)
    expect(canRotateSelection([groupShape, groupText, curvedGroupLine])).toBe(false)
    expect(canRotateSelection([shape({ groupId: 'a' }), textElement({ groupId: 'b' })])).toBe(false)
    expect(canResizeSelection([shape(), image()])).toBe(true)
    expect(canResizeSelection([shape({ rotate: 1 }), image()])).toBe(false)
    expect(canResizeSelection([groupShape, groupText])).toBe(false)
    expect(canResizeSelection([shape({ lock: true })])).toBe(false)
  })

  it('derives Vue group rotation references and aligned centers', () => {
    const first = shape({ id: 'first', left: 90, top: 90, width: 150, height: 110, rotate: 30, groupId: 'group' })
    const second = textElement({ id: 'second', left: 310, top: 105, width: 230, height: 80, rotate: 30, groupId: 'group' })
    expect(getGroupRotationReference([first, second])).toBe(30)
    expect(getGroupRotationReference([first, { ...second, rotate: 30.09 }])).toBe(30)
    expect(getGroupRotationReference([first, { ...second, rotate: 30.11 }])).toBeNull()
    const center = getGroupRotationCenter([first, second], 30)
    expect(center.x).toBeCloseTo(308.5705080756888, 8)
    expect(center.y).toBeCloseTo(161.49519052838326, 8)
    expect(normalizeAngle(190)).toBe(-170)
    expect(normalizeAngle(-190)).toBe(170)
  })

  it('rotates grouped rectangle and line geometry around one center', () => {
    const groupedShape = shape({ id: 'shape', left: 0, top: 0, width: 100, height: 100, groupId: 'group' })
    const groupedLine = line({ id: 'line', left: 200, top: 50, start: [0, 0], end: [100, 0], groupId: 'group' })
    const center = getGroupRotationCenter([groupedShape, groupedLine])
    expect(center).toEqual({ x: 150, y: 50 })
    const updates = rotateElementsAround([groupedShape, groupedLine], center, 90)
    expect(updates.get('shape')).toMatchObject({ left: 100, top: -100, rotate: 90 })
    expect(updates.get('line')).toMatchObject({ left: 150, top: 100, start: [0, 0], end: [0, 100] })
  })

  it('keeps Vue candidate order and merges equal guide ranges', () => {
    const candidates = buildSnapCandidates([
      shape({ id: 'first', left: 100, top: 80, width: 100, height: 60 }),
      shape({ id: 'second', left: 100, top: 200, width: 50, height: 40 }),
    ], new Set(), 1000, 0.5625)

    expect(candidates.vertical[0]).toEqual({ value: 100, range: [80, 240] })
    expect(candidates.horizontal.slice(-3).map(candidate => candidate.value)).toEqual([0, 562.5, 281.25])
    expect(candidates.vertical.slice(-3).map(candidate => candidate.value)).toEqual([0, 1000, 500])
  })

  it('applies strict/intersection lasso rules to locks, hidden elements, and complete groups', () => {
    const elements = [
      shape({ id: 'inside', left: 20, top: 20, width: 20, height: 20 }),
      shape({ id: 'boundary', left: 0, top: 10, width: 20, height: 20 }),
      shape({ id: 'hidden', left: 30, top: 30, width: 20, height: 20 }),
      shape({ id: 'locked', left: 40, top: 40, width: 20, height: 20, lock: true }),
      shape({ id: 'group-a', groupId: 'group', left: 10, top: 60, width: 20, height: 20 }),
      shape({ id: 'group-b', groupId: 'group', left: 110, top: 60, width: 20, height: 20 }),
    ]
    const selection = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    expect(getLassoSelectionIds({
      elements,
      hiddenElementIds: new Set(['hidden']),
      intersecting: false,
      selection,
    })).toEqual(['inside'])
    expect(getLassoSelectionIds({
      elements,
      hiddenElementIds: new Set(['hidden']),
      intersecting: true,
      selection,
    })).toEqual(['inside', 'boundary'])
    expect(getLassoSelectionIds({
      elements,
      hiddenElementIds: new Set(),
      intersecting: false,
      selection: { minX: 0, minY: 0, maxX: 140, maxY: 100 },
    })).toEqual(['inside', 'hidden', 'group-a', 'group-b'])
  })

  it('uses edge-only resize candidates and emits the original guide extent', () => {
    const candidates = buildResizeSnapCandidates([
      shape({ id: 'first', left: 100, top: 80, width: 100, height: 60 }),
      shape({ id: 'rotated', left: 250, top: 100, width: 80, height: 80, rotate: 10 }),
      line({ id: 'line-candidate' }),
    ], new Set(), 1000, 0.5625)
    expect(candidates.horizontal.map(candidate => candidate.value)).toEqual([80, 140, 0, 562.5, 281.25])
    expect(candidates.vertical.map(candidate => candidate.value)).toEqual([100, 200, 0, 1000, 500])

    expect(snapResizePoint({
      horizontalCandidates: candidates.horizontal,
      point: { x: 204, y: 142 },
      verticalCandidates: candidates.vertical,
    })).toEqual({
      correction: { x: -4, y: -2 },
      guides: [
        { orientation: 'horizontal', axis: 140, from: 50, to: 254 },
        { orientation: 'vertical', axis: 200, from: 30, to: 192 },
      ],
    })
  })

  it('ports line endpoint, curve, and cubic control semantics', () => {
    const simple = line()
    expect(getLineControlPoints(simple).map(point => point.handle)).toEqual(['start', 'end'])
    expect(moveLineControlPoint({
      delta: { x: 3, y: 5 },
      element: simple,
      elements: [],
      handle: 'end',
      preserveControlPoints: false,
      viewportRatio: 0.5625,
      viewportSize: 1000,
    })).toMatchObject({ left: 10, top: 20, start: [0, 0], end: [103, 0] })

    const curve = line({ curve: [50, 40] })
    expect(getLineControlPoints(curve).map(point => point.handle)).toEqual(['start', 'end', 'control'])
    expect(moveLineControlPoint({
      delta: { x: 20, y: 0 },
      element: curve,
      elements: [],
      handle: 'end',
      preserveControlPoints: false,
      viewportRatio: 0.5625,
      viewportSize: 1000,
    }).curve).toEqual([60, 0])

    const cubic = line({ cubic: [[25, 40], [75, 40]] })
    expect(getLineControlPoints(cubic).map(point => point.handle)).toEqual(['start', 'end', 'control-1', 'control-2'])
    expect(moveLineControlPoint({
      delta: { x: 10, y: -10 },
      element: cubic,
      elements: [],
      handle: 'control-1',
      preserveControlPoints: true,
      viewportRatio: 0.5625,
      viewportSize: 1000,
    }).cubic).toEqual([[35, 30], [75, 40]])
  })

  it('ports line endpoint canonicalization, adsorption, and live modifier preservation exactly', () => {
    const broken = line({ left: 90, top: 100, start: [0, 0], end: [280, 20], broken: [140, 70] })
    expect(moveLineControlPoint({
      delta: { x: 410, y: -100 },
      element: broken,
      elements: [],
      handle: 'start',
      preserveControlPoints: false,
      viewportRatio: 0.5625,
      viewportSize: 1000,
    })).toMatchObject({ left: 370, top: 0, start: [130, 0], end: [0, 120], broken: [65, 60] })

    const reset = moveLineControlPoint({
      delta: { x: 55, y: -45 },
      element: broken,
      elements: [],
      handle: 'end',
      preserveControlPoints: false,
      viewportRatio: 0.5625,
      viewportSize: 1000,
    })
    expect(reset).toMatchObject({ left: 90, top: 75, start: [0, 25], end: [335, 0], broken: [167.5, 12.5] })

    const preserved = moveLineControlPoint({
      delta: { x: 55, y: -45 },
      element: broken,
      elements: [],
      handle: 'end',
      preserveControlPoints: true,
      viewportRatio: 0.5625,
      viewportSize: 1000,
    })
    expect(preserved).toMatchObject({ left: 90, top: 75, start: [0, 25], end: [335, 0], broken: [140, 95] })

    const adsorbed = moveLineControlPoint({
      delta: { x: -170, y: -100 },
      element: line({ left: 90, top: 100, end: [280, 0] }),
      elements: [shape({ left: 175, top: 0, width: 50, height: 80 })],
      handle: 'end',
      preserveControlPoints: false,
      viewportRatio: 0.5625,
      viewportSize: 1000,
    })
    expect(adsorbed).toMatchObject({ left: 90, top: 0, start: [0, 100], end: [110, 0] })
  })

  it('ports broken2 direction locking, control snapping, and cubic reset semantics exactly', () => {
    const horizontal = line({ start: [0, 0], end: [280, 35], broken2: [140, 55], broken2Direction: 'horizontal' })
    expect(moveLineControlPoint({
      delta: { x: 45, y: 35 },
      element: horizontal,
      elements: [],
      handle: 'control',
      preserveControlPoints: false,
      viewportRatio: 0.5625,
      viewportSize: 1000,
    }).broken2).toEqual([185, 55])

    const vertical = { ...horizontal, broken2Direction: 'vertical' as const }
    expect(moveLineControlPoint({
      delta: { x: 45, y: 35 },
      element: vertical,
      elements: [],
      handle: 'control',
      preserveControlPoints: false,
      viewportRatio: 0.5625,
      viewportSize: 1000,
    }).broken2).toEqual([140, 90])

    const cubic = line({ start: [0, 0], end: [280, -10], cubic: [[80, -85], [210, 65]] })
    const reset = moveLineControlPoint({
      delta: { x: 50, y: -45 },
      element: cubic,
      elements: [],
      handle: 'end',
      preserveControlPoints: false,
      viewportRatio: 0.5625,
      viewportSize: 1000,
    })
    expect(reset.cubic).toEqual([[165, 27.5], [165, 27.5]])
  })

  it('recomputes editable shape keypoints and paths from the shared formula registry', () => {
    const rounded = shape({
      id: 'rounded',
      pathFormula: ShapePathFormulasKeys.ROUND_RECT,
      keypoints: [0.1],
    })
    expect(getShapeKeypointPositions(rounded)).toEqual([{ index: 0, x: 18, y: 20 }])

    const update = moveShapeKeypoint(rounded, 0, { x: 8, y: 0 })
    expect(update.keypoints).toEqual([0.2])
    expect(update.path).toBe(SHAPE_PATH_FORMULAS.roundRect!.formula(100, 80, [0.2]))
  })

  it('keeps per-type minimums and type-specific resize side effects', () => {
    const rounded = shape({
      id: 'rounded',
      pathFormula: ShapePathFormulasKeys.ROUND_RECT,
      keypoints: [0.125],
    })
    const table: PPTTableElement = {
      type: 'table',
      id: 'table',
      left: 0,
      top: 0,
      width: 420,
      height: 250,
      rotate: 0,
      outline: { width: 2 },
      colWidths: [1],
      cellMinHeight: 54,
      data: [[{ id: 'a', colspan: 1, rowspan: 1, text: '', style: {} }]],
    }
    expect(getMinimumElementSize(textElement())).toBe(40)
    expect(getMinimumElementSize(table)).toBe(30)
    expect(getMinimumElementSize({ ...table, type: 'chart' } as unknown as PPTChartElement)).toBe(200)

    const shapeUpdate = scaleElementsIntoBounds(
      [rounded],
      { minX: 10, maxX: 110, minY: 20, maxY: 100 },
      { minX: 10, maxX: 210, minY: 20, maxY: 180 },
    ).get('rounded') as Partial<PPTShapeElement>
    expect(shapeUpdate.viewBox).toEqual([200, 160])
    expect(shapeUpdate.path).toBe(SHAPE_PATH_FORMULAS.roundRect!.formula(200, 160, [0.125]))

    const tableUpdate = scaleElementsIntoBounds(
      [table],
      { minX: 0, maxX: 420, minY: 0, maxY: 250 },
      { minX: 0, maxX: 420, minY: 0, maxY: 500 },
    ).get('table') as Partial<PPTTableElement>
    expect(tableUpdate.cellMinHeight).toBe(304)
  })

  it('ports multi-resize zero collapse without recalculating editable shape paths', () => {
    const rounded = shape({
      id: 'rounded',
      left: 20,
      top: 30,
      width: 100,
      height: 80,
      pathFormula: ShapePathFormulasKeys.ROUND_RECT,
      keypoints: [0.125],
      viewBox: [100, 80],
      path: SHAPE_PATH_FORMULAS.roundRect!.formula(100, 80, [0.125]),
    })
    const sourceImage = image({ id: 'image', left: 180, top: 50, width: 160, height: 90 })
    const origin = { minX: 20, maxX: 340, minY: 30, maxY: 140 }

    const scaled = scaleElementsIntoBounds(
      [rounded, sourceImage],
      origin,
      { minX: 20, maxX: 500, minY: 30, maxY: 250 },
      { enforceMinimumSize: false, updateShapePath: false },
    )
    expect(scaled.get('rounded')).toEqual({ left: 20, top: 30, width: 150, height: 160 })
    expect(scaled.get('image')).toEqual({ left: 260, top: 70, width: 240, height: 180 })
    expect(scaled.get('rounded')).not.toHaveProperty('path')
    expect(scaled.get('rounded')).not.toHaveProperty('viewBox')

    const collapsed = scaleElementsIntoBounds(
      [rounded, sourceImage],
      origin,
      { minX: 20, maxX: -100, minY: 30, maxY: -100 },
      { enforceMinimumSize: false, updateShapePath: false },
    )
    expect(collapsed.get('rounded')).toEqual({ left: 20, top: 30, width: 0, height: 0 })
    expect(collapsed.get('image')).toEqual({ left: 20, top: 30, width: 0, height: 0 })
  })

  it('keeps table height DOM-owned after its cell minimum reaches the Vue floor', () => {
    const table: PPTTableElement = {
      type: 'table',
      id: 'table',
      left: 40,
      top: 50,
      width: 420,
      height: 250,
      rotate: 0,
      outline: { width: 2 },
      colWidths: [1],
      cellMinHeight: 36,
      data: [[{ id: 'a', colspan: 1, rowspan: 1, text: '', style: {} }]],
    }
    expect(scaleElementsIntoBounds(
      [table],
      { minX: 40, maxX: 460, minY: 50, maxY: 300 },
      { minX: 80, maxX: 290, minY: 50, maxY: 100 },
    ).get('table')).toEqual({ left: 80, width: 210 })
  })

  it('reconstructs the Vue crop coordinate system from an existing range', () => {
    expect(getImageCropGeometry(image({
      width: 250,
      height: 300,
      rotate: -8,
      clip: { shape: 'rect', range: [[8, 0], [88, 100]] },
    }))).toEqual({
      originLeft: 10,
      originTop: 0,
      rawWidth: 125,
      rawHeight: 100,
      rect: { left: 10, top: 0, width: 100, height: 100 },
    })
  })

  it.each([
    ['top-left', { x: -100, y: -50 }, { left: 0, top: 0, width: 125, height: 150 }],
    ['top', { x: 0, y: -50 }, { left: 25, top: 0, width: 100, height: 150 }],
    ['top-right', { x: 100, y: -50 }, { left: 25, top: 0, width: 125, height: 150 }],
    ['right', { x: 100, y: 0 }, { left: 25, top: 50, width: 125, height: 100 }],
    ['bottom-right', { x: 100, y: 100 }, { left: 25, top: 50, width: 125, height: 150 }],
    ['bottom', { x: 0, y: 100 }, { left: 25, top: 50, width: 100, height: 150 }],
    ['bottom-left', { x: -100, y: 100 }, { left: 0, top: 50, width: 125, height: 150 }],
    ['left', { x: -100, y: 0 }, { left: 0, top: 50, width: 125, height: 100 }],
  ] as const)('matches crop constraint semantics for the %s handle', (handle, delta, rect) => {
    const element = image({ width: 200, height: 100 })
    const geometry = {
      originLeft: 25,
      originTop: 50,
      rawWidth: 150,
      rawHeight: 200,
      rect: { left: 25, top: 50, width: 100, height: 100 },
    }
    expect(updateImageCropGeometry({
      delta,
      element,
      geometry,
      handle,
      lockAspectRatio: false,
    }).rect).toEqual(rect)
  })

  it('constrains crop movement, minimum size, rotation, and modifier ratio exactly', () => {
    const element = image({ width: 200, height: 100 })
    const geometry = {
      originLeft: 25,
      originTop: 50,
      rawWidth: 150,
      rawHeight: 200,
      rect: { left: 25, top: 50, width: 100, height: 100 },
    }
    expect(updateImageCropGeometry({
      delta: { x: -1000, y: -1000 }, element, geometry, handle: 'move', lockAspectRatio: false,
    }).rect).toEqual({ left: 0, top: 0, width: 100, height: 100 })
    expect(updateImageCropGeometry({
      delta: { x: 1000, y: 1000 }, element, geometry, handle: 'move', lockAspectRatio: false,
    }).rect).toEqual({ left: 50, top: 100, width: 100, height: 100 })
    expect(updateImageCropGeometry({
      delta: { x: -1000, y: 0 }, element, geometry, handle: 'right', lockAspectRatio: false,
    }).rect).toEqual({ left: 25, top: 50, width: 25, height: 100 })
    expect(updateImageCropGeometry({
      delta: { x: 0, y: -1000 }, element, geometry, handle: 'bottom', lockAspectRatio: false,
    }).rect).toEqual({ left: 25, top: 50, width: 100, height: 50 })

    expect(updateImageCropGeometry({
      delta: { x: 0, y: 20 },
      element: { ...element, rotate: 90 },
      geometry,
      handle: 'move',
      lockAspectRatio: false,
    }).rect.left).toBeCloseTo(35, 8)

    expect(updateImageCropGeometry({
      delta: { x: 20, y: 80 },
      element,
      geometry: { ...geometry, rect: { left: 25, top: 50, width: 100, height: 50 } },
      handle: 'bottom-right',
      lockAspectRatio: true,
    }).rect).toEqual({ left: 25, top: 50, width: 110, height: 55 })
  })

  it('commits one quantized Vue-compatible crop update including rotated center correction', () => {
    const source = image({ left: 30, top: 40, width: 200, height: 100 })
    const geometry = {
      originLeft: 25,
      originTop: 50,
      rawWidth: 150,
      rawHeight: 200,
      rect: { left: 35, top: 40, width: 80, height: 120 },
    }
    const update = commitImageCropGeometry(source, geometry)
    expect(update).toMatchObject({ left: 50, top: 30, width: 160, height: 120 })
    expect(update.clip!.range[0][0]).toBeCloseTo(22.9946524064, 8)
    expect(update.clip!.range[0][1]).toBeCloseTo(19.8795180723, 8)
    expect(update.clip!.range[1][0]).toBeCloseTo(76.4705882353, 8)
    expect(update.clip!.range[1][1]).toBeCloseTo(80.1204819277, 8)

    const rotated = commitImageCropGeometry({ ...source, rotate: 90 }, {
      ...geometry,
      rect: { left: 45, top: 40, width: 80, height: 120 },
    })
    expect(rotated).toMatchObject({ left: 50, top: 50, width: 160, height: 120 })
  })
})
