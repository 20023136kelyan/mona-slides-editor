import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

const expectedElementTypes = ['audio', 'chart', 'image', 'latex', 'line', 'shape', 'table', 'text', 'video']
const maxSlideDiffRatio = 0.035

function centerCrop(image: PNG, width: number, height: number): PNG {
  if (image.width === width && image.height === height) return image
  const cropped = new PNG({ width, height })
  PNG.bitblt(
    image,
    cropped,
    Math.floor((image.width - width) / 2),
    Math.floor((image.height - height) / 2),
    width,
    height,
    0,
    0,
  )
  return cropped
}

async function getReactInventory(page: Page) {
  return page.locator('.mona-thumbnail-button').evaluateAll(thumbnails => thumbnails.map(thumbnail => (
    Array.from(thumbnail.querySelectorAll('[data-element-type]')).map(element => element.getAttribute('data-element-type')).sort()
  )))
}

async function getVueInventory(page: Page) {
  return page.locator('.thumbnail-slide').evaluateAll((thumbnails, expectedTypes) => thumbnails.map(thumbnail => (
    expectedTypes.flatMap(type => Array.from({ length: thumbnail.querySelectorAll(`.base-element-${type}`).length }, () => type)).sort()
  )), expectedElementTypes)
}

async function compareDeck({
  browser,
  fixture,
  page,
  requireCompleteCoverage = false,
  slideCount,
  testInfo,
}: {
  browser: Browser
  fixture: string
  page: Page
  requireCompleteCoverage?: boolean
  slideCount: number
  testInfo: TestInfo
}) {
  const fixtureQuery = `?rendererFixture=${fixture}`
  await page.goto(`http://127.0.0.1:5174/${fixtureQuery}`)
  const vuePage = await browser.newPage()
  await vuePage.goto(`http://127.0.0.1:5173/${fixtureQuery}`)

  const reactThumbnails = page.locator('.mona-thumbnail-button .mona-slide-renderer')
  const vueThumbnails = vuePage.locator('.thumbnail-slide .elements')
  await expect(reactThumbnails).toHaveCount(slideCount)
  await expect(vueThumbnails).toHaveCount(slideCount)
  if (requireCompleteCoverage) {
    await expect(page.locator('.mona-thumbnail-rail [data-chart-ready] svg')).toBeVisible()
    await expect(vuePage.locator('.thumbnail-slide .chart svg')).toBeVisible()
  }

  const reactInventory = await getReactInventory(page)
  const vueInventory = await getVueInventory(vuePage)
  expect(reactInventory).toEqual(vueInventory)
  if (requireCompleteCoverage) expect([...new Set(reactInventory.flat())].sort()).toEqual(expectedElementTypes)

  const slideDiffRatios: number[] = []
  for (let slideIndex = 0; slideIndex < slideCount; slideIndex += 1) {
    const vueCapture = PNG.sync.read(await vueThumbnails.nth(slideIndex).screenshot({ animations: 'disabled' }))
    const reactCapture = PNG.sync.read(await reactThumbnails.nth(slideIndex).screenshot({ animations: 'disabled' }))
    const width = Math.min(vueCapture.width, reactCapture.width)
    const height = Math.min(vueCapture.height, reactCapture.height)
    const vueImage = centerCrop(vueCapture, width, height)
    const reactImage = centerCrop(reactCapture, width, height)

    const diff = new PNG({ width: vueImage.width, height: vueImage.height })
    const differentPixels = pixelmatch(
      vueImage.data,
      reactImage.data,
      diff.data,
      vueImage.width,
      vueImage.height,
      { includeAA: false, threshold: 0.1 },
    )
    const diffRatio = differentPixels / (vueImage.width * vueImage.height)
    slideDiffRatios.push(diffRatio)
    if (diffRatio > maxSlideDiffRatio) {
      const vueBuffer = PNG.sync.write(vueImage)
      const reactBuffer = PNG.sync.write(reactImage)
      const diffBuffer = PNG.sync.write(diff)
      await Promise.all([
        writeFile(testInfo.outputPath(`${fixture}-slide-${slideIndex + 1}-vue.png`), vueBuffer),
        writeFile(testInfo.outputPath(`${fixture}-slide-${slideIndex + 1}-react.png`), reactBuffer),
        writeFile(testInfo.outputPath(`${fixture}-slide-${slideIndex + 1}-diff.png`), diffBuffer),
      ])
      await testInfo.attach(`${fixture}-slide-${slideIndex + 1}-vue.png`, { body: vueBuffer, contentType: 'image/png' })
      await testInfo.attach(`${fixture}-slide-${slideIndex + 1}-react.png`, { body: reactBuffer, contentType: 'image/png' })
      await testInfo.attach(`${fixture}-slide-${slideIndex + 1}-diff.png`, { body: diffBuffer, contentType: 'image/png' })
    }
  }
  expect(
    Math.max(...slideDiffRatios),
    `slide visual differences: ${slideDiffRatios.map(ratio => ratio.toFixed(4)).join(', ')}`,
  ).toBeLessThanOrEqual(maxSlideDiffRatio)

  await vuePage.close()
}

test('matches the original three-slide Vue deck', async ({ browser, page }, testInfo) => {
  await compareDeck({ browser, fixture: 'slides', page, slideCount: 3, testInfo })
})

test('matches the complete native-element Vue renderer fixture', async ({ browser, page }, testInfo) => {
  await compareDeck({ browser, fixture: 'gate3-renderer', page, requireCompleteCoverage: true, slideCount: 4, testInfo })
})
