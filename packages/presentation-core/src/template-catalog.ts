import type { SlideTemplate, TemplateProvider } from './model'

/** The id every template falls back to when it names no provider. */
export const BUILT_IN_TEMPLATE_PROVIDER_ID = 'mona'

/**
 * Where templates come from.
 *
 * One entry per source. Adding a source is adding a row here plus templates
 * that carry its `providerId` — the drawer groups and credits by provider on
 * its own, so nothing else needs to change.
 *
 * Providers whose licence forbids redistribution take `mode: 'link'`: their
 * templates are listed and linked, never held or served by us.
 */
export const DEFAULT_TEMPLATE_PROVIDERS: readonly TemplateProvider[] = [
  {
    id: BUILT_IN_TEMPLATE_PROVIDER_ID,
    mode: 'native',
    name: 'Mona',
  },
] as const

export const DEFAULT_TEMPLATE_CATALOG: readonly SlideTemplate[] = [
  { name: 'Crimson Landscape', id: 'template_1', cover: './imgs/template_1.webp', slideCount: 38, origin: 'Official', providerId: BUILT_IN_TEMPLATE_PROVIDER_ID },
  { name: 'Urban Blue', id: 'template_2', cover: './imgs/template_2.webp', slideCount: 36, origin: 'Official', providerId: BUILT_IN_TEMPLATE_PROVIDER_ID },
  { name: 'Smart Geometry', id: 'template_3', cover: './imgs/template_3.webp', slideCount: 36, origin: 'Official', providerId: BUILT_IN_TEMPLATE_PROVIDER_ID },
  { name: 'Soft Morandi', id: 'template_4', cover: './imgs/template_4.webp', slideCount: 36, origin: 'Official', providerId: BUILT_IN_TEMPLATE_PROVIDER_ID },
  { name: 'Minimal Green', id: 'template_5', cover: './imgs/template_5.webp', slideCount: 27, origin: 'Community contribution, refined by the official team', providerId: BUILT_IN_TEMPLATE_PROVIDER_ID },
  { name: 'Warm Vintage', id: 'template_6', cover: './imgs/template_6.webp', slideCount: 28, origin: 'Community contribution, refined by the official team', providerId: BUILT_IN_TEMPLATE_PROVIDER_ID },
  { name: 'Deep Focus', id: 'template_7', cover: './imgs/template_7.webp', slideCount: 26, origin: 'Community contribution, refined by the official team', providerId: BUILT_IN_TEMPLATE_PROVIDER_ID },
  { name: 'Fresh Sky Blue', id: 'template_8', cover: './imgs/template_8.webp', slideCount: 30, origin: 'Community contribution, refined by the official team', providerId: BUILT_IN_TEMPLATE_PROVIDER_ID },
] as const

/** Where bundled templates live when a provider names no base of its own. */
export const DEFAULT_TEMPLATE_PAYLOAD_BASE_URL = '/mocks/'

/**
 * The URL a template's slides are fetched from.
 *
 * Resolution runs most-specific first: the template's own URL, then its
 * provider's base, then the bundled default. That ordering is what lets a
 * hosted catalogue with hashed filenames coexist with a provider that simply
 * points at a bucket prefix, without either needing a special case here.
 */
export function resolveTemplatePayloadUrl(
  provider: TemplateProvider | undefined,
  template: SlideTemplate,
): string {
  if (template.payloadUrl) return template.payloadUrl
  const base = provider?.payloadBaseUrl ?? DEFAULT_TEMPLATE_PAYLOAD_BASE_URL
  return `${base}${template.id}.json`
}

/**
 * The URL a template's cover image is loaded from.
 *
 * Covers are what the catalogue grid renders, so this runs for every visible
 * card and must stay cheap. Absolute and root-relative values pass through
 * untouched; a bare or `./`-prefixed path joins onto the provider's base, which
 * is how a hosted catalogue points at its own CDN.
 */
export function resolveTemplateCoverUrl(
  provider: TemplateProvider | undefined,
  template: SlideTemplate,
): string {
  const cover = template.cover
  if (!cover) return ''
  if (/^(?:https?:)?\/\//.test(cover) || cover.startsWith('/')) return cover
  const relative = cover.replace(/^\.\//, '')
  return provider?.coverBaseUrl ? `${provider.coverBaseUrl}${relative}` : `/${relative}`
}

export function resolveTemplateProvider(
  providers: readonly TemplateProvider[],
  template: SlideTemplate,
): TemplateProvider | undefined {
  const id = template.providerId ?? BUILT_IN_TEMPLATE_PROVIDER_ID
  return providers.find(provider => provider.id === id)
}

/**
 * Group templates under their provider, preserving provider order and dropping
 * empty groups so a filtered search does not leave bare headings behind.
 */
export function groupTemplatesByProvider(
  providers: readonly TemplateProvider[],
  templates: readonly SlideTemplate[],
): { provider: TemplateProvider; templates: SlideTemplate[] }[] {
  const groups = providers.map(provider => ({ provider, templates: [] as SlideTemplate[] }))
  const byId = new Map(groups.map(group => [group.provider.id, group]))
  for (const template of templates) {
    byId.get(template.providerId ?? BUILT_IN_TEMPLATE_PROVIDER_ID)?.templates.push(template)
  }
  return groups.filter(group => group.templates.length > 0)
}
