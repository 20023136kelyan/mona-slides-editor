import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Image as ImageIcon, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useEditorApplication } from '@/features/editor/services/editor-application'
import { listRecentOnlinePhotos, rememberOnlinePhoto } from '@/features/editor/editor-photos-recent'
import {
  PHOTO_CATEGORIES,
  PHOTO_CHIPS,
  searchOnlinePhotos,
  type PhotoCategory,
  type PhotoCategoryId,
  type PhotoSearchItem,
} from '@/features/editor/editor-photos-search'

type PhotosView =
  | { kind: 'home' }
  | { kind: 'search'; query: string }
  | { kind: 'category'; category: PhotoCategory }
  | { kind: 'recent' }

function PhotoThumb({ item }: { item: PhotoSearchItem }) {
  return (
    <img
      alt=""
      className="block h-auto w-full rounded-[var(--radius-control)] bg-muted object-cover"
      decoding="async"
      loading="lazy"
      src={item.src}
      style={item.width && item.height ? { aspectRatio: `${item.width} / ${item.height}` } : undefined}
    />
  )
}

function SectionHeader({
  onSeeAll,
  title,
}: {
  onSeeAll?: () => void
  title: string
}) {
  const { t } = useTranslation()
  return (
    <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {onSeeAll ? (
        <Button className="h-auto px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground" onClick={onSeeAll} size="sm" type="button" variant="ghost">
          {t('foundation.editor.photos.seeAll')}
        </Button>
      ) : null}
    </div>
  )
}

function HorizontalStrip({
  items,
  onInsert,
}: {
  items: PhotoSearchItem[]
  onInsert: (item: PhotoSearchItem) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
      {items.map(item => (
        <button
          aria-label={t('foundation.editor.photos.insertPhoto')}
          className="w-28 shrink-0 overflow-hidden rounded-[var(--radius-control)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          key={item.id}
          onClick={() => onInsert(item)}
          type="button"
        >
          <img
            alt=""
            className="aspect-[4/3] w-full bg-muted object-cover"
            decoding="async"
            loading="lazy"
            src={item.src}
          />
        </button>
      ))}
    </div>
  )
}

