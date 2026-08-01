/* oxlint-disable jsx-a11y/prefer-tag-over-role -- the established editor's preset div is retained for its exact anonymous-flex text layout; keyboard button semantics are implemented below. */
import { useState, useSyncExternalStore, type CSSProperties, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import AddTextIcon from '~icons/icon-park-outline/add-text'
import AlignBothIcon from '~icons/icon-park-outline/align-text-both'
import AlignBottomIcon from '~icons/icon-park-outline/align-text-bottom-one'
import AlignCenterIcon from '~icons/icon-park-outline/align-text-center'
import AlignLeftIcon from '~icons/icon-park-outline/align-text-left'
import AlignMiddleIcon from '~icons/icon-park-outline/align-text-middle-one'
import AlignRightIcon from '~icons/icon-park-outline/align-text-right'
import AlignTopIcon from '~icons/icon-park-outline/align-text-top-one'
import CodeIcon from '~icons/icon-park-outline/code'
import DownIcon from '~icons/icon-park-outline/down'
import FontSizeIcon from '~icons/icon-park-outline/font-size'
import FormatBrushIcon from '~icons/icon-park-outline/format-brush'
import FormatIcon from '~icons/icon-park-outline/format'
import FullwidthIcon from '~icons/icon-park-outline/fullwidth'
import HighlightIcon from '~icons/icon-park-outline/high-light'
import IndentLeftIcon from '~icons/icon-park-outline/indent-left'
import IndentRightIcon from '~icons/icon-park-outline/indent-right'
import LinkIcon from '~icons/icon-park-outline/link-one'
import ListIcon from '~icons/icon-park-outline/list'
import OrderedListIcon from '~icons/icon-park-outline/ordered-list'
import QuoteIcon from '~icons/icon-park-outline/quote'
import RowHeightIcon from '~icons/icon-park-outline/row-height'
import StrikethroughIcon from '~icons/icon-park-outline/strikethrough'
import TextIcon from '~icons/icon-park-outline/text'
import TextBoldIcon from '~icons/icon-park-outline/text-bold'
import TextItalicIcon from '~icons/icon-park-outline/text-italic'
import TextUnderlineIcon from '~icons/icon-park-outline/text-underline'
import VerticalSpacingIcon from '~icons/icon-park-outline/vertical-spacing-between-items'
import type { PresentationState } from '@mona/presentation-core'
import type {
  PPTShapeElement,
  PPTTextElement,
  TextAlignVertical,
  TextInset,
} from '@mona/presentation-core/model'
import type { RichTextAction } from '@mona/rich-text'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InspectorButton, InspectorButtonGroup, InspectorColorButton, InspectorNumberInput, InspectorPopoverButton, InspectorPopoverClose, InspectorSelect, InspectorSwitch, inspectorDividerClass, inspectorPopoverMenuItemCenteredClass, inspectorRowClass, inspectorSelectGroupClass, inspectorSplitRowClass } from '@/features/editor/EditorInspectorPrimitives'
import { ElementOpacityControl, ElementOutlineControls, ElementShadowControls, PropertyRow } from '@/features/editor/ElementStyleCommons'
import { enqueueAgentPrompt } from '@/features/editor/agent/agent-prompt-queue'
import { buildTextRewritePrompt } from '@/features/editor/agent/agent-text-prompt'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { editorFontOptions, editorFontSizeOptions, editorLineHeightOptions, editorParagraphSpaceOptions, editorWordSpaceOptions } from '@/features/editor/editor-text-options'
import { useEditorApplication } from '@/features/editor/services/editor-application'
import { cn } from '@/lib/utils'

// Preset tiles form a 2-up grid with collapsed borders (negative margins),
// so the tile recipe lives here rather than as six CSS variants.
const TEXT_PRESET_TILE = 'relative box-border flex h-12.5 w-1/2 cursor-pointer items-center justify-center overflow-hidden '
  + 'border border-[#d6d6d6] bg-transparent px-1.5 py-0.5 text-center leading-[1.1] text-foreground transition-all '
  + 'hover:z-[1] hover:border-editor-selection hover:text-editor-selection '
  + '[&:nth-child(2n)]:-ml-px [&:nth-child(n+3)]:-mt-px'

