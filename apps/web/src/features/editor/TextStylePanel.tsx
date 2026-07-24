/* oxlint-disable jsx-a11y/prefer-tag-over-role -- the established editor's preset div is retained for its exact anonymous-flex text layout; keyboard button semantics are implemented below. */
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent, type ReactNode } from 'react'
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
  LineStyleType,
  PPTElementOutline,
  PPTElementShadow,
  PPTShapeElement,
  PPTTextElement,
  TextAlignVertical,
  TextInset,
} from '@mona/presentation-core/model'
import type { RichTextAction } from '@mona/rich-text'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  InspectorButton,
  InspectorButtonGroup,
  InspectorColorButton,
  InspectorNumberInput,
  InspectorPopoverButton,
  InspectorPopoverClose,
  InspectorSelect,
  InspectorSlider,
  InspectorSwitch,
} from '@/features/editor/EditorInspectorPrimitives'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { requestAIWriting } from '@/features/editor/ai-writing'

const fontOptions = [
  { label: '思源黑体', value: 'SourceHanSans' },
  { label: '思源宋体', value: 'SourceHanSerif' },
  { label: '文鼎PL楷体', value: 'WenDingPLKaiTi' },
  { label: '文鼎PL宋体', value: 'WenDingPLSongTi' },
  { label: '朱雀仿宋', value: 'ZhuQueFangSong' },
  { label: '霞鹜文楷', value: 'LXGWWenKai' },
  { label: '霞鹜新致宋', value: 'LXGWNeoZhiSong' },
  { label: '霞鹜新晰黑', value: 'LXGWNeoXiHei' },
  { label: '阿里巴巴普惠体', value: 'AlibabaPuHuiTi' },
  { label: '得意黑', value: 'DeYiHei' },
  { label: 'MiSans', value: 'MiSans' },
  { label: 'Source Serif 4', value: 'SourceSerif4' },
  { label: 'JetBrains Mono', value: 'JetBrainsMono' },
  { label: 'Literata', value: 'Literata' },
  { label: 'Inter', value: 'Inter' },
  { label: 'Roboto', value: 'Roboto' },
  { label: 'Open Sans', value: 'OpenSans' },
  { label: 'Montserrat', value: 'Montserrat' },
  { label: 'Source Sans Pro', value: 'SourceSansPro' },
  { label: 'Merriweather', value: 'Merriweather' },
  { label: 'Lato', value: 'Lato' },
] as const

const fontSizeOptions = [
  '12px', '14px', '16px', '18px', '20px', '22px', '24px', '28px', '32px',
  '36px', '40px', '44px', '48px', '54px', '60px', '66px', '72px', '76px',
  '80px', '88px', '96px', '104px', '112px', '120px',
].map(value => ({ label: value, value }))
const lineHeightOptions = [0.9, 1, 1.15, 1.2, 1.4, 1.5, 1.8, 2, 2.5, 3]
  .map(value => ({ label: `${value}×`, value }))
const paragraphSpaceOptions = [0, 5, 10, 15, 20, 25, 30, 40, 50, 80]
  .map(value => ({ label: `${value}px`, value }))
const wordSpaceOptions = [0, 1, 2, 3, 4, 5, 6, 8, 10]
  .map(value => ({ label: `${value}px`, value }))
const outlineStyleOptions: Array<{ label: string; value: LineStyleType }> = [
  { label: 'Solid', value: 'solid' },
  { label: 'Dashed', value: 'dashed' },
  { label: 'Dotted', value: 'dotted' },
]

function LineStylePreview({ type }: { type: LineStyleType }) {
  const dashArray = type === 'dashed' ? '10 5' : type === 'dotted' ? '3.6 3.2' : '0 0'
  return (
    <svg aria-hidden="true" className="mona-line-style-preview" height="100%" viewBox="0 0 100 10" width="100%">
      <line stroke="#333" strokeDasharray={dashArray} strokeWidth="2" x1="0" x2="100" y1="5" y2="5" />
    </svg>
  )
}

