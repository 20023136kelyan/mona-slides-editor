import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronLeft,
  FileAudio,
  FileVideo,
  Folder,
  Image,
  Mic,
  Monitor,
  Search,
  Upload,
  UserRound,
  Video,
} from 'lucide-react'
import { VirtuosoMasonry } from '@virtuoso.dev/masonry'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useEditorApplication } from '@/features/editor/services/editor-application'
import {
  addMediaLibraryFile,
  blobToDataUrl,
  searchMediaLibraryItems,
  type MediaLibraryItem,
  type MediaLibraryKind,
} from '@/features/editor/editor-media-library'

type UploadsView = 'main' | 'record'
type UploadsTab = 'images' | 'videos' | 'audio' | 'folders'

type MasonryContext = {
  onInsert: (item: MediaLibraryItem) => void
}

const tabToKind = (tab: UploadsTab): MediaLibraryKind | undefined => {
  if (tab === 'images') return 'image'
  if (tab === 'videos') return 'video'
  if (tab === 'audio') return 'audio'
  return undefined
}

function MediaThumb({ item }: { item: MediaLibraryItem }) {
  const url = useMemo(() => URL.createObjectURL(item.blob), [item.blob, item.id])

  useEffect(() => () => URL.revokeObjectURL(url), [url])

  if (item.kind === 'image') {
    return <img alt="" className="block w-full rounded-[var(--radius-control)] bg-muted object-cover" src={url} />
  }
  if (item.kind === 'video') {
    return (
      <div className="relative overflow-hidden rounded-[var(--radius-control)] bg-muted">
        <video className="block w-full" muted preload="metadata" src={url} />
        <FileVideo className="pointer-events-none absolute right-1.5 bottom-1.5 size-3.5 text-white drop-shadow" />
      </div>
    )
  }
  return (
    <div className="flex aspect-square items-center justify-center rounded-[var(--radius-control)] bg-muted text-muted-foreground">
      <FileAudio className="size-6" />
    </div>
  )
}

function GalleryItemContent({
  context,
  data,
}: {
  context: MasonryContext
  data: MediaLibraryItem
  index: number
}) {
  const { t } = useTranslation()
  return (
    <div className="box-border p-1">
      <button
        aria-label={t('foundation.editor.uploads.insertItem', { name: data.name })}
        className="block w-full overflow-hidden rounded-[var(--radius-control)] text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => context.onInsert(data)}
        type="button"
      >
        <MediaThumb item={data} />
      </button>
    </div>
  )
}

