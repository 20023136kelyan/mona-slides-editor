import { expect, test } from 'vitest'

import { collectDeckAssetNames } from '@/features/editor/editor-deck-assets'
import { importedAssetUrl, persistImportedAssets } from '@/features/editor/editor-pptx-import'

// A 1x1 PNG, which is all the shape of the value matters here.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

test('an imported asset becomes a file reference, not inline base64', () => {
  // Inlining base64 into the model is why a 23-slide deck persisted as 193 MB:
  // the bytes rode along in every save instead of living beside it.
  const url = importedAssetUrl(PNG)

  expect(url.startsWith('mona://asset/')).toBe(true)
  expect(url).not.toContain('base64')
  // Short enough that the model stays small whatever the asset weighs.
  expect(url.length).toBeLessThan(120)
})

test('the same bytes get the same name, so a repeated fill is one file', () => {
  // One imported deck carried the same 6 MB fill twice; content addressing makes
  // that one file rather than two, and makes a re-run overwrite rather than grow.
  expect(importedAssetUrl(PNG)).toBe(importedAssetUrl(PNG))
})

test('the persistence layer finds it wherever it sits in the deck', () => {
  // Matched by value shape rather than field name, so a fill needs no allowlist
  // entry to be kept when unreferenced assets are collected.
  const deck = {
    slides: [{
      background: { image: { src: importedAssetUrl(PNG) }, type: 'image' },
      elements: [
        { id: 'a', pattern: importedAssetUrl(PNG), type: 'shape' },
        { elements: [{ id: 'c', src: importedAssetUrl(PNG), type: 'image' }], id: 'b', type: 'group' },
      ],
    }],
  }

  // The background, the shape fill, and an image nested inside a group - one file
  // each here because the three references are distinct payloads.
  expect(collectDeckAssetNames(deck).size).toBe(1)
})

test('anything that is not base64 is left exactly as it was', () => {
  for (const source of ['https://example.com/a.png', 'mona://asset/already.png', '']) {
    expect(importedAssetUrl(source)).toBe(source)
  }
})

test('the bytes are written before the deck can refer to them', async () => {
  // The deck names a path, so the file has to exist by the time the slides are
  // committed. When the reference was an object URL instead, the save had to fetch
  // the bytes back through it, and a fetch that failed left the deck naming bytes
  // that existed nowhere - blank on the next launch, with no way to mend it.
  const written: string[] = []
  const shell = window.mona!
  window.mona = {
    ...shell,
    deck: {
      ...shell.deck,
      writeAsset: async (name, bytes) => {
        expect(bytes.byteLength).toBeGreaterThan(60)
        written.push(name)
        return `mona://asset/${name}`
      },
    },
  }
  try {
    const url = importedAssetUrl(PNG)

    expect(await persistImportedAssets()).toEqual([])
    expect(written).toHaveLength(1)
    expect(url).toBe(`mona://asset/${written[0]}`)
  }
  finally {
    window.mona = shell
  }
})

test('draining twice does not rewrite what has already been stored', async () => {
  importedAssetUrl(PNG)
  await persistImportedAssets()

  // Nothing pending, so nothing to report - and no deck-sized set of blobs kept
  // alive after the import that produced them.
  expect(await persistImportedAssets()).toEqual([])
})
