import { describe, expect, it, vi } from 'vitest'
import type { PresentationState, Slide } from '@mona/presentation-core'

import { validateAgentSlides } from '@/features/editor/agent/agent-deck-validator'
import { applyAgentWorkspace, buildDeckSnapshot, readAssetBytes } from '@/features/editor/agent/agent-workspace-client'
import { getAgentDocumentRevision } from '@/features/editor/agent/agent-revision'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

/**
 * The browser project, not the unit one: committing sanitises through DOMPurify,
 * and the snapshot reads asset bytes through `fetch` on an object URL.
 */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

const textElement = (id: string, content: string) => ({
  content,
  defaultColor: '#18181b',
  defaultFontName: 'Arial',
  height: 40,
  id,
  left: 10,
  lineHeight: 1.2,
  rotate: 0,
  top: 10,
  type: 'text' as const,
  width: 200,
})

const presentation = (slides: Slide[]): PresentationState => ({
  slideIndex: 0,
  slides,
  templates: [],
  theme: {
    backgroundColor: '#fff',
    fontColor: '#18181b',
    fontName: 'Arial',
    outline: { color: '#000', style: 'solid', width: 1 },
    shadow: { blur: 0, color: '#000', h: 0, v: 0 },
    themeColors: ['#6d5dfc'],
  },
  title: 'Agent fixture',
  viewportRatio: 0.5625,
  viewportSize: 1000,
})

const base = presentation([{ elements: [textElement('t1', 'TEAM 5')], id: 'slide-1', title: 'Cover' }])

/** Just enough runtime to record what a commit was asked to do. */
const runtimeFor = (state: PresentationState, ok = true) => {
  const commits: { historyKey?: string; transaction: unknown }[] = []
  const runtime = {
    commitTransaction: vi.fn<(transaction: unknown, options?: { historyKey?: string }) => { ok: boolean; reason?: string }>((transaction, options) => {
      commits.push({ historyKey: options?.historyKey, transaction })
      return ok ? { ok: true } : { ok: false, reason: 'store said no' }
    }),
    store: { getState: () => ({ presentation: state, session: { activeElementIds: [] } }) },
  } as unknown as EditorRuntime
  return { commits, runtime }
}

describe('buildDeckSnapshot', () => {
  it('describes assets without carrying them', async () => {
    const blob = new Blob([Uint8Array.from(atob(PNG), char => char.charCodeAt(0))], { type: 'image/png' })
    // The deck refers to a file; `fetch` resolves it through the shell's own
    // protocol handler in the real application, and through this stub here.
    const url = 'mona://asset/fixture.png'
    const realFetch = window.fetch
    window.fetch = (async (input: RequestInfo | URL) => {
      const requested = input instanceof Request ? input.url : String(input)
      return requested === url
        ? new Response(blob, { headers: { 'content-type': 'image/png' } })
        : realFetch(input)
    }) as typeof window.fetch
    try {
      const snapshot = await buildDeckSnapshot(presentation([{
        elements: [{ ...textElement('i1', ''), src: url, type: 'image' }] as unknown as Slide['elements'],
        id: 'slide-1',
      }]))

      expect(snapshot.assets[url]).toEqual({ byteLength: blob.size, mediaType: 'image/png' })
      // The measured failure this prevents: a deck's images came to 342 MB of
      // base64 in one frame, against a 100 MiB socket limit, and the connection
      // closed before the agent had started.
      expect(JSON.stringify(snapshot)).not.toContain(PNG)
      // Fetched on their own instead.
      expect(await readAssetBytes(url)).toEqual({ base64: PNG, mediaType: 'image/png' })
    }
    finally {
      window.fetch = realFetch
    }
  })

  it('reports a dead asset as absent rather than throwing', async () => {
    const url = URL.createObjectURL(new Blob(['x']))
    URL.revokeObjectURL(url)
    expect(await readAssetBytes(url)).toBeUndefined()
  })

  it('survives a revoked object URL rather than failing the whole snapshot', async () => {
    const url = URL.createObjectURL(new Blob(['x']))
    URL.revokeObjectURL(url)

    const snapshot = await buildDeckSnapshot(presentation([{
      elements: [{ ...textElement('i1', ''), src: url, type: 'image' }] as unknown as Slide['elements'],
      id: 'slide-1',
    }]))

    // One dead asset must not cost the agent the other 22 slides.
    expect(snapshot.assets[url]).toBeUndefined()
    expect(snapshot.slides).toHaveLength(1)
  })

  it('reports the revision the workspace will be checked against', async () => {
    const snapshot = await buildDeckSnapshot(base)
    expect(snapshot.revision).toBe(getAgentDocumentRevision(base))
  })
})

