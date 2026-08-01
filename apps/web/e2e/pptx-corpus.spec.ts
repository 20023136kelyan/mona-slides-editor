import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ElectronApplication } from '@playwright/test'

import { chooseMenuCommand, configureLocalSaveFolder, expect, importFile, openApp, test, type Page } from './electron-fixture'

interface CorpusBaseline {
  fixture: string
  imported: {
    elementTypes: Record<string, number>
    elements: number
    groupedElements: number
    groups: number
    hyperlinks: number
    notesSlides: number
    rotatedElements: number
    slides: number
    viewportRatio: number
    viewportSize: number
  }
}

const corpusRoot = fileURLToPath(new URL('../../../tests/corpus/', import.meta.url))
const fixtures = [
  'corpus-01-text',
  'corpus-02-shapes-lines',
  'corpus-03-media',
  'corpus-04-chart-table',
  'corpus-05-groups',
].map(name => ({
  baseline: JSON.parse(readFileSync(`${corpusRoot}baselines/${name}.json`, 'utf8')) as CorpusBaseline,
  path: `${corpusRoot}public/${name}.pptx`,
}))

const createNewPresentation = async (app: ElectronApplication, page: Page) => {
  await chooseMenuCommand(app, 'file.new', page)
  await page.waitForURL(/\/documents\/[^/?]+/)
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (
    window.__MONA_TEST__!.getState().presentation.slides[0]!.elements.length
  ))).toBe(0)
}

