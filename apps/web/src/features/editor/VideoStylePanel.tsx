import { useTranslation } from 'react-i18next'

import PlusIcon from '~icons/icon-park-outline/plus'
import ScreenshotIcon from '~icons/icon-park-outline/screenshot-one'
import UndoIcon from '~icons/icon-park-outline/undo'
import type { PPTVideoElement } from '@mona/presentation-core/model'

import { Button } from '@/components/ui/button'
import { InspectorSwitch, inspectorDividerClass, inspectorRowClass } from '@/features/editor/EditorInspectorPrimitives'
import { PropertyRow } from '@/features/editor/ElementStyleCommons'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { PRESENTATION_FILTERS, pickFile } from '@/features/editor/editor-files'

const fileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new TypeError('Expected an image data URL'))
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(file)
})

export function VideoStylePanel({ element, runtime }: { element: PPTVideoElement; runtime: EditorRuntime }) {
  const { t } = useTranslation()
  const update = (props: Partial<PPTVideoElement>) => runtime.commit('Update video style', [{
    type: 'element.update',
    payload: { id: element.id, props },
  }])
  const setPoster = async () => {
    const file = await pickFile(PRESENTATION_FILTERS.image, { title: t('foundation.editor.media.videoPoster') })
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
    <div className="text-control text-foreground select-none">
      <div className="mb-2.5">{t('foundation.editor.media.videoPoster')}</div>
      <div className="mb-2.5">
        <Button className="relative block h-0 w-full rounded-control border border-dashed p-0 pb-[56.25%] transition-all hover:border-foreground hover:text-foreground" onClick={() => { void setPoster() }} type="button" variant="ghost">
          <span className="absolute inset-0 flex items-center justify-center bg-contain bg-center bg-no-repeat" style={{ backgroundImage: element.poster ? `url(${element.poster})` : '' }}><PlusIcon /></span>
        </Button>
      </div>
      <div className={inspectorRowClass}>
        <Button className="w-full flex-1" onClick={setPosterFromFirstFrame} size="editor" type="button" variant="editor"><ScreenshotIcon /> {t('foundation.editor.media.firstFramePoster')}</Button>
      </div>
      {element.poster ? (
        <div className={inspectorRowClass}>
          <Button className="w-full flex-1" onClick={() => update({ poster: '' })} size="editor" type="button" variant="editor"><UndoIcon /> {t('foundation.editor.media.resetPoster')}</Button>
        </div>
      ) : null}
      <div className={inspectorDividerClass} />
      <PropertyRow label={t('foundation.editor.media.autoplay')}>
        <div className="w-full text-right">
          <InspectorSwitch ariaLabel={t('foundation.editor.media.autoplay')} checked={element.autoplay} onChange={autoplay => update({ autoplay })} />
        </div>
      </PropertyRow>
    </div>
  )
}
