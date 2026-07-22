import type { PPTAnimation, PPTShapeElement, PPTTextElement, Slide, TurningMode } from './model'

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
  id: `gate6-screen-transition-${turningMode}`,
  turningMode,
  background: { type: 'solid', color: index % 2 ? '#eef5f8' : '#f8f3ed' },
  elements: [text(`gate6-screen-transition-title-${turningMode}`, `Transition ${turningMode}`)],
}))

const animationSlides: Slide[] = [
  {
    id: 'gate6-screen-animations',
    turningMode: 'no',
    background: { type: 'solid', color: '#edf7f0' },
    remark: 'First line\nSecond line for presenter notes.',
    elements: [
      text('gate6-screen-animation-title', 'Animation state machine', 40),
      shape('gate6-screen-animation-in-a', 100, 170, '#b7dce8'),
      shape('gate6-screen-animation-in-b', 310, 170, '#f2dbdb'),
      shape('gate6-screen-animation-attention', 520, 170, '#f5dfa7'),
      shape('gate6-screen-animation-out', 730, 170, '#c8e1c2'),
    ],
    animations: [
      animation('gate6-animation-in-a', 'gate6-screen-animation-in-a', 'fadeIn', 'in', 'click'),
      animation('gate6-animation-in-b', 'gate6-screen-animation-in-b', 'slideInUp', 'in', 'meantime', 5200),
      animation('gate6-animation-attention', 'gate6-screen-animation-attention', 'pulse', 'attention', 'click'),
      animation('gate6-animation-out', 'gate6-screen-animation-out', 'fadeOut', 'out', 'click'),
      animation('gate6-animation-auto', 'gate6-screen-animation-title', 'heartBeat', 'attention', 'auto'),
    ],
  },
  {
    id: 'gate6-screen-auto-animations',
    turningMode: 'fade',
    background: { type: 'solid', color: '#f2edf7' },
    elements: [
      text('gate6-screen-auto-title', 'Automatic first animation', 70),
      shape('gate6-screen-auto-a', 260, 190, '#b7dce8'),
      shape('gate6-screen-auto-b', 560, 190, '#f2dbdb'),
    ],
    animations: [
      animation('gate6-auto-a', 'gate6-screen-auto-a', 'fadeIn', 'in', 'auto'),
      animation('gate6-auto-b', 'gate6-screen-auto-b', 'fadeIn', 'in', 'meantime'),
    ],
  },
  {
    id: 'gate6-screen-links',
    turningMode: 'slideX',
    background: { type: 'solid', color: '#fff8e8' },
    elements: [
      {
        ...text('gate6-screen-web-link', '<a href="https://example.com">Native anchor</a>', 120, 120, 340),
        link: { type: 'web', target: 'https://example.com' },
      },
      {
        ...shape('gate6-screen-slide-link', 560, 120, '#b7dce8'),
        link: { type: 'slide', target: 'gate6-screen-transition-no' },
      },
      text('gate6-screen-slide-link-label', 'Slide link', 245, 560, 180),
    ],
  },
]

const stressSlides: Slide[] = Array.from({ length: 44 }, (_, index) => ({
  id: `gate6-screen-stress-${String(index + 1).padStart(2, '0')}`,
  turningMode: index % 2 ? 'slideY' : 'fade',
  background: { type: 'solid', color: index % 2 ? '#f4f7fa' : '#fbf7f2' },
  elements: [text(`gate6-screen-stress-title-${index + 1}`, `Stress slide ${index + 1}`)],
}))

const gate6SlideshowSlides: readonly Slide[] = [
  ...transitionSlides,
  ...animationSlides,
  ...stressSlides,
]

export const appendGate6SlideshowFixture = (slides: readonly Slide[]): Slide[] => {
  if (slides.some(slide => slide.id === gate6SlideshowSlides[0]!.id)) return clone([...slides])
  const baseSlides = clone([...slides])
  const mediaSlide = baseSlides.find(slide => slide.id === 'gate3-slide-media')
  if (mediaSlide) {
    for (const element of mediaSlide.elements) {
      if (element.type === 'audio') {
        element.autoplay = true
        element.loop = true
      }
      else if (element.type === 'video') element.autoplay = true
    }
  }
  return [...baseSlides, ...clone(gate6SlideshowSlides)]
}
