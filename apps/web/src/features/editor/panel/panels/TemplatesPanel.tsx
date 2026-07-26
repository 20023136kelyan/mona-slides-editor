/** Templates catalogue and its drill-in detail view. */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'

import {
  DEFAULT_TEMPLATE_PAYLOAD_BASE_URL,
  groupTemplatesByProvider,
  resolveTemplateCoverUrl,
  resolveTemplatePayloadUrl,
  resolveTemplateProvider,
} from '@mona/presentation-core'
import type { Slide, SlideTemplate, SlideTheme, TemplateProvider } from '@mona/presentation-core/model'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useEditorPanel } from '@/features/editor/panel/editor-panel-context'
import { useEditorPanelSearch } from '@/features/editor/panel/editor-panel-search'
import { PanelBackHeader, PanelBody, PanelChrome, PanelNoResults } from '@/features/editor/panel/EditorPanelPrimitives'
import { ScaledSlide } from '@/features/presentation-renderer/ScaledSlide'

interface TemplatePayload {
  slides: Slide[]
  theme?: Partial<SlideTheme>
}

// One fetch per payload for the whole session: the cover cards and the detail
// view share the same cached promise. Keyed by resolved URL rather than by
// template id, so two providers using the same id cannot collide in the cache.
const templatePayloadCache = new Map<string, Promise<TemplatePayload>>()
function loadTemplatePayload(url: string) {
  let cached = templatePayloadCache.get(url)
  if (!cached) {
    cached = fetch(url).then(async response => {
      if (!response.ok) throw new Error(`Template request failed: ${response.status}`)
      return response.json() as Promise<TemplatePayload>
    })
    cached.catch(() => templatePayloadCache.delete(url))
    templatePayloadCache.set(url, cached)
  }
  return cached
}

function useTemplatePayload(url: string) {
  const [payload, setPayload] = useState<TemplatePayload | null>(null)
  useEffect(() => {
    let active = true
    loadTemplatePayload(url)
      .then(data => {
        if (active) setPayload(data)
      })
      .catch(() => {
        if (active) setPayload({ slides: [] })
      })
    return () => {
      active = false
    }
  }, [url])
  return payload
}

/**
 * Thumbnails are square-cornered on purpose: they stand for slides, and slides
 * have corners. Rounding them made the grid read as a set of cards rather than
 * as a set of pages.
 *
 * `border-0` drops the Button base's 1px transparent border so the button box
 * is exactly the thumbnail box. With it, every visible gap picks up an extra
 * 1px per adjacent edge and the grid gutters stop matching the drawer's.
 */
const templateCardClassName = 'flex h-auto flex-col items-stretch border-0 p-0 hover:bg-transparent [&_.mona-template-thumb]:overflow-hidden [&_.mona-template-thumb]:ring-1 [&_.mona-template-thumb]:ring-foreground/[0.07] [&_.mona-template-thumb]:transition-shadow hover:[&_.mona-template-thumb]:ring-2 hover:[&_.mona-template-thumb]:ring-foreground/30'

/**
 * One gap value for the whole grid, matching PanelBody's px-3 gutter, so the
 * space between two thumbnails is the same as the space between a thumbnail and
 * the drawer edge — vertically and horizontally alike.
 */
const templateGridClassName = 'grid grid-cols-2 gap-3'

/**
 * A catalogue card is a cover image, not a rendered slide.
 *
 * Rendering the real first slide meant fetching the whole payload (~169KB) and
 * standing up a slide renderer for every visible card, so merely opening the
 * drawer downloaded the entire catalogue. A cover is ~12KB, lazily loaded, and
 * the payload is not touched until the user drills in or inserts.
 */
function TemplateCoverCard({ coverUrl, name, onOpen }: {
  coverUrl: string
  name: string
  onOpen: () => void
}) {
  const [failed, setFailed] = useState(false)
  return (
    <Button aria-label={name} className={templateCardClassName} onClick={onOpen} size="editor" title={name} type="button" variant="ghost">
      {coverUrl && !failed ? (
        <img
          alt=""
          className="mona-template-thumb block aspect-video w-full bg-muted object-cover"
          decoding="async"
          loading="lazy"
          onError={() => setFailed(true)}
          src={coverUrl}
        />
      ) : (
        <Skeleton className="mona-template-thumb aspect-video w-full" />
      )}
    </Button>
  )
}

