import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test, type Page, type TestInfo } from '@playwright/test'

const privateCorpusRoot = fileURLToPath(new URL('../../../tests/corpus/private/', import.meta.url))
const fidelityArtifactRoot = resolve(privateCorpusRoot, '../../../.artifacts/pptx-fidelity')
const fixtures = [
  { file: 'real-01-powerpoint-native-charts-stress.pptx', slides: 34 },
  { file: 'real-02-powerpoint-native-pie-chart.pptx', slides: 1 },
  { file: 'real-03-nasa-sewp-corporate.pptx', slides: 18 },
  { file: 'real-04-powerpoint-design-smartart-notes.pptx', slides: 28 },
] as const

const createNewPresentation = async (page: Page) => {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New presentation' }).click()
  await page.getByRole('button', { name: 'Create new' }).click()
  await expect.poll(() => page.evaluate(() => (
    window.__MONA_TEST__!.getState().presentation.slides[0]!.elements.length
  ))).toBe(0)
}

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US'))
  await page.goto('/?developmentFixture=slides')
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
  await createNewPresentation(page)
})

for (const fixture of fixtures) {
  const fixturePath = `${privateCorpusRoot}${fixture.file}`
  test.skip(!existsSync(fixturePath), `Private corpus fixture is not present: ${fixture.file}`)

  test(`renders retained PowerPoint content without silent loss for ${fixture.file}`, async ({ page }, testInfo: TestInfo) => {
    const browserProblems: string[] = []
    page.on('console', message => {
      if (message.type() === 'error' || message.type() === 'warning') {
        browserProblems.push(`${message.type()}: ${message.text()}`)
      }
    })
    page.on('pageerror', error => browserProblems.push(`pageerror: ${error.message}`))

    await page.locator('input[type="file"][accept^="application/vnd.openxmlformats"]').setInputFiles(fixturePath)
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
        const renderableMaster = source?.showMasterShapes === false || layout?.showMasterShapes === false
          ? []
          : (master?.elements ?? []).filter(element => (
              element.source?.placeholderIndex === undefined
              && element.source?.placeholderType === undefined
            ))
        const renderableLayout = (layout?.elements ?? []).filter(element => (
          element.source?.placeholderIndex === undefined
          && element.source?.placeholderType === undefined
        ))
        return { count: renderableMaster.length + renderableLayout.length, index }
      }).filter(item => item.count > 0)
      const capabilitySlides = presentation.slides.map((slide, index) => ({
        charts: slide.elements.filter(element => element.type === 'chart').length,
        grouped: slide.elements.filter(element => element.type === 'group' || Boolean(element.groupId)).length,
        images: slide.elements.filter(element => element.type === 'image').length,
        index,
        local: slide.elements.length,
        tables: slide.elements.filter(element => element.type === 'table').length,
      }))
      return {
        capabilitySlides,
        counts: report?.counts,
        hierarchy: {
          layouts: hierarchy?.layouts.length ?? 0,
          masters: hierarchy?.masters.length ?? 0,
          themes: hierarchy?.themes.length ?? 0,
        },
        sharedArt,
      }
    })

    expect(fidelity.counts?.dropped).toBe(0)
    expect(fidelity.hierarchy.layouts).toBeGreaterThan(0)
    expect(fidelity.hierarchy.masters).toBeGreaterThan(0)
    expect(fidelity.hierarchy.themes).toBeGreaterThan(0)

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

    const inspectionSlide = fidelity.capabilitySlides.find(item => item.charts > 0)
      ?? fidelity.capabilitySlides.find(item => item.grouped > 0)
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