const presets: Array<{
  actions: RichTextAction[]
  className: string
  labelKey: string
}> = [
  { labelKey: 'largeTitle', className: 'text-[19px] font-bold', actions: [
    { command: 'clear' }, { command: 'bold' }, { command: 'fontsize', value: '66px' }, { command: 'align', value: 'center' },
  ] },
  { labelKey: 'smallTitle', className: 'text-base font-bold', actions: [
    { command: 'clear' }, { command: 'bold' }, { command: 'fontsize', value: '40px' }, { command: 'align', value: 'center' },
  ] },
  { labelKey: 'body', className: 'text-field', actions: [
    { command: 'clear' }, { command: 'fontsize', value: '20px' },
  ] },
  { labelKey: 'smallBody', className: 'text-control', actions: [
    { command: 'clear' }, { command: 'fontsize', value: '18px' },
  ] },
  { labelKey: 'caption1', className: 'text-xs italic', actions: [
    { command: 'clear' }, { command: 'fontsize', value: '16px' }, { command: 'em' },
  ] },
  { labelKey: 'caption2', className: 'text-xs underline', actions: [
    { command: 'clear' }, { command: 'fontsize', value: '16px' }, { command: 'underline' },
  ] },
]

function ListStylePopover({
  ariaLabel,
  onSelect,
  options,
  roundAll = false,
}: {
  ariaLabel: string
  onSelect: (value: string) => void
  options: readonly string[]
  roundAll?: boolean
}) {
  return (
    <InspectorPopoverButton
      ariaLabel={ariaLabel}
      content={(
        <div className="mona-list-style-wrap">
          {options.map(value => (
            <InspectorPopoverClose key={value}>
              <Button
                aria-label={`${ariaLabel}: ${value}`}
                className="size-12.5 rounded-control border border-[#d9d9d9] bg-white py-1.25 pr-1 pl-4.5 text-left text-inherit hover:border-editor-selection hover:text-editor-selection [&_ul]:m-0 [&_ul]:p-0 [&_li]:h-2.5 [&_li]:pl-px [&_li_span]:inline-block [&_li_span]:h-px [&_li_span]:w-5 [&_li_span]:bg-current [&_li_span]:align-middle"
                onClick={() => onSelect(value)}
                size="editor"
                style={{ listStyleType: value } as CSSProperties}
                type="button"
                variant="ghost"
              >
                <ul style={{ listStyleType: value }}>
                  <li><span /></li>
                  <li><span /></li>
                  <li><span /></li>
                </ul>
              </Button>
            </InspectorPopoverClose>
          ))}
        </div>
      )}
      className={`mona-popover-split-button${roundAll ? ' is-source-detached' : ''}`}
    >
      <DownIcon />
    </InspectorPopoverButton>
  )
}

function IndentPopover({ ariaLabel, onSelect }: { ariaLabel: string; onSelect: () => void }) {
  return (
    <InspectorPopoverButton
      ariaLabel={ariaLabel}
      content={(
        <InspectorPopoverClose>
          <Button className={inspectorPopoverMenuItemCenteredClass} onClick={onSelect} size="editor" type="button" variant="ghost">
            {ariaLabel}
          </Button>
        </InspectorPopoverClose>
      )}
      className="mona-popover-split-button"
    >
      <DownIcon />
    </InspectorPopoverButton>
  )
}

