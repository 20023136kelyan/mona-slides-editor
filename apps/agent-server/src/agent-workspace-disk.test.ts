import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { AgentWorkspace } from './agent-workspace-disk.js'
import type { DeckSnapshot } from './agent-workspace.js'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

const created: AgentWorkspace[] = []

/** Records which URLs were asked for, and in how many calls. */
const recordingFetcher = () => {
  const asked: string[] = []
  return {
    asked,
    fetchAsset: async (url: string) => {
      asked.push(url)
      return { base64: PNG, mediaType: 'image/png' }
    },
  }
}

const open = async (snapshot: Partial<DeckSnapshot> = {}, revision = 'mona-7k2x'): Promise<AgentWorkspace> => {
  const workspace = await AgentWorkspace.create({
    fetchAsset: async () => ({ base64: PNG, mediaType: 'image/png' }),
    revision,
    snapshot: {
      assets: { 'blob:http://x/one': { mediaType: 'image/png' } },
      slides: [
        { elements: [{ id: 'e1', src: 'blob:http://x/one', type: 'image' }], id: 's1', title: 'Cover' },
        { elements: [], id: 's2' },
      ],
      title: 'Deck',
      ...snapshot,
    },
  })
  created.push(workspace)
  return workspace
}

afterEach(async () => {
  await Promise.all(created.splice(0).map(workspace => workspace.dispose()))
})

describe('AgentWorkspace', () => {
  it('lays the deck out as files the ordinary tools can reach', async () => {
    const workspace = await open()

    expect(await readdir(join(workspace.root, 'deck'))).toEqual(expect.arrayContaining(['assets', 'deck.json', 'slides']))
    expect(await readdir(join(workspace.root, 'deck/slides'))).toEqual(['01.json', '02.json'])
    // Real bytes, so Read on the image works and the model can look at it.
    expect((await readFile(join(workspace.root, 'deck/assets/image-1.png'))).byteLength).toBeGreaterThan(60)
  })

  it('sits somewhere with no .claude ancestor to inherit', async () => {
    const workspace = await open()
    // Measured, not assumed: project settings are discovered by walking up from
    // cwd, so a workspace under a real project would pull in its skills.
    expect(workspace.root.includes('.claude')).toBe(false)
  })

  it('round-trips an untouched deck, assets and all', async () => {
    const workspace = await open()

    const back = await workspace.read()

    expect(back.slides.map(slide => slide.id)).toEqual(['s1', 's2'])
    expect(back.slides[0]).toMatchObject({ elements: [{ src: 'blob:http://x/one' }] })
    expect(back.invalid).toEqual([])
    expect(back.addedAssets).toEqual([])
  })

  it('reads back what the agent actually edited', async () => {
    const workspace = await open()
    const slide = join(workspace.root, 'deck/slides/01.json')
    const parsed = JSON.parse(await readFile(slide, 'utf8')) as { title: string }
    await writeFile(slide, JSON.stringify({ ...parsed, title: 'Opening' }))

    const back = await workspace.read()

    expect(back.slides[0]?.title).toBe('Opening')
  })

  it('reports unparseable JSON instead of committing half a slide', async () => {
    const workspace = await open()
    await writeFile(join(workspace.root, 'deck/slides/02.json'), '{ "id": "s2", ')

    const back = await workspace.read()

    // The one failure this boundary exists to prevent is a malformed deck
    // reaching the renderer.
    expect(back.invalid).toEqual(['deck/slides/02.json'])
    expect(back.slides.map(slide => slide.id)).toEqual(['s1'])
  })

  it('treats a deleted slide file as a deletion, not a fault', async () => {
    const workspace = await open()
    await writeFile(
      join(workspace.root, 'deck/deck.json'),
      JSON.stringify({ slides: [{ file: 'slides/01.json', id: 's1' }, { file: 'slides/99.json', id: 'gone' }] }),
    )

    const back = await workspace.read()

    expect(back.invalid).toEqual([])
    expect(back.slides.map(slide => slide.id)).toEqual(['s1'])
  })

  it('hands over the bytes of an asset the agent created', async () => {
    const workspace = await open()
    await mkdir(join(workspace.root, 'deck/assets'), { recursive: true })
    await writeFile(join(workspace.root, 'deck/assets/chart.png'), Buffer.from(PNG, 'base64'))

    const added = await workspace.addedAsset('assets/chart.png')

    expect(added?.mediaType).toBe('image/png')
    expect(added?.base64).toBe(PNG)
  })

  it('refuses an asset path that climbs out of the workspace', async () => {
    const workspace = await open()

    // The path comes from JSON the agent wrote, so it is untrusted input. Without
    // the check this reads whatever the server process can read.
    expect(await workspace.addedAsset('../../../../../../etc/passwd')).toBeUndefined()
    expect(await workspace.addedAsset('assets/../../../../etc/hosts')).toBeUndefined()
  })

  it('keeps the revision to itself', async () => {
    const workspace = await open({}, 'mona-9zqp')

    expect(workspace.revision).toBe('mona-9zqp')
    // Not on disk: a value the agent can edit is not a staleness check.
    expect(await readFile(join(workspace.root, 'deck/deck.json'), 'utf8')).not.toContain('mona-9zqp')
  })
})

