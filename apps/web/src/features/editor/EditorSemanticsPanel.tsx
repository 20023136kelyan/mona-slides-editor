import { useTranslation } from 'react-i18next'

import { selectCurrentSlide, selectSession } from '@mona/editor-state'
import type { ImageType, SlideType, TextType } from '@mona/presentation-core'

import { InspectorSelect } from '@/features/editor/EditorInspectorPrimitives'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorSelector } from '@/features/editor/use-editor-selector'

const slideTypes: SlideType[] = ['cover', 'contents', 'transition', 'content', 'end']
const textTypes: TextType[] = ['title', 'subtitle', 'content', 'item', 'itemTitle', 'notes', 'header', 'footer', 'partNumber', 'itemNumber']
const imageTypes: ImageType[] = ['pageFigure', 'itemFigure', 'background']

export function EditorSemanticsPanel({ runtime }: { runtime: EditorRuntime }) {
  const { t } = useTranslation()
  const slide = useEditorSelector(runtime.store, selectCurrentSlide)!
  const session = useEditorSelector(runtime.store, selectSession)
  const element = slide.elements.find(candidate => candidate.id === session.handleElementId)
  const updateSlide = (type: string) => runtime.commit('Label slide type', type
    ? [{ type: 'slide.update', slideId: slide.id, props: { type: type as SlideType } }]
    : [{ type: 'slide.properties.remove', payload: { id: slide.id, property: 'type' } }], { historyKey: `slide-semantics-${slide.id}` })
  const updateElement = (type: string) => {
    if (!element) return
    if (element.type === 'image') {
      runtime.commit('Label image type', type
        ? [{ type: 'element.update', payload: { id: element.id, props: { imageType: type as ImageType } } }]
        : [{ type: 'element.properties.remove', payload: { id: element.id, property: 'imageType' } }], { historyKey: `element-semantics-${element.id}` })
    }
    else if (element.type === 'text') {
      runtime.commit('Label text type', type
        ? [{ type: 'element.update', payload: { id: element.id, props: { textType: type as TextType } } }]
        : [{ type: 'element.properties.remove', payload: { id: element.id, property: 'textType' } }], { historyKey: `element-semantics-${element.id}` })
    }
    else if (element.type === 'shape' && element.text) {
      const text = structuredClone(element.text)
      if (type) text.type = type as TextType
      else delete text.type
      runtime.commit('Label shape text type', [{
        type: 'element.update',
        payload: { id: element.id, props: { text } },
      }], { historyKey: `element-semantics-${element.id}` })
    }
  }
  const semanticValue = element?.type === 'image'
    ? element.imageType ?? ''
    : element?.type === 'text'
      ? element.textType ?? ''
      : element?.type === 'shape' && element.text ? element.text.type ?? '' : ''
  const semanticKind = element?.type === 'image' ? 'image' : element?.type === 'text' || (element?.type === 'shape' && element.text) ? 'text' : null
  const slideTypeOptions = [
    { label: t('foundation.editor.markup.unlabeled'), value: '' },
    ...slideTypes.map(type => ({ label: t(`foundation.editor.markup.slide.${type}`), value: type })),
  ]
  const semanticOptions = semanticKind ? [
    { label: t('foundation.editor.markup.unlabeled'), value: '' },
    ...(semanticKind === 'image' ? imageTypes : textTypes).map(type => ({ label: t(`foundation.editor.markup.${semanticKind}.${type}`), value: type })),
  ] : []

  return (
    <div className="mona-markup-panel is-embedded">
      <div className="mona-markup-container">
        <div className="mona-markup-row">
          <div>{t('foundation.editor.markup.currentSlide')}</div>
          <InspectorSelect ariaLabel={t('foundation.editor.markup.currentSlide')} className="mona-markup-select" onChange={updateSlide} options={slideTypeOptions} value={slide.type ?? ''} />
        </div>
        {semanticKind ? (
          <div className="mona-markup-row">
            <div>{t(`foundation.editor.markup.${semanticKind === 'image' ? 'currentImage' : 'currentText'}`)}</div>
            <InspectorSelect ariaLabel={t(`foundation.editor.markup.${semanticKind === 'image' ? 'currentImage' : 'currentText'}`)} className="mona-markup-select" onChange={updateElement} options={semanticOptions} value={semanticValue} />
          </div>
        ) : <div className="mona-markup-placeholder">{t('foundation.editor.markup.placeholder')}</div>}
      </div>
    </div>
  )
}
