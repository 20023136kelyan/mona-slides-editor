import { describe, expect, it } from 'vitest'

import { planWorkspace, readWorkspace, type DeckSnapshot } from './agent-workspace.js'

const snapshot = (overrides: Partial<DeckSnapshot> = {}): DeckSnapshot => ({
  assets: { 'blob:http://x/one': { mediaType: 'image/png' } },
  slides: [{ elements: [], id: 's1', title: 'Cover' }],
  title: 'Deck',
  ...overrides,
})

/** Reads a plan back the way the filesystem would. */
const readerFor = (plan: ReturnType<typeof planWorkspace>) => (path: string): unknown => {
  const file = plan.files.find(candidate => candidate.path === path)
  return typeof file?.data === 'string' ? JSON.parse(file.data) : undefined
}

const text = (plan: ReturnType<typeof planWorkspace>, path: string): string => {
  const file = plan.files.find(candidate => candidate.path === path)
  return typeof file?.data === 'string' ? file.data : ''
}

describe('planWorkspace', () => {
  it('writes one file per slide, in an order Glob and ls agree with', () => {
    const plan = planWorkspace(snapshot({
      slides: Array.from({ length: 12 }, (_, index) => ({ elements: [], id: `s${index}` })),
    }))

    const slideFiles = plan.files.map(file => file.path).filter(path => path.startsWith('deck/slides/'))
    expect(slideFiles.slice(0, 3)).toEqual(['deck/slides/01.json', 'deck/slides/02.json', 'deck/slides/03.json'])
    // Zero-padded so lexical order is deck order - an agent globbing the
    // directory gets slide 2 before slide 10.
    expect(slideFiles.at(-1)).toBe('deck/slides/12.json')
  })

  it('replaces an asset URL with the path of the file that will hold its bytes', () => {
    const plan = planWorkspace(snapshot({
      slides: [{ elements: [{ id: 'e1', src: 'blob:http://x/one', type: 'image' }], id: 's1' }],
    }))

    // The model reads a path, not 30 MB of base64 spliced into its context.
    expect(text(plan, 'deck/slides/01.json')).toContain('"assets/image-1.png"')
    expect(text(plan, 'deck/slides/01.json')).not.toContain('blob:')
    expect(plan.assets).toEqual([{ path: 'deck/assets/image-1.png', url: 'blob:http://x/one' }])
    expect(plan.assetSources.get('assets/image-1.png')).toBe('blob:http://x/one')
  })

  it('plans assets rather than carrying them, so no frame holds the whole deck', () => {
    const plan = planWorkspace(snapshot({
      slides: [{ elements: [{ id: 'e1', src: 'blob:http://x/one', type: 'image' }], id: 's1' }],
    }))

    // The measured failure: 342 MB of base64 in a single frame against a 100 MiB
    // socket limit, which closed the connection before the agent had started.
    expect(plan.files.every(file => typeof file.data === 'string')).toBe(true)
    expect(plan.files.some(file => file.path.startsWith('deck/assets/'))).toBe(false)
  })

  it('finds an asset by the shape of the value, not the name of the field', () => {
    // `pattern` is a shape fill, nested inside a group. Nobody listed either, and
    // an allowlist of field names is exactly how 191 MB of fills went unnoticed.
    const plan = planWorkspace(snapshot({
      slides: [{
        background: { image: { src: 'blob:http://x/one' }, type: 'image' },
        elements: [{ elements: [{ id: 'inner', pattern: 'blob:http://x/two', type: 'shape' }], id: 'g', type: 'group' }],
        id: 's1',
      }],
      assets: {
        'blob:http://x/one': { mediaType: 'image/png' },
        'blob:http://x/two': { mediaType: 'image/jpeg' },
      },
    }))

    const planned = plan.assets.map(asset => asset.path)
    expect(planned).toContain('deck/assets/image-1.png')
    // Named after the field that referenced it, and typed by its own media type.
    expect(planned).toContain('deck/assets/pattern-1.jpg')
  })

  it('writes a shared asset once, however many slides reference it', () => {
    const plan = planWorkspace(snapshot({
      slides: [
        { elements: [{ id: 'a', src: 'blob:http://x/one', type: 'image' }], id: 's1' },
        { elements: [{ id: 'b', src: 'blob:http://x/one', type: 'image' }], id: 's2' },
      ],
    }))

    // One imported deck carried the same 6 MB fill twice; the workspace does not.
    expect(plan.assets).toHaveLength(1)
    expect(text(plan, 'deck/slides/02.json')).toContain('"assets/image-1.png"')
  })

  it('keeps the reference when the browser could not supply the bytes', () => {
    const plan = planWorkspace(snapshot({
      assets: {},
      slides: [{ elements: [{ id: 'a', src: 'blob:http://x/gone', type: 'image' }], id: 's1' }],
    }))

    // A dangling path the model can see beats a silent deletion it cannot.
    expect(plan.assets).toEqual([])
    expect(text(plan, 'deck/slides/01.json')).toContain('"assets/image-1.bin"')
  })

  it('never writes the revision into the workspace', () => {
    // Staleness is checked against the server's own copy. A revision on disk is a
    // number the agent could edit to talk its way past the check.
    const plan = planWorkspace(snapshot())
    expect(text(plan, 'deck/deck.json')).not.toContain('revision')
  })
})

