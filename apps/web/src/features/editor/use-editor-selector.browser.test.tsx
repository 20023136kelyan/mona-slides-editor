import { Profiler } from 'react'
import { expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import { editorActions } from '@mona/editor-state'
import type { PresentationState } from '@mona/presentation-core'

import { createEditorRuntime, type EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorSelector } from '@/features/editor/use-editor-selector'

const presentation: PresentationState = {
  title: 'Selector fixture',
  slides: [{ id: 'slide-1', elements: [] }],
  slideIndex: 0,
  viewportSize: 1000,
  viewportRatio: 0.5625,
  theme: {
    themeColors: [],
    fontColor: '#000',
    fontName: 'Arial',
    backgroundColor: '#fff',
    shadow: { h: 0, v: 0, blur: 0, color: '#000' },
    outline: { width: 1, color: '#000', style: 'solid' },
  },
  templates: [],
}

const SelectorProbe = ({ runtime }: { runtime: EditorRuntime }) => {
  const title = useEditorSelector(
    runtime.store,
    state => ({ value: state.presentation.title }),
    (previous, next) => previous.value === next.value,
  )
  return <output data-testid="derived-probe">{title.value}</output>
}

const PrimitiveProbe = ({ runtime }: { runtime: EditorRuntime }) => {
  const title = useEditorSelector(runtime.store, state => state.presentation.title)
  return <output data-testid="primitive-probe">{title}</output>
}

test('only re-renders selector consumers when their selected value changes', async () => {
  let derivedCommitCount = 0
  let primitiveCommitCount = 0
  const runtime = createEditorRuntime(presentation)
  await render(
    <>
      <Profiler id="derived" onRender={() => {
        derivedCommitCount += 1
      }}>
        <SelectorProbe runtime={runtime} />
      </Profiler>
      <Profiler id="primitive" onRender={() => {
        primitiveCommitCount += 1
      }}>
        <PrimitiveProbe runtime={runtime} />
      </Profiler>
    </>,
  )

  const derived = page.getByTestId('derived-probe')
  const primitive = page.getByTestId('primitive-probe')
  const initialDerived = derivedCommitCount
  const initialPrimitive = primitiveCommitCount

  runtime.store.dispatch(editorActions.selectionChanged(['not-a-real-element']))
  await new Promise(resolve => setTimeout(resolve, 0))
  await expect.element(derived).toHaveTextContent('Selector fixture')
  await expect.element(primitive).toHaveTextContent('Selector fixture')
  expect(derivedCommitCount).toBe(initialDerived)
  expect(primitiveCommitCount).toBe(initialPrimitive)

  runtime.commit('Rename', [{
    type: 'presentation.title.set',
    title: 'Changed title',
    fallbackTitle: 'Untitled presentation',
  }], { recordHistory: false })
  await expect.element(derived).toHaveTextContent('Changed title')
  await expect.element(primitive).toHaveTextContent('Changed title')
  expect(derivedCommitCount).toBeGreaterThan(initialDerived)
  expect(primitiveCommitCount).toBeGreaterThan(initialPrimitive)
})
