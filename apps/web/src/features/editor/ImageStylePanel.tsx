/* oxlint-disable jsx-a11y/prefer-tag-over-role -- PPTist's filter preset and crop-item divs are required for exact raster parity. */

import { useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'

import DownIcon from '~icons/icon-park-outline/down'
import TailoringIcon from '~icons/icon-park-outline/tailoring'
import ThemeIcon from '~icons/icon-park-outline/theme'
import TransformIcon from '~icons/icon-park-outline/transform'
import UndoIcon from '~icons/icon-park-outline/undo'
import type { PresentationState } from '@mona/presentation-core'
import type {
  ImageElementFilterKeys,
  ImageElementFilters,
  PPTImageElement,
} from '@mona/presentation-core/model'
import { editorActions } from '@mona/editor-state'
import tinycolor from 'tinycolor2'

import {
  ElementFlipControls,
  ElementOutlineControls,
  ElementShadowControls,
  PropertyRow,
} from '@/features/editor/ElementStyleCommons'
import {
  InspectorButton,
  InspectorButtonGroup,
  InspectorColorButton,
  InspectorNumberInput,
  InspectorPopoverButton,
  InspectorSlider,
  InspectorSwitch,
} from '@/features/editor/EditorInspectorPrimitives'
import { getImageBeforeCrop, getPresetImageCrop, getReplacementImageCommands } from '@/features/editor/editor-image'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { CLIP_PATHS, getImageFilter } from '@/features/presentation-renderer/render-utils'

interface FilterOption {
  default: number
  key: ImageElementFilterKeys
  max: number
  step: number
  unit: string
}

const filterOptions: readonly FilterOption[] = [
  { key: 'blur', default: 0, unit: 'px', max: 10, step: 1 },
  { key: 'brightness', default: 100, unit: '%', max: 200, step: 5 },
  { key: 'contrast', default: 100, unit: '%', max: 200, step: 5 },
  { key: 'grayscale', default: 0, unit: '%', max: 100, step: 5 },
  { key: 'saturate', default: 100, unit: '%', max: 200, step: 5 },
  { key: 'hue-rotate', default: 0, unit: 'deg', max: 360, step: 10 },
  { key: 'sepia', default: 0, unit: '%', max: 100, step: 5 },
  { key: 'invert', default: 0, unit: '%', max: 100, step: 5 },
  { key: 'opacity', default: 100, unit: '%', max: 100, step: 5 },
]

const presetFilters: ReadonlyArray<{ key: string; values: ImageElementFilters }> = [
  { key: 'blackWhite', values: { grayscale: '100%' } },
  { key: 'vintage', values: { sepia: '50%', contrast: '110%', brightness: '90%' } },
  { key: 'sharpen', values: { contrast: '150%' } },
  { key: 'soft', values: { brightness: '110%', contrast: '90%' } },
  { key: 'warm', values: { sepia: '30%', saturate: '135%' } },
  { key: 'bright', values: { brightness: '110%', contrast: '110%' } },
  { key: 'vivid', values: { saturate: '200%' } },
  { key: 'blur', values: { blur: '2px' } },
  { key: 'invert', values: { invert: '100%' } },
]

const ratioClipOptions = [
  { label: 'squareRatio', children: [{ key: '1:1', ratio: 1 }] },
  { label: 'portraitRatio', children: [{ key: '2:3', ratio: 3 / 2 }, { key: '3:4', ratio: 4 / 3 }, { key: '3:5', ratio: 5 / 3 }, { key: '4:5', ratio: 5 / 4 }] },
  { label: 'landscapeRatio', children: [{ key: '3:2', ratio: 2 / 3 }, { key: '4:3', ratio: 3 / 4 }, { key: '5:3', ratio: 3 / 5 }, { key: '5:4', ratio: 4 / 5 }] },
  { label: '', children: [{ key: '16:9', ratio: 9 / 16 }, { key: '16:10', ratio: 10 / 16 }] },
] as const

const commitUpdate = (runtime: EditorRuntime, element: PPTImageElement, props: Partial<PPTImageElement>, historyKey = `image-style-${element.id}`) => runtime.commit(
  'Update image style',
  [{ type: 'element.update', payload: { id: element.id, props } }],
  { historyKey },
)

const commitRemove = (runtime: EditorRuntime, element: PPTImageElement, property: string | string[], historyKey = `image-style-${element.id}`) => runtime.commit(
  'Remove image style',
  [{ type: 'element.properties.remove', payload: { id: element.id, property } }],
  { historyKey },
)

export function ImageStylePanel({ element, presentation, runtime }: {
  element: PPTImageElement
  presentation: PresentationState
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const [cropOptionsOpen, setCropOptionsOpen] = useState(false)
  const hasFilters = element.filters !== undefined
  const hasColorMask = element.colorMask !== undefined
  const defaultMask = tinycolor(presentation.theme.themeColors[0]).setAlpha(0.5).toRgbString()
  const applyCrop = (shape: string, ratio = 0) => {
    commitUpdate(runtime, element, getPresetImageCrop(element, shape, ratio), `image-crop-${element.id}`)
    setCropOptionsOpen(false)
    runtime.store.dispatch(editorActions.cropElementChanged(element.id))
  }
  const replaceImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const commands = await getReplacementImageCommands(element, file)
    runtime.commit('Replace image', commands, { historyKey: `image-replace-${element.id}` })
  }
  const resetImage = () => {
    const commands: Parameters<EditorRuntime['commit']>[1] = []
    if (element.clip) {
      const origin = getImageBeforeCrop(element)
      commands.push({
        type: 'element.update',
        payload: {
          id: element.id,
          props: {
            left: origin.originLeft,
            top: origin.originTop,
            width: origin.originWidth,
            height: origin.originHeight,
          },
        },
      })
    }
    commands.push({
      type: 'element.properties.remove',
      // Keep PPTist's legacy `flip` removal literally. The source does not
      // clear the independent flipH / flipV flags during reset.
      payload: { id: element.id, property: ['clip', 'outline', 'flip', 'shadow', 'filters', 'colorMask', 'radius'] },
    })
    if (element.radius !== undefined && element.radius !== 0) {
      // Vue's watched NumberInput observes the removed nonzero radius and
      // synchronously writes its displayed fallback (0) back to the element.
      // Preserve that externally observable source state.
      commands.push({ type: 'element.update', payload: { id: element.id, props: { radius: 0 } } })
    }
    runtime.commit('Reset image style', commands, { historyKey: `image-reset-${element.id}` })
  }

  return (
    <div className="mona-image-style-panel">
      <div className="mona-image-origin-preview" style={{ backgroundImage: `url(${element.src})` }} />
      <ElementFlipControls element={element} runtime={runtime} />

      <InspectorButtonGroup className="mona-image-crop-group mona-panel-row-full">
        <InspectorButton ariaLabel={t('foundation.editor.image.cropImage')} onClick={() => runtime.store.dispatch(editorActions.cropElementChanged(element.id))} style={{ width: 'calc(100% - 32px)' }}><TailoringIcon /> {t('foundation.editor.image.cropImage')}</InspectorButton>
        <InspectorPopoverButton
          ariaLabel={t('foundation.editor.image.cropOptions')}
          className="mona-image-crop-popover-button"
          content={(
            <div className="mona-image-clip-panel">
              <div className="mona-image-clip-title">{t('foundation.editor.image.byShape')}</div>
              <div className="mona-image-clip-shapes">
                {Object.entries(CLIP_PATHS).map(([key, clip]) => (
                  <div
                    aria-label={key}
                    className="mona-image-clip-shape-item"
                    key={key}
                    onClick={() => applyCrop(key)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') applyCrop(key)
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="mona-image-clip-shape" style={{ clipPath: clip.style }} />
                  </div>
                ))}
              </div>
              {ratioClipOptions.map(group => (
                <div className="mona-image-ratio-group" key={group.label || 'wide'}>
                  {group.label ? <div className="mona-image-clip-title">{t('foundation.editor.image.byRatio', { ratio: t(`foundation.editor.image.${group.label}`) })}</div> : null}
                  <InspectorButtonGroup className="mona-image-ratio-buttons">
                    {group.children.map(option => <InspectorButton ariaLabel={option.key} key={option.key} onClick={() => applyCrop('rect', option.ratio)} style={{ flex: 1 }}>{option.key}</InspectorButton>)}
                  </InspectorButtonGroup>
                </div>
              ))}
            </div>
          )}
          onOpenChange={setCropOptionsOpen}
          open={cropOptionsOpen}
        ><DownIcon /></InspectorPopoverButton>
      </InspectorButtonGroup>

      <PropertyRow label={t('foundation.editor.image.cornerRadius')}><InspectorNumberInput ariaLabel={t('foundation.editor.image.cornerRadius')} onChange={radius => commitUpdate(runtime, element, { radius })} value={element.radius || 0} /></PropertyRow>
      <div className="mona-panel-divider" />

      <PropertyRow label={t('foundation.editor.image.colorMask')}>
        <div className="mona-panel-switch-wrapper"><InspectorSwitch ariaLabel={t('foundation.editor.image.colorMask')} checked={hasColorMask} onChange={checked => checked ? commitUpdate(runtime, element, { colorMask: defaultMask }) : commitRemove(runtime, element, 'colorMask')} /></div>
      </PropertyRow>
      {hasColorMask ? <PropertyRow label={t('foundation.editor.image.maskColor')}><InspectorColorButton ariaLabel={t('foundation.editor.image.maskColor')} color={element.colorMask || defaultMask} onChange={colorMask => commitUpdate(runtime, element, { colorMask })} /></PropertyRow> : null}
      <div className="mona-panel-divider" />

      <PropertyRow label={t('foundation.editor.image.enableFilter')}>
        <div className="mona-panel-switch-wrapper"><InspectorSwitch ariaLabel={t('foundation.editor.image.enableFilter')} checked={hasFilters} onChange={checked => checked ? commitUpdate(runtime, element, { filters: {} }) : commitRemove(runtime, element, 'filters')} /></div>
      </PropertyRow>
      {hasFilters ? (
        <>
          <div className="mona-image-filter-presets">
            {presetFilters.map(preset => (
              <div
                aria-label={t(`foundation.editor.filters.${preset.key}`)}
                className="mona-image-filter-preset"
                key={preset.key}
                onClick={() => commitUpdate(runtime, element, { filters: preset.values })}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') commitUpdate(runtime, element, { filters: preset.values })
                }}
                role="button"
                tabIndex={0}
              >
                <img alt="" src={element.src} style={{ filter: getImageFilter(preset.values) }} />
                <span>{t(`foundation.editor.filters.${preset.key}`)}</span>
              </div>
            ))}
          </div>
          <div className="mona-image-filter-controls">
            {filterOptions.map(filter => {
              const value = element.filters?.[filter.key] ? Number.parseInt(element.filters[filter.key]!, 10) : filter.default
              return (
                <div className="mona-image-filter-row" key={filter.key}>
                  <div>{t(`foundation.editor.filters.${filter.key}`)}</div>
                  <InspectorSlider ariaLabel={t(`foundation.editor.filters.${filter.key}`)} max={filter.max} min={0} onChange={next => commitUpdate(runtime, element, { filters: { ...(element.filters || {}), [filter.key]: `${next}${filter.unit}` } })} step={filter.step} value={value} />
                </div>
              )
            })}
          </div>
        </>
      ) : null}
      <div className="mona-panel-divider" />
      <ElementOutlineControls element={element} presentation={presentation} runtime={runtime} />
      <div className="mona-panel-divider" />
      <ElementShadowControls element={element} presentation={presentation} runtime={runtime} />
      <div className="mona-panel-divider" />

      <input accept="image/*" aria-label={t('foundation.editor.image.replaceImage')} className="mona-visually-hidden" onChange={replaceImage} ref={replaceInputRef} type="file" />
      <InspectorButton ariaLabel={t('foundation.editor.image.replaceImage')} className="mona-image-full-button" onClick={() => replaceInputRef.current?.click()}><TransformIcon /> {t('foundation.editor.image.replaceImage')}</InspectorButton>
      <InspectorButton ariaLabel={t('foundation.editor.image.resetStyle')} className="mona-image-full-button" onClick={resetImage}><UndoIcon /> {t('foundation.editor.image.resetStyle')}</InspectorButton>
      <InspectorButton ariaLabel={t('foundation.editor.image.setAsBackground')} className="mona-image-full-button" onClick={() => runtime.commit('Set image as background', [{ type: 'slide.update', props: { background: { ...(presentation.slides[presentation.slideIndex]?.background || {}), type: 'image', image: { src: element.src, size: 'cover' } } } }], { historyKey: `image-background-${element.id}` })}><ThemeIcon /> {t('foundation.editor.image.setAsBackground')}</InspectorButton>
    </div>
  )
}
