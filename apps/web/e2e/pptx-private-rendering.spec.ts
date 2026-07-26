import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ElectronApplication } from '@playwright/test'

import { chooseMenuCommand, expect, importFile, openApp, test, type Page, type TestInfo } from './electron-fixture'

const privateCorpusRoot = fileURLToPath(new URL('../../../tests/corpus/private/', import.meta.url))
const fidelityArtifactRoot = resolve(privateCorpusRoot, '../../../.artifacts/pptx-fidelity')
const fixtures = [
  { file: 'real-01-powerpoint-native-charts-stress.pptx', slides: 34 },
  { file: 'real-02-powerpoint-native-pie-chart.pptx', slides: 1 },
  { file: 'real-03-nasa-sewp-corporate.pptx', slides: 18 },
  { file: 'real-04-powerpoint-design-smartart-notes.pptx', slides: 28 },
] as const

const isFontCdnFailure = (text: string) => (
  text.includes('fonts.googleapis.com')
  || text.includes('fonts.gstatic.com')
  || text === 'Failed to load resource: net::ERR_FAILED'
)

const createNewPresentation = async (app: ElectronApplication, page: Page) => {
  await chooseMenuCommand(app, 'file.new')
  await page.getByRole('button', { name: 'Create new' }).click()
  await expect.poll(() => page.evaluate(() => (
    window.__MONA_TEST__!.getState().presentation.slides[0]!.elements.length
  ))).toBe(0)
}

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ app, page }) => {
  await page.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US'))
  await openApp(page, '?developmentFixture=slides')
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
  await createNewPresentation(app, page)
})

