import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'

import CloseIcon from '~icons/icon-park-outline/close'
import DownIcon from '~icons/icon-park-outline/down'
import SearchIcon from '~icons/icon-park-outline/search'
import { Popover as PopoverPrimitive } from 'radix-ui'

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

export function EditorImageLibraryPanel({ onClose, onInsert }: {
  onClose: () => void
  onInsert: (src: string) => void
}) {
  const { t } = useTranslation()
  const [position, setPosition] = useState(() => ({ left: document.body.clientWidth - 270 - 360, top: 90 }))
  const [orientation, setOrientation] = useState<Orientation>('all')
  const [orientationOpen, setOrientationOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<ImageLibraryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const defaultQueryRef = useRef(t('foundation.editor.imageLibrary.defaultQuery'))
  const initialRequestRef = useRef<ReturnType<typeof requestImages> | null>(null)

  const search = async (searchQuery = query, nextPage = 1, append = false, nextOrientation = orientation) => {
    if (!searchQuery) {
      window.dispatchEvent(new CustomEvent('mona:notice', {
        detail: { text: t('foundation.editor.imageLibrary.enterKeyword'), type: 'error' },
      }))
      return
    }
    setLoading(true)
    try {
      const result = await requestImages(searchQuery, nextPage, nextOrientation)
      setItems(current => append ? [...current, ...(result.data || [])] : result.data || [])
      setTotal(result.total || 0)
      setPage(nextPage)
    }
    catch {
      // PPTist leaves the existing result set in place on a failed request.
    }
    finally {
      setLoading(false)
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
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const columns = useMemo(() => {
    // The source computes 166.5px, applies Math.round() to the item width,
    // and uses integer clientHeight values when placing subsequent rows.
    const calculatedWidth = 166.5
    const width = Math.round(calculatedWidth)
    const heights = [0, 0]
    return items.map(item => {
      const column = heights[0]! <= heights[1]! ? 0 : 1
      const height = item.width ? Math.round(width * item.height / item.width) : width
      const placed = { ...item, height, left: Math.round(column * (calculatedWidth + 5)), top: Math.round(heights[column]!), width }
      heights[column] = heights[column]! + height + 5
      return placed
    })
  }, [items])
  const contentHeight = columns.length ? Math.max(...columns.map(item => item.top + item.height)) + 5 : 200

  const startMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const origin = position
    const start = { x: event.clientX, y: event.clientY }
    const move = (nativeEvent: PointerEvent) => {
      const panel = panelRef.current
      if (!panel) return
      const left = Math.min(document.body.clientWidth - 360, Math.max(0, origin.left + nativeEvent.clientX - start.x))
      const top = Math.min(document.body.clientHeight - 580, Math.max(0, origin.top + nativeEvent.clientY - start.y))
      setPosition({ left, top })
    }
    const stop = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', stop)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', stop)
  }

  const setImageOrientation = (value: Orientation) => {
    setOrientation(value)
    setOrientationOpen(false)
    if (query) void search(query, 1, false, value)
  }

  return (
    <div className="mona-image-library-panel" ref={panelRef} style={position}>
      <div className="mona-moveable-panel-header" onPointerDown={startMove}>
        <div className="mona-moveable-panel-title">{t('foundation.editor.imageLibrary.title')}</div>
        <button aria-label={t('foundation.editor.imageLibrary.close')} className="mona-moveable-panel-close" onClick={onClose} onPointerDown={event => event.stopPropagation()} type="button"><CloseIcon /></button>
      </div>
      <div className="mona-image-library-content">
        <div className="mona-image-library-container">
          <div className="mona-image-library-tools">
            <div className="mona-image-library-input">
              <PopoverPrimitive.Root onOpenChange={setOrientationOpen} open={orientationOpen}>
                <PopoverPrimitive.Trigger asChild>
                  <button className="mona-image-library-orientation" type="button">{t(`foundation.editor.imageLibrary.${orientation}`)} <DownIcon /></button>
                </PopoverPrimitive.Trigger>
                <PopoverPrimitive.Portal>
                  <PopoverPrimitive.Content className="mona-image-library-orientation-menu" side="bottom" sideOffset={8}>
                    {orientations.map(value => <button className={value === orientation ? 'is-active' : ''} key={value} onClick={() => setImageOrientation(value)} type="button">{t(`foundation.editor.imageLibrary.${value}`)}</button>)}
                  </PopoverPrimitive.Content>
                </PopoverPrimitive.Portal>
              </PopoverPrimitive.Root>
              <input onChange={event => setQuery(event.target.value)} onKeyDown={event => {
                if (event.key === 'Enter') void search() 
              }} placeholder={t('foundation.editor.imageLibrary.searchPlaceholder')} type="text" value={query} />
              <button aria-label={t('foundation.editor.imageLibrary.search')} className="mona-image-library-search" onClick={() => void search()} type="button"><SearchIcon /></button>
            </div>
          </div>
          <div className="mona-image-library-waterfall" onScroll={event => {
            const element = event.currentTarget
            if (!loading && items.length < Math.min(500, total) && element.scrollHeight - element.clientHeight - element.scrollTop < 5) void search(query || t('foundation.editor.imageLibrary.defaultQuery'), page + 1, true)
          }}>
            <div className="mona-image-library-waterfall-content" style={{ height: contentHeight }}>
              {columns.map(item => (
                <div className="mona-image-library-item" key={`${item.id}:${item.left}:${item.top}`} style={{ left: item.left, top: item.top, width: Math.round(item.width) }}>
                  <img alt="" src={item.src} />
                  <div className="mona-image-library-mask"><button onClick={() => onInsert(item.src)} type="button">{t('foundation.editor.imageLibrary.insert')}</button></div>
                </div>
              ))}
            </div>
          </div>
          {loading ? <div className="mona-image-library-loading has-text" style={{ '--mona-loading-text': `"${t('foundation.editor.imageLibrary.loading')}"` } as CSSProperties} /> : null}
        </div>
      </div>
    </div>
  )
}
