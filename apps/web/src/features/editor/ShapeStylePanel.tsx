/* oxlint-disable jsx-a11y/no-static-element-interactions -- Gradient stops preserve the established editor's pointer and context-menu interaction contract. */
import { useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'

import AlignBottomIcon from '~icons/icon-park-outline/align-text-bottom-one'
import AlignMiddleIcon from '~icons/icon-park-outline/align-text-middle-one'
import AlignTopIcon from '~icons/icon-park-outline/align-text-top-one'
import DownIcon from '~icons/icon-park-outline/down'
import FormatBrushIcon from '~icons/icon-park-outline/format-brush'
import FullwidthIcon from '~icons/icon-park-outline/fullwidth'
import PlusIcon from '~icons/icon-park-outline/plus'
import RowHeightIcon from '~icons/icon-park-outline/row-height'
import VerticalSpacingIcon from '~icons/icon-park-outline/vertical-spacing-between-items'
import type { PresentationState, ShapePoolItem } from '@mona/presentation-core'
import { SHAPE_LIST, SHAPE_PATH_FORMULAS } from '@mona/presentation-core/shape-presets'
import type { Gradient, GradientColor, GradientType, PPTShapeElement, ShapeText, TextInset } from '@mona/presentation-core/model'

import { Button } from '@/components/ui/button'
import { InspectorButton, InspectorButtonGroup, InspectorColorButton, InspectorNumberInput, InspectorSelect, InspectorSlider, inspectorDividerClass } from '@/features/editor/EditorInspectorPrimitives'
import {
  ElementFlipControls,
  ElementOpacityControl,
  ElementOutlineControls,
  ElementShadowControls,
  PropertyRow,
} from '@/features/editor/ElementStyleCommons'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { RichTextBaseControls } from '@/features/editor/TextStylePanel'

type FillType = 'fill' | 'gradient' | 'pattern'

const lineHeightOptions = [0.9, 1, 1.15, 1.2, 1.4, 1.5, 1.8, 2, 2.5, 3].map(value => ({ label: `${value}×`, value }))
const paragraphSpaceOptions = [0, 5, 10, 15, 20, 25, 30, 40, 50, 80].map(value => ({ label: `${value}px`, value }))
const wordSpaceOptions = [0, 1, 2, 3, 4, 5, 6, 8, 10].map(value => ({ label: `${value}px`, value }))

function ShapeThumbnail({ onSelect, shape }: { onSelect: () => void; shape: ShapePoolItem }) {
  return (
    <Button aria-label={shape.title || 'Shape preset'} className="mona-shape-thumbnail" onClick={onSelect} size="editor-icon" type="button" variant="ghost">
      <svg height="18" overflow="visible" width="18">
        <g transform={`scale(${18 / shape.viewBox[0]}, ${18 / shape.viewBox[1]}) translate(0,0) matrix(1,0,0,1,0,0)`}>
          <path
            className={shape.outlined ? 'is-outlined' : ''}
            d={shape.path}
            fill={shape.outlined ? '#999' : 'transparent'}
            stroke={shape.outlined ? 'transparent' : '#999'}
            strokeLinecap="butt"
            strokeMiterlimit="8"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </svg>
    </Button>
  )
}

function GradientBar({
  index,
  onChange,
  onIndexChange,
  value,
}: {
  index: number
  onChange: (value: GradientColor[]) => void
  onIndexChange: (index: number) => void
  value: GradientColor[]
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<GradientColor[] | null>(null)
  const points = draft || value
  const activeIndex = Math.min(index, value.length - 1)
  const positionAt = (clientX: number) => {
    const bar = barRef.current
    if (!bar) return 0
    return Math.min(100, Math.max(0, Math.round((clientX - bar.getBoundingClientRect().left) / bar.clientWidth * 100)))
  }
  const addPoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== barRef.current || value.length >= 6) return
    const pos = positionAt(event.clientX)
    let targetIndex = 0
    value.forEach((point, pointIndex) => {
      if (pos > point.pos) targetIndex = pointIndex + 1 
    })
    const color = value[targetIndex - 1]?.color || value[targetIndex]!.color
    const next = [...value]
    next.splice(targetIndex, 0, { pos, color })
    onIndexChange(targetIndex)
    onChange(next)
  }
  const movePoint = (event: ReactPointerEvent<HTMLDivElement>, movingIndex: number) => {
    if (event.button !== 0) return
    event.preventDefault()
    const update = (pointer: PointerEvent) => setDraft(value.map((point, pointIndex) => pointIndex === movingIndex ? { ...point, pos: positionAt(pointer.clientX) } : point))
    const stop = (pointer: PointerEvent) => {
      const moving = { ...value[movingIndex]!, pos: positionAt(pointer.clientX) }
      const next = value.filter((_, pointIndex) => pointIndex !== movingIndex)
      let targetIndex = 0
      next.forEach((point, pointIndex) => {
        if (moving.pos > point.pos) targetIndex = pointIndex + 1 
      })
      next.splice(targetIndex, 0, moving)
      setDraft(null)
      onIndexChange(targetIndex)
      onChange(next)
      document.removeEventListener('pointermove', update)
      document.removeEventListener('pointerup', stop)
      document.removeEventListener('pointercancel', stop)
    }
    document.addEventListener('pointermove', update)
    document.addEventListener('pointerup', stop)
    document.addEventListener('pointercancel', stop)
  }
  const removePoint = (event: ReactPointerEvent<HTMLDivElement>, removingIndex: number) => {
    if (event.button !== 2 || value.length <= 2) return
    event.preventDefault()
    let targetIndex = 0
    if (removingIndex === activeIndex) targetIndex = Math.max(0, removingIndex - 1)
    else if (activeIndex === value.length - 1) targetIndex = value.length - 2
    onIndexChange(targetIndex)
    onChange(value.filter((_, pointIndex) => pointIndex !== removingIndex))
  }
  return (
    <div className="mona-gradient-bar" onPointerDown={addPoint}>
      <div className="mona-gradient-bar-track" ref={barRef} style={{ backgroundImage: `linear-gradient(to right, ${points.map(point => `${point.color} ${point.pos}%`).join(',')})` }} />
      {points.map((point, pointIndex) => (
        <div
          className={`mona-gradient-stop${activeIndex === pointIndex ? ' is-active' : ''}`}
          key={`${point.pos}-${pointIndex}`}
          onContextMenu={event => event.preventDefault()}
          onPointerDown={event => event.button === 2 ? removePoint(event, pointIndex) : movePoint(event, pointIndex)}
          style={{ backgroundColor: point.color, left: `calc(${point.pos}% - 5px)` }}
        />
      ))}
    </div>
  )
}

