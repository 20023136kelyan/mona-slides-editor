import {
  appendGate6SlideshowFixture,
  appendGate6WorkflowFixture,
} from '@mona/presentation-core'
import { appendGate4EditorFixture } from '@mona/presentation-core/gate4-editor-fixture'
import { appendGate5MultiFixture } from '@mona/presentation-core/gate5-multi-fixture'
import type { Slide } from '@mona/presentation-core/model'

const ALLOWED_FIXTURES = new Set([
  'slides',
  'gate3-renderer',
  'gate4-editor',
  'gate5-multi',
  'gate6-workflows',
  'gate6-slideshow',
])

export const loadDevelopmentSlides = async (request: Request): Promise<Slide[]> => {
  const requestedFixture = new URL(request.url).searchParams.get('rendererFixture') || 'slides'
  const fixture = ALLOWED_FIXTURES.has(requestedFixture) ? requestedFixture : 'slides'
  const fixtureFile = fixture === 'slides' || fixture === 'gate3-renderer'
    ? fixture
    : 'gate3-renderer'
  const response = await fetch(`/mocks/${fixtureFile}.json`)
  if (!response.ok) throw new Error(`Unable to load development presentation fixture: ${response.status}`)
  const loadedSlides = await response.json() as Slide[]

  if (fixture === 'gate4-editor') return appendGate4EditorFixture(loadedSlides)
  if (fixture === 'gate5-multi') return appendGate5MultiFixture(loadedSlides)
  if (fixture === 'gate6-workflows') return appendGate6WorkflowFixture(loadedSlides)
  if (fixture === 'gate6-slideshow') return appendGate6SlideshowFixture(loadedSlides)
  return loadedSlides
}