describe('re-taking the workspace', () => {
  it('becomes the new deck at the same path', async () => {
    const workspace = await open()
    const root = workspace.root

    await workspace.take({
      fetchAsset: async () => undefined,
      revision: 'mona-later',
      snapshot: { assets: {}, slides: [{ elements: [], id: 'fresh', title: 'New' }], title: 'Renamed' },
    })

    // Same path, because the subprocess's cwd is fixed once it starts.
    expect(workspace.root).toBe(root)
    expect(workspace.revision).toBe('mona-later')
    const back = await workspace.read()
    expect(back.slides.map(slide => slide.id)).toEqual(['fresh'])
    expect(back.title).toBe('Renamed')
  })

  it('does not leave the old slides behind as readable files', async () => {
    const workspace = await open()

    await workspace.take({
      fetchAsset: async () => undefined,
      revision: 'mona-later',
      snapshot: { assets: {}, slides: [{ elements: [], id: 'only' }] },
    })

    // A slide the user deleted must not survive as a file the agent still reads.
    expect(await readdir(join(workspace.root, 'deck/slides'))).toEqual(['01.json'])
    expect(existsSync(join(workspace.root, 'deck/assets/image-1.png'))).toBe(false)
  })
})

describe('fetching assets', () => {
  it('asks for each asset on its own, once per distinct URL', async () => {
    const { asked, fetchAsset } = recordingFetcher()
    const workspace = await AgentWorkspace.create({
      fetchAsset,
      revision: 'mona-1',
      snapshot: {
        assets: {
          'blob:http://x/one': { mediaType: 'image/png' },
          'blob:http://x/two': { mediaType: 'image/png' },
        },
        slides: [
          { elements: [{ id: 'a', src: 'blob:http://x/one', type: 'image' }], id: 's1' },
          // The same asset again, plus a second one.
          { elements: [
            { id: 'b', src: 'blob:http://x/one', type: 'image' },
            { id: 'c', src: 'blob:http://x/two', type: 'image' },
          ], id: 's2' },
        ],
      },
    })
    created.push(workspace)

    // One request each, never one frame carrying the deck: 342 MB in a single
    // frame against a 100 MiB limit is what closed the socket before the fix.
    expect(asked).toEqual(['blob:http://x/one', 'blob:http://x/two'])
    expect(existsSync(join(workspace.root, 'deck/assets/image-1.png'))).toBe(true)
    expect(existsSync(join(workspace.root, 'deck/assets/image-2.png'))).toBe(true)
  })

  it('loses one image rather than the whole workspace when a fetch fails', async () => {
    const workspace = await AgentWorkspace.create({
      fetchAsset: async url => (url.endsWith('two') ? undefined : { base64: PNG, mediaType: 'image/png' }),
      revision: 'mona-1',
      snapshot: {
        assets: {
          'blob:http://x/one': { mediaType: 'image/png' },
          'blob:http://x/two': { mediaType: 'image/png' },
        },
        slides: [{ elements: [
          { id: 'a', src: 'blob:http://x/one', type: 'image' },
          { id: 'b', src: 'blob:http://x/two', type: 'image' },
        ], id: 's1' }],
      },
    })
    created.push(workspace)

    expect(existsSync(join(workspace.root, 'deck/assets/image-1.png'))).toBe(true)
    // A reference with no file, which the agent can see and report.
    expect(existsSync(join(workspace.root, 'deck/assets/image-2.png'))).toBe(false)
    expect((await workspace.read()).slides).toHaveLength(1)
  })

  it('survives a fetcher that throws', async () => {
    const workspace = await AgentWorkspace.create({
      fetchAsset: async () => { throw new Error('socket closed') },
      revision: 'mona-1',
      snapshot: {
        assets: { 'blob:http://x/one': { mediaType: 'image/png' } },
        slides: [{ elements: [{ id: 'a', src: 'blob:http://x/one', type: 'image' }], id: 's1' }],
      },
    })
    created.push(workspace)

    expect((await workspace.read()).slides.map(slide => slide.id)).toEqual(['s1'])
  })
})