export function EditorUploadsPanel({
  onInsertAudio,
  onInsertImageSource,
  onInsertVideo,
}: {
  onInsertAudio: (payload: { ext?: string; src: string }) => void
  onInsertImageSource: (src: string) => void
  onInsertVideo: (payload: { ext?: string; src: string }) => void
}) {
  const { t } = useTranslation()
  const { notifications } = useEditorApplication()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [view, setView] = useState<UploadsView>('main')
  const [tab, setTab] = useState<UploadsTab>('images')
  const [query, setQuery] = useState('')
  const [recordNotice, setRecordNotice] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const kind = tabToKind(tab)
  const items = useLiveQuery(
    () => (tab === 'folders' ? Promise.resolve([] as MediaLibraryItem[]) : searchMediaLibraryItems(query, kind)),
    [query, tab, kind],
    [] as MediaLibraryItem[],
  )

  const masonryContext = useMemo<MasonryContext>(() => ({
    onInsert: item => {
      void (async () => {
        if (item.kind === 'image') {
          onInsertImageSource(await blobToDataUrl(item.blob))
          return
        }
        const src = URL.createObjectURL(item.blob)
        const ext = item.name.includes('.') ? item.name.split('.').pop()?.toLowerCase() : undefined
        if (item.kind === 'video') onInsertVideo({ ...(ext ? { ext } : {}), src })
        else onInsertAudio({ ...(ext ? { ext } : {}), src })
      })()
    },
  }), [onInsertAudio, onInsertImageSource, onInsertVideo])

  const uploadFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return
    setUploading(true)
    try {
      let added = 0
      let firstKind: MediaLibraryKind | null = null
      for (const file of Array.from(fileList)) {
        const item = await addMediaLibraryFile(file)
        if (!item) continue
        added += 1
        firstKind ??= item.kind
      }
      if (!added) {
        notifications.notify({ text: t('foundation.editor.uploads.unsupportedType'), type: 'warning' })
        return
      }
      if (firstKind === 'image') setTab('images')
      else if (firstKind === 'video') setTab('videos')
      else if (firstKind === 'audio') setTab('audio')
    }
    finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const EmptyIcon = tab === 'folders'
    ? Folder
    : query.trim()
      ? Search
      : tab === 'videos'
        ? FileVideo
        : tab === 'audio'
          ? FileAudio
          : Image
  const emptyMessage = tab === 'folders'
    ? t('foundation.editor.uploads.foldersComingSoon')
    : query.trim()
      ? t('foundation.editor.uploads.noSearchResults')
      : t('foundation.editor.uploads.emptyLibrary')

  if (view === 'record') {
    const options = [
      { key: 'talking-head', icon: UserRound, label: t('foundation.editor.uploads.recordTalkingHead') },
      { key: 'screen', icon: Monitor, label: t('foundation.editor.uploads.recordScreen') },
      { key: 'ai-voice', icon: Mic, label: t('foundation.editor.uploads.recordAiVoice') },
    ] as const

    return (
      <div className="mona-uploads-panel flex min-h-0 flex-1 flex-col p-3">
        <div className="mb-3 flex items-center gap-1">
          <Button
            aria-label={t('foundation.editor.uploads.back')}
            onClick={() => {
              setRecordNotice(null)
              setView('main')
            }}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <h3 className="text-sm font-semibold">{t('foundation.editor.uploads.recordYourself')}</h3>
        </div>
        <div className="flex flex-col gap-2">
          {options.map(option => {
            const Icon = option.icon
            return (
              <Button
                className="h-auto justify-start gap-3 rounded-[var(--radius-control)] border px-3 py-3 text-left font-medium whitespace-normal"
                key={option.key}
                onClick={() => setRecordNotice(t('foundation.editor.uploads.recordComingSoon'))}
                type="button"
                variant="ghost"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-muted text-foreground">
                  <Icon className="size-5" />
                </span>
                <span className="text-sm">{option.label}</span>
              </Button>
            )
          })}
        </div>
        {recordNotice ? (
          <p className="mt-4 rounded-[var(--radius-control)] bg-muted px-3 py-2 text-xs text-muted-foreground" role="status">
            {recordNotice}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="mona-uploads-panel flex min-h-0 flex-1 flex-col">
      <input
        accept="image/*,video/*,audio/*"
        aria-hidden="true"
        className="mona-uploads-file-input hidden"
        multiple
        onChange={event => void uploadFiles(event.target.files)}
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
      />

      <div className="flex shrink-0 flex-col gap-2.5 px-3 pt-3 pb-2">
      <div className="flex h-9 shrink-0 items-center gap-0.5 rounded-[var(--radius-action)] border border-input bg-background pl-2 pr-1">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          aria-label={t('foundation.editor.uploads.search')}
          className="h-8 min-w-0 flex-1 rounded-[var(--radius-action)] border-0 bg-transparent px-1.5 shadow-none focus-visible:ring-0"
          onChange={event => setQuery(event.target.value)}
          placeholder={t('foundation.editor.uploads.searchPlaceholder')}
          type="text"
          value={query}
        />
        <Button
          aria-label={uploading ? t('foundation.editor.uploads.uploading') : t('foundation.editor.uploads.uploadFiles')}
          className="size-7 shrink-0 rounded-[var(--radius-action)]"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <Upload className="size-3.5" />
        </Button>
        <Button
          aria-label={t('foundation.editor.uploads.recordYourself')}
          className="size-7 shrink-0 rounded-[var(--radius-action)]"
          onClick={() => {
            setRecordNotice(null)
            setView('record')
          }}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <Video className="size-3.5" />
        </Button>
      </div>

      <Tabs className="shrink-0" onValueChange={value => setTab(value as UploadsTab)} value={tab}>
        <TabsList className="h-auto w-full justify-start gap-0 rounded-none bg-transparent p-0" variant="line">
          {([
            ['images', t('foundation.editor.uploads.tabImages')],
            ['videos', t('foundation.editor.uploads.tabVideos')],
            ['audio', t('foundation.editor.uploads.tabAudio')],
            ['folders', t('foundation.editor.uploads.tabFolders')],
          ] as const).map(([value, label]) => (
            <TabsTrigger
              className="flex-none rounded-none px-2.5 py-1.5 text-xs"
              key={value}
              value={value}
            >
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      </div>

      <div className="min-h-0 flex-1 overflow-x-hidden px-3 pb-3">
        {tab === 'folders' || !items.length ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground">
            <EmptyIcon className="size-6 opacity-60" />
            <p>{emptyMessage}</p>
          </div>
        ) : (
          <VirtuosoMasonry
            className="h-full"
            columnCount={2}
            context={masonryContext}
            data={items}
            ItemContent={GalleryItemContent}
            style={{ height: '100%' }}
          />
        )}
      </div>
    </div>
  )
}
