import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import DownIcon from '~icons/icon-park-outline/down'
import LeftIcon from '~icons/icon-park-outline/left'
import SearchIcon from '~icons/icon-park-outline/search'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useEditorApplication } from '@/features/editor/services/editor-application'

interface ImageLibraryItem {
  height: number
  id: number
  src: string
  width: number
}

type Orientation = 'all' | 'landscape' | 'portrait' | 'square'

const orientations: readonly Orientation[] = ['all', 'landscape', 'portrait', 'square']

async function requestImages(query: string, page: number, orientation: Orientation, signal?: AbortSignal) {
  const response = await fetch('/api/tools/img_search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, per_page: 50, page, orientation }),
    signal,
  })
  if (!response.ok) throw new Error(`Image search failed: ${response.status}`)
  return response.json() as Promise<{ data?: ImageLibraryItem[]; total?: number }>
}

export function EditorImageLibrary({ onBack, onInsert }: {
  onBack: () => void
  onInsert: (src: string) => void
}) {
  const { t } = useTranslation()
  const { notifications } = useEditorApplication()
  const [orientation, setOrientation] = useState<Orientation>('all')
  const [orientationOpen, setOrientationOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<ImageLibraryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [contentWidth, setContentWidth] = useState(0)
  const waterfallRef = useRef<HTMLDivElement>(null)
  const defaultQueryRef = useRef(t('foundation.editor.imageLibrary.defaultQuery'))
  const initialRequestRef = useRef<ReturnType<typeof requestImages> | null>(null)
  const requestControllerRef = useRef<AbortController | null>(null)
  const requestSequenceRef = useRef(0)

  const search = async (searchQuery = query, nextPage = 1, append = false, nextOrientation = orientation) => {
    if (!searchQuery) {
      notifications.notify({
        text: t('foundation.editor.imageLibrary.enterKeyword'),
        type: 'error',
      })
      return
    }
    requestControllerRef.current?.abort()
    const controller = new AbortController()
    const sequence = requestSequenceRef.current + 1
    requestControllerRef.current = controller
    requestSequenceRef.current = sequence
    setLoading(true)
    setError(false)
    try {
      const result = await requestImages(searchQuery, nextPage, nextOrientation, controller.signal)
      if (sequence !== requestSequenceRef.current) return
      setItems(current => append ? [...current, ...(result.data || [])] : result.data || [])
      setTotal(result.total || 0)
      setPage(nextPage)
    }
    catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === 'AbortError') return
      if (sequence === requestSequenceRef.current) setError(true)
    }
    finally {
      if (sequence === requestSequenceRef.current) {
        requestControllerRef.current = null
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    let active = true
    // Reuse the same in-flight request when development StrictMode replays the
    // effect. A real close/reopen creates a new panel instance and therefore a
    // new request, matching the source lifecycle without sending twice on mount.
    initialRequestRef.current ??= requestImages(defaultQueryRef.current, 1, 'all')
    void initialRequestRef.current
      .then(result => {
        if (!active) return
        setItems(result.data || [])
        setTotal(result.total || 0)
        setPage(1)
      })
      .catch(() => {
        if (active) setError(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  useLayoutEffect(() => {
    const waterfall = waterfallRef.current
    if (!waterfall) return undefined
    const update = () => setContentWidth(waterfall.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(waterfall)
    return () => observer.disconnect()
  }, [])

  const columns = useMemo(() => {
    const calculatedWidth = Math.max(80, (contentWidth - 5) / 2)
    const width = Math.round(calculatedWidth)
    const heights = [0, 0]
    return items.map(item => {
      const column = heights[0]! <= heights[1]! ? 0 : 1
      const height = item.width ? Math.round(width * item.height / item.width) : width
      const placed = { ...item, height, left: Math.round(column * (calculatedWidth + 5)), top: Math.round(heights[column]!), width }
      heights[column] = heights[column]! + height + 5
      return placed
    })
  }, [contentWidth, items])
  const contentHeight = columns.length ? Math.max(...columns.map(item => item.top + item.height)) + 5 : 200

  const setImageOrientation = (value: Orientation) => {
    setOrientation(value)
    setOrientationOpen(false)
    void search(query || defaultQueryRef.current, 1, false, value)
  }

  return (
    <div className="mona-image-library-panel">
      <div className="mona-image-library-header">
        <Button aria-label={t('foundation.editor.imageLibrary.back')} onClick={onBack} size="editor-icon" type="button" variant="ghost"><LeftIcon /></Button>
        <h3>{t('foundation.editor.imageLibrary.title')}</h3>
      </div>
      <div className="mona-image-library-content">
        <div className="mona-image-library-container">
          <div className="mona-image-library-tools">
            <div className="mona-image-library-input">
              <Popover onOpenChange={setOrientationOpen} open={orientationOpen}>
                <PopoverTrigger asChild>
                  <Button aria-label={t('foundation.editor.imageLibrary.orientation')} className="mona-image-library-orientation" size="editor" type="button" variant="outline">{t(`foundation.editor.imageLibrary.${orientation}`)} <DownIcon /></Button>
                </PopoverTrigger>
                <PopoverContent aria-label={t('foundation.editor.imageLibrary.orientation')} className="mona-image-library-orientation-menu" side="bottom" sideOffset={8}>
                  {orientations.map(value => <Button aria-pressed={value === orientation} className={value === orientation ? 'is-active' : ''} key={value} onClick={() => setImageOrientation(value)} size="sm" type="button" variant="ghost">{t(`foundation.editor.imageLibrary.${value}`)}</Button>)}
                </PopoverContent>
              </Popover>
              <Input onChange={event => setQuery(event.target.value)} onKeyDown={event => {
                if (event.key === 'Enter') void search()
              }} placeholder={t('foundation.editor.imageLibrary.searchPlaceholder')} type="text" value={query} />
              <Button aria-label={t('foundation.editor.imageLibrary.search')} className="mona-image-library-search" onClick={() => void search()} size="editor-icon" type="button" variant="ghost"><SearchIcon /></Button>
            </div>
          </div>
          <div className="mona-image-library-waterfall" onScroll={event => {
            const element = event.currentTarget
            if (!loading && items.length < Math.min(500, total) && element.scrollHeight - element.clientHeight - element.scrollTop < 5) void search(query || t('foundation.editor.imageLibrary.defaultQuery'), page + 1, true)
          }} ref={waterfallRef}>
            <div className="mona-image-library-waterfall-content" style={{ height: contentHeight }}>
              {columns.map(item => (
                <div className="mona-image-library-item" key={`${item.id}:${item.left}:${item.top}`} style={{ left: item.left, top: item.top, width: Math.round(item.width) }}>
                  <img alt="" src={item.src} />
                  <div className="mona-image-library-mask"><Button aria-label={t('foundation.editor.imageLibrary.insert')} onClick={() => onInsert(item.src)} size="sm" type="button">{t('foundation.editor.imageLibrary.insert')}</Button></div>
                </div>
              ))}
              {!loading && !error && !columns.length ? (
                <output className="mona-image-library-state">{t('foundation.editor.imageLibrary.noResults')}</output>
              ) : null}
            </div>
          </div>
          {error ? (
            <div className={`mona-image-library-error${items.length ? ' is-inline' : ''}`} role="alert">
              <span>{t('foundation.editor.imageLibrary.searchError')}</span>
              <Button
                onClick={() => void search(query || defaultQueryRef.current, items.length ? page + 1 : 1, items.length > 0)}
                size="sm"
                type="button"
                variant="outline"
              >
                {t('foundation.editor.imageLibrary.retry')}
              </Button>
            </div>
          ) : null}
          {loading ? <div className="mona-image-library-loading has-text" style={{ '--mona-loading-text': `"${t('foundation.editor.imageLibrary.loading')}"` } as CSSProperties} /> : null}
        </div>
      </div>
    </div>
  )
}
