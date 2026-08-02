import type { StructuredTextRun } from './model'

export interface PowerPointFieldEvaluationContext {
  /** The instant used for dynamic date/time fields. */
  dateTime: Date
  /** Presentation fallback locale. A run-level language takes precedence. */
  locale?: string
  slideNumber: number
  timeZone?: string
}

const safeLocale = (locale: string | undefined): string => {
  if (!locale) return 'en-US'
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? 'en-US'
  }
  catch {
    return 'en-US'
  }
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

const formatter = (
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat => {
  const key = `${locale}:${JSON.stringify(Object.entries(options).sort(([left], [right]) => (
    left.localeCompare(right)
  )))}`
  const cached = formatterCache.get(key)
  if (cached) return cached
  const created = new Intl.DateTimeFormat(locale, options)
  if (formatterCache.size >= 128) formatterCache.delete(formatterCache.keys().next().value!)
  formatterCache.set(key, created)
  return created
}

const format = (
  dateTime: Date,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string => formatter(locale, options).format(dateTime)

const part = (
  dateTime: Date,
  locale: string,
  options: Intl.DateTimeFormatOptions,
  type: Intl.DateTimeFormatPartTypes,
): string => formatter(locale, options)
  .formatToParts(dateTime)
  .find(candidate => candidate.type === type)?.value ?? ''

const dateTimeFieldText = (
  fieldType: string,
  dateTime: Date,
  locale: string,
  timeZone: string | undefined,
): string | undefined => {
  const common = timeZone ? { timeZone } : {}
  switch (fieldType) {
    case 'datetime':
      return format(dateTime, locale, {
        ...common,
        dateStyle: 'short',
        timeStyle: 'short',
      })
    // PowerPoint's "Figure Out" option follows the run language. This is also
    // what Office itself writes in real en-US and en-GB decks.
    case 'datetimefigureout':
      return format(dateTime, locale, {
        ...common,
        day: 'numeric',
        month: 'numeric',
        year: 'numeric',
      })
    case 'datetime1':
      return format(dateTime, locale, {
        ...common,
        day: 'numeric',
        month: 'numeric',
        year: 'numeric',
      })
    case 'datetime2':
      return format(dateTime, locale, {
        ...common,
        day: 'numeric',
        month: 'long',
        weekday: 'long',
        year: 'numeric',
      })
    case 'datetime3': {
      const options = { ...common, day: 'numeric', month: 'long', year: 'numeric' } as const
      return [
        part(dateTime, locale, options, 'day'),
        part(dateTime, locale, options, 'month'),
        part(dateTime, locale, options, 'year'),
      ].filter(Boolean).join(' ')
    }
    case 'datetime4': {
      const options = { ...common, day: 'numeric', month: 'long', year: 'numeric' } as const
      const month = part(dateTime, locale, options, 'month')
      const day = part(dateTime, locale, options, 'day')
      const year = part(dateTime, locale, options, 'year')
      return `${month} ${day}, ${year}`.trim()
    }
    case 'datetime5': {
      const options = { ...common, day: 'numeric', month: 'short', year: '2-digit' } as const
      return [
        part(dateTime, locale, options, 'day'),
        part(dateTime, locale, options, 'month'),
        part(dateTime, locale, options, 'year'),
      ].filter(Boolean).join('-')
    }
    case 'datetime6': {
      const options = { ...common, month: 'long', year: '2-digit' } as const
      return [
        part(dateTime, locale, options, 'month'),
        part(dateTime, locale, options, 'year'),
      ].filter(Boolean).join(' ')
    }
    case 'datetime7': {
      const options = { ...common, month: 'short', year: '2-digit' } as const
      return [
        part(dateTime, locale, options, 'month'),
        part(dateTime, locale, options, 'year'),
      ].filter(Boolean).join('-')
    }
    case 'datetime8':
      return format(dateTime, locale, {
        ...common,
        day: 'numeric',
        hour: 'numeric',
        hourCycle: 'h12',
        minute: '2-digit',
        month: 'numeric',
        year: 'numeric',
      })
    case 'datetime9':
      return format(dateTime, locale, {
        ...common,
        day: 'numeric',
        hour: 'numeric',
        hourCycle: 'h12',
        minute: '2-digit',
        month: 'numeric',
        second: '2-digit',
        year: 'numeric',
      })
    case 'datetime10':
      return format(dateTime, locale, {
        ...common,
        hour: '2-digit',
        hourCycle: 'h23',
        minute: '2-digit',
      })
    case 'datetime11':
      return format(dateTime, locale, {
        ...common,
        hour: '2-digit',
        hourCycle: 'h23',
        minute: '2-digit',
        second: '2-digit',
      })
    case 'datetime12':
      return format(dateTime, locale, {
        ...common,
        hour: 'numeric',
        hourCycle: 'h12',
        minute: '2-digit',
      })
    case 'datetime13':
      return format(dateTime, locale, {
        ...common,
        hour: 'numeric',
        hourCycle: 'h12',
        minute: '2-digit',
        second: '2-digit',
      })
    default:
      return undefined
  }
}

/**
 * Evaluate the reserved DrawingML field types that PowerPoint updates before
 * rendering. Unknown application-defined types deliberately retain their
 * cached text, as required by OOXML's open-ended field-type contract.
 */
export const evaluatePowerPointField = (
  run: StructuredTextRun,
  context: PowerPointFieldEvaluationContext,
): string => {
  const fieldType = run.fieldType?.trim().toLowerCase()
  if (!fieldType) return run.text ?? ''
  if (fieldType === 'slidenum') return String(context.slideNumber)
  if (!Number.isFinite(context.dateTime.getTime())) return run.text ?? ''
  const locale = safeLocale(run.properties?.language ?? context.locale)
  try {
    return dateTimeFieldText(fieldType, context.dateTime, locale, context.timeZone)
      ?? run.text
      ?? ''
  }
  catch {
    // Invalid time zones and incomplete ICU data must not erase the source
    // package's last materialized field value.
    return run.text ?? ''
  }
}
