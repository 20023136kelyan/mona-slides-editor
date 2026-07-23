import { describe, expect, test } from 'vitest'

import enUS from '@/i18n/shared/en-US.json'
import zhCN from '@/i18n/shared/zh-CN.json'
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

const collectSingleBracePlaceholders = (value: unknown, prefix = ''): string[] => {
  if (typeof value === 'string') {
    return /(?<!\{)\{[a-zA-Z]+\}(?!\})/.test(value) ? [prefix] : []
  }
  if (!value || typeof value !== 'object') return []

  return Object.entries(value).flatMap(([key, child]) =>
    collectSingleBracePlaceholders(child, prefix ? `${prefix}.${key}` : key))
}

describe('shared locale catalogs', () => {
  test('keeps English and Chinese catalog keys synchronized', () => {
    expect(collectKeys(zhCN).sort()).toEqual(collectKeys(enUS).sort())
    expect(collectKeys(foundationZhCN).sort()).toEqual(collectKeys(foundationEnUS).sort())
  })

  test('uses i18next double-brace placeholders only (no vue-i18n leftovers)', () => {
    for (const catalog of [enUS, zhCN, foundationEnUS, foundationZhCN]) {
      expect(collectSingleBracePlaceholders(catalog)).toEqual([])
    }
  })
})
