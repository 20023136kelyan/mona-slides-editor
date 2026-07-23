import {
  DEFAULT_TEMPLATE_CATALOG,
  validatePresentationState,
  type PresentationState,
} from '@mona/presentation-core'
import type { Slide } from '@mona/presentation-core/model'

import { isPersistenceEnabled, restoreWorkingDeck } from '@/features/editor/editor-persistence'
import { i18n } from '@/i18n'

const fetchProductionSlides = async (): Promise<Slide[]> => {
  const response = await fetch('/mocks/default-deck.json')
  if (!response.ok) throw new Error(`Unable to load presentation: ${response.status}`)
  return response.json() as Promise<Slide[]>
}

const loadSlides = async (request: Request): Promise<Slide[]> => {
  // The fixture path also serves production-preview stability runs. The
  // module stays a lazy chunk that ordinary sessions never fetch, and the
  // fixture base JSON is pruned from real builds by exclude-development-fixtures.
  if (import.meta.env.DEV || new URL(request.url).searchParams.has('developmentFixture')) {
    const { loadDevelopmentSlides } = await import('./load-development-slides')
    return loadDevelopmentSlides(request)
  }

  return fetchProductionSlides()
}

export async function loadPresentation({ request }: { request: Request }): Promise<PresentationState> {
  // A persisted working copy takes precedence over the default deck; fixture
  // and audience sessions never consult it (isPersistenceEnabled).
  if (isPersistenceEnabled(new URL(request.url))) {
    const restored = await restoreWorkingDeck()
    if (restored) return restored
  }

  const slides = await loadSlides(request)
  const presentation: PresentationState = {
    title: i18n.t('header.untitledPresentation'),
    theme: {
      themeColors: ['#5b9bd5', '#ed7d31', '#a5a5a5', '#ffc000', '#4472c4', '#70ad47'],
      fontColor: '#333',
      fontName: '',
      backgroundColor: '#fff',
      shadow: { h: 3, v: 3, blur: 2, color: '#808080' },
      outline: { width: 2, color: '#525252', style: 'solid' },
    },
    slides,
    slideIndex: 0,
    viewportSize: 1000,
    viewportRatio: 0.5625,
    templates: structuredClone([...DEFAULT_TEMPLATE_CATALOG]),
  }
  const validation = validatePresentationState(presentation)
  if (!validation.valid) {
    throw new Error(`Presentation fixture is invalid: ${validation.issues.map(issue => issue.message).join('; ')}`)
  }
  return presentation
}