test.beforeEach(async ({ app, page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US'))
  await openApp(page, '?developmentFixture=slides')
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
  await configureLocalSaveFolder(app, page, join(testInfo.outputDir, 'presentations'))
  await createNewPresentation(app, page)
})

for (const fixture of fixtures) {
  test(`preserves the executable PPTX corpus baseline for ${fixture.baseline.fixture}`, async ({ app, page }) => {
    const browserProblems: string[] = []
    page.on('console', message => {
      if (message.type() === 'error' || message.type() === 'warning') {
        browserProblems.push(`${message.type()}: ${message.text()}`)
      }
    })
    page.on('pageerror', error => browserProblems.push(`pageerror: ${error.message}`))

    await importFile(app, 'pptx', fixture.path, page)
    await expect.poll(() => page.evaluate(() => (
      window.__MONA_TEST__!.getState().presentation.slides.length
    )), { timeout: 30_000 }).toBe(fixture.baseline.imported.slides)
    await expect.poll(() => page.evaluate(() => (
      window.__MONA_TEST__!.getState().presentation.slides.reduce((count, slide) => {
        const visit = (elements: typeof slide.elements): number => elements.reduce(
          (elementCount, element) => elementCount + 1 + (element.type === 'group' ? visit(element.elements) : 0),
          0,
        )
        return count + visit(slide.elements)
      }, 0)
    )), { timeout: 30_000 }).toBe(fixture.baseline.imported.elements)

    const imported = await page.evaluate(() => {
      const presentation = window.__MONA_TEST__!.getState().presentation
      const entries = presentation.slides.flatMap(slide => {
        const visit = (
          elements: typeof slide.elements,
          parentId?: string,
        ): Array<{ element: (typeof slide.elements)[number]; parentId?: string }> => elements.flatMap(element => [
          { element, parentId },
          ...(element.type === 'group' ? visit(element.elements, element.id) : []),
        ])
        return visit(slide.elements)
      })
      const elements = entries.map(entry => entry.element)
      const elementTypes = elements.reduce<Record<string, number>>((counts, element) => {
        counts[element.type] = (counts[element.type] ?? 0) + 1
        return counts
      }, {})
      const linkedRuns = elements.reduce((count, element) => {
        const html = element.type === 'text'
          ? element.content
          : element.type === 'shape'
            ? element.text?.content ?? ''
            : ''
        return count + (html.match(/<a\b[^>]*\bhref=/gi)?.length ?? 0)
      }, 0)
      return {
        elementTypes,
        groupedElements: entries.filter(entry => Boolean(entry.parentId || entry.element.groupId)).length,
        groups: elements.filter(element => element.type === 'group').length
          + new Set(elements.flatMap(element => element.groupId ? [element.groupId] : [])).size,
        // PPTX text-run links remain editable rich-text anchors and also
        // receive the element-level navigation target used in slideshow mode.
        hyperlinks: elements.filter(element => Boolean(element.link)).length + linkedRuns,
        notesSlides: presentation.slides.filter(slide => Boolean(slide.remark?.trim())).length,
        rotatedElements: elements.filter(element => Boolean(element.rotate)).length,
        viewportRatio: presentation.viewportRatio,
        viewportSize: presentation.viewportSize,
      }
    })

    expect(imported.elementTypes).toEqual(fixture.baseline.imported.elementTypes)
    expect(imported.groupedElements).toBe(fixture.baseline.imported.groupedElements)
    expect(imported.groups).toBe(fixture.baseline.imported.groups)
    expect(imported.hyperlinks).toBe(fixture.baseline.imported.hyperlinks)
    expect(imported.notesSlides).toBe(fixture.baseline.imported.notesSlides)
    expect(imported.rotatedElements).toBe(fixture.baseline.imported.rotatedElements)
    expect(imported.viewportRatio).toBeCloseTo(fixture.baseline.imported.viewportRatio, 6)
    expect(imported.viewportSize).toBeCloseTo(fixture.baseline.imported.viewportSize, 6)
    expect(browserProblems).toEqual([])

    if (fixture.baseline.fixture === 'corpus-05-groups.pptx') {
      const importedGroups = await page.evaluate(() => {
        const elements = window.__MONA_TEST__!.getState().presentation.slides[0]!.elements
        const groups = elements.filter((element): element is Extract<typeof element, { type: 'group' }> => element.type === 'group')
        return {
          elementId: groups[0]!.id,
          sizes: groups.map(group => group.elements.length).sort((a, b) => a - b),
        }
      })
      expect(importedGroups.sizes).toEqual([2, 3])
      const groupHitTarget = page.locator(`.mona-editor-slide-canvas [data-element-hit="${importedGroups.elementId}"]`)
      await groupHitTarget.click()
      await expect.poll(() => page.evaluate(() => (
        window.__MONA_TEST__!.getState().session.activeElementIds.length
      ))).toBe(1)

      const groupBefore = await page.evaluate(id => {
        const group = window.__MONA_TEST__!.getState().presentation.slides[0]!.elements
          .find(element => element.id === id)
        if (!group || group.type !== 'group') throw new Error('Semantic group not found')
        return structuredClone(group)
      }, importedGroups.elementId)
      const hitBox = await groupHitTarget.boundingBox()
      await page.mouse.move(hitBox!.x + hitBox!.width / 2, hitBox!.y + hitBox!.height / 2)
      await page.mouse.down()
      await page.mouse.move(hitBox!.x + hitBox!.width / 2 + 35, hitBox!.y + hitBox!.height / 2 + 20, { steps: 3 })
      await page.mouse.up()
      await expect.poll(() => page.evaluate(id => {
        const group = window.__MONA_TEST__!.getState().presentation.slides[0]!.elements
          .find(element => element.id === id)
        return group?.left
      }, importedGroups.elementId)).not.toBe(groupBefore.left)

      const resize = page.getByRole('button', { name: 'Resize bottom-right' })
      const resizeBox = await resize.boundingBox()
      await page.mouse.move(resizeBox!.x + resizeBox!.width / 2, resizeBox!.y + resizeBox!.height / 2)
      await page.mouse.down()
      await page.mouse.move(resizeBox!.x + 45, resizeBox!.y + 30, { steps: 3 })
      await page.mouse.up()
      await expect.poll(() => page.evaluate(({ id, width }) => {
        const group = window.__MONA_TEST__!.getState().presentation.slides[0]!.elements
          .find(element => element.id === id)
        return Boolean(group && group.width > width)
      }, { id: importedGroups.elementId, width: groupBefore.width })).toBe(true)
      const groupAfterResize = await page.evaluate(id => {
        const group = window.__MONA_TEST__!.getState().presentation.slides[0]!.elements
          .find(element => element.id === id)
        if (!group || group.type !== 'group') throw new Error('Semantic group not found')
        return structuredClone(group)
      }, importedGroups.elementId)
      expect(groupAfterResize.coordinateWidth).toBe(groupBefore.coordinateWidth)
      expect(groupAfterResize.elements).toEqual(groupBefore.elements)

      await groupHitTarget.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Copy' }).click()
      await groupHitTarget.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Paste' }).click()
      await expect.poll(() => page.evaluate(() => (
        window.__MONA_TEST__!.getState().presentation.slides[0]!.elements.filter(element => element.type === 'group').length
      ))).toBe(3)
      const groupIds = await page.evaluate(() => {
        type TreeElement = { elements?: TreeElement[]; id: string; type: string }
        const visit = (elements: TreeElement[]): string[] => (
          elements.flatMap(element => [element.id, ...(element.type === 'group' ? visit(element.elements ?? []) : [])])
        )
        return visit(window.__MONA_TEST__!.getState().presentation.slides[0]!.elements as TreeElement[])
      })
      expect(new Set(groupIds).size).toBe(groupIds.length)
      const copyProvenance = await page.evaluate(originalId => {
        const state = window.__MONA_TEST__!.getState()
        const elements = state.presentation.slides[0]!.elements
        const original = elements.find(element => element.id === originalId)
        const duplicateId = state.session.activeElementIds[0]
        const duplicate = elements.find(element => element.id === duplicateId)
        const hasNoNativeSources = (element: (typeof elements)[number]): boolean => (
          element.source === undefined
          && (element.type !== 'group' || element.elements.every(hasNoNativeSources))
        )
        return {
          duplicateDetached: Boolean(duplicate && hasNoNativeSources(duplicate)),
          originalRetained: Boolean(original?.source),
        }
      }, importedGroups.elementId)
      expect(copyProvenance).toEqual({
        duplicateDetached: true,
        originalRetained: true,
      })
      await page.keyboard.press('Delete')
      await expect.poll(() => page.evaluate(() => (
        window.__MONA_TEST__!.getState().presentation.slides[0]!.elements.filter(element => element.type === 'group').length
      ))).toBe(2)
    }

    if (fixture.baseline.fixture === 'corpus-04-chart-table.pptx') {
      const charts = page.locator('.mona-editor-slide-canvas .mona-chart-element')
      await expect(charts).toHaveCount(3)
      const chartSvgs = page.locator('.mona-editor-slide-canvas .mona-chart svg')
      await expect(chartSvgs).toHaveCount(3)
      await expect.poll(async () => {
        const renderedMarks = await chartSvgs.evaluateAll(nodes => (
          nodes.map(node => node.querySelectorAll('path, rect, polyline, polygon, circle').length)
        ))
        return renderedMarks.length === 3 && renderedMarks.every(count => count > 0)
      }).toBe(true)
    }
  })
}
