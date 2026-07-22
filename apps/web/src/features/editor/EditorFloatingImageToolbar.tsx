import { useLayoutEffect, useRef, type ChangeEvent, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import TailoringIcon from '~icons/icon-park-outline/tailoring'
import TransformIcon from '~icons/icon-park-outline/transform'
import type { PPTImageElement } from '@mona/presentation-core/model'
import { editorActions } from '@mona/editor-state'

import { getReplacementImageCommands } from '@/features/editor/editor-image'
import { getElementBounds } from '@/features/editor/editor-geometry'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

export function EditorFloatingImageToolbar({
  element,
  frameRef,
  runtime,
  scale,
  stageRef,
}: {
  element: PPTImageElement
  frameRef: RefObject<HTMLDivElement | null>
  runtime: EditorRuntime
  scale: number
  stageRef: RefObject<HTMLElement | null>
}) {
  const { t } = useTranslation()
  const toolbarRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current
    const frame = frameRef.current
    const stage = stageRef.current
    if (!toolbar || !frame || !stage) return undefined
    const update = () => {
      const range = getElementBounds(element)
      const stageRect = stage.getBoundingClientRect()
      const frameRect = frame.getBoundingClientRect()
      const availableTop = stageRect.top - frameRect.top
      const availableBottom = stageRect.bottom - frameRect.top
      const availableLeft = stageRect.left - frameRect.left
      const availableRight = stageRect.right - frameRect.left
      const minimumLeft = availableLeft + 10
      const maximumLeft = availableRight - toolbar.clientWidth - 10
      const requestedLeft = range.minX * scale
      const left = maximumLeft < minimumLeft ? minimumLeft : Math.min(Math.max(requestedLeft, minimumLeft), maximumLeft)
      const bottomTop = range.maxY * scale + 10
      const requestedTop = stageRect.height && bottomTop + 40 > availableBottom
        ? range.minY * scale - 40 - 40
        : bottomTop
      toolbar.style.left = `${left}px`
      toolbar.style.top = `${Math.max(availableTop + 10, requestedTop)}px`
      toolbar.style.visibility = 'visible'
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(toolbar)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [element, frameRef, scale, stageRef])

  const replaceImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    runtime.commit('Replace image', await getReplacementImageCommands(element, file), { historyKey: `image-replace-${element.id}` })
  }

  return (
    <div className="mona-floating-toolbar mona-floating-image-toolbar" onPointerDown={event => event.stopPropagation()} ref={toolbarRef} style={{ visibility: 'hidden' }}>
      <div className="mona-floating-toolbar-content">
        <button className="mona-floating-toolbar-button is-labeled" onClick={() => runtime.store.dispatch(editorActions.cropElementChanged(element.id))} type="button"><TailoringIcon /><span>{t('foundation.editor.image.crop')}</span></button>
        <input accept="image/*" aria-label={t('foundation.editor.image.replaceImage')} className="mona-visually-hidden" onChange={replaceImage} ref={inputRef} type="file" />
        <button className="mona-floating-toolbar-button is-labeled" onClick={() => inputRef.current?.click()} type="button"><TransformIcon /><span>{t('foundation.editor.image.replace')}</span></button>
      </div>
    </div>
  )
}
