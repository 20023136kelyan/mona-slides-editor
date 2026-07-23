import type { PPTAnimation, PPTShapeElement, PPTTextElement, Slide, TurningMode } from '@mona/presentation-core/model'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const text = (
  id: string,
  content: string,
  top = 160,
  left = 100,
  width = 800,
): PPTTextElement => ({
  type: 'text',
  id,
  left,
  top,
  width,
  height: 82,
  rotate: 0,
  content: `<p>${content}</p>`,
  defaultFontName: 'Arial',
  defaultColor: '#17324d',
  fixedHeight: true,
})

const shape = (id: string, left: number, top: number, color: string): PPTShapeElement => ({
  type: 'shape',
  id,
  left,
  top,
  width: 180,
  height: 110,
  rotate: 0,
  fixedRatio: false,
  viewBox: [180, 110],
  path: 'M 0 0 L 180 0 L 180 110 L 0 110 Z',
  fill: color,
})

const animation = (
  id: string,
  elId: string,
  effect: string,
  type: PPTAnimation['type'],
  trigger: PPTAnimation['trigger'],
  duration = 5000,
): PPTAnimation => ({ id, elId, effect, type, trigger, duration })

const transitionModes: TurningMode[] = [
  'no',
  'fade',
  'slideX',
  'slideY',
  'slideX3D',
  'slideY3D',
  'rotate',
  'scaleY',
  'scaleX',
  'scale',
  'scaleReverse',
  'random',
]

const transitionSlides: Slide[] = transitionModes.map((turningMode, index) => ({
  id: `slideshow-screen-transition-${turningMode}`,
  turningMode,
  background: { type: 'solid', color: index % 2 ? '#eef5f8' : '#f8f3ed' },
  elements: [text(`slideshow-screen-transition-title-${turningMode}`, `Transition ${turningMode}`)],
}))

const animationSlides: Slide[] = [
  {
    id: 'slideshow-screen-animations',
    turningMode: 'no',
    background: { type: 'solid', color: '#edf7f0' },
    remark: 'First line\nSecond line for presenter notes.',
    elements: [
      text('slideshow-screen-animation-title', 'Animation state machine', 40),
      shape('slideshow-screen-animation-in-a', 100, 170, '#b7dce8'),
      shape('slideshow-screen-animation-in-b', 310, 170, '#f2dbdb'),
      shape('slideshow-screen-animation-attention', 520, 170, '#f5dfa7'),
      shape('slideshow-screen-animation-out', 730, 170, '#c8e1c2'),
    ],
    animations: [
      animation('slideshow-animation-in-a', 'slideshow-screen-animation-in-a', 'fadeIn', 'in', 'click'),
      animation('slideshow-animation-in-b', 'slideshow-screen-animation-in-b', 'slideInUp', 'in', 'meantime', 5200),
      animation('slideshow-animation-attention', 'slideshow-screen-animation-attention', 'pulse', 'attention', 'click'),
      animation('slideshow-animation-out', 'slideshow-screen-animation-out', 'fadeOut', 'out', 'click'),
      animation('slideshow-animation-auto', 'slideshow-screen-animation-title', 'heartBeat', 'attention', 'auto'),
    ],
  },
  {
    id: 'slideshow-screen-auto-animations',
    turningMode: 'fade',
    background: { type: 'solid', color: '#f2edf7' },
    elements: [
      text('slideshow-screen-auto-title', 'Automatic first animation', 70),
      shape('slideshow-screen-auto-a', 260, 190, '#b7dce8'),
      shape('slideshow-screen-auto-b', 560, 190, '#f2dbdb'),
    ],
    animations: [
      animation('slideshow-auto-a', 'slideshow-screen-auto-a', 'fadeIn', 'in', 'auto'),
      animation('slideshow-auto-b', 'slideshow-screen-auto-b', 'fadeIn', 'in', 'meantime'),
    ],
  },
  {
    id: 'slideshow-screen-links',
    turningMode: 'slideX',
    background: { type: 'solid', color: '#fff8e8' },
    elements: [
      {
        ...text('slideshow-screen-web-link', '<a href="https://example.com">Native anchor</a>', 120, 120, 340),
        link: { type: 'web', target: 'https://example.com' },
      },
      {
        ...shape('slideshow-screen-slide-link', 560, 120, '#b7dce8'),
        link: { type: 'slide', target: 'slideshow-screen-transition-no' },
      },
      text('slideshow-screen-slide-link-label', 'Slide link', 245, 560, 180),
    ],
  },
]

const stressSlides: Slide[] = Array.from({ length: 44 }, (_, index) => ({
  id: `slideshow-screen-stress-${String(index + 1).padStart(2, '0')}`,
  turningMode: index % 2 ? 'slideY' : 'fade',
  background: { type: 'solid', color: index % 2 ? '#f4f7fa' : '#fbf7f2' },
  elements: [text(`slideshow-screen-stress-title-${index + 1}`, `Stress slide ${index + 1}`)],
}))

const slideshowSlides: readonly Slide[] = [
  ...transitionSlides,
  ...animationSlides,
  ...stressSlides,
]

export const appendSlideshowFixture = (slides: readonly Slide[]): Slide[] => {
  if (slides.some(slide => slide.id === slideshowSlides[0]!.id)) return clone([...slides])
  const baseSlides = clone([...slides])
  const mediaSlide = baseSlides.find(slide => slide.id === 'fixture-slide-media')
  if (mediaSlide) {
    for (const element of mediaSlide.elements) {
      if (element.type === 'audio') {
        element.autoplay = true
        element.loop = true
      }
      else if (element.type === 'video') element.autoplay = true
    }
  }
  return [...baseSlides, ...clone(slideshowSlides)]
}