const presets: Array<{
  actions: RichTextAction[]
  className: string
  labelKey: string
}> = [
  { labelKey: 'largeTitle', className: 'is-large-title', actions: [
    { command: 'clear' }, { command: 'bold' }, { command: 'fontsize', value: '66px' }, { command: 'align', value: 'center' },
  ] },
  { labelKey: 'smallTitle', className: 'is-small-title', actions: [
    { command: 'clear' }, { command: 'bold' }, { command: 'fontsize', value: '40px' }, { command: 'align', value: 'center' },
  ] },
  { labelKey: 'body', className: 'is-body', actions: [
    { command: 'clear' }, { command: 'fontsize', value: '20px' },
  ] },
  { labelKey: 'smallBody', className: 'is-small-body', actions: [
    { command: 'clear' }, { command: 'fontsize', value: '18px' },
  ] },
  { labelKey: 'caption1', className: 'is-caption-one', actions: [
    { command: 'clear' }, { command: 'fontsize', value: '16px' }, { command: 'em' },
  ] },
  { labelKey: 'caption2', className: 'is-caption-two', actions: [
    { command: 'clear' }, { command: 'fontsize', value: '16px' }, { command: 'underline' },
  ] },
]

function PropertyRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="flex w-full items-center mb-2.5">
      <div className="w-[48%] text-xs">{label}</div>
      <div className="w-[52%] [&>*]:w-full">{children}</div>
    </div>
  )
}

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
                className="mona-list-style-option"
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
          <Button className="mona-panel-popover-menu-item is-centered" onClick={onSelect} size="editor" type="button" variant="ghost">
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
          <form className="mona-text-link-popover" onSubmit={update}>
            <Input
              aria-label={t('foundation.editor.text.hyperlink')}
              onChange={event => setDraft(event.target.value)}
              placeholder={t('foundation.editor.text.hyperlinkPlaceholder')}
              value={draft}
            />
            <div className="mona-text-link-actions">
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
  execute,
}: {
  element: PPTTextElement | PPTShapeElement
  execute: (action: RichTextAction) => boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [isWriting, setIsWriting] = useState(false)
  const writingRef = useRef(false)

  useEffect(() => () => {
    writingRef.current = false
  }, [])

  const run = async (command: string) => {
    setOpen(false)
    const content = element.type === 'text' ? element.content : element.text?.content || ''
    if (!content) {
      toast.error(t('foundation.editor.text.noTextContent'))
      return
    }
    const stream = await requestAIWriting({ command, content: htmlToText(content) })
    if (!(stream instanceof Response) && stream.state === -1) {
      toast.error(t('foundation.editor.text.aiBusy'))
      return
    }
    if (!(stream instanceof Response) || !stream.body) return

    writingRef.current = true
    setIsWriting(true)
    const reader = stream.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let resultText = ''
    while (writingRef.current) {
      const { done, value } = await reader.read()
      if (!writingRef.current) return
      if (done) {
        writingRef.current = false
        setIsWriting(false)
        return
      }
      resultText += decoder.decode(value, { stream: true })
      execute({ command: 'replace', value: resultText })
    }
  }

  return (
    <>
      <InspectorPopoverButton
        ariaLabel={t('foundation.editor.text.aiAssist')}
        content={(
          <div className="min-w-[120px]">
            {([
              ['aiPolish', 'aiCommandPolish'],
              ['aiExpand', 'aiCommandExpand'],
              ['aiCondense', 'aiCommandCondense'],
            ] as const).map(([label, command]) => (
              <Button
                className="mona-panel-popover-menu-item is-centered"
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
        <span className={isWriting ? 'mt-2 inline-block size-4 animate-spin rounded-full border border-foreground border-t-transparent' : ''}>{isWriting ? '' : 'AI'}</span>
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
      <div className="mona-panel-select-group mona-panel-row-full">
        <InspectorSelect
          ariaLabel={t('foundation.editor.text.fontFamily')}
          icon={<FontSizeIcon />}
          onChange={value => execute({ command: 'fontname', value })}
          options={[{ label: t('common.defaultFont'), value: '' }, ...fontOptions]}
          search
          searchLabel={t('foundation.editor.text.fontSearch')}
          style={{ width: '60%' }}
          value={attrs.fontname}
        />
        <InspectorSelect
          ariaLabel={t('foundation.editor.text.fontSize')}
          icon={<AddTextIcon />}
          onChange={value => execute({ command: 'fontsize', value })}
          options={fontSizeOptions}
          search
          searchLabel={t('foundation.editor.text.fontSizeSearch')}
          style={{ width: '40%' }}
          value={attrs.fontsize}
        />
      </div>

      <InspectorButtonGroup className="mona-panel-row-full is-passive">
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

      <InspectorButtonGroup className="mona-panel-row-full is-passive">
        <AIWritingControl element={element} execute={action => execute(action)} key={element.id} />
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

      <div className="mona-panel-divider" />
      <InspectorButtonGroup className="flex w-full items-center mb-2.5">
        <InspectorButton active={attrs.align === 'left'} ariaLabel={t('foundation.editor.text.alignLeft')} onClick={() => execute({ command: 'align', value: 'left' })} style={{ flex: 1 }}><AlignLeftIcon /></InspectorButton>
        <InspectorButton active={attrs.align === 'center'} ariaLabel={t('foundation.editor.text.alignCenter')} onClick={() => execute({ command: 'align', value: 'center' })} style={{ flex: 1 }}><AlignCenterIcon /></InspectorButton>
        <InspectorButton active={attrs.align === 'right'} ariaLabel={t('foundation.editor.text.alignRight')} onClick={() => execute({ command: 'align', value: 'right' })} style={{ flex: 1 }}><AlignRightIcon /></InspectorButton>
        <InspectorButton active={attrs.align === 'justify'} ariaLabel={t('foundation.editor.text.justify')} onClick={() => execute({ command: 'align', value: 'justify' })} style={{ flex: 1 }}><AlignBothIcon /></InspectorButton>
      </InspectorButtonGroup>

      <div className="grid w-full grid-cols-2 items-center gap-2.5 mb-2.5">
        <InspectorButtonGroup>
          <InspectorButton active={attrs.bulletList} ariaLabel={t('foundation.editor.text.bullets')} onClick={() => execute({ command: 'bulletList' })} style={{ flex: 1 }}><ListIcon /></InspectorButton>
          <ListStylePopover ariaLabel={t('foundation.editor.text.bulletStyle')} onSelect={value => execute({ command: 'bulletList', value })} options={['disc', 'circle', 'square']} roundAll />
        </InspectorButtonGroup>
        <InspectorButtonGroup>
          <InspectorButton active={attrs.orderedList} ariaLabel={t('foundation.editor.text.numbering')} onClick={() => execute({ command: 'orderedList' })} style={{ flex: 1 }}><OrderedListIcon /></InspectorButton>
          <ListStylePopover ariaLabel={t('foundation.editor.text.numberStyle')} onSelect={value => execute({ command: 'orderedList', value })} options={['decimal', 'lower-roman', 'upper-roman', 'lower-alpha', 'upper-alpha', 'lower-greek']} />
        </InspectorButtonGroup>
      </div>

      <div className="grid w-full grid-cols-2 items-center gap-2.5 mb-2.5">
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
  const richText = useSyncExternalStore(
    runtime.richText.subscribe,
    runtime.richText.getSnapshot,
    runtime.richText.getSnapshot,
  )
  const attrs = richText.elementId === element.id ? richText.attrs : runtime.richText.getSnapshot().attrs
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
  const updateOutline = (props: Partial<PPTElementOutline>) => update({
    outline: { ...(element.outline || presentation.theme.outline), ...props },
  }, `element-outline-${element.id}`)
  const updateShadow = (props: Partial<PPTElementShadow>) => update({
    shadow: { ...(element.shadow || presentation.theme.shadow), ...props },
  }, `element-shadow-${element.id}`)

  return (
    <div className="mona-text-style-panel">
      <div className="mona-text-presets">
        {presets.map(preset => (
          <div
            aria-label={t(`foundation.editor.text.${preset.labelKey}`)}
            className={`mona-text-preset ${preset.className}`}
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

      <div className="mona-panel-divider" />
      <div className="mona-panel-select-group mona-panel-row-full">
        <InspectorSelect
          ariaLabel={t('foundation.editor.text.fontFamily')}
          icon={<FontSizeIcon />}
          onChange={value => execute({ command: 'fontname', value })}
          options={[{ label: t('common.defaultFont'), value: '' }, ...fontOptions]}
          search
          searchLabel={t('foundation.editor.text.fontSearch')}
          style={{ width: '60%' }}
          value={attrs.fontname}
        />
        <InspectorSelect
          ariaLabel={t('foundation.editor.text.fontSize')}
          icon={<AddTextIcon />}
          onChange={value => execute({ command: 'fontsize', value })}
          options={fontSizeOptions}
          search
          searchLabel={t('foundation.editor.text.fontSizeSearch')}
          style={{ width: '40%' }}
          value={attrs.fontsize}
        />
      </div>

      <InspectorButtonGroup className="mona-panel-row-full is-passive">
        <InspectorColorButton
          ariaLabel={t('foundation.editor.text.textColor')}
          color={attrs.color}
          icon={<TextIcon />}
          onChange={value => execute({ command: 'color', value })}
          style={{ flex: 1 }}
        />
        <InspectorColorButton
          ariaLabel={t('foundation.editor.text.highlight')}
          color={attrs.backcolor}
          icon={<HighlightIcon />}
          onChange={value => execute({ command: 'backcolor', value })}
          style={{ flex: 1 }}
        />
        <InspectorButton ariaLabel={t('foundation.editor.text.increaseFont')} className="mona-font-size-button" onClick={() => execute({ command: 'fontsize-add' })} style={{ flex: 1 }}>
          <FontSizeIcon />+
        </InspectorButton>
        <InspectorButton ariaLabel={t('foundation.editor.text.decreaseFont')} className="mona-font-size-button" onClick={() => execute({ command: 'fontsize-reduce' })} style={{ flex: 1 }}>
          <FontSizeIcon />-
        </InspectorButton>
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

      <InspectorButtonGroup className="mona-panel-row-full is-passive">
        <AIWritingControl element={element} execute={action => execute(action)} key={element.id} />
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

      <div className="mona-panel-divider" />
      <InspectorButtonGroup className="flex w-full items-center mb-2.5">
        <InspectorButton active={attrs.align === 'left'} ariaLabel={t('foundation.editor.text.alignLeft')} onClick={() => execute({ command: 'align', value: 'left' })} style={{ flex: 1 }}><AlignLeftIcon /></InspectorButton>
        <InspectorButton active={attrs.align === 'center'} ariaLabel={t('foundation.editor.text.alignCenter')} onClick={() => execute({ command: 'align', value: 'center' })} style={{ flex: 1 }}><AlignCenterIcon /></InspectorButton>
        <InspectorButton active={attrs.align === 'right'} ariaLabel={t('foundation.editor.text.alignRight')} onClick={() => execute({ command: 'align', value: 'right' })} style={{ flex: 1 }}><AlignRightIcon /></InspectorButton>
        <InspectorButton active={attrs.align === 'justify'} ariaLabel={t('foundation.editor.text.justify')} onClick={() => execute({ command: 'align', value: 'justify' })} style={{ flex: 1 }}><AlignBothIcon /></InspectorButton>
      </InspectorButtonGroup>

      <div className="grid w-full grid-cols-2 items-center gap-2.5 mb-2.5">
        <InspectorButtonGroup>
          <InspectorButton active={attrs.bulletList} ariaLabel={t('foundation.editor.text.bullets')} onClick={() => execute({ command: 'bulletList' })} style={{ flex: 1 }}><ListIcon /></InspectorButton>
          <ListStylePopover ariaLabel={t('foundation.editor.text.bulletStyle')} onSelect={value => execute({ command: 'bulletList', value })} options={['disc', 'circle', 'square']} roundAll />
        </InspectorButtonGroup>
        <InspectorButtonGroup>
          <InspectorButton active={attrs.orderedList} ariaLabel={t('foundation.editor.text.numbering')} onClick={() => execute({ command: 'orderedList' })} style={{ flex: 1 }}><OrderedListIcon /></InspectorButton>
          <ListStylePopover ariaLabel={t('foundation.editor.text.numberStyle')} onSelect={value => execute({ command: 'orderedList', value })} options={['decimal', 'lower-roman', 'upper-roman', 'lower-alpha', 'upper-alpha', 'lower-greek']} />
        </InspectorButtonGroup>
      </div>

      <div className="grid w-full grid-cols-2 items-center gap-2.5 mb-2.5">
        <InspectorButtonGroup>
          <InspectorButton ariaLabel={t('foundation.editor.text.decreaseIndent')} onClick={() => execute({ command: 'indent', value: '-1' })} style={{ flex: 1 }}><IndentLeftIcon /></InspectorButton>
          <IndentPopover ariaLabel={t('foundation.editor.text.decreaseFirstIndent')} onSelect={() => execute({ command: 'textIndent', value: '-1' })} />
        </InspectorButtonGroup>
        <InspectorButtonGroup>
          <InspectorButton ariaLabel={t('foundation.editor.text.increaseIndent')} onClick={() => execute({ command: 'indent', value: '+1' })} style={{ flex: 1 }}><IndentRightIcon /></InspectorButton>
          <IndentPopover ariaLabel={t('foundation.editor.text.increaseFirstIndent')} onSelect={() => execute({ command: 'textIndent', value: '+1' })} />
        </InspectorButtonGroup>
      </div>

      <div className="mona-panel-divider" />
      <PropertyRow label={t('foundation.editor.text.lineSpacing')}>
        <InspectorSelect ariaLabel={t('foundation.editor.text.lineSpacing')} icon={<RowHeightIcon />} onChange={value => update({ lineHeight: value })} options={lineHeightOptions} value={element.lineHeight || 1.5} />
      </PropertyRow>
      <PropertyRow label={t('foundation.editor.text.paragraphSpacing')}>
        <InspectorSelect ariaLabel={t('foundation.editor.text.paragraphSpacing')} icon={<VerticalSpacingIcon />} onChange={value => update({ paragraphSpace: value })} options={paragraphSpaceOptions} value={element.paragraphSpace === undefined ? 5 : element.paragraphSpace} />
      </PropertyRow>
      <PropertyRow label={t('foundation.editor.text.letterSpacing')}>
        <InspectorSelect ariaLabel={t('foundation.editor.text.letterSpacing')} icon={<FullwidthIcon />} onChange={value => update({ wordSpace: value })} options={wordSpaceOptions} value={element.wordSpace || 0} />
      </PropertyRow>
      <PropertyRow label={t('foundation.editor.text.boxFill')}>
        <InspectorColorButton ariaLabel={t('foundation.editor.text.boxFill')} color={element.fill || '#ffffff'} onChange={value => update({ fill: value })} />
      </PropertyRow>

      <div className="mona-panel-divider" />
      <div className="grid w-full grid-cols-2 items-center gap-2.5 mb-2.5 is-insets">
        <InspectorNumberInput ariaLabel={t('foundation.editor.text.marginTop')} label={t('foundation.editor.text.marginTop')} max={50} min={0} onChange={value => updateInset(0, value)} value={inset[0]} />
        <InspectorNumberInput ariaLabel={t('foundation.editor.text.marginBottom')} label={t('foundation.editor.text.marginBottom')} max={50} min={0} onChange={value => updateInset(2, value)} value={inset[2]} />
      </div>
      <div className="grid w-full grid-cols-2 items-center gap-2.5 mb-2.5 is-insets">
        <InspectorNumberInput ariaLabel={t('foundation.editor.text.marginLeft')} label={t('foundation.editor.text.marginLeft')} max={50} min={0} onChange={value => updateInset(3, value)} value={inset[3]} />
        <InspectorNumberInput ariaLabel={t('foundation.editor.text.marginRight')} label={t('foundation.editor.text.marginRight')} max={50} min={0} onChange={value => updateInset(1, value)} value={inset[1]} />
      </div>

      <div className="mona-panel-divider" />
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

      <div className="mona-panel-divider" />
      <PropertyRow label={t('foundation.editor.text.enableBorder')}>
        <div className="w-full text-right"><InspectorSwitch ariaLabel={t('foundation.editor.text.enableBorder')} checked={Boolean(element.outline)} onChange={value => value ? update({ outline: presentation.theme.outline }, `element-outline-${element.id}`) : remove('outline', `element-outline-${element.id}`)} /></div>
      </PropertyRow>
      {element.outline ? (
        <>
          <PropertyRow label={t('foundation.editor.text.borderStyle')}><InspectorSelect<LineStyleType> ariaLabel={t('foundation.editor.text.borderStyle')} onChange={value => updateOutline({ style: value })} options={outlineStyleOptions} renderLabel={option => <LineStylePreview type={option?.value || 'solid'} />} renderOption={option => <LineStylePreview type={option.value} />} value={element.outline.style || 'solid'} /></PropertyRow>
          <PropertyRow label={t('foundation.editor.text.borderColor')}><InspectorColorButton ariaLabel={t('foundation.editor.text.borderColor')} color={element.outline.color || '#000000'} onChange={value => updateOutline({ color: value })} /></PropertyRow>
          <PropertyRow label={t('foundation.editor.text.borderWidth')}><InspectorNumberInput ariaLabel={t('foundation.editor.text.borderWidth')} min={0} onChange={value => updateOutline({ width: value })} value={element.outline.width || 0} /></PropertyRow>
        </>
      ) : null}

      <div className="mona-panel-divider" />
      <PropertyRow label={t('foundation.editor.text.enableShadow')}>
        <div className="w-full text-right"><InspectorSwitch ariaLabel={t('foundation.editor.text.enableShadow')} checked={Boolean(element.shadow)} onChange={value => value ? update({ shadow: presentation.theme.shadow }, `element-shadow-${element.id}`) : remove('shadow', `element-shadow-${element.id}`)} /></div>
      </PropertyRow>
      {element.shadow ? (
        <>
          <PropertyRow label={t('foundation.editor.text.shadowHorizontal')}><InspectorSlider ariaLabel={t('foundation.editor.text.shadowHorizontal')} max={20} min={-20} onChange={value => updateShadow({ h: value })} value={element.shadow.h} /></PropertyRow>
          <PropertyRow label={t('foundation.editor.text.shadowVertical')}><InspectorSlider ariaLabel={t('foundation.editor.text.shadowVertical')} max={20} min={-20} onChange={value => updateShadow({ v: value })} value={element.shadow.v} /></PropertyRow>
          <PropertyRow label={t('foundation.editor.text.shadowBlur')}><InspectorSlider ariaLabel={t('foundation.editor.text.shadowBlur')} max={30} min={1} onChange={value => updateShadow({ blur: value })} value={element.shadow.blur} /></PropertyRow>
          <PropertyRow label={t('foundation.editor.text.shadowColor')}><InspectorColorButton ariaLabel={t('foundation.editor.text.shadowColor')} color={element.shadow.color} onChange={value => updateShadow({ color: value })} /></PropertyRow>
        </>
      ) : null}

      <div className="mona-panel-divider" />
      <PropertyRow label={t('foundation.editor.text.opacity')}>
        <InspectorSlider ariaLabel={t('foundation.editor.text.opacity')} max={1} min={0} onChange={value => update({ opacity: value }, `element-opacity-${element.id}`)} step={0.1} value={element.opacity === undefined ? 1 : element.opacity} />
      </PropertyRow>
    </div>
  )
}
