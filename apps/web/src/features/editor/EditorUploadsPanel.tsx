import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FileAudio,
  FileVideo,
  Mic,
  Monitor,
  Upload,
  Video,
  UserRound,
} from 'lucide-react'

import { storeDeckAsset } from '@/features/editor/editor-deck-assets'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useEditorApplication } from '@/features/editor/services/editor-application'
import { CATEGORY_ICONS } from '@/features/editor/icons/category-icons'
import { useEditorPanelSearch } from '@/features/editor/panel/editor-panel-search'
import {
  PanelBackHeader,
  PanelBody,
  PanelChrome,
  PanelEmptyState,
  PanelHeader,
  PanelMasonry,
  PanelNoResults,
} from '@/features/editor/panel/EditorPanelPrimitives'
import {
  addMediaLibraryFile,
  searchMediaLibraryItems,
  type MediaLibraryItem,
  type MediaLibraryKind,
} from '@/features/editor/editor-media-library'
import { UPLOAD_FILTERS, pickFiles } from '@/features/editor/editor-files'

type UploadsView = 'main' | 'record'
type UploadsTab = 'images' | 'videos' | 'audio' | 'folders'

const tabToKind = (tab: UploadsTab): MediaLibraryKind | undefined => {
  if (tab === 'images') return 'image'
  if (tab === 'videos') return 'video'
  if (tab === 'audio') return 'audio'
  return undefined
}

const mediaRatio = (item: MediaLibraryItem) =>
  item.width && item.height ? item.height / item.width : 1

function MediaThumb({ item }: { item: MediaLibraryItem }) {
  const url = useMemo(() => URL.createObjectURL(item.blob), [item.blob])

  useEffect(() => () => URL.revokeObjectURL(url), [url])

  if (item.kind === 'image') {
    return <img alt="" className="block w-full rounded-control bg-muted object-cover" src={url} />
  }
  if (item.kind === 'video') {
    return (
      <div className="relative overflow-hidden rounded-control bg-muted">
        <video className="block w-full" muted preload="metadata" src={url} />
        <FileVideo className="pointer-events-none absolute right-1.5 bottom-1.5 size-3.5 text-white drop-shadow" />
      </div>
    )
  }
  return (
    <div className="flex aspect-square items-center justify-center rounded-control bg-muted text-muted-foreground">
      <FileAudio className="size-6" />
    </div>
  )
}

