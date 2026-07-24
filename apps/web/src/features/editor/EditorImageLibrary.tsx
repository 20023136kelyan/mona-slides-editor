import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import DownIcon from '~icons/icon-park-outline/down'
import LeftIcon from '~icons/icon-park-outline/left'
import SearchIcon from '~icons/icon-park-outline/search'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useEditorApplication } from '@/features/editor/services/editor-application'
import { searchOnlinePhotos, type PhotoOrientation, type PhotoSearchItem } from '@/features/editor/editor-photos-search'
import { cn } from '@/lib/utils'

type Orientation = PhotoOrientation
type ImageLibraryItem = PhotoSearchItem

const orientations: readonly Orientation[] = ['all', 'landscape', 'portrait', 'square']

async function requestImages(query: string, page: number, orientation: Orientation, signal?: AbortSignal) {
  return searchOnlinePhotos(query, { page, orientation, perPage: 50, signal })
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
    <div className="mona-image-library-panel flex min-h-0 w-full flex-1 flex-col text-[13px] text-foreground">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b">
        <Button aria-label={t('foundation.editor.imageLibrary.back')} onClick={onBack} size="editor-icon" type="button" variant="ghost"><LeftIcon /></Button>
        <h3 className="truncate text-[13px] font-semibold">{t('foundation.editor.imageLibrary.title')}</h3>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2.5">
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="mb-2.5 shrink-0">
            <div className="flex rounded-[var(--radius-control)] border border-input bg-background px-[5px] transition-colors hover:border-foreground focus-within:border-foreground">
              <Popover onOpenChange={setOrientationOpen} open={orientationOpen}>
                <PopoverTrigger asChild>
                  <Button aria-label={t('foundation.editor.imageLibrary.orientation')} className="h-[30px] px-0 pl-[5px] text-muted-foreground hover:text-foreground" size="editor" type="button" variant="ghost">{t(`foundation.editor.imageLibrary.${orientation}`)} <DownIcon /></Button>
                </PopoverTrigger>
                <PopoverContent aria-label={t('foundation.editor.imageLibrary.orientation')} className="w-auto p-2.5" side="bottom" sideOffset={8}>
                  {orientations.map(value => <Button aria-pressed={value === orientation} className={cn('w-full min-w-20 justify-center', value === orientation && 'font-semibold')} key={value} onClick={() => setImageOrientation(value)} size="sm" type="button" variant="ghost">{t(`foundation.editor.imageLibrary.${value}`)}</Button>)}
                </PopoverContent>
              </Popover>
              <Input className="h-[30px] flex-1 border-0 bg-transparent px-[5px] shadow-none focus-visible:ring-0" onChange={event => setQuery(event.target.value)} onKeyDown={event => {
                if (event.key === 'Enter') void search()
              }} placeholder={t('foundation.editor.imageLibrary.searchPlaceholder')} type="text" value={query} />
              <Button aria-label={t('foundation.editor.imageLibrary.search')} className="h-[30px] w-6 text-muted-foreground hover:text-foreground" onClick={() => void search()} size="editor-icon" type="button" variant="ghost"><SearchIcon /></Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto" onScroll={event => {
            const element = event.currentTarget
            if (!loading && items.length < Math.min(500, total) && element.scrollHeight - element.clientHeight - element.scrollTop < 5) void search(query || t('foundation.editor.imageLibrary.defaultQuery'), page + 1, true)
          }} ref={waterfallRef}>
            <div className="relative w-full" style={{ height: contentHeight }}>
              {columns.map(item => (
                <div className="group absolute overflow-hidden rounded-[var(--radius-control)] text-center" key={`${item.id}:${item.left}:${item.top}`} style={{ left: item.left, top: item.top, width: Math.round(item.width) }}>
                  <img alt="" className="mx-auto block max-w-full" src={item.src} />
                  <div className="absolute inset-0 hidden flex-col items-center justify-center bg-black/25 group-hover:flex group-focus-within:flex"><Button aria-label={t('foundation.editor.imageLibrary.insert')} className="h-6 px-2 text-xs" onClick={() => onInsert(item.src)} size="sm" type="button">{t('foundation.editor.imageLibrary.insert')}</Button></div>
                </div>
              ))}
              {!loading && !error && !columns.length ? (
                <output className="absolute inset-0 flex min-h-40 flex-col items-center justify-center gap-2.5 p-5 text-center text-muted-foreground">{t('foundation.editor.imageLibrary.noResults')}</output>
              ) : null}
            </div>
          </div>
          {error ? (
            <div className={cn('flex flex-col items-center justify-center gap-2.5 p-5 text-center text-muted-foreground', items.length ? 'min-h-0 flex-row justify-between border-t px-0.5 pt-2' : 'min-h-40')} role="alert">
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
          {loading ? (
            <div className="absolute inset-0 z-[99] flex flex-col items-center justify-center gap-2 bg-white/75 text-[12px] text-foreground">
              <span className="size-6 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
              <span>{t('foundation.editor.imageLibrary.loading')}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
