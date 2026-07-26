import { expect, test } from 'vitest'

import { collectBlobUrls } from '@/features/editor/editor-persistence'
import { importedAssetUrl, persistImportedAssets } from '@/features/editor/editor-pptx-import'
import { readMediaBlob } from '@/lib/deck-storage'

// A 1x1 PNG, which is all the shape of the value matters here.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

test('an imported asset becomes an object URL, not inline base64', () => {
  // Inlining base64 into the model is why a 23-slide deck persisted as 193 MB:
  // the bytes rode along in every save instead of living in the media store.
  const url = importedAssetUrl(PNG)

  expect(url.startsWith('blob:')).toBe(true)
  expect(url).not.toContain('base64')
  // Short enough that the model stays small whatever the asset weighs.
  expect(url.length).toBeLessThan(120)
})

test('the persistence layer finds it wherever it sits in the deck', () => {
  // collectBlobUrls matches by value shape rather than field name, so a fill
  // needs no allowlist entry to be captured, restored and garbage-collected.
  const deck = {
    slides: [{
      background: { image: { src: importedAssetUrl(PNG) }, type: 'image' },
      elements: [
        { id: 'a', pattern: importedAssetUrl(PNG), type: 'shape' },
        { elements: [{ id: 'c', src: importedAssetUrl(PNG), type: 'image' }], id: 'b', type: 'group' },
      ],
    }],
  }

  // The background, the shape fill, and an image nested inside a group.
  expect(collectBlobUrls(deck).size).toBe(3)
})

test('anything that is not base64 is left exactly as it was', () => {
  for (const source of ['https://example.com/a.png', 'blob:http://localhost/already', '']) {
    expect(importedAssetUrl(source)).toBe(source)
  }
})

test('the bytes reach the media store without waiting for a save', async () => {
  // Until they do, the object URL is the only handle on them and the save path
  // recovers them by fetching it. One dead URL there meant the deck was written
  // referencing bytes that existed nowhere, and the image was blank on reload.
  const url = importedAssetUrl(PNG)

  const failed = await persistImportedAssets()

  expect(failed).toEqual([])
  const stored = await readMediaBlob(url)
  expect(stored).toBeInstanceOf(Blob)
  expect((stored as Blob).size).toBeGreaterThan(60)
  expect((stored as Blob).type).toBe('image/png')
})

test('draining twice does not rewrite what has already been stored', async () => {
  importedAssetUrl(PNG)
  await persistImportedAssets()

  // Nothing pending, so nothing to report - and no deck-sized set of blobs kept
  // alive after the import that produced them.
  expect(await persistImportedAssets()).toEqual([])
})