describe('applyAgentWorkspace', () => {
  const edited = [{ elements: [textElement('t1', 'TEAM FIVE')], id: 'slide-1', title: 'Cover' }]

  it('commits a whole run as one undo entry', async () => {
    const { commits, runtime } = runtimeFor(base)

    const result = await applyAgentWorkspace(
      { expectedRevision: getAgentDocumentRevision(base), explanation: 'Renamed the label', slides: edited },
      runtime,
    )

    expect(result).toMatchObject({ applied: true, slideCount: 1 })
    // The shared history key is what collapses a conversation to a single undo.
    expect(commits[0]?.historyKey).toBe('mona-agent-run')
    expect(commits[0]?.transaction).toMatchObject({ label: 'Renamed the label' })
  })

  it('refuses a stale workspace instead of clobbering the edit it never saw', async () => {
    const { commits, runtime } = runtimeFor(base)

    await expect(applyAgentWorkspace(
      { expectedRevision: 'mona-somethingelse', slides: edited },
      runtime,
    )).rejects.toThrow(/changed while you were working/)

    // Nothing at all committed: a copy cannot be reconciled with unseen edits.
    expect(commits).toHaveLength(0)
  })

  it('ingests an asset the agent created and points the deck at it', async () => {
    const { commits, runtime } = runtimeFor(base)
    // The shared fake returns a loadable URL so images render in tests; here the
    // shape is the point, so it answers the way the real shell does.
    const shell = window.mona!
    window.mona = {
      ...shell,
      deck: { ...shell.deck, writeAsset: async name => `mona://asset/${name}` },
    }
    try {
      await applyAgentWorkspace({
        addedAssets: { 'assets/chart.png': { base64: PNG, mediaType: 'image/png' } },
        expectedRevision: getAgentDocumentRevision(base),
        slides: [{
          elements: [{ ...textElement('i1', ''), src: 'assets/chart.png', type: 'image' }],
          id: 'slide-1',
        }] as unknown as Slide[],
      }, runtime)

      const committed = JSON.stringify(commits[0]?.transaction)
      // The workspace path is gone; the file the shell wrote took its place.
      expect(committed).not.toContain('assets/chart.png')
      expect(committed).toContain('mona://asset/')
    }
    finally {
      window.mona = shell
    }
  })

  it('names the fix when the agent references a web image', async () => {
    const { runtime } = runtimeFor(base)

    await expect(applyAgentWorkspace({
      expectedRevision: getAgentDocumentRevision(base),
      slides: [{
        elements: [{ ...textElement('i1', ''), src: 'https://example.com/photo.png', type: 'image' }],
        id: 'slide-1',
      }] as unknown as Slide[],
    }, runtime)).rejects.toThrow(/Save the image into deck\/assets\//)
  })
})

describe('validateAgentSlides', () => {
  it('refuses to leave the deck with no slides', () => {
    expect(() => validateAgentSlides(base, { slides: [] })).toThrow(/must keep at least one/)
  })

  it('catches a duplicated slide id, naming the slide', () => {
    expect(() => validateAgentSlides(base, {
      slides: [
        { elements: [], id: 'slide-1' },
        { elements: [], id: 'slide-1', title: 'Copy' },
      ],
    })).toThrow(/Slide "Copy" repeats the id "slide-1"/)
  })

  it('catches a slide the agent gave no id', () => {
    // Common when a slide is created by hand rather than copied.
    expect(() => validateAgentSlides(base, {
      slides: [{ elements: [], title: 'New' }] as unknown as Slide[],
    })).toThrow(/Keep the id the slide was read with/)
  })

  it('catches geometry that would break the renderer, naming the element', () => {
    expect(() => validateAgentSlides(base, {
      slides: [{ elements: [{ ...textElement('t1', 'x'), width: 0 }], id: 'slide-1' }],
    })).toThrow(/element t1 must have positive dimensions/)
  })

  it('sets the title through the deck, and only when it changed', () => {
    const unchanged = validateAgentSlides(base, { slides: base.slides, title: 'Agent fixture' })
    expect(unchanged.commands.map(command => command.type)).toEqual(['presentation.slides.replace'])

    const renamed = validateAgentSlides(base, { slides: base.slides, title: 'Q3 review' })
    expect(renamed.commands.map(command => command.type))
      .toEqual(['presentation.slides.replace', 'presentation.title.set'])
  })
})

describe('the blank-label footgun, at the new boundary', () => {
  const shapeSlides = (text: unknown): Slide[] => [{
    elements: [{
      fill: '#eee',
      height: 40,
      id: 'badge',
      left: 10,
      path: 'M 0 0 L 200 0 L 200 200 L 0 200 Z',
      rotate: 0,
      text,
      top: 10,
      type: 'shape',
      viewBox: [200, 200],
      width: 120,
    }],
    id: 'slide-1',
  }] as unknown as Slide[]

  const withShape = presentation(shapeSlides({
    align: 'middle',
    content: 'TEAM 5',
    defaultColor: '#123456',
    defaultFontName: 'Inter',
  }))

  it('wraps a bare string a hand-edited slide file put in text', () => {
    // Editing slide JSON directly makes this likelier than the old program did:
    // `"text": "TEAM FIVE"` is the obvious thing to write, applied cleanly, and
    // rendered a shape with nothing visible on it.
    const transaction = validateAgentSlides(withShape, { slides: shapeSlides('TEAM FIVE') })

    const committed = transaction.commands[0] as unknown as { slides: { elements: { text: Record<string, string> }[] }[] }
    const shapeText = committed.slides[0]?.elements[0]?.text
    expect(shapeText?.content).toBe('TEAM FIVE')
    // The element's own styling survives the coercion.
    expect(shapeText?.defaultColor).toBe('#123456')
    expect(shapeText?.defaultFontName).toBe('Inter')
  })

  it('maps a stray text field on a text element to its content', () => {
    // A text element is the other way round: its copy is `content`, and there is
    // no `text` field to set. Writing one would have been silently dropped.
    const withText = presentation([{ elements: [textElement('t1', 'Before')], id: 'slide-1' }])
    const transaction = validateAgentSlides(withText, {
      slides: [{
        elements: [{ ...textElement('t1', 'Before'), text: 'After' }],
        id: 'slide-1',
      }] as unknown as Slide[],
    })

    const committed = transaction.commands[0] as unknown as {
      slides: { elements: Record<string, unknown>[] }[]
    }
    expect(committed.slides[0]?.elements[0]?.content).toBe('After')
    expect(committed.slides[0]?.elements[0]).not.toHaveProperty('text')
  })

  it('leaves a properly structured text object alone', () => {
    const structured = { align: 'top', content: 'TEAM SIX', defaultColor: '#000', defaultFontName: 'Arial' }
    const transaction = validateAgentSlides(withShape, { slides: shapeSlides(structured) })

    const committed = transaction.commands[0] as unknown as { slides: { elements: { text: Record<string, string> }[] }[] }
    expect(committed.slides[0]?.elements[0]?.text).toMatchObject(structured)
  })
})

describe('what reaches the agent', () => {
  it('carries no bytes, because no path puts bytes in the model', async () => {
    // This used to re-home inline `data:` payloads before sending, because a deck
    // carrying its own bytes came to 193 MB of slide JSON and closed the socket
    // before the agent had started. Nothing produces them now - every image is a
    // file the deck names - so the snapshot is small by construction rather than
    // by being repaired on the way out.
    const snapshot = await buildDeckSnapshot(presentation([{
      elements: [{ ...textElement('i1', ''), src: 'mona://asset/fixture.png', type: 'image' }] as unknown as Slide['elements'],
      id: 'slide-1',
    }]))

    const wire = JSON.stringify(snapshot)
    expect(wire).not.toContain('data:image')
    expect(wire).not.toContain('base64')
    expect(JSON.stringify(snapshot.slides)).toContain('mona://asset/fixture.png')
  })

  it('ignores an inline reference rather than shipping it', async () => {
    // Belt and braces: if one ever appeared - a fixture, a paste path nobody has
    // migrated - it is not treated as a deck asset, so it is never fetched or
    // described. It would still render; it just does not reach the agent's manifest.
    const snapshot = await buildDeckSnapshot(presentation([{
      elements: [{ ...textElement('i1', ''), src: `data:image/png;base64,${PNG}`, type: 'image' }] as unknown as Slide['elements'],
      id: 'slide-1',
    }]))

    expect(snapshot.assets).toEqual({})
  })
})
