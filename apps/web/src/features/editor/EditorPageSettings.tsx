import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock3, SlidersHorizontal } from 'lucide-react'

import { SLIDE_ANIMATIONS } from '@mona/presentation-core/animation-config'
import type { Slide, TurningMode } from '@mona/presentation-core/model'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { statusBarItemClassName } from '@/features/editor/editor-statusbar-chrome'
import type { EditorRuntime } from '@/features/editor/editor-runtime'

const MIN_DURATION_SECONDS = 1
const MAX_DURATION_SECONDS = 3600

export function EditorPageSettings({
  runtime,
  slide,
}: {
  runtime: EditorRuntime
  slide: Slide
}) {
  const { t } = useTranslation()
  const [title, setTitle] = useState(slide.title ?? '')
  const [duration, setDuration] = useState(slide.durationMs ? String(slide.durationMs / 1000) : '')

  const update = (props: Partial<Slide>, label: string, historyKey: string) => runtime.commit(
    label,
    [{ type: 'slide.update', slideId: slide.id, props }],
    { historyKey },
  )
  const commitTitle = () => {
    const value = title.trim()
    if (value === (slide.title ?? '')) return
    if (!value) {
      runtime.commit('Clear page title', [{
        type: 'slide.properties.remove',
        payload: { id: slide.id, property: 'title' },
      }], { historyKey: `page-title-${slide.id}` })
    }
    else update({ title: value }, 'Update page title', `page-title-${slide.id}`)
  }
  const commitDuration = () => {
    if (!duration.trim()) {
      if (slide.durationMs === undefined) return
      runtime.commit('Use manual page timing', [{
        type: 'slide.properties.remove',
        payload: { id: slide.id, property: 'durationMs' },
      }], { historyKey: `page-duration-${slide.id}` })
      return
    }
    const seconds = Math.max(MIN_DURATION_SECONDS, Math.min(MAX_DURATION_SECONDS, Number(duration)))
    if (!Number.isFinite(seconds)) {
      setDuration(slide.durationMs ? String(slide.durationMs / 1000) : '')
      return
    }
    setDuration(String(seconds))
    update({ durationMs: Math.round(seconds * 1000) }, 'Update page duration', `page-duration-${slide.id}`)
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button aria-label={t('foundation.editor.statusBar.pageSettings')} className={statusBarItemClassName()} size="editor" type="button" variant="ghost">
          <SlidersHorizontal /><span>{t('foundation.editor.statusBar.pageSettings')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label={t('foundation.editor.statusBar.pageSettings')} align="start" className="flex w-80 flex-col gap-3.5" side="top" sideOffset={10}>
        <div className="flex items-center justify-between [&>span]:text-tiny [&>span]:text-muted-foreground">
          <strong>{t('foundation.editor.statusBar.pageSettings')}</strong>
          <span>{t('foundation.editor.thumbnails.slideCount', {
            current: runtime.store.getState().presentation.slides.findIndex(candidate => candidate.id === slide.id) + 1,
            total: runtime.store.getState().presentation.slides.length,
          })}</span>
        </div>
        <div className="grid gap-1.5 [&_label]:text-xs [&_label]:font-semibold">
          <Label htmlFor={`page-title-${slide.id}`}>{t('foundation.editor.statusBar.pageTitle')}</Label>
          <Input
            id={`page-title-${slide.id}`}
            onBlur={commitTitle}
            onChange={event => setTitle(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') event.currentTarget.blur()
              else if (event.key === 'Escape') {
                setTitle(slide.title ?? '')
                event.currentTarget.blur()
              }
            }}
            placeholder={t('foundation.editor.statusBar.untitledPage')}
            value={title}
          />
        </div>
        <div className="flex items-center justify-between gap-5 [&_label]:text-xs [&_label]:font-semibold [&_p]:mt-0.75 [&_p]:text-mini [&_p]:text-muted-foreground">
          <div>
            <Label htmlFor={`page-hidden-${slide.id}`}>{t('foundation.editor.statusBar.hidePage')}</Label>
            <p>{t('foundation.editor.statusBar.hidePageDescription')}</p>
          </div>
          <Switch
            checked={Boolean(slide.hidden)}
            id={`page-hidden-${slide.id}`}
            onCheckedChange={hidden => update({ hidden }, hidden ? 'Hide page' : 'Show page', `page-hidden-${slide.id}`)}
          />
        </div>
        <div className="grid gap-1.5 [&_label]:text-xs [&_label]:font-semibold">
          <Label htmlFor={`page-duration-${slide.id}`}>{t('foundation.editor.statusBar.duration')}</Label>
          <div className="relative flex items-center gap-1.75 [&>svg]:absolute [&>svg]:left-2.25 [&>svg]:size-3.75 [&>svg]:text-muted-foreground [&_input]:pl-7.5 [&>span]:text-tiny [&>span]:text-muted-foreground">
            <Clock3 />
            <Input
              id={`page-duration-${slide.id}`}
              inputMode="decimal"
              max={MAX_DURATION_SECONDS}
              min={MIN_DURATION_SECONDS}
              onBlur={commitDuration}
              onChange={event => setDuration(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') event.currentTarget.blur()
                else if (event.key === 'Escape') {
                  setDuration(slide.durationMs ? String(slide.durationMs / 1000) : '')
                  event.currentTarget.blur()
                }
              }}
              placeholder={t('foundation.editor.statusBar.manual')}
              step="0.5"
              type="number"
              value={duration}
            />
            <span>{t('foundation.editor.statusBar.seconds')}</span>
          </div>
        </div>
        <div className="grid gap-1.5 [&_label]:text-xs [&_label]:font-semibold">
          <Label>{t('foundation.editor.statusBar.transition')}</Label>
          <Select
            onValueChange={value => update({ turningMode: value as TurningMode }, 'Update page transition', `page-transition-${slide.id}`)}
            value={slide.turningMode || 'slideY'}
          >
            <SelectTrigger aria-label={t('foundation.editor.statusBar.transition')} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {SLIDE_ANIMATIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {t(`slideTransitions.${option.value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </PopoverContent>
    </Popover>
  )
}