function TextLinkControl({
  activeLink,
  execute,
}: {
  activeLink: string
  execute: (action: RichTextAction) => boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const close = () => setOpen(false)
  const update = (event: FormEvent) => {
    event.preventDefault()
    const linkPattern = /^(https?):\/\/[\w-]+(\.[\w-]+)+([\w-.,@?^=%&:/~+#]*[\w-@?^=%&/~+#])?$/
    if (!draft || !linkPattern.test(draft)) {
      toast.error(t('foundation.editor.text.invalidLink'))
      return
    }
    execute({ command: 'link', value: draft })
    close()
  }
  return (
    <>
      <InspectorPopoverButton
        active={Boolean(activeLink)}
        ariaLabel={t('foundation.editor.text.hyperlink')}
        content={(
          <form className="w-60" onSubmit={update}>
            <Input
              aria-label={t('foundation.editor.text.hyperlink')}
              onChange={event => setDraft(event.target.value)}
              placeholder={t('foundation.editor.text.hyperlinkPlaceholder')}
              value={draft}
            />
            <div className="mt-2.5 flex justify-end gap-2">
              <Button
                disabled={!activeLink}
                onClick={() => {
                  execute({ command: 'link' })
                  close()
                }}
                size="sm"
                variant="outline"
              >
                {t('foundation.editor.text.remove')}
              </Button>
              <Button size="sm" type="submit">{t('foundation.editor.text.confirm')}</Button>
            </div>
          </form>
        )}
        onOpenChange={next => {
          if (next) setDraft(activeLink)
          setOpen(next)
        }}
        open={open}
        style={{ width: '25%' }}
      >
        <LinkIcon />
      </InspectorPopoverButton>
    </>
  )
}

function htmlToText(html: string) {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent || ''
}

function AIWritingControl({
  element,
  runtime,
}: {
  element: PPTTextElement | PPTShapeElement
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const { openAgent } = useEditorApplication()
  const [open, setOpen] = useState(false)

  const run = (instruction: string) => {
    setOpen(false)
    const content = element.type === 'text' ? element.content : element.text?.content || ''
    const currentText = htmlToText(content).trim()
    if (!currentText) {
      toast.error(t('foundation.editor.text.noTextContent'))
      return
    }
    const presentation = runtime.store.getState().presentation
    const slide = presentation.slides.find(candidate => (
      candidate.elements.some(candidateElement => candidateElement.id === element.id)
    ))
    if (!slide) return

    enqueueAgentPrompt(buildTextRewritePrompt({
      currentText,
      elementId: element.id,
      instruction,
      slideId: slide.id,
    }))
    openAgent()
  }

  return (
    <>
      <InspectorPopoverButton
        ariaLabel={t('foundation.editor.text.aiAssist')}
        content={(
          <div className="min-w-30">
            {([
              ['aiPolish', 'aiCommandPolish'],
              ['aiExpand', 'aiCommandExpand'],
              ['aiCondense', 'aiCommandCondense'],
            ] as const).map(([label, command]) => (
              <Button
                className={inspectorPopoverMenuItemCenteredClass}
                key={label}
                onClick={() => run(t(`foundation.editor.text.${command}`))}
                size="editor"
                type="button"
                variant="ghost"
              >
                {t(`foundation.editor.text.${label}`)}
              </Button>
            ))}
          </div>
        )}
        onOpenChange={setOpen}
        open={open}
        style={{ width: '25%' }}
      >
        <span>AI</span>
      </InspectorPopoverButton>
    </>
  )
}

export function RichTextBaseControls({
  element,
  runtime,
}: {
  element: PPTTextElement | PPTShapeElement
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const richText = useSyncExternalStore(
    runtime.richText.subscribe,
    runtime.richText.getSnapshot,
    runtime.richText.getSnapshot,
  )
  const attrs = richText.elementId === element.id ? richText.attrs : runtime.richText.getSnapshot().attrs
  const execute = (action: RichTextAction | readonly RichTextAction[]) => runtime.richText.execute(element.id, action)
  return (
    <div className="mona-rich-text-base">
      <div className={`${inspectorSelectGroupClass} ${inspectorRowClass}`}>
        <InspectorSelect
          ariaLabel={t('foundation.editor.text.fontFamily')}
          icon={<FontSizeIcon />}
          onChange={value => execute({ command: 'fontname', value })}
          options={[{ label: t('common.defaultFont'), value: '' }, ...editorFontOptions]}
          search
          searchLabel={t('foundation.editor.text.fontSearch')}
          style={{ width: '60%' }}
          value={attrs.fontname}
        />
        <InspectorSelect
          ariaLabel={t('foundation.editor.text.fontSize')}
          icon={<AddTextIcon />}
          onChange={value => execute({ command: 'fontsize', value })}
          options={editorFontSizeOptions}
          search
          searchLabel={t('foundation.editor.text.fontSizeSearch')}
          style={{ width: '40%' }}
          value={attrs.fontsize}
        />
      </div>

      <InspectorButtonGroup className={`${inspectorRowClass} is-passive`}>
        <InspectorColorButton ariaLabel={t('foundation.editor.text.textColor')} color={attrs.color} icon={<TextIcon />} onChange={value => execute({ command: 'color', value })} style={{ flex: 1 }} />
        <InspectorColorButton ariaLabel={t('foundation.editor.text.highlight')} color={attrs.backcolor} icon={<HighlightIcon />} onChange={value => execute({ command: 'backcolor', value })} style={{ flex: 1 }} />
        <InspectorButton ariaLabel={t('foundation.editor.text.increaseFont')} className="mona-font-size-button" onClick={() => execute({ command: 'fontsize-add' })} style={{ flex: 1 }}><FontSizeIcon />+</InspectorButton>
        <InspectorButton ariaLabel={t('foundation.editor.text.decreaseFont')} className="mona-font-size-button" onClick={() => execute({ command: 'fontsize-reduce' })} style={{ flex: 1 }}><FontSizeIcon />-</InspectorButton>
      </InspectorButtonGroup>

      <InspectorButtonGroup className="flex w-full items-center mb-2.5">
        <InspectorButton active={attrs.bold} ariaLabel={t('foundation.editor.text.bold')} onClick={() => execute({ command: 'bold' })} style={{ flex: 1 }}><TextBoldIcon /></InspectorButton>
        <InspectorButton active={attrs.em} ariaLabel={t('foundation.editor.text.italic')} onClick={() => execute({ command: 'em' })} style={{ flex: 1 }}><TextItalicIcon /></InspectorButton>
        <InspectorButton active={attrs.underline} ariaLabel={t('foundation.editor.text.underline')} onClick={() => execute({ command: 'underline' })} style={{ flex: 1 }}><TextUnderlineIcon /></InspectorButton>
        <InspectorButton active={attrs.strikethrough} ariaLabel={t('foundation.editor.text.strikethrough')} onClick={() => execute({ command: 'strikethrough' })} style={{ flex: 1 }}><StrikethroughIcon /></InspectorButton>
      </InspectorButtonGroup>

      <InspectorButtonGroup className="flex w-full items-center mb-2.5">
        <InspectorButton active={attrs.superscript} ariaLabel={t('foundation.editor.text.superscript')} onClick={() => execute({ command: 'superscript' })} style={{ flex: 1 }}>A²</InspectorButton>
        <InspectorButton active={attrs.subscript} ariaLabel={t('foundation.editor.text.subscript')} onClick={() => execute({ command: 'subscript' })} style={{ flex: 1 }}>A₂</InspectorButton>
        <InspectorButton active={attrs.code} ariaLabel={t('foundation.editor.text.code')} onClick={() => execute({ command: 'code' })} style={{ flex: 1 }}><CodeIcon /></InspectorButton>
        <InspectorButton active={attrs.blockquote} ariaLabel={t('foundation.editor.text.quote')} onClick={() => execute({ command: 'blockquote' })} style={{ flex: 1 }}><QuoteIcon /></InspectorButton>
      </InspectorButtonGroup>

      <InspectorButtonGroup className={`${inspectorRowClass} is-passive`}>
        <AIWritingControl element={element} key={element.id} runtime={runtime} />
        <InspectorButton ariaLabel={t('foundation.editor.text.clear')} onClick={() => execute({ command: 'clear' })} style={{ width: '25%' }}><FormatIcon /></InspectorButton>
        <InspectorButton
          active={Boolean(richText.formatPainter)}
          ariaLabel={t('foundation.editor.text.formatPainter')}
          onClick={() => runtime.richText.toggleFormatPainter()}
          onDoubleClick={() => runtime.richText.toggleFormatPainter(true)}
          style={{ width: '25%' }}
        ><FormatBrushIcon /></InspectorButton>
        <TextLinkControl activeLink={attrs.link} execute={action => runtime.richText.execute(element.id, action)} />
      </InspectorButtonGroup>

      <div className={inspectorDividerClass} />
      <InspectorButtonGroup className="flex w-full items-center mb-2.5">
        <InspectorButton active={attrs.align === 'left'} ariaLabel={t('foundation.editor.text.alignLeft')} onClick={() => execute({ command: 'align', value: 'left' })} style={{ flex: 1 }}><AlignLeftIcon /></InspectorButton>
        <InspectorButton active={attrs.align === 'center'} ariaLabel={t('foundation.editor.text.alignCenter')} onClick={() => execute({ command: 'align', value: 'center' })} style={{ flex: 1 }}><AlignCenterIcon /></InspectorButton>
        <InspectorButton active={attrs.align === 'right'} ariaLabel={t('foundation.editor.text.alignRight')} onClick={() => execute({ command: 'align', value: 'right' })} style={{ flex: 1 }}><AlignRightIcon /></InspectorButton>
        <InspectorButton active={attrs.align === 'justify'} ariaLabel={t('foundation.editor.text.justify')} onClick={() => execute({ command: 'align', value: 'justify' })} style={{ flex: 1 }}><AlignBothIcon /></InspectorButton>
      </InspectorButtonGroup>

      <div className={inspectorSplitRowClass}>
        <InspectorButtonGroup>
          <InspectorButton active={attrs.bulletList} ariaLabel={t('foundation.editor.text.bullets')} onClick={() => execute({ command: 'bulletList' })} style={{ flex: 1 }}><ListIcon /></InspectorButton>
          <ListStylePopover ariaLabel={t('foundation.editor.text.bulletStyle')} onSelect={value => execute({ command: 'bulletList', value })} options={['disc', 'circle', 'square']} roundAll />
        </InspectorButtonGroup>
        <InspectorButtonGroup>
          <InspectorButton active={attrs.orderedList} ariaLabel={t('foundation.editor.text.numbering')} onClick={() => execute({ command: 'orderedList' })} style={{ flex: 1 }}><OrderedListIcon /></InspectorButton>
          <ListStylePopover ariaLabel={t('foundation.editor.text.numberStyle')} onSelect={value => execute({ command: 'orderedList', value })} options={['decimal', 'lower-roman', 'upper-roman', 'lower-alpha', 'upper-alpha', 'lower-greek']} />
        </InspectorButtonGroup>
      </div>

      <div className={inspectorSplitRowClass}>
        <InspectorButtonGroup>
          <InspectorButton ariaLabel={t('foundation.editor.text.decreaseIndent')} onClick={() => execute({ command: 'indent', value: '-1' })} style={{ flex: 1 }}><IndentLeftIcon /></InspectorButton>
          <IndentPopover ariaLabel={t('foundation.editor.text.decreaseFirstIndent')} onSelect={() => execute({ command: 'textIndent', value: '-1' })} />
        </InspectorButtonGroup>
        <InspectorButtonGroup>
          <InspectorButton ariaLabel={t('foundation.editor.text.increaseIndent')} onClick={() => execute({ command: 'indent', value: '+1' })} style={{ flex: 1 }}><IndentRightIcon /></InspectorButton>
          <IndentPopover ariaLabel={t('foundation.editor.text.increaseFirstIndent')} onSelect={() => execute({ command: 'textIndent', value: '+1' })} />
        </InspectorButtonGroup>
      </div>
    </div>
  )
}

export function TextStylePanel({
  element,
  presentation,
  runtime,
}: {
  element: PPTTextElement
  presentation: PresentationState
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const inset: TextInset = element.inset || [10, 10, 10, 10]
  const execute = (action: RichTextAction | readonly RichTextAction[]) => runtime.richText.execute(element.id, action)
  const update = (props: Partial<PPTTextElement>, historyKey = `text-style-${element.id}`) => runtime.commit(
    'Update text style',
    [{ type: 'element.update', payload: { id: element.id, props } }],
    { historyKey },
  )
  const remove = (property: string | string[], historyKey = `text-style-${element.id}`) => runtime.commit(
    'Remove text style',
    [{ type: 'element.properties.remove', payload: { id: element.id, property } }],
    { historyKey },
  )
  const updateInset = (index: number, value: number) => {
    const next: TextInset = [...inset]
    next[index] = value
    update({ inset: next })
  }

  return (
    <div className="mona-text-style-panel">
      <div className="mb-2.5 flex flex-wrap">
        {presets.map(preset => (
          <div
            aria-label={t(`foundation.editor.text.${preset.labelKey}`)}
            className={cn(TEXT_PRESET_TILE, preset.className)}
            key={preset.labelKey}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                execute(preset.actions)
              }
            }}
            onClick={() => execute(preset.actions)}
            role="button"
            tabIndex={0}
          >
            {t(`foundation.editor.text.${preset.labelKey}`)}
          </div>
        ))}
      </div>

      <div className={inspectorDividerClass} />
      <RichTextBaseControls element={element} runtime={runtime} />

      <div className={inspectorDividerClass} />
      <PropertyRow label={t('foundation.editor.text.lineSpacing')}>
        <InspectorSelect ariaLabel={t('foundation.editor.text.lineSpacing')} icon={<RowHeightIcon />} onChange={value => update({ lineHeight: value })} options={editorLineHeightOptions} value={element.lineHeight || 1.5} />
      </PropertyRow>
      <PropertyRow label={t('foundation.editor.text.paragraphSpacing')}>
        <InspectorSelect ariaLabel={t('foundation.editor.text.paragraphSpacing')} icon={<VerticalSpacingIcon />} onChange={value => update({ paragraphSpace: value })} options={editorParagraphSpaceOptions} value={element.paragraphSpace === undefined ? 5 : element.paragraphSpace} />
      </PropertyRow>
      <PropertyRow label={t('foundation.editor.text.letterSpacing')}>
        <InspectorSelect ariaLabel={t('foundation.editor.text.letterSpacing')} icon={<FullwidthIcon />} onChange={value => update({ wordSpace: value })} options={editorWordSpaceOptions} value={element.wordSpace || 0} />
      </PropertyRow>
      <PropertyRow label={t('foundation.editor.text.boxFill')}>
        <InspectorColorButton ariaLabel={t('foundation.editor.text.boxFill')} color={element.fill || '#ffffff'} onChange={value => update({ fill: value })} />
      </PropertyRow>

      <div className={inspectorDividerClass} />
      <div className={`${inspectorSplitRowClass} is-insets`}>
        <InspectorNumberInput ariaLabel={t('foundation.editor.text.marginTop')} label={t('foundation.editor.text.marginTop')} max={50} min={0} onChange={value => updateInset(0, value)} value={inset[0]} />
        <InspectorNumberInput ariaLabel={t('foundation.editor.text.marginBottom')} label={t('foundation.editor.text.marginBottom')} max={50} min={0} onChange={value => updateInset(2, value)} value={inset[2]} />
      </div>
      <div className={`${inspectorSplitRowClass} is-insets`}>
        <InspectorNumberInput ariaLabel={t('foundation.editor.text.marginLeft')} label={t('foundation.editor.text.marginLeft')} max={50} min={0} onChange={value => updateInset(3, value)} value={inset[3]} />
        <InspectorNumberInput ariaLabel={t('foundation.editor.text.marginRight')} label={t('foundation.editor.text.marginRight')} max={50} min={0} onChange={value => updateInset(1, value)} value={inset[1]} />
      </div>

      <div className={inspectorDividerClass} />
      <PropertyRow label={t('foundation.editor.text.fixedHeight')}>
        <div className="w-full text-right">
          <InspectorSwitch ariaLabel={t('foundation.editor.text.fixedHeight')} checked={Boolean(element.fixedHeight)} onChange={value => {
            if (value) update({ fixedHeight: true, vAlign: element.vAlign || 'top' })
            else remove(['fixedHeight', 'vAlign'])
          }} />
        </div>
      </PropertyRow>
      {element.fixedHeight ? (
        <InspectorButtonGroup className="flex w-full items-center mb-2.5">
          {([
            ['top', AlignTopIcon, 'alignTop'],
            ['middle', AlignMiddleIcon, 'alignMiddle'],
            ['bottom', AlignBottomIcon, 'alignBottom'],
          ] as const).map(([value, VerticalIcon, label]) => (
            <InspectorButton active={(element.vAlign || 'top') === value} ariaLabel={t(`foundation.editor.text.${label}`)} key={value} onClick={() => update({ vAlign: value as TextAlignVertical })} style={{ flex: 1 }}><VerticalIcon /></InspectorButton>
          ))}
        </InspectorButtonGroup>
      ) : null}

      <div className={inspectorDividerClass} />
      <ElementOutlineControls element={element} presentation={presentation} runtime={runtime} />

      <div className={inspectorDividerClass} />
      <ElementShadowControls element={element} presentation={presentation} runtime={runtime} />

      <div className={inspectorDividerClass} />
      <ElementOpacityControl element={element} runtime={runtime} />
    </div>
  )
}