export function ShapeStylePanel({
  element,
  presentation,
  runtime,
}: {
  element: PPTShapeElement
  presentation: PresentationState
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const painter = useSyncExternalStore(runtime.shapeFormatPainter.subscribe, runtime.shapeFormatPainter.getSnapshot, runtime.shapeFormatPainter.getSnapshot)
  const [gradientSelection, setGradientSelection] = useState({ elementId: element.id, index: 0 })
  const gradientIndex = gradientSelection.elementId === element.id ? gradientSelection.index : 0
  const setGradientIndex = (index: number) => setGradientSelection({ elementId: element.id, index })
  const fileRef = useRef<HTMLInputElement>(null)
  const defaultGradient: Gradient = {
    type: 'linear',
    rotate: 0,
    colors: [{ pos: 0, color: element.fill || '#fff' }, { pos: 100, color: '#fff' }],
  }
  const gradient = element.gradient || defaultGradient
  const fillType: FillType = element.pattern !== undefined ? 'pattern' : element.gradient ? 'gradient' : 'fill'
  const inset: TextInset = element.text?.inset || [10, 10, 10, 10]
  const update = (props: Partial<PPTShapeElement>, historyKey = `shape-style-${element.id}`) => runtime.commit(
    'Update shape style',
    [{ type: 'element.update', payload: { id: element.id, props } }],
    { historyKey },
  )
  const remove = (property: string | string[], historyKey = `shape-style-${element.id}`) => runtime.commit(
    'Remove shape style',
    [{ type: 'element.properties.remove', payload: { id: element.id, property } }],
    { historyKey },
  )
  const updateGradient = (props: Partial<Gradient>) => update({ gradient: { ...gradient, ...props } })
  const updateText = (props: Partial<ShapeText>) => update({
    text: {
      content: '',
      defaultFontName: '',
      defaultColor: '#000',
      align: 'middle',
      ...element.text,
      ...props,
    },
  }, `shape-text-${element.id}`)
  const updateInset = (index: number, value: number) => {
    const next: TextInset = [...inset]
    next[index] = value
    updateText({ inset: next })
  }
  const changeFillType = (type: FillType) => {
    if (type === 'fill') remove(['gradient', 'pattern'])
    else if (type === 'gradient') {
      setGradientIndex(0)
      runtime.commit('Use gradient shape fill', [
        { type: 'element.properties.remove', payload: { id: element.id, property: 'pattern' } },
        { type: 'element.update', payload: { id: element.id, props: { gradient } } },
      ], { historyKey: `shape-style-${element.id}` })
    }
    else {
      runtime.commit('Use image shape fill', [
        { type: 'element.properties.remove', payload: { id: element.id, property: 'gradient' } },
        { type: 'element.update', payload: { id: element.id, props: { pattern: '' } } },
      ], { historyKey: `shape-style-${element.id}` })
    }
  }
  const changeShape = (shape: ShapePoolItem) => {
    const props: Partial<PPTShapeElement> = {
      viewBox: shape.viewBox,
      path: shape.path,
      special: shape.special,
    }
    if (shape.pathFormula) {
      props.pathFormula = shape.pathFormula
      props.viewBox = [element.width, element.height]
      const formula = SHAPE_PATH_FORMULAS[shape.pathFormula]
      if (formula.editable) {
        props.path = formula.formula(element.width, element.height, formula.defaultValue)
        props.keypoints = formula.defaultValue
      }
      else props.path = formula.formula(element.width, element.height)
    }
    else {
      props.pathFormula = undefined
      props.keypoints = undefined
    }
    update(props, `shape-replace-${element.id}`)
  }
  return (
    <div className="mona-shape-style-panel">
      <div className="mona-shape-panel-title"><span>{t('foundation.editor.shape.replace')}</span><DownIcon /></div>
      <div className="mona-shape-replace-pool">
        {SHAPE_LIST.map(category => (
          <div className="mona-shape-replace-list" key={category.type}>
            {category.children.map((shape, index) => <ShapeThumbnail key={`${category.type}-${index}`} onSelect={() => changeShape(shape)} shape={shape} />)}
          </div>
        ))}
      </div>

      <div className="mona-shape-fill-row mb-2.5 flex w-full items-center gap-0">
        <div className="mona-shape-fill-control"><InspectorSelect<FillType> ariaLabel={t('foundation.editor.shape.fillType')} onChange={changeFillType} options={[
          { label: t('foundation.editor.shape.solidFill'), value: 'fill' },
          { label: t('foundation.editor.shape.gradientFill'), value: 'gradient' },
          { label: t('foundation.editor.shape.imageFill'), value: 'pattern' },
        ]} value={fillType} /></div>
        {fillType !== 'pattern' ? <div className="mona-shape-fill-spacer" /> : null}
        {fillType === 'fill' ? <div className="mona-shape-fill-control"><InspectorColorButton ariaLabel={t('foundation.editor.shape.fillColor')} color={element.fill || '#fff'} onChange={value => update({ fill: value })} /></div> : null}
        {fillType === 'gradient' ? <div className="mona-shape-fill-control"><InspectorSelect<GradientType> ariaLabel={t('foundation.editor.shape.gradientType')} onChange={value => updateGradient({ type: value })} options={[
          { label: t('foundation.editor.shape.linearGradient'), value: 'linear' },
          { label: t('foundation.editor.shape.radialGradient'), value: 'radial' },
        ]} value={gradient.type} /></div> : null}
      </div>
      {fillType === 'gradient' ? (
        <>
          <div className="flex w-full items-center mb-2.5"><GradientBar index={gradientIndex} onChange={colors => updateGradient({ colors })} onIndexChange={setGradientIndex} value={gradient.colors} /></div>
          <PropertyRow label={t('foundation.editor.shape.currentStop')}><InspectorColorButton ariaLabel={t('foundation.editor.shape.currentStop')} color={gradient.colors[gradientIndex]?.color || gradient.colors[0]!.color} onChange={color => updateGradient({ colors: gradient.colors.map((stop, index) => index === gradientIndex ? { ...stop, color } : stop) })} /></PropertyRow>
          {gradient.type === 'linear' ? <PropertyRow label={t('foundation.editor.shape.gradientAngle')}><InspectorSlider ariaLabel={t('foundation.editor.shape.gradientAngle')} max={360} min={0} onChange={rotate => updateGradient({ rotate })} step={15} value={gradient.rotate} /></PropertyRow> : null}
        </>
      ) : null}
      {fillType === 'pattern' ? (
        <div className="mona-pattern-image-wrapper">
          <input accept="image/*" aria-label={t('foundation.editor.shape.uploadImage')} hidden onChange={event => {
            const file = event.target.files?.[0]
            if (!file) return
            const reader = new FileReader()
            reader.addEventListener('load', () => {
              if (typeof reader.result === 'string') update({ pattern: reader.result })
            }, { once: true })
            reader.readAsDataURL(file)
          }} ref={fileRef} type="file" />
          <Button className="mona-pattern-image" onClick={() => fileRef.current?.click()} size="editor" style={{ backgroundImage: `url(${element.pattern || ''})` }} type="button" variant="outline"><PlusIcon /></Button>
        </div>
      ) : null}

      <ElementFlipControls element={element} runtime={runtime} />
      <div className={inspectorDividerClass} />

      {element.text?.content ? (
        <>
          <RichTextBaseControls element={element} runtime={runtime} />
          <div className={inspectorDividerClass} />
          <PropertyRow label={t('foundation.editor.text.lineSpacing')}><InspectorSelect ariaLabel={t('foundation.editor.text.lineSpacing')} icon={<RowHeightIcon />} onChange={value => updateText({ lineHeight: value })} options={lineHeightOptions} value={element.text.lineHeight || 1.5} /></PropertyRow>
          <PropertyRow label={t('foundation.editor.text.paragraphSpacing')}><InspectorSelect ariaLabel={t('foundation.editor.text.paragraphSpacing')} icon={<VerticalSpacingIcon />} onChange={value => updateText({ paragraphSpace: value })} options={paragraphSpaceOptions} value={element.text.paragraphSpace === undefined ? 5 : element.text.paragraphSpace} /></PropertyRow>
          <PropertyRow label={t('foundation.editor.text.letterSpacing')}><InspectorSelect ariaLabel={t('foundation.editor.text.letterSpacing')} icon={<FullwidthIcon />} onChange={value => updateText({ wordSpace: value })} options={wordSpaceOptions} value={element.text.wordSpace || 0} /></PropertyRow>
          <div className={inspectorDividerClass} />
          <div className="grid w-full grid-cols-2 items-center gap-2.5 mb-2.5 is-insets"><InspectorNumberInput ariaLabel={t('foundation.editor.text.marginTop')} label={t('foundation.editor.text.marginTop')} max={50} min={0} onChange={value => updateInset(0, value)} value={inset[0]} /><InspectorNumberInput ariaLabel={t('foundation.editor.text.marginBottom')} label={t('foundation.editor.text.marginBottom')} max={50} min={0} onChange={value => updateInset(2, value)} value={inset[2]} /></div>
          <div className="grid w-full grid-cols-2 items-center gap-2.5 mb-2.5 is-insets"><InspectorNumberInput ariaLabel={t('foundation.editor.text.marginLeft')} label={t('foundation.editor.text.marginLeft')} max={50} min={0} onChange={value => updateInset(3, value)} value={inset[3]} /><InspectorNumberInput ariaLabel={t('foundation.editor.text.marginRight')} label={t('foundation.editor.text.marginRight')} max={50} min={0} onChange={value => updateInset(1, value)} value={inset[1]} /></div>
          <div className={inspectorDividerClass} />
          <InspectorButtonGroup className="flex w-full items-center mb-2.5">
            <InspectorButton active={(element.text.align || 'middle') === 'top'} ariaLabel={t('foundation.editor.text.alignTop')} onClick={() => updateText({ align: 'top' })} style={{ flex: 1 }}><AlignTopIcon /></InspectorButton>
            <InspectorButton active={(element.text.align || 'middle') === 'middle'} ariaLabel={t('foundation.editor.text.alignMiddle')} onClick={() => updateText({ align: 'middle' })} style={{ flex: 1 }}><AlignMiddleIcon /></InspectorButton>
            <InspectorButton active={(element.text.align || 'middle') === 'bottom'} ariaLabel={t('foundation.editor.text.alignBottom')} onClick={() => updateText({ align: 'bottom' })} style={{ flex: 1 }}><AlignBottomIcon /></InspectorButton>
          </InspectorButtonGroup>
          <div className={inspectorDividerClass} />
        </>
      ) : null}

      <ElementOutlineControls element={element} presentation={presentation} runtime={runtime} />
      <div className={inspectorDividerClass} />
      <ElementShadowControls element={element} presentation={presentation} runtime={runtime} />
      <div className={inspectorDividerClass} />
      <ElementOpacityControl element={element} runtime={runtime} />
      <div className={inspectorDividerClass} />
      <InspectorButton active={Boolean(painter)} ariaLabel={t('foundation.editor.shape.formatPainter')} onClick={() => runtime.shapeFormatPainter.toggle(element)} onDoubleClick={() => runtime.shapeFormatPainter.toggle(element, true)} style={{ width: '100%' }}><FormatBrushIcon /> {t('foundation.editor.shape.formatPainter')}</InspectorButton>
    </div>
  )
}
