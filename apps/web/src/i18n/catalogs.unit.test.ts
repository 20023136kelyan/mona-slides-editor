import { describe, expect, test } from 'vitest'

import enUS from '../../../../src/i18n/locales/en-US.json'
import zhCN from '../../../../src/i18n/locales/zh-CN.json'
import foundationEnUS from '@/i18n/foundation/en-US.json'
import foundationZhCN from '@/i18n/foundation/zh-CN.json'

const collectKeys = (value: unknown, prefix = ''): string[] => {
  if (Array.isArray(value)) return [prefix]
  if (!value || typeof value !== 'object') return [prefix]

  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return collectKeys(child, path)
  })
}

describe('shared locale catalogs', () => {
  test('keeps English and Chinese keys in exact parity', () => {
    expect(collectKeys(zhCN).sort()).toEqual(collectKeys(enUS).sort())
    expect(collectKeys(foundationZhCN).sort()).toEqual(collectKeys(foundationEnUS).sort())
  })
})
