import { describe, expect, test } from 'vitest'

import type { PPTImageElement, PPTLineElement, TableCell } from '@mona/presentation-core/model'

import {
  formatTableText,
  getHiddenTableCells,
  getImageClip,
  getImagePosition,
  getLineDashArray,
  getLinePath,
  getLineRenderPath,
  getSlideBackgroundStyle,
} from '@/features/presentation-renderer/render-utils'

const image: PPTImageElement = {
  id: 'image-1',
  type: 'image',
  left: 0,
  top: 0,
  width: 200,
  height: 100,
  rotate: 0,
  fixedRatio: false,
  src: '/asset.png',
  clip: { shape: 'roundRect', range: [[10, 20], [90, 80]] },
  radius: 18,
}

const line: PPTLineElement = {
  id: 'line-1',
  type: 'line',
  left: 0,
  top: 0,
  width: 4,
  start: [0, 0],
  end: [100, 100],
  curve: [50, 20],
  style: 'dashed',
  color: '#000',
  points: ['arrow', 'dot'],
}

describe('slide renderer geometry', () => {
  test('maps all background forms to complete CSS values', () => {
    expect(getSlideBackgroundStyle({ type: 'image', image: { src: '/background.png', size: 'cover' } })).toMatchObject({
      backgroundImage: 'url(/background.png)',
      backgroundRepeat: 'no-repeat',
      backgroundSize: 'cover',
    })
    expect(getSlideBackgroundStyle({
      type: 'gradient',
      gradient: { type: 'linear', rotate: 30, colors: [{ pos: 0, color: '#000' }, { pos: 100, color: '#fff' }] },
    })).toEqual({ backgroundImage: 'linear-gradient(120deg, #000 0%,#fff 100%)' })
    expect(getSlideBackgroundStyle({
      type: 'gradient',
      gradient: { type: 'radial', rotate: 0, colors: [{ pos: 0, color: '#000' }, { pos: 100, color: '#fff' }] },
    })).toEqual({ backgroundImage: 'radial-gradient(#000 0%,#fff 100%)' })
  })

  test('preserves image clipping and crop coordinates', () => {
    expect(getImageClip(image)).toMatchObject({ type: 'rect', radius: '18px', style: 'inset(0 round 18px)' })
    expect(getImagePosition(image)).toEqual({
      left: '-12.5%',
      top: '-33.333333333333336%',
      width: '125%',
      height: '166.66666666666669%',
    })
  })

  test('preserves line curves, markers, and dash geometry', () => {
    expect(getLinePath(line)).toBe('M0,0 Q50,20 100,100')
    expect(getLineRenderPath(line)).toBe('M3.7139067635410368,1.4855627054164147 Q50,20 98.94000211999364,98.30400339198982')
    expect(getLineDashArray(line)).toBe('20 10')
  })
})

describe('table renderer helpers', () => {
  test('hides every covered cell in a merged range', () => {
    const cell = (id: string, colspan = 1, rowspan = 1): TableCell => ({ id, colspan, rowspan, text: id })
    const data = [
      [cell('a', 2, 2), cell('b'), cell('c')],
      [cell('d'), cell('e'), cell('f')],
    ]
    expect([...getHiddenTableCells(data)]).toEqual(['0_1', '1_0', '1_1'])
  })

  test('preserves line breaks and spaces in static table markup', () => {
    expect(formatTableText('First line\nSecond line')).toBe('First&nbsp;line</br>Second&nbsp;line')
  })
})
