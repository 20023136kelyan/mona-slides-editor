import { useEffect, useState } from 'react'
import { monaBridge } from '@/lib/mona-bridge'

import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'

import { useEditorPanelSearch } from '@/features/editor/panel/editor-panel-search'
import {
  PanelBody,
  PanelChrome,
  PanelEmptyState,
  PanelErrorRow,
  PanelLoadingRow,
  PanelNoResults,
} from '@/features/editor/panel/EditorPanelPrimitives'

interface StockVideo {
  alt: string
  attribution: string
  duration: number
  height: number
  id: string
  poster: string
  src: string
  width: number
}

const formatDuration = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Stock video search, the sibling of the Photos panel. Results are *linked*,
 * not imported: a clip is tens of megabytes, so the deck stores the remote URL
 * and its poster still rather than the file.
 */
export function EditorVideosPanel({
  onInsertVideo,
}: {
  onInsertVideo: (payload: { ext?: string; poster?: string; src: string }) => void
}) {
  const { t } = useTranslation()
  const search = useEditorPanelSearch()
  const submitted = search.submitted
  const [videos, setVideos] = useState<StockVideo[]>([])
  const [status, setStatus] = useState<'error' | 'idle' | 'loading'>('idle')

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    monaBridge().browseMedia<{ videos?: StockVideo[] }>('videos', { perPage: 24, query: submitted || 'abstract' })
      .then(payload => {
        if (cancelled) return
        setVideos(payload.videos ?? [])
        setStatus('idle')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    // A result that outlives its panel is discarded rather than aborted: IPC
    // carries no signal, and one wasted stock-photo response is cheaper than
    // threading cancellation through the bridge for it.
    return () => { cancelled = true }
  }, [submitted])

  return (
    <PanelChrome className="mona-videos-panel select-none">
      <PanelBody>
        {status === 'loading' && !videos.length ? <PanelLoadingRow label={t('common.loading')} /> : null}
        {status === 'error' ? (
          <PanelErrorRow
            message={t('foundation.editor.videos.searchFailed')}
            onRetry={search.submit}
            retryLabel={t('common.retry')}
          />
        ) : null}
        {status === 'idle' && !videos.length ? (
          submitted
            ? <PanelNoResults onClear={search.clear} query={submitted} />
            : <PanelEmptyState message={t('foundation.editor.videos.empty')} />
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          {videos.map(video => (
            <Button
              aria-label={t('foundation.editor.videos.insert', { name: video.alt })}
              className="relative block h-auto overflow-hidden rounded-control bg-muted p-0 text-left"
              key={video.id}
              onClick={() => onInsertVideo({ ext: 'mp4', poster: video.poster, src: video.src })}
              type="button"
              variant="ghost"
            >
              <img alt={video.alt} className="block aspect-video w-full object-cover" loading="lazy" src={video.poster} />
              <span className="absolute right-1 bottom-1 rounded-detail bg-[rgb(24_24_27/78%)] px-1 py-0.5 text-micro text-white tabular-nums">
                {formatDuration(video.duration)}
              </span>
            </Button>
          ))}
        </div>
      </PanelBody>
    </PanelChrome>
  )
}
