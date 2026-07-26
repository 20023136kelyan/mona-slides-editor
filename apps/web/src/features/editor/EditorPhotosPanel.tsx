import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { storeDeckAsset } from '@/features/editor/editor-deck-assets'
import { useEditorApplication } from '@/features/editor/services/editor-application'
import { useEditorPanelSearch } from '@/features/editor/panel/editor-panel-search'
import {
  PanelBackHeader,
  PanelBody,
  PanelChrome,
  PanelEmptyState,
  PanelErrorRow,
  PanelHeader,
  PanelLoadingRow,
  PanelMasonry,
  PanelNoResults,
  PanelSectionHeader,
} from '@/features/editor/panel/EditorPanelPrimitives'
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

const photoRatio = (item: PhotoSearchItem) => (item.width > 0 ? item.height / item.width : 1)

function PhotoThumb({ item }: { item: PhotoSearchItem }) {
  return (
    <img
      alt=""
      className="block h-auto w-full rounded-control bg-muted object-cover"
      decoding="async"
      loading="lazy"
      src={item.src}
      style={item.width && item.height ? { aspectRatio: `${item.width} / ${item.height}` } : undefined}
    />
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
        <Button
          aria-label={t('foundation.editor.photos.insertPhoto')}
          className="block h-auto w-28 shrink-0 overflow-hidden rounded-control p-0"
          key={item.id}
          onClick={() => onInsert(item)}
          type="button"
          variant="ghost"
        >
          <img
            alt=""
            className="aspect-[4/3] w-full bg-muted object-cover"
            decoding="async"
            loading="lazy"
            src={item.src}
          />
        </Button>
      ))}
    </div>
  )
}

