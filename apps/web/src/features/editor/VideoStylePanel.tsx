import { useRef, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'

import PlusIcon from '~icons/icon-park-outline/plus'
import ScreenshotIcon from '~icons/icon-park-outline/screenshot-one'
import UndoIcon from '~icons/icon-park-outline/undo'
import type { PPTVideoElement } from '@mona/presentation-core/model'

import { Button } from '@/components/ui/button'
import { InspectorSwitch } from '@/features/editor/EditorInspectorPrimitives'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

const fileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new TypeError('Expected an image data URL'))
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(file)
})

export function VideoStylePanel({ element, runtime }: { element: PPTVideoElement; runtime: EditorRuntime }) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const update = (props: Partial<PPTVideoElement>) => runtime.commit('Update video style', [{
    type: 'element.update',
    payload: { id: element.id, props },
  }])
  const setPoster = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) update({ poster: await fileAsDataUrl(file) })
  }
  const setPosterFromFirstFrame = () => {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    video.addEventListener('error', () => update({ poster: '' }))
    video.addEventListener('loadedmetadata', () => {
      video.requestVideoFrameCallback(() => {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        context?.drawImage(video, 0, 0, canvas.width, canvas.height)
        update({ poster: canvas.toDataURL('image/jpeg', .8) })
        video.remove()
        canvas.remove()
      })
    }, { once: true })
    video.src = element.src
  }
  return (
    <div className="mona-video-style-panel">
      <div className="mona-video-style-title">{t('foundation.editor.media.videoPoster')}</div>
      <div className="mona-video-poster-wrapper">
        <input accept="image/*" aria-label={t('foundation.editor.media.videoPoster')} className="mona-media-file-input" onChange={event => void setPoster(event)} ref={inputRef} type="file" />
        <Button className="mona-video-poster" onClick={() => inputRef.current?.click()} type="button" variant="ghost">
          <span className="mona-video-poster-content" style={{ backgroundImage: element.poster ? `url(${element.poster})` : '' }}><PlusIcon /></span>
        </Button>
      </div>
      <div className="flex w-full items-center mb-2.5">
        <Button className="mona-panel-button mona-media-full-button" onClick={setPosterFromFirstFrame} size="editor" type="button" variant="editor"><ScreenshotIcon /> {t('foundation.editor.media.firstFramePoster')}</Button>
      </div>
      {element.poster ? (
        <div className="flex w-full items-center mb-2.5">
          <Button className="mona-panel-button mona-media-full-button" onClick={() => update({ poster: '' })} size="editor" type="button" variant="editor"><UndoIcon /> {t('foundation.editor.media.resetPoster')}</Button>
        </div>
      ) : null}
      <div className="my-6 w-full border-t border-black/[0.06]" />
      <div className="mona-panel-row mona-media-switch-row">
        <div className="w-[48%] text-xs">{t('foundation.editor.media.autoplay')}</div>
        <div className="mona-panel-row-control mona-panel-switch-wrapper">
          <InspectorSwitch ariaLabel={t('foundation.editor.media.autoplay')} checked={element.autoplay} onChange={autoplay => update({ autoplay })} />
        </div>
      </div>
    </div>
  )
}
