import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createTestPresentation } from '@mona/test-fixtures'
import { ingestPowerPoint } from '@mona/pptx-ingestion'
import {
  flattenElementTree,
  type PresentationState,
} from '@mona/presentation-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DataSourceService as DataSourceServiceType } from './data-source-service.js'

let userDataRoot = ''

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataRoot,
  },
}))

const {
  createDocument,
  packageDocument,
} = await import('./document-library.js')
const { DataSourceService } = await import('./data-source-service.js')
const { ProjectDocumentJobEngine, ProjectDocumentAgentExecutor } = await import(
  './project-document-jobs.js'
)
const { ProjectJobStore } = await import('./project-job-store.js')
const { ProjectStore } = await import('./project-store.js')

describe('project document jobs', () => {
  beforeEach(async () => {
    userDataRoot = await mkdtemp(join(tmpdir(), 'mona-project-job-test-'))
  })

  afterEach(async () => {
    await rm(userDataRoot, { force: true, recursive: true })
  })

  const setup = async (
    count = 1,
    dataSources = new DataSourceService(),
  ) => {
    const sourceRoot = join(userDataRoot, 'Source')
    await mkdir(sourceRoot, { recursive: true })
    const source = await dataSources.addLocalFolder(sourceRoot, {
      defaultSaveLocation: true,
    })
    const projects = new ProjectStore()
    const jobs = new ProjectJobStore()
    const artifacts = []
    for (let index = 0; index < count; index += 1) {
      const presentation = {
        ...createTestPresentation(),
        title: `Deck ${index + 1}`,
      }
      const recovery = await createDocument(presentation)
      const created = await dataSources.createDocument(
        source.id,
        `Deck ${index + 1}.mona`,
        await packageDocument(recovery.id),
      )
      artifacts.push({
        documentType: 'presentation' as const,
        mediaType: 'application/vnd.mona.presentation-package',
        name: `Deck ${index + 1}.mona`,
        reference: created.reference,
      })
    }
    const project = await projects.create({ artifacts })
    const engine = new ProjectDocumentJobEngine({ dataSources, jobs, projects })
    const executor = new ProjectDocumentAgentExecutor({
      dataSources,
      engine,
      projectId: project.id,
      projects,
    })
    return { dataSources, executor, jobs, project, projects }
  }

  it('writes a validated native presentation through its provider and marks the artifact', async () => {
    const { dataSources, executor, project, projects } = await setup()
    const [prepared] = await executor.prepare()
    if (!prepared) throw new Error('The project document was not prepared.')
    expect(prepared.readOnlyReason).toBeUndefined()
    const presentation = structuredClone(prepared.basePresentation) as ReturnType<
      typeof createTestPresentation
    >
    presentation.title = 'Agent-updated title'

    const job = await executor.apply('Update the presentation title', [{
      addedAssets: {},
      artifactId: prepared.artifactId,
      expectedRevision: prepared.revision!,
      presentation,
    }])

    expect(
      job.status,
      job.steps.map(step => step.error).filter(Boolean).join('; '),
    ).toBe('succeeded')
    expect(job.steps).toMatchObject([{ status: 'succeeded' }])
    expect(JSON.stringify(job)).not.toContain('Agent-updated title')
    const updatedProject = await projects.peek(project.id)
    expect(updatedProject?.artifacts[0]?.state).toBe('modified')

    const refreshed = await executor.prepare()
    expect(refreshed[0]?.basePresentation).toMatchObject({ title: 'Agent-updated title' })
    await dataSources.removeSource(project.artifacts[0]!.reference.sourceId)
  })

  it('hydrates PowerPoint as editable semantic context and patches geometry plus text', async () => {
    const sourceRoot = join(userDataRoot, 'PowerPoint Source')
    await mkdir(sourceRoot, { recursive: true })
    const dataSources = new DataSourceService()
    const file = await readFile(new URL(
      '../../../tests/corpus/public/corpus-03-media.pptx',
      import.meta.url,
    ))
    await writeFile(join(sourceRoot, 'Imported media.pptx'), file)
    const source = await dataSources.addLocalFolder(sourceRoot, {
      defaultSaveLocation: true,
    })
    const sourceDocument = (await dataSources.queryDocuments()).find(
      document => document.name === 'Imported media.pptx',
    )
    if (!sourceDocument) throw new Error('The PowerPoint fixture was not indexed.')
    const projects = new ProjectStore()
    const jobs = new ProjectJobStore()
    const project = await projects.create({
      artifacts: [{
        documentType: 'presentation',
        mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        name: 'Imported media.pptx',
        reference: {
          itemId: sourceDocument.id,
          sourceId: sourceDocument.sourceId,
        },
      }],
    })
    const executor = new ProjectDocumentAgentExecutor({
      dataSources,
      engine: new ProjectDocumentJobEngine({ dataSources, jobs, projects }),
      projectId: project.id,
      projects,
    })

    const [prepared] = await executor.prepare()

    expect(prepared?.readOnlyReason).toBeUndefined()
    expect(prepared?.basePresentation).toBeDefined()
    expect(prepared?.revision).toBeDefined()
    expect(prepared?.snapshot?.slides.length).toBeGreaterThan(0)
    const [assetUrl] = Object.keys(prepared?.snapshot?.assets ?? {})
    expect(assetUrl).toMatch(/^pptx-asset:\/\//)
    await expect(prepared?.fetchAsset?.(assetUrl!)).resolves.toMatchObject({
      mediaType: expect.stringMatching(/^(?:image|video|audio)\//),
    })
    const presentation = structuredClone(prepared!.basePresentation) as PresentationState
    const target = presentation.slides.flatMap(slide => slide.elements).find(element => (
      element.type !== 'line'
      && element.source?.sourceLayer === 'slide'
      && element.source.sourcePart === element.source.slidePart
      && element.width > 0
      && element.height > 0
    ))
    if (!target || target.type === 'line') throw new Error('The PowerPoint fixture has no patchable element.')
    const nativeShapeId = target.source?.nativeShapeId
    const sourcePart = target.source?.sourcePart
    target.left += 24
    const textTarget = presentation.slides.flatMap(slide => flattenElementTree(slide.elements)).find(
      element => (
        (element.type === 'text' || (element.type === 'shape' && Boolean(element.text)))
        && element.source?.sourceLayer === 'slide'
        && element.source.sourcePart === element.source.slidePart
      ),
    )
    if (!textTarget || (textTarget.type !== 'text' && textTarget.type !== 'shape')) {
      throw new Error('The PowerPoint fixture has no editable text body.')
    }
    const textNativeShapeId = textTarget.source?.nativeShapeId
    const textSourcePart = textTarget.source?.sourcePart
    if (textTarget.type === 'text') {
      textTarget.content = '<p>Project agent rewrote this text.</p>'
      delete textTarget.structuredText
    }
    else {
      textTarget.text!.content = '<p>Project agent rewrote this text.</p>'
      delete textTarget.text!.structuredText
    }
    const job = await executor.apply('Move one PowerPoint element and rewrite text', [{
      addedAssets: {},
      artifactId: prepared!.artifactId,
      expectedRevision: prepared!.revision!,
      presentation,
    }])
    expect(
      job.status,
      job.steps.map(step => step.error).filter(Boolean).join('; '),
    ).toBe('succeeded')
    const written = await dataSources.readDocument(project.artifacts[0]!.reference)
    const reimported = await ingestPowerPoint(written.bytes, {
      fileName: 'Imported media.pptx',
      theme: presentation.theme,
    })
    const roundTripped = reimported.presentation.slides
      .flatMap(slide => flattenElementTree(slide.elements))
      .find(element => (
        element.source?.nativeShapeId === nativeShapeId
        && element.source?.sourcePart === sourcePart
      ))
    expect(roundTripped?.left).toBeCloseTo(target.left, 2)
    const roundTrippedText = reimported.presentation.slides
      .flatMap(slide => flattenElementTree(slide.elements))
      .find(element => (
        element.source?.nativeShapeId === textNativeShapeId
        && element.source?.sourcePart === textSourcePart
      ))
    const content = roundTrippedText?.type === 'text'
      ? roundTrippedText.content
      : roundTrippedText?.type === 'shape'
        ? roundTrippedText.text?.content
        : undefined
    expect(content).toContain('Project agent rewrote this text.')
    await dataSources.removeSource(source.id)
  })

  it('preflights every document and records a partial result without overwriting stale input', async () => {
    const { dataSources, executor, project } = await setup(2)
    const prepared = await executor.prepare()
    const changes = prepared.map((document, index) => {
      const presentation = structuredClone(document.basePresentation) as ReturnType<
        typeof createTestPresentation
      >
      presentation.title = `Updated ${index + 1}`
      return {
        addedAssets: {},
        artifactId: document.artifactId,
        expectedRevision: index === 1
          ? { ...document.revision!, contentHash: '0'.repeat(64) }
          : document.revision!,
        presentation,
      }
    })

    const job = await executor.apply('Update both decks', changes)

    expect(job.status).toBe('partial')
    expect(job.steps.map(step => step.status)).toEqual(['succeeded', 'failed'])
    expect(job.steps[1]?.error).toContain('changed after the agent opened it')
    const refreshed = await executor.prepare()
    expect(refreshed[0]?.basePresentation).toMatchObject({ title: 'Updated 1' })
    expect(refreshed[1]?.basePresentation).toMatchObject({ title: 'Deck 2' })
    await dataSources.removeSource(project.artifacts[0]!.reference.sourceId)
  })

  it('marks in-flight records interrupted on recovery instead of replaying mutations', async () => {
    const { dataSources, jobs, project } = await setup()
    const record = await jobs.create({
      explanation: 'A pending update',
      projectId: project.id,
      steps: [{
        artifactId: project.artifacts[0]!.id,
        expectedRevision: {
          contentHash: 'a'.repeat(64),
          modifiedAt: 1,
          size: 1,
        },
        name: project.artifacts[0]!.name,
        operation: 'presentation.replace',
        reference: project.artifacts[0]!.reference,
      }],
    })
    await jobs.start(project.id, record.id)
    await jobs.updateStep(project.id, record.id, record.steps[0]!.id, 'running')

    const recovered = await new ProjectJobStore().interruptActive(project.id)

    expect(recovered[0]?.status).toBe('interrupted')
    expect(recovered[0]?.steps[0]?.status).toBe('cancelled')
    await dataSources.removeSource(project.artifacts[0]!.reference.sourceId)
  })

  it('honors cancellation between documents and reports already-written work as partial', async () => {
    class CancellingDataSourceService extends DataSourceService {
      afterFirstWrite: (() => Promise<void>) | null = null

      override async writeDocument(
        reference: Parameters<DataSourceServiceType['writeDocument']>[0],
        bytes: ArrayBuffer,
      ) {
        const written = await super.writeDocument(reference, bytes)
        const callback = this.afterFirstWrite
        this.afterFirstWrite = null
        await callback?.()
        return written
      }
    }

    const dataSources = new CancellingDataSourceService()
    const { executor, jobs, project } = await setup(2, dataSources)
    const prepared = await executor.prepare()
    const changes = prepared.map(document => ({
      addedAssets: {},
      artifactId: document.artifactId,
      expectedRevision: document.revision!,
      presentation: {
        ...(structuredClone(document.basePresentation) as ReturnType<
          typeof createTestPresentation
        >),
        title: `Changed ${document.name}`,
      },
    }))
    dataSources.afterFirstWrite = async () => {
      const [active] = await jobs.list(project.id)
      if (active) await jobs.requestCancel(project.id, active.id)
    }

    const job = await executor.apply('Update until cancelled', changes)

    expect(job.status).toBe('partial')
    expect(job.cancelRequested).toBe(true)
    expect(job.steps.map(step => step.status)).toEqual(['succeeded', 'cancelled'])
    await dataSources.removeSource(project.artifacts[0]!.reference.sourceId)
  })

  it('rechecks the provider immediately before writing and preserves a racing external change', async () => {
    class RacingDataSourceService extends DataSourceService {
      readCount = 0
      writeCount = 0

      override async readDocument(
        reference: Parameters<DataSourceServiceType['readDocument']>[0],
      ) {
        const picked = await super.readDocument(reference)
        this.readCount += 1
        if (this.readCount === 2) {
          await appendFile(
            join(userDataRoot, 'Source', 'Deck 1.mona'),
            Buffer.from('external-change'),
          )
        }
        return picked
      }

      override async writeDocument(
        reference: Parameters<DataSourceServiceType['writeDocument']>[0],
        bytes: ArrayBuffer,
      ) {
        this.writeCount += 1
        return super.writeDocument(reference, bytes)
      }
    }

    const dataSources = new RacingDataSourceService()
    const { executor, project } = await setup(1, dataSources)
    const [prepared] = await executor.prepare()
    if (!prepared) throw new Error('The project document was not prepared.')
    const presentation = {
      ...(structuredClone(prepared.basePresentation) as ReturnType<
        typeof createTestPresentation
      >),
      title: 'Must not overwrite the external edit',
    }

    const job = await executor.apply('Attempt a racing update', [{
      addedAssets: {},
      artifactId: prepared.artifactId,
      expectedRevision: prepared.revision!,
      presentation,
    }])

    expect(job.status).toBe('failed')
    expect(dataSources.writeCount).toBe(0)
    const source = await readFile(join(userDataRoot, 'Source', 'Deck 1.mona'))
    expect(source.subarray(-'external-change'.length).toString()).toBe('external-change')
    await dataSources.removeSource(project.artifacts[0]!.reference.sourceId)
  })

  it('rejects scriptable presentation content before any provider write', async () => {
    class CountingDataSourceService extends DataSourceService {
      writeCount = 0

      override async writeDocument(
        reference: Parameters<DataSourceServiceType['writeDocument']>[0],
        bytes: ArrayBuffer,
      ) {
        this.writeCount += 1
        return super.writeDocument(reference, bytes)
      }
    }

    const dataSources = new CountingDataSourceService()
    const { executor, project } = await setup(1, dataSources)
    const [prepared] = await executor.prepare()
    if (!prepared) throw new Error('The project document was not prepared.')
    const presentation = {
      ...(structuredClone(prepared.basePresentation) as ReturnType<
        typeof createTestPresentation
      >),
      agentAnnotation: '<script>unsafe()</script>',
    }

    const job = await executor.apply('Attempt an unsafe update', [{
      addedAssets: {},
      artifactId: prepared.artifactId,
      expectedRevision: prepared.revision!,
      presentation,
    }])

    expect(job.status).toBe('failed')
    expect(job.steps[0]?.error).toContain('unsafe markup')
    expect(dataSources.writeCount).toBe(0)
    await dataSources.removeSource(project.artifacts[0]!.reference.sourceId)
  })
})
