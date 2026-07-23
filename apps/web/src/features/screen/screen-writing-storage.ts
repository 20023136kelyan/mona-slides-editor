import Dexie, { type EntityTable } from 'dexie'

import { createPresentationId } from '@mona/presentation-core'

import {
  LEGACY_WRITING_DATABASE_PREFIX,
  LEGACY_WRITING_DATABASES_KEY,
} from '@/lib/legacy-compatibility'

const DATABASE_PREFIX = 'Mona'
const DISCARDED_DATABASES_KEY = 'MONA_DISCARDED_DB'
const databaseId = createPresentationId(10)

interface WritingBoardImage {
  dataURL: string
  id: string
}

const database = new Dexie(`${DATABASE_PREFIX}_${databaseId}_${Date.now()}`) as Dexie & {
  writingBoardImgs: EntityTable<WritingBoardImage, 'id'>
}

database.version(1).stores({
  writingBoardImgs: 'id',
})

const readDiscardedIds = (): string[] => {
  // A corrupt localStorage value must not abort cleanup or the unload marker.
  const readKey = (key: string) => {
    try {
      const value = localStorage.getItem(key)
      const parsed: unknown = value ? JSON.parse(value) : []
      return Array.isArray(parsed) ? parsed.filter(entry => typeof entry === 'string') : []
    }
    catch {
      return []
    }
  }
  return [...new Set([...readKey(DISCARDED_DATABASES_KEY), ...readKey(LEGACY_WRITING_DATABASES_KEY)])]
}

const deleteDiscardedDatabases = async () => {
  const now = Date.now()
  const discardedIds = readDiscardedIds()
  const names = await Dexie.getDatabaseNames()
  const discardedNames = names.filter(name => {
    if (!name.startsWith(`${DATABASE_PREFIX}_`) && !name.startsWith(`${LEGACY_WRITING_DATABASE_PREFIX}_`)) return false
    const [prefix, id, time] = name.split('_')
    if ((prefix !== DATABASE_PREFIX && prefix !== LEGACY_WRITING_DATABASE_PREFIX) || !id || !time) return true
    if (discardedIds.includes(id)) return true
    return now - Number(time) >= 1000 * 60 * 60 * 12
  })
  await Promise.all(discardedNames.map(name => Dexie.delete(name)))
  localStorage.removeItem(DISCARDED_DATABASES_KEY)
  localStorage.removeItem(LEGACY_WRITING_DATABASES_KEY)
}

if (new URLSearchParams(window.location.search).get('mode') !== 'audience') void deleteDiscardedDatabases()

window.addEventListener('beforeunload', () => {
  const discardedIds = readDiscardedIds()
  discardedIds.push(databaseId)
  localStorage.setItem(DISCARDED_DATABASES_KEY, JSON.stringify(discardedIds))
})

export const readWritingBoardImage = async (id: string) => {
  const images = await database.writingBoardImgs.where('id').equals(id).toArray()
  return images[0]?.dataURL || ''
}

export const writeWritingBoardImage = async (id: string, dataURL: string) => {
  // put() is atomic upsert; a read-then-add pair can race into a
  // ConstraintError when two stroke-end persists overlap.
  await database.writingBoardImgs.put({ dataURL, id })
}
