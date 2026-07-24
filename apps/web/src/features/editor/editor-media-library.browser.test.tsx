import { afterEach, beforeEach, expect, test } from 'vitest'

import {
  addMediaLibraryFile,
  deleteMediaLibraryItem,
  listMediaLibraryItems,
  mediaLibraryDatabase,
  searchMediaLibraryItems,
} from '@/features/editor/editor-media-library'

beforeEach(async () => {
  await mediaLibraryDatabase.items.clear()
})

afterEach(async () => {
  await mediaLibraryDatabase.items.clear()
})

test('stores uploaded files by kind and supports search', async () => {
  const image = await addMediaLibraryFile(new File(['png'], 'hero.png', { type: 'image/png' }))
  const video = await addMediaLibraryFile(new File(['mp4'], 'demo.mp4', { type: 'video/mp4' }))
  const unsupported = await addMediaLibraryFile(new File(['pdf'], 'notes.pdf', { type: 'application/pdf' }))

  expect(image?.kind).toBe('image')
  expect(video?.kind).toBe('video')
  expect(unsupported).toBeNull()

  await expect(listMediaLibraryItems('image')).resolves.toHaveLength(1)
  await expect(searchMediaLibraryItems('demo')).resolves.toEqual([expect.objectContaining({ name: 'demo.mp4' })])
  await expect(searchMediaLibraryItems('', 'audio')).resolves.toEqual([])

  await deleteMediaLibraryItem(image!.id)
  await expect(listMediaLibraryItems()).resolves.toHaveLength(1)
})