/** Balanced 2-column masonry without Virtuoso (avoids ResizeObserver loops in the drawer). */
function PhotoMasonry({
  items,
  onInsert,
}: {
  items: PhotoSearchItem[]
  onInsert: (item: PhotoSearchItem) => void
}) {
  const { t } = useTranslation()
  const columns = useMemo(() => {
    const next: [PhotoSearchItem[], PhotoSearchItem[]] = [[], []]
    const heights = [0, 0]
    for (const item of items) {
      const ratio = item.width > 0 ? item.height / item.width : 1
      const column = heights[0]! <= heights[1]! ? 0 : 1
      next[column].push(item)
      heights[column]! += ratio
    }
    return next
  }, [items])

  return (
    <div className="grid w-full grid-cols-2 gap-2">
      {columns.map((column, columnIndex) => (
        <div className="flex min-w-0 flex-col gap-2" key={columnIndex}>
          {column.map(item => (
            <button
              aria-label={t('foundation.editor.photos.insertPhoto')}
              className="block w-full overflow-hidden rounded-[var(--radius-control)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              key={item.id}
              onClick={() => onInsert(item)}
              type="button"
            >
              <PhotoThumb item={item} />
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

function usePhotoQuery(query: string | null, perPage = 30, refreshKey = 0) {
  const [items, setItems] = useState<PhotoSearchItem[]>([])
  const [loading, setLoading] = useState(Boolean(query))
  const [error, setError] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const sequenceRef = useRef(0)

  useEffect(() => {
    if (!query) {
      setItems([])
      setLoading(false)
      setError(false)
      setPage(1)
      setTotal(0)
      return undefined
    }
    const controller = new AbortController()
    const sequence = sequenceRef.current + 1
    sequenceRef.current = sequence
    setLoading(true)
    setError(false)
    void searchOnlinePhotos(query, { page: 1, perPage, signal: controller.signal })
      .then(result => {
        if (sequence !== sequenceRef.current) return
        setItems(result.data)
        setTotal(result.total)
        setPage(1)
      })
      .catch(errorValue => {
        if (errorValue instanceof DOMException && errorValue.name === 'AbortError') return
        if (sequence === sequenceRef.current) setError(true)
      })
      .finally(() => {
        if (sequence === sequenceRef.current) setLoading(false)
      })
    return () => controller.abort()
  }, [perPage, query, refreshKey])

  const loadMore = async () => {
    if (!query || loading || items.length >= total) return
    const nextPage = page + 1
    setLoading(true)
    try {
      const result = await searchOnlinePhotos(query, { page: nextPage, perPage })
      setItems(current => [...current, ...result.data])
      setTotal(result.total)
      setPage(nextPage)
      setError(false)
    }
    catch {
      setError(true)
    }
    finally {
      setLoading(false)
    }
  }

  return { error, items, loadMore, loading, total }
}

function PhotoResults({
  error,
  items,
  loading,
  onInsert,
  onLoadMore,
  onRetry,
}: {
  error: boolean
  items: PhotoSearchItem[]
  loading: boolean
  onInsert: (item: PhotoSearchItem) => void
  onLoadMore?: () => void
  onRetry?: () => void
}) {
  const { t } = useTranslation()

  if (!loading && !error && !items.length) {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground">
        <ImageIcon className="size-6 opacity-60" />
        <p>{t('foundation.editor.photos.noResults')}</p>
      </div>
    )
  }

  return (
    <div
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      onScroll={event => {
        if (!onLoadMore || loading) return
        const element = event.currentTarget
        if (element.scrollHeight - element.clientHeight - element.scrollTop < 64) onLoadMore()
      }}
    >
      {items.length ? <PhotoMasonry items={items} onInsert={onInsert} /> : null}
      {loading ? (
        <p className="py-3 text-center text-xs text-muted-foreground" role="status">{t('foundation.editor.photos.loading')}</p>
      ) : null}
      {error ? (
        <div className="flex flex-col items-center gap-2 py-4 text-xs text-muted-foreground" role="alert">
          <span>{t('foundation.editor.photos.searchError')}</span>
          {onRetry ? (
            <Button onClick={onRetry} size="sm" type="button" variant="outline">{t('foundation.editor.photos.retry')}</Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function EditorPhotosPanel({ onInsertImageSource }: { onInsertImageSource: (src: string) => void }) {
  const { t } = useTranslation()
  const { notifications } = useEditorApplication()
  const [view, setView] = useState<PhotosView>({ kind: 'home' })
  const [draftQuery, setDraftQuery] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const recent = useLiveQuery(() => listRecentOnlinePhotos(), [], [] as Awaited<ReturnType<typeof listRecentOnlinePhotos>>)

  const categoryLabel = (id: PhotoCategoryId) => t(`foundation.editor.photos.categories.${id}`)

  const activeQuery = view.kind === 'search'
    ? view.query
    : view.kind === 'category'
      ? view.category.query
      : null
  const gridQuery = usePhotoQuery(activeQuery, 40, refreshKey)
  const trendingQuery = usePhotoQuery(view.kind === 'home' ? 'trending' : null, 24, refreshKey)
  const natureQuery = usePhotoQuery(view.kind === 'home' ? 'nature' : null, 12, refreshKey)

  const insertPhoto = async (item: PhotoSearchItem) => {
    try {
      await rememberOnlinePhoto(item)
      onInsertImageSource(item.src)
    }
    catch {
      notifications.notify({ text: t('foundation.editor.photos.insertFailed'), type: 'error' })
    }
  }

  const runSearch = (query: string) => {
    const next = query.trim()
    if (!next) {
      notifications.notify({ text: t('foundation.editor.photos.enterKeyword'), type: 'warning' })
      return
    }
    setDraftQuery(next)
    setView({ kind: 'search', query: next })
  }

  if (view.kind === 'search' || view.kind === 'category' || view.kind === 'recent') {
    const title = view.kind === 'search'
      ? view.query
      : view.kind === 'recent'
        ? t('foundation.editor.photos.recentlyUsed')
        : categoryLabel(view.category.id)

    return (
      <div className="mona-photos-panel flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-1 px-3 pt-3 pb-2">
          <Button
            aria-label={t('foundation.editor.photos.back')}
            onClick={() => setView({ kind: 'home' })}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <h3 className="truncate text-sm font-semibold">{title}</h3>
        </div>
        <div className="min-h-0 flex-1 px-3 pb-3">
          {view.kind === 'recent' ? (
            <PhotoResults
              error={false}
              items={recent}
              loading={false}
              onInsert={item => void insertPhoto(item)}
            />
          ) : (
            <PhotoResults
              error={gridQuery.error}
              items={gridQuery.items}
              loading={gridQuery.loading}
              onInsert={item => void insertPhoto(item)}
              onLoadMore={() => void gridQuery.loadMore()}
              onRetry={() => setRefreshKey(value => value + 1)}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mona-photos-panel flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2.5 px-3 pt-3 pb-2">
        <div className="flex h-9 shrink-0 items-center gap-0.5 rounded-[var(--radius-action)] border border-input bg-background pl-2.5 pr-1">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            aria-label={t('foundation.editor.photos.search')}
            className="h-8 min-w-0 flex-1 rounded-[var(--radius-action)] border-0 bg-transparent px-1.5 shadow-none focus-visible:ring-0"
            onChange={event => setDraftQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') runSearch(draftQuery)
            }}
            placeholder={t('foundation.editor.photos.searchPlaceholder')}
            type="text"
            value={draftQuery}
          />
          <Button
            aria-label={t('foundation.editor.photos.search')}
            className="size-7 shrink-0 rounded-[var(--radius-action)]"
            onClick={() => runSearch(draftQuery)}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <Search className="size-3.5" />
          </Button>
        </div>

        <div className="flex h-7 shrink-0 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {PHOTO_CHIPS.map(chip => (
            <Button
              className="h-7 shrink-0 rounded-full px-3 text-xs"
              key={chip.id}
              onClick={() => runSearch(chip.query)}
              size="sm"
              type="button"
              variant="outline"
            >
              {t(`foundation.editor.photos.chips.${chip.id}`, { defaultValue: chip.query })}
            </Button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-x-hidden overflow-y-auto px-3 pb-3">
        {recent.length ? (
          <section className="shrink-0">
            <SectionHeader
              onSeeAll={() => setView({ kind: 'recent' })}
              title={t('foundation.editor.photos.recentlyUsed')}
            />
            <HorizontalStrip items={recent.slice(0, 12)} onInsert={item => void insertPhoto(item)} />
          </section>
        ) : null}

        <section className="shrink-0">
          <SectionHeader
            onSeeAll={() => setView({ kind: 'category', category: PHOTO_CATEGORIES[0]! })}
            title={categoryLabel('trending')}
          />
          {trendingQuery.loading && !trendingQuery.items.length ? (
            <p className="py-3 text-center text-xs text-muted-foreground" role="status">{t('foundation.editor.photos.loading')}</p>
          ) : trendingQuery.error ? (
            <div className="flex flex-col items-center gap-2 py-4 text-xs text-muted-foreground" role="alert">
              <span>{t('foundation.editor.photos.searchError')}</span>
              <Button onClick={() => setRefreshKey(value => value + 1)} size="sm" type="button" variant="outline">{t('foundation.editor.photos.retry')}</Button>
            </div>
          ) : (
            <PhotoMasonry items={trendingQuery.items.slice(0, 16)} onInsert={item => void insertPhoto(item)} />
          )}
        </section>

        <section className="shrink-0">
          <SectionHeader
            onSeeAll={() => setView({ kind: 'category', category: PHOTO_CATEGORIES.find(category => category.id === 'nature')! })}
            title={categoryLabel('nature')}
          />
          {natureQuery.loading && !natureQuery.items.length ? (
            <p className="py-3 text-center text-xs text-muted-foreground" role="status">{t('foundation.editor.photos.loading')}</p>
          ) : (
            <HorizontalStrip items={natureQuery.items} onInsert={item => void insertPhoto(item)} />
          )}
        </section>

        <section className="shrink-0 pb-1">
          <SectionHeader title={t('foundation.editor.photos.moreCategories')} />
          <div className="flex flex-wrap gap-1.5">
            {PHOTO_CATEGORIES.filter(category => category.id !== 'trending' && category.id !== 'nature').map(category => (
              <Button
                className="h-7 shrink-0 rounded-full px-3 text-xs"
                key={category.id}
                onClick={() => setView({ kind: 'category', category })}
                size="sm"
                type="button"
                variant="outline"
              >
                {categoryLabel(category.id)}
              </Button>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
