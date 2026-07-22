import { useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'

import UploadIcon from '~icons/icon-park-outline/upload'

const MEDIA_EXTENSION_BY_MIME: Record<string, string> = {
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/midi': 'mid',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'oga',
  'audio/wav': 'wav',
  'audio/webm': 'weba',
  'audio/x-aiff': 'aif',
  'audio/x-ms-wma': 'wma',
  'video/3gpp': '3gp',
  'video/3gpp2': '3g2',
  'video/mp4': 'mp4',
  'video/mpeg': 'mpeg',
  'video/ogg': 'ogv',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-flv': 'flv',
  'video/x-ms-wmv': 'wmv',
  'video/x-msvideo': 'avi',
}

type MediaType = 'audio' | 'video'

export function EditorMediaInput({
  onClose,
  onInsertAudio,
  onInsertVideo,
}: {
  onClose: () => void
  onInsertAudio: (payload: { ext?: string; src: string }) => void
  onInsertVideo: (payload: { ext?: string; src: string }) => void
}) {
  const { t } = useTranslation()
  const [type, setType] = useState<MediaType>('video')
  const [videoSrc, setVideoSrc] = useState('https://videos.pexels.com/video-files/29261597/12623866_640_360_24fps.mp4')
  const [audioSrc, setAudioSrc] = useState('https://freesound.org/data/previews/614/614107_11861866-lq.mp3')
  const videoInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)

  const upload = (event: ChangeEvent<HTMLInputElement>, mediaType: MediaType) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const payload = {
      src: URL.createObjectURL(file),
      ...(MEDIA_EXTENSION_BY_MIME[file.type] ? { ext: MEDIA_EXTENSION_BY_MIME[file.type] } : {}),
    }
    if (mediaType === 'video') onInsertVideo(payload)
    else onInsertAudio(payload)
  }

  const confirm = () => {
    if (type === 'video') {
      if (!videoSrc) {
        window.dispatchEvent(new CustomEvent('mona:notice', { detail: { text: t('foundation.editor.media.invalidVideo'), type: 'error' } }))
        return
      }
      onInsertVideo({ src: videoSrc })
    }
    else {
      if (!audioSrc) {
        window.dispatchEvent(new CustomEvent('mona:notice', { detail: { text: t('foundation.editor.media.invalidAudio'), type: 'error' } }))
        return
      }
      onInsertAudio({ src: audioSrc })
    }
  }

  return (
    <div className="mona-media-input">
      <div className="mona-media-tabs" role="tablist">
        {(['video', 'audio'] as const).map(value => (
          <button
            aria-selected={type === value}
            className={type === value ? 'is-active' : ''}
            key={value}
            onClick={() => setType(value)}
            role="tab"
            type="button"
          >{t(`foundation.editor.media.${value}`)}</button>
        ))}
      </div>
      <label className="mona-media-url-input">
        <input
          aria-label={t(`foundation.editor.media.${type}Placeholder`)}
          onChange={event => type === 'video' ? setVideoSrc(event.target.value) : setAudioSrc(event.target.value)}
          placeholder={t(`foundation.editor.media.${type}Placeholder`)}
          type="text"
          value={type === 'video' ? videoSrc : audioSrc}
        />
      </label>
      <div className="mona-media-actions">
        <input
          accept={`${type}/*`}
          aria-label={t(`foundation.editor.media.upload${type === 'video' ? 'Video' : 'Audio'}`)}
          className="mona-media-file-input"
          key={type}
          onChange={event => upload(event, type)}
          ref={type === 'video' ? videoInputRef : audioInputRef}
          type="file"
        />
        <button className="mona-media-button" onClick={() => (type === 'video' ? videoInputRef : audioInputRef).current?.click()} type="button">
          <UploadIcon /> {t(`foundation.editor.media.upload${type === 'video' ? 'Video' : 'Audio'}`)}
        </button>
        <div className="mona-media-confirm-actions">
          <button className="mona-media-button" onClick={onClose} type="button">{t('foundation.editor.media.cancel')}</button>
          <button className="mona-media-button is-primary" onClick={confirm} type="button">{t('foundation.editor.media.confirm')}</button>
        </div>
      </div>
    </div>
  )
}