function TemplateDetail({ name, onBack, onInsertAll, onInsertOne, payloadUrl, slideCount, theme }: {
  name: string
  onBack: () => void
  onInsertAll: (payload: TemplatePayload) => void
  onInsertOne: (slide: Slide) => void
  payloadUrl: string
  /** From the catalogue, so the count renders before the payload lands. */
  slideCount?: number
  theme?: SlideTheme
}) {
  const { t } = useTranslation()
  const payload = useTemplatePayload(payloadUrl)
  // Same contract as the catalogue view it replaces: the back header stays put
  // and only the slide grid scrolls. As a bare div it inherited the container's
  // scroll instead, so the header scrolled away with the content.
  return (
    <PanelChrome className="mona-templates-panel select-none">
      <PanelBackHeader
        label={t('foundation.editor.templates.back')}
        onBack={onBack}
        title={name}
      />
      <PanelBody>
        <div className="mb-3 text-xs text-foreground/55">{t('foundation.editor.templates.meta', { count: payload?.slides.length ?? slideCount ?? 0 })}</div>
        {payload ? (
          <>
            <Button className="mb-3 w-full rounded-action font-semibold" onClick={() => onInsertAll(payload)} size="sm" type="button" variant="outline">
              {t('foundation.editor.templates.applyAll', { count: payload.slides.length })}
            </Button>
            <div className={templateGridClassName}>
              {payload.slides.map((slide, index) => (
                <Button aria-label={`${t('foundation.editor.templates.insertTemplate')} ${index + 1}`} className={templateCardClassName} key={slide.id} onClick={() => onInsertOne(slide)} size="editor" type="button" variant="ghost">
                  <ScaledSlide slide={slide} theme={{ ...theme!, ...payload.theme }} thumbnail viewportRatio={0.5625} viewportSize={1000} />
                </Button>
              ))}
            </div>
          </>
        ) : (
          <Skeleton className="aspect-video w-full" />
        )}
      </PanelBody>
    </PanelChrome>
  )
}

/**
 * Names the source of the templates beneath it.
 *
 * Every group is labelled, including our own: the point is that a user can
 * always tell whose catalogue they are looking at. Where a licence requires
 * credit, this is where it is paid — as visible text, with a link to the
 * provider, which is what attribution clauses generally ask for.
 */
function TemplateProviderHeader({ provider }: { provider: TemplateProvider }) {
  const { t } = useTranslation()
  return (
    <div className="mb-2 flex min-w-0 items-baseline gap-2">
      <h3 className="truncate text-sm font-semibold text-foreground">{provider.name}</h3>
      {provider.license ? (
        <span className="shrink-0 text-[11px] text-muted-foreground">{provider.license.name}</span>
      ) : null}
      {provider.homepage ? (
        <a
          className="ml-auto flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          href={provider.homepage}
          rel="noopener noreferrer"
          target="_blank"
        >
          {t('foundation.editor.templates.visitProvider', { provider: provider.name })}
          <ExternalLink className="size-3" />
        </a>
      ) : null}
    </div>
  )
}

export function TemplatesPanel() {
  const { actions, templateProviders, templates, theme } = useEditorPanel()
  const search = useEditorPanelSearch()
  const onInsertAll = (payload: TemplatePayload) => actions.insertTemplateAll(payload.slides, payload.theme ?? {})
  const onInsertOne = actions.insertTemplateOne
  const { t } = useTranslation()
  const [openCatalog, setOpenCatalog] = useState<string | null>(null)
  const query = search.query
  const templateName = (template: SlideTemplate) =>
    t(`foundation.editor.templates.catalog.${template.id}`, { defaultValue: template.name })

  const groups = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    // Resolved inside the memo rather than through the outer helper: closing
    // over that helper makes it a dependency that changes every render.
    const nameOf = (template: SlideTemplate) =>
      t(`foundation.editor.templates.catalog.${template.id}`, { defaultValue: template.name })
    const matched = normalized
      ? templates.filter(template => nameOf(template).toLocaleLowerCase().includes(normalized))
      : templates
    return groupTemplatesByProvider(templateProviders, matched)
  }, [query, t, templateProviders, templates])

  if (openCatalog) {
    const template = templates.find(item => item.id === openCatalog)
    return (
      <TemplateDetail
        name={template ? templateName(template) : openCatalog}
        onBack={() => setOpenCatalog(null)}
        onInsertAll={onInsertAll}
        onInsertOne={onInsertOne}
        payloadUrl={template
          ? resolveTemplatePayloadUrl(resolveTemplateProvider(templateProviders, template), template)
          : `${DEFAULT_TEMPLATE_PAYLOAD_BASE_URL}${openCatalog}.json`}
        slideCount={template?.slideCount}
        theme={theme}
      />
    )
  }

  // The search bar is the drawer's, above this panel; the catalogue is all this
  // one contributes — grouped by provider so every template is credited to the
  // catalogue it came from.
  return (
    <PanelChrome className="mona-templates-panel select-none">
      <PanelBody className="space-y-5">
        {groups.length ? groups.map(({ provider, templates: providerTemplates }) => (
          <section key={provider.id}>
            <TemplateProviderHeader provider={provider} />
            <div className={templateGridClassName}>
              {providerTemplates.map(template => (
                <TemplateCoverCard
                  coverUrl={resolveTemplateCoverUrl(provider, template)}
                  key={template.id}
                  name={templateName(template)}
                  // A `link` provider does not hand us files: the card sends the
                  // user to the provider's own page for this template instead of
                  // drilling into a payload we are not allowed to hold.
                  onOpen={provider.mode === 'link' && template.sourceUrl
                    ? () => window.open(template.sourceUrl, '_blank', 'noopener,noreferrer')
                    : () => setOpenCatalog(template.id)}
                />
              ))}
            </div>
            {provider.attribution ? (
              <p className="mt-2 text-[11px] leading-normal text-muted-foreground">{provider.attribution}</p>
            ) : null}
          </section>
        )) : <PanelNoResults onClear={search.clear} query={query} />}
      </PanelBody>
    </PanelChrome>
  )
}
