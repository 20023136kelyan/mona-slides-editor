import Dexie, { type EntityTable } from 'dexie'

export interface RecentOnlinePhoto {
  height: number
  id: string
  src: string
  usedAt: number
  width: number
}

const database = new Dexie('mona-online-photos') as Dexie & {
  recent: EntityTable<RecentOnlinePhoto, 'id'>
}

database.version(1).stores({
  recent: 'id, usedAt',
})

const MAX_RECENT = 40

export const rememberOnlinePhoto = async (photo: {
  height: number
  id: number | string
  src: string
  width: number
}): Promise<void> => {
  await database.recent.put({
    id: String(photo.id),
    src: photo.src,
    width: photo.width,
    height: photo.height,
    usedAt: Date.now(),
  })
  const overflow = await database.recent.orderBy('usedAt').reverse().offset(MAX_RECENT).primaryKeys()
  if (overflow.length) await database.recent.bulkDelete(overflow)
}

export const listRecentOnlinePhotos = (): Promise<RecentOnlinePhoto[]> =>
  database.recent.orderBy('usedAt').reverse().toArray()

export const onlinePhotosDatabase = database
