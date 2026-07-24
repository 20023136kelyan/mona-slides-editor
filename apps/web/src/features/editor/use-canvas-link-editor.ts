import { useState } from 'react'
import type { TFunction } from 'i18next'

import { editorActions } from '@mona/editor-state'
import type { ElementLinkType, PPTElement } from '@mona/presentation-core/model'

import type { EditorRuntime } from '@/features/editor/editor-runtime'
import type { EditorNotificationService } from '@/features/editor/services/editor-notifications'

export interface LinkEditorState {
  readonly elementId: string
  readonly type: ElementLinkType
  readonly address: string
  readonly slideId: string
}

const WEB_LINK_PATTERN = /^(https?):\/\/[\w-]+(\.[\w-]+)+([\w-.,@?^=%&:/~+#]*[\w-@?^=%&/~+#])?$/

/**
 * Hyperlink dialog state for a canvas element. Opening it disables editor
 * hotkeys so typing a URL cannot trigger canvas shortcuts; closing restores
 * them, which is why open/close must stay paired inside this hook.
 */
export function useCanvasLinkEditor({
  notify,
  runtime,
  t,
}: {
  notify: EditorNotificationService['notify']
  runtime: EditorRuntime
  t: TFunction
}) {
  const [linkEditor, setLinkEditor] = useState<LinkEditorState | null>(null)

  const openLinkEditorFor = (element: PPTElement) => {
    const livePresentation = runtime.store.getState().presentation
    const liveSlide = livePresentation.slides[livePresentation.slideIndex]
    const defaultSlideId = livePresentation.slides.find(slide => slide.id !== liveSlide?.id)?.id ?? ''
    runtime.store.dispatch(editorActions.hotkeysDisabledChanged(true))
    setLinkEditor({
      address: element.link?.type === 'web' ? element.link.target : '',
      elementId: element.id,
      slideId: element.link?.type === 'slide' ? element.link.target : defaultSlideId,
      type: element.link?.type ?? 'web',
    })
  }

  const closeLinkEditor = () => {
    runtime.store.dispatch(editorActions.hotkeysDisabledChanged(false))
    setLinkEditor(null)
  }

  const applyLink = () => {
    if (!linkEditor) return
    const target = linkEditor.type === 'web' ? linkEditor.address : linkEditor.slideId
    if (linkEditor.type === 'web') {
      if (!WEB_LINK_PATTERN.test(target)) {
        setLinkEditor({ ...linkEditor, address: '' })
        notify({ text: t('foundation.editor.link.invalid'), type: 'error' })
        return
      }
    }
    else if (!target) {
      notify({ text: t('foundation.editor.link.selectTarget'), type: 'error' })
      return
    }
    runtime.commit('Set element link', [{
      type: 'element.update',
      payload: {
        id: linkEditor.elementId,
        props: { link: { type: linkEditor.type, target } },
      },
    }])
    closeLinkEditor()
  }

  return { applyLink, closeLinkEditor, linkEditor, openLinkEditorFor, setLinkEditor }
}
