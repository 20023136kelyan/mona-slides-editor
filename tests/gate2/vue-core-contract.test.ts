import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyPresentationCommand,
  cloneSerializable,
  normalizeSerializable,
  type PresentationCommand,
} from '@mona/presentation-core'
import {
  createGate2OperationScenarios,
  createGate2Presentation,
} from '@mona/parity-fixtures'
import { useSlidesStore } from '@/store/slides'

const applyThroughVueStore = (
  store: ReturnType<typeof useSlidesStore>,
  command: PresentationCommand,
) => {
  switch (command.type) {
    case 'presentation.title.set':
      store.setTitle(command.title)
      break
    case 'presentation.theme.update':
      store.setTheme(command.props)
      break
    case 'presentation.viewport-size.set':
      store.setViewportSize(command.size)
      break
    case 'presentation.viewport-ratio.set':
      store.setViewportRatio(command.ratio)
      break
    case 'presentation.slides.replace':
      store.setSlides(cloneSerializable(command.slides), command.theme)
      break
    case 'presentation.templates.replace':
      store.setTemplates(cloneSerializable(command.templates))
      break
    case 'slide.add':
      store.addSlide(cloneSerializable(command.slides))
      break
    case 'slide.update':
      store.updateSlide(cloneSerializable(command.props), command.slideId)
      break
    case 'slide.properties.remove':
      store.removeSlideProps({
        id: command.payload.id,
        propName: command.payload.property,
      })
      break
    case 'slide.delete':
      store.deleteSlide(command.slideIds)
      break
    case 'slide.focus':
      store.updateSlideIndex(command.index)
      break
    case 'element.add':
      store.addElement(cloneSerializable(command.elements))
      break
    case 'element.delete':
      store.deleteElement(command.elementIds)
      break
    case 'element.update':
      store.updateElement(cloneSerializable(command.payload))
      break
    case 'element.properties.remove':
      store.removeElementProps({
        id: command.payload.id,
        propName: command.payload.property,
      })
      break
  }
}

describe('Vue presentation adapter and framework-neutral core', () => {
  beforeEach(() => setActivePinia(createPinia()))

  for (const scenario of createGate2OperationScenarios()) {
    it(`produces identical normalized state: ${scenario.name}`, () => {
      const initial = createGate2Presentation()
      const expected = applyPresentationCommand(
        cloneSerializable(initial),
        cloneSerializable(scenario.command),
      ).state
      const store = useSlidesStore()
      store.$patch(cloneSerializable(initial))

      applyThroughVueStore(store, cloneSerializable(scenario.command))

      expect(normalizeSerializable(store.$state)).toEqual(normalizeSerializable(expected))
    })
  }
})