describe('readWorkspace', () => {
  it('round-trips a deck the agent never touched', () => {
    const original = snapshot({
      slides: [
        { elements: [{ id: 'a', src: 'blob:http://x/one', type: 'image' }], id: 's1', title: 'Cover' },
        { elements: [], id: 's2' },
      ],
    })
    const plan = planWorkspace(original)

    const back = readWorkspace({ assetSources: plan.assetSources, readJson: readerFor(plan) })

    expect(back.title).toBe('Deck')
    expect(back.slides.map(slide => slide.id)).toEqual(['s1', 's2'])
    // Resolved to the blob it came from, so an untouched fill is not re-uploaded.
    expect(back.slides[0]).toMatchObject({ elements: [{ src: 'blob:http://x/one' }] })
    expect(back.addedAssets).toEqual([])
  })

  it('reports an asset the agent added rather than resolving it', () => {
    const plan = planWorkspace(snapshot())
    const edited = (path: string): unknown => (
      path === 'deck/slides/01.json'
        ? { elements: [{ id: 'new', src: 'assets/chart.png', type: 'image' }], id: 's1' }
        : readerFor(plan)(path)
    )

    const back = readWorkspace({ assetSources: plan.assetSources, readJson: edited })

    // The caller has to ingest the bytes before the deck can reference them.
    expect(back.addedAssets).toEqual(['assets/chart.png'])
    expect(back.slides[0]).toMatchObject({ elements: [{ src: 'assets/chart.png' }] })
  })

  it('takes slide order from the index, so reordering deck.json reorders the deck', () => {
    const plan = planWorkspace(snapshot({
      slides: [{ elements: [], id: 's1' }, { elements: [], id: 's2' }, { elements: [], id: 's3' }],
    }))
    const reordered = (path: string): unknown => {
      const value = readerFor(plan)(path)
      if (path !== 'deck/deck.json') return value
      const deck = value as { slides: unknown[] }
      return { ...deck, slides: [deck.slides[2], deck.slides[0], deck.slides[1]] }
    }

    const back = readWorkspace({ assetSources: plan.assetSources, readJson: reordered })

    expect(back.slides.map(slide => slide.id)).toEqual(['s3', 's1', 's2'])
  })

  it('skips a slide whose file the agent deleted instead of inventing one', () => {
    const plan = planWorkspace(snapshot({
      slides: [{ elements: [], id: 's1' }, { elements: [], id: 's2' }],
    }))
    const missing = (path: string): unknown => (
      path === 'deck/slides/02.json' ? undefined : readerFor(plan)(path)
    )

    const back = readWorkspace({ assetSources: plan.assetSources, readJson: missing })

    // Half-written state must not reach the renderer as an empty slide.
    expect(back.slides.map(slide => slide.id)).toEqual(['s1'])
  })
})
