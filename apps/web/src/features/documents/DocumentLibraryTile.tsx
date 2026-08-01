import { useState, type ReactNode } from 'react'
import { Presentation } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export type DocumentLibraryView = 'grid' | 'list'

interface DocumentLibraryTileProps {
  actions?: ReactNode
  busy?: boolean
  dataSourceDocumentId?: string
  metadata: string
  onOpen: () => void
  openLabel: string
  source: string
  thumbnailUrl?: string
  title: string
  view: DocumentLibraryView
}

function DocumentThumbnail({
  className,
  thumbnailUrl,
}: {
  className?: string
  thumbnailUrl?: string
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const failed = !thumbnailUrl || failedSource === thumbnailUrl

  return (
    <div className={cn('relative flex overflow-hidden bg-muted/55', className)}>
      {!failed ? (
        <img
          alt=""
          className="size-full object-contain"
          decoding="async"
          loading="lazy"
          onError={() => setFailedSource(thumbnailUrl)}
          src={thumbnailUrl}
        />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground/65">
          <Presentation aria-hidden className="size-[18%] min-h-7 min-w-7" strokeWidth={1.5} />
        </div>
      )}
    </div>
  )
}

export function DocumentLibraryTile({
  actions,
  busy = false,
  dataSourceDocumentId,
  metadata,
  onOpen,
  openLabel,
  source,
  thumbnailUrl,
  title,
  view,
}: DocumentLibraryTileProps) {
  if (view === 'list') {
    return (
      <div
        className="group relative flex min-w-0 items-center gap-3 border-b border-border/70 py-2.5 pe-12"
        data-source-document={dataSourceDocumentId}
      >
        <Button
          aria-label={openLabel}
          className="h-auto min-w-0 flex-1 justify-start gap-3 rounded-control p-0 text-start font-normal hover:bg-transparent"
          disabled={busy}
          onClick={onOpen}
          size={null}
          type="button"
          variant="ghost"
        >
          <DocumentThumbnail className="aspect-video w-28 shrink-0 rounded-control ring-1 ring-foreground/8" thumbnailUrl={thumbnailUrl} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <Presentation aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm font-medium">{title}</span>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{metadata}</p>
          </div>
          <span className="hidden w-32 shrink-0 truncate text-xs text-muted-foreground lg:block">{source}</span>
        </Button>
        {actions ? <div className="absolute end-1 top-1/2 -translate-y-1/2">{actions}</div> : null}
      </div>
    )
  }

  return (
    <Card
      className="group relative gap-0 py-0 shadow-[0_1px_2px_rgb(15_23_42/4%)] transition-[box-shadow,ring-color,transform] duration-150 hover:-translate-y-px hover:shadow-[0_6px_18px_rgb(15_23_42/9%)] focus-within:ring-2 focus-within:ring-ring/45"
      data-source-document={dataSourceDocumentId}
      size="sm"
    >
      <Button
        aria-label={openLabel}
        className="h-auto min-w-0 w-full cursor-pointer flex-col items-stretch justify-start gap-0 rounded-xl p-0 text-start font-normal whitespace-normal hover:bg-transparent"
        disabled={busy}
        onClick={onOpen}
        size={null}
        type="button"
        variant="ghost"
      >
        <CardContent className="aspect-video w-full overflow-hidden bg-muted/45 p-2">
          <DocumentThumbnail className="size-full rounded-lg ring-1 ring-foreground/7" thumbnailUrl={thumbnailUrl} />
        </CardContent>
        <CardFooter className="min-h-14 gap-2 border-t-0 bg-card px-3 py-2.5">
          <Presentation aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-5">{title}</p>
            <p className="truncate text-xs leading-4 text-muted-foreground">{metadata}</p>
          </div>
        </CardFooter>
      </Button>
      {actions ? (
        <div className="absolute end-2 bottom-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {actions}
        </div>
      ) : null}
    </Card>
  )
}
