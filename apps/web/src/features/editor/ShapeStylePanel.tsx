import { useState, useSyncExternalStore } from 'react'
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
import type { Gradient, GradientType, PPTShapeElement, ShapeText, TextInset } from '@mona/presentation-core/model'

import { Button } from '@/components/ui/button'
import { EditorGradientBar } from '@/features/editor/EditorGradientBar'
import { InspectorButton, InspectorButtonGroup, InspectorColorButton, InspectorNumberInput, InspectorSelect, InspectorSlider, inspectorDividerClass, inspectorRowClass, inspectorSplitRowClass } from '@/features/editor/EditorInspectorPrimitives'
import {
  ElementFlipControls,
  ElementOpacityControl,
  ElementOutlineControls,
  ElementShadowControls,
  PropertyRow,
} from '@/features/editor/ElementStyleCommons'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { editorLineHeightOptions, editorParagraphSpaceOptions, editorWordSpaceOptions } from '@/features/editor/editor-text-options'
import { RichTextBaseControls } from '@/features/editor/TextStylePanel'
import { PRESENTATION_FILTERS, pickFile } from '@/features/editor/editor-files'
import { fileToDataUrl } from '@/features/editor/editor-image'

type FillType = 'fill' | 'gradient' | 'pattern'

function ShapeThumbnail({ onSelect, shape }: { onSelect: () => void; shape: ShapePoolItem }) {
  return (
    <Button aria-label={shape.title || 'Shape preset'} className="relative aspect-square size-full cursor-pointer border-0 bg-transparent p-0 text-neutral-400 [&_svg]:absolute [&_svg]:top-1/2 [&_svg]:left-1/2 [&_svg]:-translate-x-1/2 [&_svg]:-translate-y-1/2 [&_svg]:overflow-visible hover:[&_path:not(.is-outlined)]:stroke-editor-selection hover:[&_path.is-outlined]:fill-editor-selection" onClick={onSelect} size="editor-icon" type="button" variant="ghost">
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
          <div className="grid grid-cols-6 gap-[3.2%]" key={category.type}>
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
          <div className={inspectorRowClass}><EditorGradientBar index={Math.min(gradientIndex, gradient.colors.length - 1)} onChange={colors => updateGradient({ colors })} onIndexChange={setGradientIndex} value={gradient.colors} /></div>
          <PropertyRow label={t('foundation.editor.shape.currentStop')}><InspectorColorButton ariaLabel={t('foundation.editor.shape.currentStop')} color={gradient.colors[gradientIndex]?.color || gradient.colors[0]!.color} onChange={color => updateGradient({ colors: gradient.colors.map((stop, index) => index === gradientIndex ? { ...stop, color } : stop) })} /></PropertyRow>
          {gradient.type === 'linear' ? <PropertyRow label={t('foundation.editor.shape.gradientAngle')}><InspectorSlider ariaLabel={t('foundation.editor.shape.gradientAngle')} max={360} min={0} onChange={rotate => updateGradient({ rotate })} step={15} value={gradient.rotate} /></PropertyRow> : null}
        </>
      ) : null}
      {fillType === 'pattern' ? (
        <div className="mona-pattern-image-wrapper">
          <Button className="mona-pattern-image" onClick={() => {
            void pickFile(PRESENTATION_FILTERS.image, { title: t('foundation.editor.shape.uploadImage') })
              .then(async file => { if (file) update({ pattern: await fileToDataUrl(file) }) })
          }} size="editor" style={{ backgroundImage: `url(${element.pattern || ''})` }} type="button" variant="outline"><PlusIcon /></Button>
        </div>
      ) : null}

      <ElementFlipControls element={element} runtime={runtime} />
      <div className={inspectorDividerClass} />

      {element.text?.content ? (
        <>
          <RichTextBaseControls element={element} runtime={runtime} />
          <div className={inspectorDividerClass} />
          <PropertyRow label={t('foundation.editor.text.lineSpacing')}><InspectorSelect ariaLabel={t('foundation.editor.text.lineSpacing')} icon={<RowHeightIcon />} onChange={value => updateText({ lineHeight: value })} options={editorLineHeightOptions} value={element.text.lineHeight || 1.5} /></PropertyRow>
          <PropertyRow label={t('foundation.editor.text.paragraphSpacing')}><InspectorSelect ariaLabel={t('foundation.editor.text.paragraphSpacing')} icon={<VerticalSpacingIcon />} onChange={value => updateText({ paragraphSpace: value })} options={editorParagraphSpaceOptions} value={element.text.paragraphSpace === undefined ? 5 : element.text.paragraphSpace} /></PropertyRow>
          <PropertyRow label={t('foundation.editor.text.letterSpacing')}><InspectorSelect ariaLabel={t('foundation.editor.text.letterSpacing')} icon={<FullwidthIcon />} onChange={value => updateText({ wordSpace: value })} options={editorWordSpaceOptions} value={element.text.wordSpace || 0} /></PropertyRow>
          <div className={inspectorDividerClass} />
          <div className={`${inspectorSplitRowClass} is-insets`}><InspectorNumberInput ariaLabel={t('foundation.editor.text.marginTop')} label={t('foundation.editor.text.marginTop')} max={50} min={0} onChange={value => updateInset(0, value)} value={inset[0]} /><InspectorNumberInput ariaLabel={t('foundation.editor.text.marginBottom')} label={t('foundation.editor.text.marginBottom')} max={50} min={0} onChange={value => updateInset(2, value)} value={inset[2]} /></div>
          <div className={`${inspectorSplitRowClass} is-insets`}><InspectorNumberInput ariaLabel={t('foundation.editor.text.marginLeft')} label={t('foundation.editor.text.marginLeft')} max={50} min={0} onChange={value => updateInset(3, value)} value={inset[3]} /><InspectorNumberInput ariaLabel={t('foundation.editor.text.marginRight')} label={t('foundation.editor.text.marginRight')} max={50} min={0} onChange={value => updateInset(1, value)} value={inset[1]} /></div>
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
