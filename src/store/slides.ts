import { defineStore } from 'pinia'
import {
  applyPresentationCommand,
  selectCurrentSlide,
  selectCurrentSlideAnimations,
  selectFormattedCurrentSlideAnimations,
  type PresentationCommand,
  type PresentationState,
} from '@mona/presentation-core'
import type { Slide, SlideTheme, PPTElement, SlideTemplate } from '@/types/slides'
import { translate } from '@/i18n'

interface RemovePropData {
  id: string
  propName: string | string[]
}

interface UpdateElementData {
  id: string | string[]
  props: Partial<PPTElement>
  slideId?: string
}

export type SlidesState = PresentationState

const commitPresentationCommand = (
  target: PresentationState,
  command: PresentationCommand,
) => {
  const next = applyPresentationCommand(target, command).state
  if (next.title !== target.title) target.title = next.title
  if (next.theme !== target.theme) target.theme = next.theme
  if (next.slides !== target.slides) target.slides = next.slides
  if (next.slideIndex !== target.slideIndex) target.slideIndex = next.slideIndex
  if (next.viewportSize !== target.viewportSize) target.viewportSize = next.viewportSize
  if (next.viewportRatio !== target.viewportRatio) target.viewportRatio = next.viewportRatio
  if (next.templates !== target.templates) target.templates = next.templates
}

export const useSlidesStore = defineStore('slides', {
  state: (): SlidesState => ({
    title: translate('header.untitledPresentation'), // 幻灯片标题
    theme: {
      themeColors: ['#5b9bd5', '#ed7d31', '#a5a5a5', '#ffc000', '#4472c4', '#70ad47'],
      fontColor: '#333',
      fontName: '',
      backgroundColor: '#fff',
      shadow: {
        h: 3,
        v: 3,
        blur: 2,
        color: '#808080',
      },
      outline: {
        width: 2,
        color: '#525252',
        style: 'solid',
      },
    }, // 主题样式
    slides: [], // 幻灯片页面数据
    slideIndex: 0, // 当前页面索引
    viewportSize: 1000, // 可视区域宽度基数
    viewportRatio: 0.5625, // 可视区域比例，默认16:9
    templates: [
      { name: 'Crimson Landscape', id: 'template_1', cover: './imgs/template_1.webp', origin: 'Official' },
      { name: 'Urban Blue', id: 'template_2', cover: './imgs/template_2.webp', origin: 'Official' },
      { name: 'Smart Geometry', id: 'template_3', cover: './imgs/template_3.webp', origin: 'Official' },
      { name: 'Soft Morandi', id: 'template_4', cover: './imgs/template_4.webp', origin: 'Official' },
      { name: 'Minimal Green', id: 'template_5', cover: './imgs/template_5.webp', origin: 'Community contribution, refined by the official team' },
      { name: 'Warm Vintage', id: 'template_6', cover: './imgs/template_6.webp', origin: 'Community contribution, refined by the official team' },
      { name: 'Deep Focus', id: 'template_7', cover: './imgs/template_7.webp', origin: 'Community contribution, refined by the official team' },
      { name: 'Fresh Sky Blue', id: 'template_8', cover: './imgs/template_8.webp', origin: 'Community contribution, refined by the official team' },
    ], // 模板
  }),

  getters: {
    currentSlide(state) {
      return selectCurrentSlide(state)
    },
  
    currentSlideAnimations(state) {
      return selectCurrentSlideAnimations(state)
    },

    // 格式化的当前页动画
    // 将触发条件为“与上一动画同时”的项目向上合并到序列中的同一位置
    // 为触发条件为“上一动画之后”项目的上一项添加自动向下执行标记
    formatedAnimations(state) {
      return selectFormattedCurrentSlideAnimations(state)
    },
  },

  actions: {
    setTitle(title: string) {
      commitPresentationCommand(this.$state, {
        type: 'presentation.title.set',
        title,
        fallbackTitle: translate('header.untitledPresentation'),
      })
    },

    setTheme(themeProps: Partial<SlideTheme>) {
      commitPresentationCommand(this.$state, { type: 'presentation.theme.update', props: themeProps })
    },
  
    setViewportSize(size: number) {
      commitPresentationCommand(this.$state, { type: 'presentation.viewport-size.set', size })
    },
  
    setViewportRatio(viewportRatio: number) {
      commitPresentationCommand(this.$state, { type: 'presentation.viewport-ratio.set', ratio: viewportRatio })
    },
  
    setSlides(slides: Slide[], themeProps?: Partial<SlideTheme>) {
      commitPresentationCommand(this.$state, {
        type: 'presentation.slides.replace',
        slides,
        theme: themeProps,
      })
    },
  
    setTemplates(templates: SlideTemplate[]) {
      commitPresentationCommand(this.$state, { type: 'presentation.templates.replace', templates })
    },
  
    addSlide(slide: Slide | Slide[]) {
      commitPresentationCommand(this.$state, { type: 'slide.add', slides: slide })
    },
  
    updateSlide(props: Partial<Slide>, slideId?: string) {
      commitPresentationCommand(this.$state, { type: 'slide.update', props, slideId })
    },
  
    removeSlideProps(data: RemovePropData) {
      commitPresentationCommand(this.$state, {
        type: 'slide.properties.remove',
        payload: { id: data.id, property: data.propName },
      })
    },
  
    deleteSlide(slideId: string | string[]) {
      commitPresentationCommand(this.$state, { type: 'slide.delete', slideIds: slideId })
    },
  
    updateSlideIndex(index: number) {
      commitPresentationCommand(this.$state, { type: 'slide.focus', index })
    },
  
    addElement(element: PPTElement | PPTElement[]) {
      commitPresentationCommand(this.$state, { type: 'element.add', elements: element })
    },

    deleteElement(elementId: string | string[]) {
      commitPresentationCommand(this.$state, { type: 'element.delete', elementIds: elementId })
    },
  
    updateElement(data: UpdateElementData) {
      commitPresentationCommand(this.$state, { type: 'element.update', payload: data })
    },
  
    removeElementProps(data: RemovePropData) {
      commitPresentationCommand(this.$state, {
        type: 'element.properties.remove',
        payload: { id: data.id, property: data.propName },
      })
    },
  },
})
