import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { DocumentSourceRevision } from '@mona/document-jobs'
import { afterEach, describe, expect, it } from 'vitest'

import {
  ProjectAgentWorkspace,
  type ProjectWorkspaceDocument,
} from './project-agent-workspace.js'

const revision: DocumentSourceRevision = {
  contentHash: 'a'.repeat(64),
  modifiedAt: 10,
  size: 100,
}

const editableDocument = (
  artifactId: string,
  title: string,
): ProjectWorkspaceDocument => {
  const slides = [{
    elements: [],
    id: `${artifactId}-slide`,
    title: `${title} cover`,
  }]
  return {
    artifactId,
    basePresentation: {
      preservedMetadata: { author: 'Mona' },
      slideIndex: 0,
      slides,
      theme: { colorScheme: [] },
      title,
    },
    fetchAsset: async () => undefined,
    name: `${title}.mona`,
    revision,
    snapshot: {
      assets: {},
      slideIndex: 0,
      slides,
      theme: { colorScheme: [] },
      title,
    },
  }
}

const workspaces: ProjectAgentWorkspace[] = []

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map(workspace => workspace.dispose()))
})

describe('ProjectAgentWorkspace', () => {
  it('lays out multiple documents, marks unsupported sources read-only, and reports only real edits', async () => {
    const workspace = await ProjectAgentWorkspace.create([
      editableDocument('deck-one', 'Launch'),
      editableDocument('deck-two', 'Sales'),
      {
        artifactId: 'powerpoint',
        name: 'External.pptx',
        readOnlyReason: 'PowerPoint direct writeback is unavailable.',
      },
    ])
    workspaces.push(workspace)

    expect(workspace.describe()).toEqual([
      {
        editable: true,
        id: 'deck-one',
        name: 'Launch.mona',
        path: 'documents/deck-one/deck',
      },
      {
        editable: true,
        id: 'deck-two',
        name: 'Sales.mona',
        path: 'documents/deck-two/deck',
      },
      {
        editable: false,
        id: 'powerpoint',
        name: 'External.pptx',
        readOnlyReason: 'PowerPoint direct writeback is unavailable.',
      },
    ])
    await expect(access(join(workspace.root, 'documents', 'powerpoint')))
      .rejects.toMatchObject({ code: 'ENOENT' })
    expect(await workspace.changes()).toEqual([])

    const slidePath = join(
      workspace.root,
      'documents',
      'deck-one',
      'deck',
      'slides',
      '01.json',
    )
    const slide = JSON.parse(await readFile(slidePath, 'utf8')) as {
      elements: unknown[]
      title: string
    }
    slide.title = 'Updated launch cover'
    slide.elements.push({
      id: 'new-image',
      src: 'assets/research-chart.png',
      type: 'image',
    })
    await writeFile(slidePath, JSON.stringify(slide))
    const assetRoot = join(workspace.root, 'documents', 'deck-one', 'deck', 'assets')
    await mkdir(assetRoot, { recursive: true })
    await writeFile(join(assetRoot, 'research-chart.png'), Buffer.from('chart bytes'))

    expect(await workspace.changes(['deck-two'])).toEqual([])
    const changes = await workspace.changes()
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      artifactId: 'deck-one',
      expectedRevision: revision,
      presentation: {
        preservedMetadata: { author: 'Mona' },
        slides: [{
          elements: [{
            id: 'new-image',
            src: 'assets/research-chart.png',
            type: 'image',
          }],
          title: 'Updated launch cover',
        }],
      },
    })
    expect(changes[0]?.addedAssets['assets/research-chart.png']).toEqual({
      base64: Buffer.from('chart bytes').toString('base64'),
      mediaType: 'image/png',
    })
  })

  it('resets uncommitted edits when the project is synchronized', async () => {
    const document = editableDocument('deck-one', 'Launch')
    const workspace = await ProjectAgentWorkspace.create([document])
    workspaces.push(workspace)
    const deckFile = join(workspace.root, 'documents', 'deck-one', 'deck', 'deck.json')
    const deck = JSON.parse(await readFile(deckFile, 'utf8')) as { title: string }
    await writeFile(deckFile, JSON.stringify({ ...deck, title: 'Uncommitted' }))
    expect(await workspace.changes()).toHaveLength(1)

    await workspace.take([document])

    expect(await workspace.changes()).toEqual([])
    expect(JSON.parse(await readFile(deckFile, 'utf8'))).toMatchObject({ title: 'Launch' })
  })

  it('materializes a readable PowerPoint workspace without making it committable', async () => {
    const workspace = await ProjectAgentWorkspace.create([{
      artifactId: 'powerpoint',
      fetchAsset: async url => url === 'pptx-asset://cover'
        ? { base64: Buffer.from('image').toString('base64'), mediaType: 'image/png' }
        : undefined,
      name: 'External.pptx',
      readOnlyReason: 'PowerPoint writeback is unavailable.',
      snapshot: {
        assets: {
          'pptx-asset://cover': { byteLength: 5, mediaType: 'image/png' },
        },
        slides: [{
          elements: [{
            id: 'image',
            src: 'pptx-asset://cover',
            type: 'image',
          }],
          id: 'slide-1',
          title: 'Cover',
        }],
        title: 'External',
      },
    }])
    workspaces.push(workspace)

    expect(workspace.describe()).toEqual([{
      editable: false,
      id: 'powerpoint',
      name: 'External.pptx',
      path: 'documents/powerpoint/deck',
      readOnlyReason: 'PowerPoint writeback is unavailable.',
    }])
    const slide = await readFile(
      join(workspace.root, 'documents', 'powerpoint', 'deck', 'slides', '01.json'),
      'utf8',
    )
    expect(slide).toContain('"src": "assets/image-1.png"')
    await expect(readFile(
      join(workspace.root, 'documents', 'powerpoint', 'deck', 'assets', 'image-1.png'),
      'utf8',
    )).resolves.toBe('image')
    expect(await workspace.changes()).toEqual([])
  })
})