function PhotoMasonry({
  items,
  onInsert,
}: {
  items: PhotoSearchItem[]
  onInsert: (item: PhotoSearchItem) => void
}) {
  const { t } = useTranslation()
  return (
    <PanelMasonry
      estimateRatio={photoRatio}
      getKey={item => String(item.id)}
      items={items}
      renderItem={item => (
        <Button
          aria-label={t('foundation.editor.photos.insertPhoto')}
          className="block h-auto w-full overflow-hidden rounded-control p-0"
          onClick={() => onInsert(item)}
          type="button"
          variant="ghost"
        >
          <PhotoThumb item={item} />
        </Button>
      )}
    />
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
    const sequence = sequenceRef.current + 1
    sequenceRef.current = sequence
    setLoading(true)
    setError(false)
    void searchOnlinePhotos(query, { page: 1, perPage })
      .then(result => {
        if (sequence !== sequenceRef.current) return
        setItems(result.data)
        setTotal(result.total)
        setPage(1)
      })
      .catch(() => {
        if (sequence === sequenceRef.current) setError(true)
      })
      .finally(() => {
        if (sequence === sequenceRef.current) setLoading(false)
      })
    // The sequence guard above already discards a stale result, which is what the
    // abort was really for.
    return undefined
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

function PhotoGridEmpty() {
  const { t } = useTranslation()
  const search = useEditorPanelSearch()
  const submitted = search.submitted.trim()
  return submitted
    ? <PanelNoResults onClear={search.clear} query={submitted} />
    : <PanelEmptyState message={t('foundation.editor.photos.empty')} />
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

  // Two different facts, two different surfaces: a committed query that matched
  // nothing is a no-results state, while an untouched panel is simply empty.
  if (!loading && !error && !items.length) {
    return <PhotoGridEmpty />
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
      {loading ? <PanelLoadingRow label={t('foundation.editor.photos.loading')} /> : null}
      {error ? (
        <PanelErrorRow
          message={t('foundation.editor.photos.searchError')}
          onRetry={onRetry}
          retryLabel={t('foundation.editor.photos.retry')}
        />
      ) : null}
    </div>
  )
}

export function EditorPhotosPanel({ onInsertImageSource }: { onInsertImageSource: (src: string) => void }) {
  const { t } = useTranslation()
  const { notifications } = useEditorApplication()
  const [browseView, setBrowseView] = useState<PhotosView>({ kind: 'home' })
  const search = useEditorPanelSearch()
  const [refreshKey, setRefreshKey] = useState(0)
  const recent = useLiveQuery(() => listRecentOnlinePhotos(), [], [] as Awaited<ReturnType<typeof listRecentOnlinePhotos>>)

  const categoryLabel = (id: PhotoCategoryId) => t(`foundation.editor.photos.categories.${id}`)

  // The bar is the drawer's, so the committed term *is* the search view rather
  // than something copied into local state after the fact — derive it and the
  // two can never disagree. Chips and categories commit through the bar too.
  const submitted = search.submitted.trim()
  // useMemo, not a bare ternary: a fresh object every render would defeat the
  // memoised result lists downstream.
  const view = useMemo<PhotosView>(() => (submitted ? { kind: 'search', query: submitted } : browseView), [browseView, submitted])

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
      // Downloaded rather than referenced: a deck that points at a remote host
      // renders only while that host is up, leaks the reader's IP to it, and
      // breaks offline. It also keeps one rule for every image in a deck.
      void fetch(item.src)
        .then(response => response.blob())
        .then(blob => storeDeckAsset(blob))
        .then(src => onInsertImageSource(src))
        .catch(() => notifications.notify({
          text: t('foundation.editor.photos.insertFailed'),
          type: 'error',
        }))
    }
    catch {
      notifications.notify({ text: t('foundation.editor.photos.insertFailed'), type: 'error' })
    }
  }

  if (view.kind === 'search' || view.kind === 'category' || view.kind === 'recent') {
    const title = view.kind === 'search'
      ? view.query
      : view.kind === 'recent'
        ? t('foundation.editor.photos.recentlyUsed')
        : categoryLabel(view.category.id)

    return (
      <PanelChrome className="mona-photos-panel">
        <PanelBackHeader
          label={t('foundation.editor.photos.back')}
          onBack={() => {
            setBrowseView({ kind: 'home' })
            search.clear()
          }}
          title={title}
        />
        <PanelBody>
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
        </PanelBody>
      </PanelChrome>
    )
  }

  return (
    <PanelChrome className="mona-photos-panel">
      <PanelHeader>
        <div className="flex h-7 shrink-0 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {PHOTO_CHIPS.map(chip => (
            <Button
              className="shrink-0"
              key={chip.id}
              onClick={() => search.submitQuery(chip.query)}
              size="chip"
              type="button"
              variant="outline"
            >
              {t(`foundation.editor.photos.chips.${chip.id}`, { defaultValue: chip.query })}
            </Button>
          ))}
        </div>
      </PanelHeader>

      <PanelBody className="space-y-5 overflow-x-hidden">
        {recent.length ? (
          <section className="shrink-0">
            <PanelSectionHeader
              onSeeAll={() => setBrowseView({ kind: 'recent' })}
              title={t('foundation.editor.photos.recentlyUsed')}
            />
            <HorizontalStrip items={recent.slice(0, 12)} onInsert={item => void insertPhoto(item)} />
          </section>
        ) : null}

        <section className="shrink-0">
          <PanelSectionHeader
            onSeeAll={() => setBrowseView({ kind: 'category', category: PHOTO_CATEGORIES[0]! })}
            title={categoryLabel('trending')}
          />
          {trendingQuery.loading && !trendingQuery.items.length ? (
            <PanelLoadingRow label={t('foundation.editor.photos.loading')} />
          ) : trendingQuery.error ? (
            <PanelErrorRow
              message={t('foundation.editor.photos.searchError')}
              onRetry={() => setRefreshKey(value => value + 1)}
              retryLabel={t('foundation.editor.photos.retry')}
            />
          ) : (
            <PhotoMasonry items={trendingQuery.items.slice(0, 16)} onInsert={item => void insertPhoto(item)} />
          )}
        </section>

        <section className="shrink-0">
          <PanelSectionHeader
            onSeeAll={() => setBrowseView({ kind: 'category', category: PHOTO_CATEGORIES.find(category => category.id === 'nature')! })}
            title={categoryLabel('nature')}
          />
          {natureQuery.loading && !natureQuery.items.length ? (
            <PanelLoadingRow label={t('foundation.editor.photos.loading')} />
          ) : (
            <HorizontalStrip items={natureQuery.items} onInsert={item => void insertPhoto(item)} />
          )}
        </section>

        <section className="shrink-0 pb-1">
          <PanelSectionHeader title={t('foundation.editor.photos.moreCategories')} />
          <div className="flex flex-wrap gap-1.5">
            {PHOTO_CATEGORIES.filter(category => category.id !== 'trending' && category.id !== 'nature').map(category => (
              <Button
                className="shrink-0"
                key={category.id}
                onClick={() => setBrowseView({ kind: 'category', category })}
                size="chip"
                type="button"
                variant="outline"
              >
                {categoryLabel(category.id)}
              </Button>
            ))}
          </div>
        </section>
      </PanelBody>
    </PanelChrome>
  )
}
