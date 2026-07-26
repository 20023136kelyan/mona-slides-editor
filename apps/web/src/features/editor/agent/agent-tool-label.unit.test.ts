import { describe, expect, it } from 'vitest'

import { buildToolLabel, slideLabelFor } from '@/features/editor/agent/agent-tool-label'

import foundation from '@/i18n/foundation/en-US.json'

/**
 * Renders from the real catalogue rather than a copy of it, so a key that gets
 * renamed or dropped fails here instead of shipping as a raw key on screen.
 */
const translate = (key: string, values?: Record<string, unknown>): string => {
  const path = key.replace(/^foundation\./, '').split('.')
  let node: unknown = foundation
  for (const step of path) node = (node as Record<string, unknown> | undefined)?.[step]
  return typeof node === 'string'
    ? node.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ''))
    : key
}

const slides = [
  { id: 's1', title: 'Sensitivity Analysis' },
  { id: 's2' },
  { id: 's3', title: '   ' },
  { id: 's4', title: 'Conclusions' },
  { id: 's5' },
]

const context = { currentSlideId: 's2', slides, translate }

describe('slide labels', () => {
  it('uses the slide title when it has one', () => {
    expect(slideLabelFor('s1', context)).toBe('Sensitivity Analysis')
  })

  it('falls back to the slide number when untitled', () => {
    expect(slideLabelFor('s2', context)).toBe('Slide 2')
  })

  it('treats a whitespace-only title as untitled', () => {
    expect(slideLabelFor('s3', context)).toBe('Slide 3')
  })

  it('returns nothing for a slide the deck no longer holds', () => {
    // Naming it after whatever now sits at that index would be a lie.
    expect(slideLabelFor('deleted', context)).toBeNull()
    expect(slideLabelFor(undefined, context)).toBeNull()
  })
})

describe('tool labels', () => {
  it('names the slide it is looking at rather than saying "this slide"', () => {
    expect(buildToolLabel('look', { slideIds: ['s1'] }, context))
      .toBe('Looking at Sensitivity Analysis')
    expect(buildToolLabel('look', { slideIds: ['s2'] }, context))
      .toBe('Looking at Slide 2')
  })

  it('names the current slide when the call specifies none', () => {
    // `look` defaults to the current slide, so the row says which that is.
    expect(buildToolLabel('look', {}, context)).toBe('Looking at Slide 2')
  })

  it('lists a few slides by name', () => {
    expect(buildToolLabel('look', { slideIds: ['s1', 's4'] }, context))
      .toBe('Looking at Sensitivity Analysis, Conclusions')
  })

  it('counts them instead once there are too many to read', () => {
    expect(buildToolLabel('look', { slideIds: ['s1', 's2', 's4', 's5'] }, context))
      .toBe('Looking at 4 slides')
  })

  it('counts rather than naming nothing when every id is stale', () => {
    expect(buildToolLabel('look', { slideIds: ['gone', 'also-gone'] }, context))
      .toBe('Looking at 2 slides')
  })

  it('distinguishes searching the web from searching the deck', () => {
    // Two different actions that both used to read "Searching for X".
    expect(buildToolLabel('web_search', { query: 'sensitivity analysis' }, context))
      .toBe('Searching the web for sensitivity analysis')
    expect(buildToolLabel('Grep', { pattern: 'sensitivity analysis' }, context))
      .toBe('Searching for sensitivity analysis')
  })

  it('reports the commit by its own explanation, and falls back when it has none', () => {
    expect(buildToolLabel('apply', { explanation: 'Add a title' }, context)).toBe('Add a title')
    expect(buildToolLabel('apply', { explanation: '  ' }, context)).toBe('Applying the changes')
  })
})

describe('the ordinary tools', () => {
  it('turns a slide file path back into the slide the user sees', () => {
    // The agent works in a temp directory on `deck/slides/01.json`, which is true
    // and useless to read. The filename is the slide's position in deck order.
    expect(buildToolLabel('Read', { file_path: '/tmp/mona-deck-x/deck/slides/01.json' }, context))
      .toBe('Reading Sensitivity Analysis')
    expect(buildToolLabel('Read', { file_path: 'deck/slides/02.json' }, context))
      .toBe('Reading Slide 2')
    expect(buildToolLabel('Edit', { file_path: 'deck/slides/04.json' }, context))
      .toBe('Editing Conclusions')
    expect(buildToolLabel('Write', { file_path: 'deck/slides/05.json' }, context))
      .toBe('Writing Slide 5')
  })

  it('names an image and the outline for what they are', () => {
    expect(buildToolLabel('Read', { file_path: 'deck/assets/pattern-3.png' }, context))
      .toBe('Looking at pattern-3.png')
    expect(buildToolLabel('Read', { file_path: 'deck/deck.json' }, context))
      .toBe('Reading the deck outline')
  })

  it('falls back to the filename for anything outside the deck', () => {
    expect(buildToolLabel('Read', { file_path: '/tmp/mona-deck-x/notes.txt' }, context))
      .toBe('Reading notes.txt')
  })

  it('describes a search, a listing and a command', () => {
    expect(buildToolLabel('Grep', { pattern: 'TEAM 5' }, context)).toBe('Searching for TEAM 5')
    expect(buildToolLabel('Glob', { pattern: 'deck/**/*.json' }, context)).toBe('Listing files')
    // The SDK asks the model for a one-line description; it reads better than the
    // command, and the command is the fallback.
    expect(buildToolLabel('Bash', { command: 'curl -sL x -o y', description: 'Download the chart' }, context))
      .toBe('Running Download the chart')
    expect(buildToolLabel('Bash', { command: 'ls deck/assets' }, context))
      .toBe('Running ls deck/assets')
  })

  it('shows a web fetch by host, not by full URL', () => {
    expect(buildToolLabel('WebFetch', { url: 'https://example.com/a/very/long/path?q=1' }, context))
      .toBe('Fetching example.com')
    expect(buildToolLabel('WebSearch', { query: 'GDP growth 2026' }, context))
      .toBe('Searching the web for GDP growth 2026')
  })

  it('labels the commit and the recovery', () => {
    expect(buildToolLabel('apply', { explanation: 'Renamed the team label' }, context))
      .toBe('Renamed the team label')
    expect(buildToolLabel('apply', {}, context)).toBe('Applying the changes')
    expect(buildToolLabel('sync', {}, context)).toBe('Re-reading the deck')
  })

  it('names an unknown tool instead of describing it as something else', () => {
    // Every unrecognised tool used to render as "Reading this slide", which was a
    // confident lie about what was happening.
    expect(buildToolLabel('TodoWrite', { todos: [] }, context)).toBe('Running TodoWrite')
    expect(buildToolLabel('Read', {}, context)).toBe('Running Read')
  })
})
