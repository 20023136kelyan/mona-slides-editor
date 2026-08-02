import { describe, expect, it } from 'vitest'

import type { StructuredTextRun } from './model'
import { evaluatePowerPointField } from './powerpoint-fields'

const field = (
  fieldType: string,
  text = 'cached',
  language = 'en-US',
): StructuredTextRun => ({
  fieldType,
  kind: 'field',
  properties: { language },
  sourceId: `field-${fieldType}`,
  text,
})

const context = {
  dateTime: new Date('2026-08-02T16:28:34.000Z'),
  slideNumber: 42,
  timeZone: 'UTC',
}

describe('PowerPoint field evaluation', () => {
  it('evaluates slide numbers and every reserved date/time shape', () => {
    expect(evaluatePowerPointField(field('slidenum'), context)).toBe('42')
    expect(evaluatePowerPointField(field('datetime1'), context)).toBe('8/2/2026')
    expect(evaluatePowerPointField(field('datetime2'), context)).toBe('Sunday, August 2, 2026')
    expect(evaluatePowerPointField(field('datetime3'), context)).toBe('2 August 2026')
    expect(evaluatePowerPointField(field('datetime4'), context)).toBe('August 2, 2026')
    expect(evaluatePowerPointField(field('datetime5'), context)).toBe('2-Aug-26')
    expect(evaluatePowerPointField(field('datetime6'), context)).toBe('August 26')
    expect(evaluatePowerPointField(field('datetime7'), context)).toBe('Aug-26')
    expect(evaluatePowerPointField(field('datetime8'), context)).toBe('8/2/2026, 4:28 PM')
    expect(evaluatePowerPointField(field('datetime9'), context)).toBe('8/2/2026, 4:28:34 PM')
    expect(evaluatePowerPointField(field('datetime10'), context)).toBe('16:28')
    expect(evaluatePowerPointField(field('datetime11'), context)).toBe('16:28:34')
    expect(evaluatePowerPointField(field('datetime12'), context)).toBe('4:28 PM')
    expect(evaluatePowerPointField(field('datetime13'), context)).toBe('4:28:34 PM')
  })

  it('uses the run language for locale-sensitive fields', () => {
    expect(evaluatePowerPointField(field('datetime1', 'cached', 'en-GB'), context)).toBe('02/08/2026')
    expect(evaluatePowerPointField(field('datetimeFigureOut', 'cached', 'fr-FR'), context)).toBe('02/08/2026')
  })

  it('preserves cached text for custom types and invalid dates', () => {
    expect(evaluatePowerPointField(field('vendorCustom'), context)).toBe('cached')
    expect(evaluatePowerPointField(field('datetime4'), {
      ...context,
      dateTime: new Date(Number.NaN),
    })).toBe('cached')
  })
})