for (const fixture of fixtures) {
  const fixturePath = `${privateCorpusRoot}${fixture.file}`
  test.skip(!existsSync(fixturePath), `Private corpus fixture is not present: ${fixture.file}`)

  test(`renders retained PowerPoint content without silent loss for ${fixture.file}`, async ({ app, page }, testInfo: TestInfo) => {
    const browserProblems: string[] = []
    page.on('console', message => {
      if (message.type() === 'error' || message.type() === 'warning') {
        // A licensed corporate face is on no public CDN, so the request for it
        // fails and the browser logs it. Mona reports that family as
        // unavailable and renders its deterministic fallback, which is the
        // product behaviour under test; the CDN's answer is not.
        if (isFontCdnFailure(message.text())) return
        browserProblems.push(`${message.type()}: ${message.text()}`)
      }
    })
    page.on('pageerror', error => browserProblems.push(`pageerror: ${error.message}`))

    await importFile(app, 'pptx', fixturePath)
    await expect.poll(() => page.evaluate(() => (
      window.__MONA_TEST__!.getState().presentation.slides.length
    )), { timeout: 45_000 }).toBe(fixture.slides)
    await expect.poll(() => page.evaluate(() => (
      window.__MONA_TEST__!.getState().presentation.sourcePackages?.[0]?.fileName
    )), { timeout: 45_000 }).toBe(fixture.file)

    const fidelity = await page.evaluate(() => {
      const presentation = window.__MONA_TEST__!.getState().presentation
      const sourcePackage = presentation.sourcePackages?.[0]
      const report = sourcePackage?.importReport
      const hierarchy = sourcePackage?.hierarchy
      const sharedArt = presentation.slides.map((slide, index) => {
        const source = slide.source
        const layout = hierarchy?.layouts.find(candidate => candidate.partPath === source?.layoutPart)
        const master = hierarchy?.masters.find(candidate => candidate.partPath === source?.masterPart)
        // Layout and master placeholders are inheritance prompts and are never
        // painted, field placeholders included: enabling a field writes it
        // onto the slide, so the slide's own copy is what renders.
        const isPrompt = (element: (typeof slide.elements)[number]) => (
          element.source?.placeholderIndex !== undefined || element.source?.placeholderType !== undefined
        )
        const renderableMaster = source?.showMasterShapes === false || layout?.showMasterShapes === false
          ? []
          : (master?.elements ?? []).filter(element => !isPrompt(element))
        const renderableLayout = (layout?.elements ?? []).filter(element => !isPrompt(element))
        return { count: renderableMaster.length + renderableLayout.length, index }
      }).filter(item => item.count > 0)
      const capabilitySlides = presentation.slides.map((slide, index) => ({
        charts: slide.elements.filter(element => element.type === 'chart').length,
        grouped: slide.elements.filter(element => element.type === 'group' || Boolean(element.groupId)).length,
        images: slide.elements.filter(element => element.type === 'image').length,
        index,
        local: slide.elements.length,
        structuredRuns: slide.elements.reduce((count, element) => {
          const body = element.type === 'text'
            ? element.structuredText
            : element.type === 'shape'
              ? element.text?.structuredText
              : undefined
          return count + (body?.paragraphs.reduce((sum, paragraph) => sum + paragraph.runs.length, 0) ?? 0)
        }, 0),
        structuredText: slide.elements.filter(element => (
          (element.type === 'text' && Boolean(element.structuredText?.paragraphs.length))
          || (element.type === 'shape' && Boolean(element.text?.structuredText?.paragraphs.length))
        )).length,
        tables: slide.elements.filter(element => element.type === 'table').length,
      }))
      return {
        capabilitySlides,
        counts: report?.counts,
        hierarchy: {
          authoredBackgrounds: (hierarchy?.layouts.filter(layout => layout.background).length ?? 0)
            + (hierarchy?.masters.filter(master => master.background).length ?? 0),
          headerFooterPolicies: hierarchy?.masters.filter(master => master.headerFooter).length ?? 0,
          layouts: hierarchy?.layouts.length ?? 0,
          masters: hierarchy?.masters.length ?? 0,
          placeholderElements: hierarchy?.placeholders.filter(placeholder => placeholder.elementId).length ?? 0,
          styledMasters: hierarchy?.masters.filter(master => (
            master.textStyles?.title.length
            || master.textStyles?.body.length
            || master.textStyles?.other.length
          )).length ?? 0,
          themes: hierarchy?.themes.length ?? 0,
        },
        linkedPlaceholders: presentation.slides.reduce((count, slide) => (
          count + slide.elements.filter(element => (
            element.source?.placeholderLayoutObjectId
            || element.source?.placeholderMasterObjectId
          )).length
        ), 0),
        sharedArt,
      }
    })

    expect(fidelity.counts?.dropped).toBe(0)
    expect(fidelity.hierarchy.layouts).toBeGreaterThan(0)
    expect(fidelity.hierarchy.masters).toBeGreaterThan(0)
    expect(fidelity.hierarchy.themes).toBeGreaterThan(0)
    if (fixture.file === 'real-03-nasa-sewp-corporate.pptx') {
      expect(fidelity.hierarchy.authoredBackgrounds).toBeGreaterThan(0)
      expect(fidelity.hierarchy.headerFooterPolicies).toBeGreaterThan(0)
      expect(fidelity.hierarchy.placeholderElements).toBeGreaterThan(0)
      expect(fidelity.hierarchy.styledMasters).toBeGreaterThan(0)
      expect(fidelity.linkedPlaceholders).toBeGreaterThan(0)
      expect(fidelity.capabilitySlides.some(slide => slide.structuredText > 0)).toBe(true)
      expect(fidelity.capabilitySlides.some(slide => slide.structuredRuns > 0)).toBe(true)
    }

    const showSlide = async (index: number) => {
      await page.getByRole('button', { name: `Show slide ${index + 1}`, exact: true }).click()
      await expect(page.getByRole('spinbutton', { name: 'Go to page' })).toHaveValue(String(index + 1))
      const expectedLocal = fidelity.capabilitySlides[index]!.local
      await expect(page.locator('.mona-editor-slide-canvas [data-pptx-layer="slide"]')).toHaveCount(expectedLocal)
    }

    for (const capability of fidelity.capabilitySlides.filter(item => item.charts > 0)) {
      await showSlide(capability.index)
      const charts = page.locator('.mona-editor-slide-canvas .mona-chart svg')
      await expect(charts).toHaveCount(capability.charts)
      await expect.poll(async () => charts.evaluateAll(nodes => (
        nodes.length > 0 && nodes.every(node => (
          node.querySelectorAll('path, rect, polyline, polygon, circle').length > 0
        ))
      ))).toBe(true)
    }

    for (const capability of fidelity.capabilitySlides.filter(item => item.tables > 0)) {
      await showSlide(capability.index)
      await expect(page.locator('.mona-editor-slide-canvas .mona-table-element')).toHaveCount(capability.tables)
      const visibleCells = page.locator('.mona-editor-slide-canvas .mona-table-element td')
      await expect(visibleCells).not.toHaveCount(0)
    }

    const imageSlide = fidelity.capabilitySlides.find(item => item.images > 0)
    if (imageSlide) {
      await showSlide(imageSlide.index)
      const localImages = page.locator('.mona-editor-slide-canvas [data-pptx-layer="slide"] .mona-image-content img')
      await expect(localImages).toHaveCount(imageSlide.images)
      await expect.poll(async () => localImages.evaluateAll(images => (
        images.every(image => (
          (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0
        ))
      ))).toBe(true)
    }

    const sharedArt = fidelity.sharedArt[0]
    if (sharedArt) {
      await showSlide(sharedArt.index)
      await expect(page.locator(
        '.mona-editor-slide-canvas [data-pptx-layer="master"], '
        + '.mona-editor-slide-canvas [data-pptx-layer="layout"]',
      )).toHaveCount(sharedArt.count)
    }

    const structuredTextSlide = fidelity.capabilitySlides.find(item => item.structuredRuns > 0)
    if (structuredTextSlide) {
      await showSlide(structuredTextSlide.index)
      const structuredRun = page.locator('.mona-editor-slide-canvas [data-ppt-run-id]').first()
      await expect(page.locator('.mona-editor-slide-canvas [data-ppt-paragraph-id]').first()).toBeVisible()
      await expect(structuredRun).toBeVisible()

      if (fixture.file === 'real-03-nasa-sewp-corporate.pptx') {
        const elementId = await structuredRun.evaluate(run => (
          run.closest<HTMLElement>('[data-element-id]')?.dataset.elementId
        ))
        expect(elementId).toBeTruthy()
        const original = await page.evaluate(id => {
          const presentation = window.__MONA_TEST__!.getState().presentation
          const element = presentation.slides[presentation.slideIndex]!.elements.find(candidate => candidate.id === id)!
          return {
            content: element.type === 'text' ? element.content : element.type === 'shape' ? element.text?.content : undefined,
            structured: element.type === 'text'
              ? Boolean(element.structuredText)
              : element.type === 'shape'
                ? Boolean(element.text?.structuredText)
                : false,
          }
        }, elementId)
        expect(original.structured).toBe(true)

        const editor = page.locator(`[data-element-id="${elementId}"] .ProseMirror`)
        await editor.click()
        await editor.press('End')
        await editor.type('MonaEditProbe')
        await expect.poll(() => page.evaluate(id => {
          const presentation = window.__MONA_TEST__!.getState().presentation
          const element = presentation.slides[presentation.slideIndex]!.elements.find(candidate => candidate.id === id)!
          return {
            content: element.type === 'text' ? element.content : element.type === 'shape' ? element.text?.content : undefined,
            structured: element.type === 'text'
              ? Boolean(element.structuredText)
              : element.type === 'shape'
                ? Boolean(element.text?.structuredText)
                : false,
          }
        }, elementId)).toMatchObject({ content: expect.stringContaining('MonaEditProbe'), structured: false })

        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
        await expect.poll(() => page.evaluate(id => {
          const presentation = window.__MONA_TEST__!.getState().presentation
          const element = presentation.slides[presentation.slideIndex]!.elements.find(candidate => candidate.id === id)!
          return {
            content: element.type === 'text' ? element.content : element.type === 'shape' ? element.text?.content : undefined,
            structured: element.type === 'text'
              ? Boolean(element.structuredText)
              : element.type === 'shape'
                ? Boolean(element.text?.structuredText)
                : false,
          }
        }, elementId)).toEqual(original)
      }
    }

    const inspectionSlide = fidelity.capabilitySlides.find(item => item.charts > 0)
      ?? fidelity.capabilitySlides.find(item => item.grouped > 0)
      ?? structuredTextSlide
      ?? fidelity.capabilitySlides[sharedArt?.index ?? 0]
    await showSlide(inspectionSlide!.index)
    await testInfo.attach(`${fixture.file}-representative-slide`, {
      body: await page.locator('.mona-editor-slide-canvas').screenshot(),
      contentType: 'image/png',
    })
    if (process.env.MONA_WRITE_FIDELITY_SCREENSHOTS === '1') {
      mkdirSync(fidelityArtifactRoot, { recursive: true })
      await page.locator('.mona-editor-slide-canvas').screenshot({
        path: `${fidelityArtifactRoot}/${fixture.file.replace(/\.pptx$/i, '')}.png`,
      })
    }
    expect(browserProblems).toEqual([])
  })
}
