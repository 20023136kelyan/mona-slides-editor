import type { ComponentProps } from 'react'
import { expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import type {
  PowerPointPackageReference,
  PPTTextElement,
  Slide,
  SlideTheme,
} from '@mona/presentation-core'

import { SlideRenderer } from '@/features/presentation-renderer/SlideRenderer'

const theme: SlideTheme = {
  backgroundColor: '#ffffff',
  fontColor: '#111111',
  fontName: 'Arial',
  outline: { color: '#111111', style: 'solid', width: 1 },
  shadow: { blur: 0, color: '#000000', h: 0, v: 0 },
  themeColors: [],
}

const field = (
  id: string,
  type: 'ftr' | 'sldNum',
  layer: 'layout' | 'master' | 'slide',
): PPTTextElement => ({
  content: `<p>${type === 'sldNum' ? '‹#›' : 'Corporate footer'}</p>`,
  defaultColor: '#111111',
  defaultFontName: 'Arial',
  fixedHeight: true,
  height: 40,
  id,
  left: 40,
  rotate: 0,
  source: {
    kind: 'pptx',
    packageId: 'pptx:source',
    placeholderType: type,
    slidePart: 'ppt/slides/slide2.xml',
    sourceLayer: layer,
    stableId: `${layer}-${id}`,
  },
  top: type === 'sldNum' ? 500 : 460,
  type: 'text',
  width: 200,
})

test('renders the resolved hierarchy background and the slide\'s own fields', async () => {
  const footer = field('master-footer', 'ftr', 'master')
  const layoutFooter = field('layout-footer', 'ftr', 'layout')
  const slideNumber = field('layout-number', 'sldNum', 'layout')
  // Enabling a field writes the placeholder onto the slide; the layout and
  // master copies stay prompts.
  const slideFooter = field('slide-footer', 'ftr', 'slide')
  const slideNumberOnSlide = field('slide-number', 'sldNum', 'slide')
  const sourcePackage: PowerPointPackageReference = {
    byteLength: 100,
    fileName: 'hierarchy.pptx',
    hierarchy: {
      layouts: [{
        background: { color: '#224466', type: 'solid' },
        elements: [layoutFooter, slideNumber],
        id: 'layout-1',
        masterId: 'master-1',
        objectIds: [],
        packageId: 'pptx:source',
        partPath: 'ppt/slideLayouts/slideLayout1.xml',
        preserve: false,
        showMasterPlaceholderAnimations: true,
        showMasterShapes: true,
      }],
      masters: [{
        elements: [footer],
        headerFooter: {
          dateTime: false,
          footer: true,
          header: false,
          slideNumber: true,
        },
        id: 'master-1',
        layoutIds: ['layout-1'],
        objectIds: [],
        packageId: 'pptx:source',
        partPath: 'ppt/slideMasters/slideMaster1.xml',
        preserve: false,
      }],
      placeholders: [],
      themes: [],
    },
    kind: 'pptx',
    packageId: 'pptx:source',
    slides: [
      { slidePart: 'ppt/slides/slide1.xml' },
      {
        backgroundSource: 'layout',
        layoutPart: 'ppt/slideLayouts/slideLayout1.xml',
        masterPart: 'ppt/slideMasters/slideMaster1.xml',
        slidePart: 'ppt/slides/slide2.xml',
      },
    ],
  }
  const slide: Slide = {
    background: { color: '#ffffff', type: 'solid' },
    elements: [slideFooter, slideNumberOnSlide],
    id: 'slide-2',
    source: {
      ...sourcePackage.slides[1]!,
      kind: 'pptx',
      packageId: sourcePackage.packageId,
    },
  }

  await render(
    <SlideRenderer
      slide={slide}
      sourcePackages={[sourcePackage]}
      theme={theme}
      viewportRatio={0.5625}
      viewportSize={1000}
    />,
  )

  await expect.element(page.getByText('Corporate footer')).toBeVisible()
  await expect.element(page.getByText('2')).toBeVisible()
  expect(document.querySelectorAll('[data-pptx-layer="master"]')).toHaveLength(0)
  expect(document.querySelectorAll('[data-pptx-layer="layout"]')).toHaveLength(0)
  expect(document.querySelectorAll('[data-pptx-layer="slide"]')).toHaveLength(2)
  expect(getComputedStyle(document.querySelector('.mona-slide-renderer')!).backgroundColor).toBe('rgb(34, 68, 102)')
})

test('renders compiled structured text inheritance and body columns', async () => {
  const text: PPTTextElement = {
    content: '<p>Compatibility adapter</p>',
    defaultColor: '#000000',
    defaultFontName: 'Arial',
    fixedHeight: true,
    height: 180,
    id: 'body-text',
    left: 40,
    rotate: 0,
    source: {
      kind: 'pptx',
      packageId: 'pptx:source',
      placeholderType: 'body',
      slidePart: 'ppt/slides/slide1.xml',
      sourceLayer: 'slide',
      stableId: 'slide-body',
    },
    structuredText: {
      bodyProperties: {
        columnCount: 2,
        columnSpacing: 12,
      },
      listStyle: [],
      paragraphs: [{
        level: 0,
        properties: { alignment: 'ctr' },
        runs: [{ kind: 'text', sourceId: 'body.p0.r0', text: 'Styled body' }],
        sourceId: 'body.p0',
      }],
      scale: 2,
      schemaVersion: 1,
    },
    top: 40,
    type: 'text',
    width: 500,
  }
  const sourcePackage: PowerPointPackageReference = {
    byteLength: 100,
    fileName: 'structured.pptx',
    hierarchy: {
      layouts: [{
        id: 'layout-1',
        masterId: 'master-1',
        objectIds: [],
        packageId: 'pptx:source',
        partPath: 'ppt/slideLayouts/slideLayout1.xml',
        preserve: false,
        showMasterPlaceholderAnimations: true,
        showMasterShapes: true,
      }],
      masters: [{
        id: 'master-1',
        layoutIds: ['layout-1'],
        objectIds: [],
        packageId: 'pptx:source',
        partPath: 'ppt/slideMasters/slideMaster1.xml',
        preserve: false,
        textStyles: {
          body: [{
            level: 1,
            paragraph: { lineSpacing: { unit: 'percent', value: 120 } },
            run: {
              color: { type: 'scheme', value: 'tx1' },
              fontFamily: '+mn-lt',
              fontSize: 18,
            },
          }],
          other: [],
          title: [],
        },
        themeId: 'theme-1',
      }],
      placeholders: [],
      themes: [{
        colors: [{ name: 'dk1', type: 'srgb', value: '123456' }],
        id: 'theme-1',
        minorFont: { latin: 'Aptos', supplemental: [] },
        packageId: 'pptx:source',
        partPath: 'ppt/theme/theme1.xml',
      }],
    },
    kind: 'pptx',
    packageId: 'pptx:source',
    slides: [{
      layoutPart: 'ppt/slideLayouts/slideLayout1.xml',
      masterPart: 'ppt/slideMasters/slideMaster1.xml',
      slidePart: 'ppt/slides/slide1.xml',
      themeId: 'theme-1',
    }],
  }
  const slide: Slide = {
    elements: [text],
    id: 'slide-1',
    source: {
      ...sourcePackage.slides[0]!,
      kind: 'pptx',
      packageId: sourcePackage.packageId,
    },
  }

  await render(
    <SlideRenderer
      slide={slide}
      sourcePackages={[sourcePackage]}
      theme={theme}
      viewportRatio={0.5625}
      viewportSize={1000}
    />,
  )

  await expect.element(page.getByText('Styled body')).toBeVisible()
  const paragraph = document.querySelector<HTMLElement>('[data-ppt-paragraph-id="body.p0"]')!
  const run = document.querySelector<HTMLElement>('[data-ppt-run-id="body.p0.r0"]')!
  const textContent = document.querySelector<HTMLElement>('.mona-text-content')!
  expect(getComputedStyle(paragraph).textAlign).toBe('center')
  expect(getComputedStyle(paragraph).lineHeight).toBe('43.2px')
  expect(getComputedStyle(run).fontFamily).toContain('Aptos')
  expect(getComputedStyle(run).fontSize).toBe('36px')
  expect(getComputedStyle(run).color).toBe('rgb(18, 52, 86)')
  expect(getComputedStyle(textContent).columnCount).toBe('2')
  expect(getComputedStyle(textContent).columnGap).toBe('24px')
})

test('makes an inherited object materializable only when the editor supplies the handler', async () => {
  const inherited: PPTTextElement = {
    content: '<p>Inherited decoration</p>',
    defaultColor: '#111111',
    defaultFontName: 'Arial',
    fixedHeight: true,
    height: 50,
    id: 'layout-decoration',
    left: 80,
    rotate: 0,
    source: {
      kind: 'pptx',
      packageId: 'pptx:source',
      slidePart: 'ppt/slides/slide1.xml',
      sourceLayer: 'layout',
      sourceObjectId: 'pptx:source/ppt/slideLayouts/slideLayout1.xml#8',
      sourcePart: 'ppt/slideLayouts/slideLayout1.xml',
      stableId: 'pptx:source/ppt/slideLayouts/slideLayout1.xml#8',
    },
    top: 80,
    type: 'text',
    width: 300,
  }
  const sourcePackage: PowerPointPackageReference = {
    byteLength: 100,
    fileName: 'inherited.pptx',
    hierarchy: {
      layouts: [{
        elements: [inherited],
        id: 'layout-1',
        masterId: 'master-1',
        objectIds: [inherited.source!.sourceObjectId!],
        packageId: 'pptx:source',
        partPath: 'ppt/slideLayouts/slideLayout1.xml',
        preserve: false,
        showMasterPlaceholderAnimations: true,
        showMasterShapes: true,
      }],
      masters: [{
        id: 'master-1',
        layoutIds: ['layout-1'],
        objectIds: [],
        packageId: 'pptx:source',
        partPath: 'ppt/slideMasters/slideMaster1.xml',
        preserve: false,
      }],
      placeholders: [],
      themes: [],
    },
    kind: 'pptx',
    packageId: 'pptx:source',
    slides: [{
      layoutPart: 'ppt/slideLayouts/slideLayout1.xml',
      masterPart: 'ppt/slideMasters/slideMaster1.xml',
      slidePart: 'ppt/slides/slide1.xml',
    }],
  }
  const slide: Slide = {
    elements: [],
    id: 'slide-1',
    source: {
      ...sourcePackage.slides[0]!,
      kind: 'pptx',
      packageId: sourcePackage.packageId,
    },
  }
  const onInheritedPointerDown = vi.fn<NonNullable<
    ComponentProps<typeof SlideRenderer>['onInheritedPointerDown']
  >>()

  await render(
    <SlideRenderer
      onInheritedPointerDown={onInheritedPointerDown}
      slide={slide}
      sourcePackages={[sourcePackage]}
      theme={theme}
      viewportRatio={0.5625}
      viewportSize={1000}
    />,
  )

  const inheritedLayer = document.querySelector<HTMLElement>('[data-pptx-layer="layout"]')!
  expect(getComputedStyle(inheritedLayer).pointerEvents).not.toBe('none')
  await page.getByText('Inherited decoration').click({ force: true })
  expect(onInheritedPointerDown).toHaveBeenCalledOnce()
  expect(onInheritedPointerDown.mock.calls[0]?.[1]).toBe(inherited)
})
