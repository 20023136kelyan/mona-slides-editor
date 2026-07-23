import type {
  PPTElement,
  PPTShapeElement,
  PresentationCommand,
  PresentationState,
  Slide,
  SlideTheme,
} from '@mona/presentation-core'

const createShape = (id: string, left: number, top = 40): PPTShapeElement => ({
  type: 'shape',
  id,
  left,
  top,
  width: 120,
  height: 80,
  rotate: 0,
  viewBox: [120, 80],
  path: 'M 0 0 L 120 0 L 120 80 L 0 80 Z',
  fixedRatio: false,
  fill: '#5b9bd5',
})

export const createTestTheme = (): SlideTheme => ({
  themeColors: ['#5b9bd5', '#ed7d31', '#a5a5a5'],
  fontColor: '#333',
  fontName: '',
  backgroundColor: '#fff',
  shadow: { h: 3, v: 3, blur: 2, color: '#808080' },
  outline: { width: 2, color: '#525252', style: 'solid' },
})

export const createTestPresentation = (): PresentationState => ({
  title: 'Presentation fixture',
  theme: createTestTheme(),
  slides: [
    {
      id: 'fixture-slide-1',
      elements: [
        createShape('fixture-shape-1', 40),
        {
          type: 'text',
          id: 'fixture-text-1',
          left: 220,
          top: 40,
          width: 300,
          height: 70,
          rotate: 0,
          content: '<p>Framework-neutral</p>',
          defaultFontName: '',
          defaultColor: '#333',
          opacity: 0.8,
        },
      ],
      background: { type: 'solid', color: '#fff' },
      remark: 'Core fixture note',
    },
    {
      id: 'fixture-slide-2',
      elements: [createShape('fixture-shape-2', 80)],
      background: { type: 'solid', color: '#f2f2f2' },
      sectionTag: { id: 'fixture-section', title: 'Section' },
    },
    {
      id: 'fixture-slide-3',
      elements: [createShape('fixture-shape-3', 120)],
      background: { type: 'solid', color: '#fff' },
    },
  ],
  slideIndex: 0,
  viewportSize: 1000,
  viewportRatio: 0.5625,
  templates: [{ id: 'fixture-template', name: 'Fixture', cover: './fixture.webp' }],
})

export interface OperationScenario {
  name: string
  command: PresentationCommand
}

export const createOperationScenarios = (): OperationScenario[] => {
  const replacementSlide: Slide = {
    id: 'replacement-slide',
    elements: [createShape('replacement-shape', 10)],
  }
  const addedShape: PPTElement = createShape('added-shape', 560)

  return [
    {
      name: 'set title',
      command: { type: 'presentation.title.set', title: 'Renamed fixture', fallbackTitle: 'Untitled presentation' },
    },
    {
      name: 'update theme',
      command: { type: 'presentation.theme.update', props: { fontColor: '#123456' } },
    },
    {
      name: 'set viewport size',
      command: { type: 'presentation.viewport-size.set', size: 1280 },
    },
    {
      name: 'set viewport ratio',
      command: { type: 'presentation.viewport-ratio.set', ratio: 0.75 },
    },
    {
      name: 'replace slides and merge theme',
      command: {
        type: 'presentation.slides.replace',
        slides: [replacementSlide],
        theme: { backgroundColor: '#fefefe' },
      },
    },
    {
      name: 'replace templates',
      command: {
        type: 'presentation.templates.replace',
        templates: [{ id: 'template-2', name: 'Second', cover: './second.webp' }],
      },
    },
    {
      name: 'add slide after current',
      command: {
        type: 'slide.add',
        slides: { id: 'added-slide', elements: [], sectionTag: { id: 'removed-on-add' } },
      },
    },
    {
      name: 'update slide by ID',
      command: { type: 'slide.update', slideId: 'fixture-slide-2', props: { remark: 'Updated' } },
    },
    {
      name: 'remove slide property',
      command: {
        type: 'slide.properties.remove',
        payload: { id: 'fixture-slide-1', property: 'remark' },
      },
    },
    {
      name: 'delete section-leading slide',
      command: { type: 'slide.delete', slideIds: 'fixture-slide-2' },
    },
    {
      name: 'focus slide',
      command: { type: 'slide.focus', index: 2 },
    },
    {
      name: 'add element',
      command: { type: 'element.add', elements: addedShape },
    },
    {
      name: 'delete element',
      command: { type: 'element.delete', elementIds: 'fixture-shape-1' },
    },
    {
      name: 'update element',
      command: {
        type: 'element.update',
        payload: { id: 'fixture-shape-1', props: { left: 333, opacity: 0.4 } },
      },
    },
    {
      name: 'remove element property',
      command: {
        type: 'element.properties.remove',
        payload: { id: 'fixture-text-1', property: 'opacity' },
      },
    },
  ]
}

export interface LargeDeckOptions {
  slideCount?: number
  elementsPerSlide?: number
}

export const createLargeTestPresentation = (
  options: LargeDeckOptions = {},
): PresentationState => {
  const slideCount = options.slideCount ?? 120
  const elementsPerSlide = options.elementsPerSlide ?? 40
  const slides: Slide[] = []

  for (let slideIndex = 0; slideIndex < slideCount; slideIndex += 1) {
    const elements: PPTElement[] = []
    for (let elementIndex = 0; elementIndex < elementsPerSlide; elementIndex += 1) {
      elements.push(createShape(
        `stress-element-${slideIndex}-${elementIndex}`,
        (elementIndex % 8) * 120,
        Math.floor(elementIndex / 8) * 90,
      ))
    }
    slides.push({
      id: `stress-slide-${slideIndex}`,
      elements,
      background: { type: 'solid', color: slideIndex % 2 === 0 ? '#fff' : '#f8f8f8' },
    })
  }

  return {
    title: 'Editor state stress deck',
    theme: createTestTheme(),
    slides,
    slideIndex: Math.floor(slideCount / 2),
    viewportSize: 1000,
    viewportRatio: 0.5625,
    templates: [],
  }
}
