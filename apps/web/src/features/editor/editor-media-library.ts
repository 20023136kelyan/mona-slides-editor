import Dexie, { type EntityTable } from 'dexie'

import { createPresentationId } from '@mona/presentation-core'

export type MediaLibraryKind = 'image' | 'video' | 'audio'

export interface MediaLibraryItem {
  blob: Blob
  createdAt: number
  height?: number
  id: string
  kind: MediaLibraryKind
  mime: string
  name: string
  width?: number
}

const database = new Dexie('mona-media-library') as Dexie & {
  items: EntityTable<MediaLibraryItem, 'id'>
}

database.version(1).stores({
  items: 'id, kind, name, createdAt',
})

const kindFromMime = (mime: string): MediaLibraryKind | null => {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return null
}

const readImageSize = (blob: Blob): Promise<{ height: number; width: number } | undefined> => {
  if (!blob.type.startsWith('image/')) return Promise.resolve(undefined)
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      resolve({ height: image.naturalHeight, width: image.naturalWidth })
      URL.revokeObjectURL(url)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(undefined)
    }
    image.src = url
  })
}

export const addMediaLibraryFile = async (file: File): Promise<MediaLibraryItem | null> => {
  const kind = kindFromMime(file.type)
  if (!kind) return null
  const size = await readImageSize(file)
  const item: MediaLibraryItem = {
    id: createPresentationId(12),
    kind,
    name: file.name || `${kind}-${Date.now()}`,
    mime: file.type || 'application/octet-stream',
    createdAt: Date.now(),
    blob: file,
    ...size,
  }
  await database.items.put(item)
  return item
}

export const listMediaLibraryItems = (kind?: MediaLibraryKind): Promise<MediaLibraryItem[]> => {
  if (!kind) return database.items.orderBy('createdAt').reverse().toArray()
  return database.items.where('kind').equals(kind).reverse().sortBy('createdAt')
}

export const searchMediaLibraryItems = async (
  query: string,
  kind?: MediaLibraryKind,
): Promise<MediaLibraryItem[]> => {
  const needle = query.trim().toLowerCase()
  const items = await listMediaLibraryItems(kind)
  if (!needle) return items
  return items.filter(item => item.name.toLowerCase().includes(needle) || item.mime.toLowerCase().includes(needle))
}

export const getMediaLibraryItem = (id: string): Promise<MediaLibraryItem | undefined> =>
  database.items.get(id)

export const deleteMediaLibraryItem = (id: string): Promise<void> =>
  database.items.delete(id).then(() => undefined)

export const mediaLibraryDatabase = database