export function EditorUploadsPanel({
  initialTab = 'images',
  onInsertAudio,
  onInsertImageSource,
  onInsertVideo,
}: {
  /** Videos and Audio are their own rail entries, each opening on its tab. */
  initialTab?: UploadsTab
  onInsertAudio: (payload: { ext?: string; src: string }) => void
  onInsertImageSource: (src: string) => void
  onInsertVideo: (payload: { ext?: string; src: string }) => void
}) {
  const { t } = useTranslation()
  const { notifications } = useEditorApplication()
  const [view, setView] = useState<UploadsView>('main')
  const [tab, setTab] = useState<UploadsTab>(initialTab)
  // Uploads, Videos and Audio are separate rail entries sharing this panel.
  // Follow the entry the user picked without remounting: a remount would drop
  // the record view and the in-flight media subscription.
  useEffect(() => {
    setTab(initialTab)
  }, [initialTab])
  const search = useEditorPanelSearch()
  const query = search.query
  const [recordNotice, setRecordNotice] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const kind = tabToKind(tab)
  const items = useLiveQuery(
    () => (tab === 'folders' ? Promise.resolve([] as MediaLibraryItem[]) : searchMediaLibraryItems(query, kind)),
    [query, tab, kind],
    [] as MediaLibraryItem[],
  )

  const insertItem = (item: MediaLibraryItem) => {
    void (async () => {
      // Every kind takes the same path now. Images used to be inserted as a data
      // URL, which put the whole picture into the deck as base64 - the same thing
      // that made one imported deck persist at 193 MB.
      const src = await storeDeckAsset(item.blob)
      if (item.kind === 'image') {
        onInsertImageSource(src)
        return
      }
      const ext = item.name.includes('.') ? item.name.split('.').pop()?.toLowerCase() : undefined
      if (item.kind === 'video') onInsertVideo({ ...(ext ? { ext } : {}), src })
      else onInsertAudio({ ...(ext ? { ext } : {}), src })
    })()
  }

  const uploadFiles = async (files: readonly File[]) => {
    if (!files.length) return
    setUploading(true)
    try {
      let added = 0
      let firstKind: MediaLibraryKind | null = null
      for (const file of files) {
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
    }
  }

  // The empty space takes the icon of whatever kind of thing is missing, so an
  // empty Audio tab does not show a picture frame. A search that found nothing
  // is a different statement and gets PanelNoResults instead.
  const EmptyIcon = tab === 'videos'
    ? CATEGORY_ICONS.videos
    : tab === 'audio'
      ? CATEGORY_ICONS.audio
      : CATEGORY_ICONS.photos

  if (view === 'record') {
    const options = [
      { key: 'talking-head', icon: UserRound, label: t('foundation.editor.uploads.recordTalkingHead') },
      { key: 'screen', icon: Monitor, label: t('foundation.editor.uploads.recordScreen') },
      { key: 'ai-voice', icon: Mic, label: t('foundation.editor.uploads.recordAiVoice') },
    ] as const

    return (
      <PanelChrome className="mona-uploads-panel">
        <PanelBackHeader
          label={t('foundation.editor.uploads.back')}
          onBack={() => {
            setRecordNotice(null)
            setView('main')
          }}
          title={t('foundation.editor.uploads.recordYourself')}
        />
        <PanelBody>
          <div className="flex flex-col gap-2">
            {options.map(option => {
              const Icon = option.icon
              return (
                <Button
                  className="h-auto justify-start gap-3 rounded-control border px-3 py-3 text-left font-medium whitespace-normal"
                  key={option.key}
                  onClick={() => setRecordNotice(t('foundation.editor.uploads.recordComingSoon'))}
                  type="button"
                  variant="ghost"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-control bg-muted text-foreground">
                    <Icon className="size-5" />
                  </span>
                  <span className="text-sm">{option.label}</span>
                </Button>
              )
            })}
          </div>
          {recordNotice ? (
            <output className="mt-4 block rounded-control bg-muted px-3 py-2 text-xs text-muted-foreground">
              {recordNotice}
            </output>
          ) : null}
        </PanelBody>
      </PanelChrome>
    )
  }

  return (
    <PanelChrome className="mona-uploads-panel">
      <PanelHeader>
        {/* Both actions rode along inside the old search field's trailing slot.
            With the field hoisted to the drawer they become controls in their
            own right, which is what they always were. */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            className="h-9 justify-start gap-2 rounded-action"
            disabled={uploading}
            onClick={() => {
              void pickFiles(UPLOAD_FILTERS, { multiple: true }).then(files => uploadFiles(files))
            }}
            type="button"
            variant="outline"
          >
            <Upload className="size-4 shrink-0" />
            <span className="truncate">{uploading ? t('foundation.editor.uploads.uploading') : t('foundation.editor.uploads.uploadFiles')}</span>
          </Button>
          <Button
            className="h-9 justify-start gap-2 rounded-action"
            onClick={() => {
              setRecordNotice(null)
              setView('record')
            }}
            type="button"
            variant="outline"
          >
            <Video className="size-4 shrink-0" />
            <span className="truncate">{t('foundation.editor.uploads.recordYourself')}</span>
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
      </PanelHeader>

      <PanelBody className="overflow-x-hidden">
        {tab === 'folders' ? (
          <PanelEmptyState icon={CATEGORY_ICONS.projects} message={t('foundation.editor.uploads.foldersComingSoon')} />
        ) : !items.length ? (
          query.trim()
            ? <PanelNoResults onClear={search.clear} query={query} />
            : <PanelEmptyState icon={EmptyIcon} message={t('foundation.editor.uploads.emptyLibrary')} />
        ) : (
          <PanelMasonry
            estimateRatio={mediaRatio}
            getKey={item => item.id}
            items={items}
            renderItem={item => (
              <button
                aria-label={t('foundation.editor.uploads.insertItem', { name: item.name })}
                className="block w-full overflow-hidden rounded-control text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => insertItem(item)}
                type="button"
              >
                <MediaThumb item={item} />
              </button>
            )}
          />
        )}
      </PanelBody>
    </PanelChrome>
  )
}
