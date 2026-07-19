import {
  validatePresentationState,
  type PresentationState,
} from '@mona/presentation-core'
import type { Slide } from '@mona/presentation-core/model'

const allowedFixtures = new Set(['slides', 'gate3-renderer', 'gate4-editor'])

export async function loadPresentation({ request }: { request: Request }): Promise<PresentationState> {
  const url = new URL(request.url)
  const requestedFixture = url.searchParams.get('rendererFixture') || 'slides'
  const fixture = allowedFixtures.has(requestedFixture) ? requestedFixture : 'slides'
  const fixtureFile = fixture === 'gate4-editor' ? 'gate3-renderer' : fixture
  const response = await fetch(`/${fixtureFile}.json`)
  if (!response.ok) throw new Error(`Unable to load presentation fixture: ${response.status}`)
  const slides = await response.json() as Slide[]
  const presentation: PresentationState = {
    title: 'Untitled presentation',
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
    templates: [],
  }
  const validation = validatePresentationState(presentation)
  if (!validation.valid) {
    throw new Error(`Presentation fixture is invalid: ${validation.issues.map(issue => issue.message).join('; ')}`)
  }
  return presentation
}
