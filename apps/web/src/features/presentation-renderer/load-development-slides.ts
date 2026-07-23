import { appendEditorInteractionFixture } from '@mona/test-fixtures/editor-interactions'
import { appendMultiElementFixture } from '@mona/test-fixtures/multi-elements'
import { appendSlideshowFixture } from '@mona/test-fixtures/slideshow'
import { appendWorkflowFixture } from '@mona/test-fixtures/workflows'
import type { Slide } from '@mona/presentation-core/model'

const ALLOWED_FIXTURES = new Set([
  'slides',
  'renderer',
  'editor-interactions',
  'multi-elements',
  'workflows',
  'slideshow',
])

export const loadDevelopmentSlides = async (request: Request): Promise<Slide[]> => {
  const requestedFixture = new URL(request.url).searchParams.get('developmentFixture') || 'slides'
  const fixture = ALLOWED_FIXTURES.has(requestedFixture) ? requestedFixture : 'slides'
  const fixtureFile = fixture === 'slides' ? 'default-deck' : 'editor-fixture'
  const response = await fetch(`/mocks/${fixtureFile}.json`)
  if (!response.ok) throw new Error(`Unable to load development presentation fixture: ${response.status}`)
  const loadedSlides = await response.json() as Slide[]

  if (fixture === 'editor-interactions') return appendEditorInteractionFixture(loadedSlides)
  if (fixture === 'multi-elements') return appendMultiElementFixture(loadedSlides)
  if (fixture === 'workflows') return appendWorkflowFixture(loadedSlides)
  if (fixture === 'slideshow') return appendSlideshowFixture(loadedSlides)
  return loadedSlides
}
