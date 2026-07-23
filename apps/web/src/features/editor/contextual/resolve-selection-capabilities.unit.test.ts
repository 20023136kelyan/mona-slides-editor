import { describe, expect, test } from 'vitest'

import type { PPTElement } from '@mona/presentation-core/model'

import { resolveSelectionCapabilities } from '@/features/editor/contextual/resolve-selection-capabilities'

const shape = (id: string, props: Partial<Extract<PPTElement, { type: 'shape' }>> = {}): Extract<PPTElement, { type: 'shape' }> => ({
  type: 'shape',
  id,
  left: 0,
  top: 0,
  width: 100,
  height: 100,
  rotate: 0,
  fixedRatio: false,
  viewBox: [100, 100],
  path: 'M0 0H100V100H0Z',
  fill: '#fff',
  ...props,
})

const text: Extract<PPTElement, { type: 'text' }> = {
  type: 'text',
  id: 'text',
  content: '<p>Text</p>',
  defaultFontName: 'Inter',
  defaultColor: '#111',
  left: 0,
  top: 0,
  width: 100,
  height: 40,
  rotate: 0,
}

const image: Extract<PPTElement, { type: 'image' }> = {
  type: 'image',
  id: 'image',
  src: 'data:image/png;base64,',
  fixedRatio: true,
  left: 0,
  top: 0,
  width: 100,
  height: 100,
  rotate: 0,
}

const line: Extract<PPTElement, { type: 'line' }> = {
  type: 'line',
  id: 'line',
  left: 0,
  top: 0,
  width: 2,
  start: [0, 0],
  end: [100, 100],
  style: 'solid',
  color: '#000',
  points: ['', 'arrow'],
}

const table: Extract<PPTElement, { type: 'table' }> = {
  type: 'table',
  id: 'table',
  left: 0,
  top: 0,
  width: 100,
  height: 100,
  rotate: 0,
  outline: { color: '#000', style: 'solid', width: 1 },
  colWidths: [100],
  cellMinHeight: 20,
  data: [[{ id: 'cell', colspan: 1, rowspan: 1, text: '<p>Cell</p>' }]],
}

const chart: Extract<PPTElement, { type: 'chart' }> = {
  type: 'chart',
  id: 'chart',
  left: 0,
  top: 0,
  width: 100,
  height: 100,
  rotate: 0,
  chartType: 'bar',
  data: { labels: ['A'], legends: ['Series'], series: [[1]] },
  themeColors: ['#000'],
}

const equation: Extract<PPTElement, { type: 'latex' }> = {
  type: 'latex',
  id: 'equation',
  left: 0,
  top: 0,
  width: 100,
  height: 40,
  rotate: 0,
  latex: 'x',
  path: 'M0 0',
  color: '#000',
  strokeWidth: 1,
  viewBox: [100, 40],
  fixedRatio: true,
}

const video: Extract<PPTElement, { type: 'video' }> = {
  type: 'video',
  id: 'video',
  left: 0,
  top: 0,
  width: 100,
  height: 100,
  rotate: 0,
  src: 'video.mp4',
  autoplay: false,
}

const resolve = (
  elements: readonly PPTElement[],
  selected: readonly string[],
  overrides: Partial<Parameters<typeof resolveSelectionCapabilities>[0]> = {},
) => resolveSelectionCapabilities({
  activeElementIds: selected,
  activeGroupElementId: null,
  cropElementId: null,
  editingTextElementId: null,
  elements,
  handleElementId: selected.length === 1 ? selected[0]! : null,
  pageSelected: false,
  ...overrides,
})

describe('resolveSelectionCapabilities', () => {
  test('distinguishes an explicit page selection from an empty or creation state', () => {
    expect(resolve([], [], { pageSelected: true }).selectionKind).toBe('page')
    expect(resolve([], [], { pageSelected: false }).selectionKind).toBe('empty')
    expect(resolve([], [], { activeMode: 'create', pageSelected: true })).toMatchObject({
      selectionKind: 'empty',
      canFill: false,
      canPosition: false,
    })
  })

  test.each([
    [text, 'text', { canEditText: true }],
    [image, 'image', { canCrop: true, canFlip: true }],
    [shape('shape'), 'shape', { canFill: true, canStroke: true }],
    [line, 'line', { canStroke: true }],
    [chart, 'chart', { canEditChartData: true }],
    [table, 'table', { canEditTable: true }],
    [equation, 'equation', { canEditEquation: true }],
    [video, 'media', { canEditMedia: true }],
  ] as const)('resolves %s as %s with type-specific capabilities', (element, kind, capabilities) => {
    expect(resolve([element], [element.id])).toMatchObject({
      selectionKind: kind,
      targetKind: kind,
      ...capabilities,
    })
  })

  test('makes text editing non-destructive while preserving text and link capabilities', () => {
    expect(resolve([text], [text.id], { editingTextElementId: text.id })).toMatchObject({
      mode: 'text-edit',
      canDelete: false,
      canDuplicate: false,
      canEditText: true,
      canLink: true,
    })
  })

  test('suppresses destructive actions during image crop mode', () => {
    expect(resolve([image], [image.id], { cropElementId: image.id })).toMatchObject({
      mode: 'crop',
      canDelete: false,
      canDuplicate: false,
      canCrop: true,
    })
  })

  test('retains group context while drilling into a child', () => {
    const group = [shape('shape-a', { groupId: 'group' }), { ...line, id: 'line-b', groupId: 'group' }]
    const parent = resolve(group, group.map(element => element.id), { handleElementId: 'shape-a' })
    expect(parent).toMatchObject({ selectionKind: 'group', canUngroup: true, canGroup: false })

    const child = resolve(group, group.map(element => element.id), {
      activeGroupElementId: 'line-b',
      handleElementId: 'line-b',
    })
    expect(child).toMatchObject({
      selectionKind: 'group-child',
      targetKind: 'line',
      canStroke: true,
      canUngroup: true,
    })
  })

  test('composes mixed-selection capabilities and reports mixed values explicitly', () => {
    const first = shape('shape-a', { fill: '#f00', opacity: 1 })
    const second = shape('shape-b', { fill: '#0f0', opacity: 0.5 })
    const homogeneous = resolve([first, second], [first.id, second.id])
    expect(homogeneous.selectionKind).toBe('mixed')
    expect(homogeneous.canFill).toBe(true)
    expect(homogeneous.values.fill).toBe('mixed')
    expect(homogeneous.values.transparency).toBe('mixed')
    expect(homogeneous.mixedValues).toEqual(new Set(['fill', 'transparency']))

    const heterogeneous = resolve([first, image], [first.id, image.id])
    expect(heterogeneous).toMatchObject({
      selectionKind: 'mixed',
      canFill: true,
      canFlip: true,
      canTransparency: true,
      canGroup: true,
    })
    expect(heterogeneous.values.fill).toBe('#f00')

    const shapeAndText = resolve([first, text], [first.id, text.id])
    expect(shapeAndText).toMatchObject({
      selectionKind: 'mixed',
      canEditText: true,
      canFill: true,
      canStroke: true,
      canTransparency: true,
    })
  })
})
