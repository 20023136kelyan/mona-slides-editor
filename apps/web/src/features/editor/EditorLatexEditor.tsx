/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the source formula/symbol tiles and modal mask are pointer surfaces without keyboard roles. */
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FORMULA_LIST, SYMBOL_LIST } from '@mona/presentation-core/latex-presets'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { renderLatex, renderLatexSymbol, type LatexRenderResult } from '@/features/editor/editor-latex'
import { useEditorApplication } from '@/features/editor/services/editor-application'

type FormulaToolbarState = 'formula' | 'symbol'

function FormulaContent({ height, latex, width }: { height: number; latex: string; width: number }) {
  const result = useMemo(() => renderLatex(latex), [latex])
  const scale = result.w > width || result.h > height
    ? result.w / result.h > width / height ? width / result.w : height / result.h
    : 1
  return (
    <svg className="overflow-hidden" fill="none" height={result.h} overflow="visible" stroke="#000" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" width={result.w}>
      <g style={{ transformOrigin: '0 50%' }} transform={'scale(' + scale + ', ' + scale + ') translate(0,0) matrix(1,0,0,1,0,0)'}><path d={result.path} /></g>
    </svg>
  )
}

function FormulaSymbol({ latex }: { latex: string }) {
  const svg = useMemo(() => renderLatexSymbol(latex), [latex])
  return <div className="[&_svg]:inline [&_svg]:align-baseline" dangerouslySetInnerHTML={{ __html: svg }} />
}

function LatexCardTabs({ onChange, tabs, value }: {
  onChange: (value: string) => void
  tabs: ReadonlyArray<{ key: string; label: string }>
  value: string
}) {
  return (
    <ToggleGroup
      className="h-10 w-full shrink-0 flex-wrap items-stretch justify-start gap-0 rounded-none"
      onValueChange={next => {
        if (next) onChange(next)
      }}
      type="single"
      value={value}
    >
      {tabs.map(tab => (
        <ToggleGroupItem
          className="h-auto min-w-0 flex-1 rounded-none border-b bg-muted px-0 py-0 text-xs font-normal hover:bg-muted data-[state=on]:border-b-transparent data-[state=on]:bg-transparent [&:not(:first-child)]:border-l"
          key={tab.key}
          value={tab.key}
        >
          {tab.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

function LatexLineTabs({ onChange, tabs, value }: {
  onChange: (value: string) => void
  tabs: ReadonlyArray<{ key: string; label: string }>
  value: string
}) {
  return (
    <Tabs className="w-full" onValueChange={onChange} value={value}>
      <TabsList className="h-auto w-full flex-wrap justify-between gap-0 rounded-none bg-transparent p-0" variant="line">
        {tabs.map(tab => (
          <TabsTrigger className="flex-none rounded-none px-2.5 py-1.5 text-xs" key={tab.key} value={tab.key}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

export function EditorLatexEditor({ initialValue = '', onClose, onSave }: {
  initialValue?: string
  onClose: () => void
  onSave: (result: LatexRenderResult) => void
}) {
  const { t } = useTranslation()
  const { notifications } = useEditorApplication()
  const [latex, setLatex] = useState(initialValue)
  const [toolbarState, setToolbarState] = useState<FormulaToolbarState>('symbol')
  const [selectedSymbolKey, setSelectedSymbolKey] = useState(SYMBOL_LIST[0]!.type)
  const textAreaRef = useRef<HTMLTextAreaElement>(null)
  const formulaTabs = [
    { key: 'symbol', label: t('foundation.editor.latex.symbols') },
    { key: 'formula', label: t('foundation.editor.latex.presets') },
  ]
  const symbolTabs = SYMBOL_LIST.map(item => ({ key: item.type, label: t('foundation.editor.latex.categories.' + item.type) }))
  const selectedSymbol = SYMBOL_LIST.find(item => item.type === selectedSymbolKey) || SYMBOL_LIST[0]!

  const insertSymbol = (value: string) => {
    const textArea = textAreaRef.current
    if (!textArea) return
    textArea.focus()
    const start = textArea.selectionStart
    const end = textArea.selectionEnd
    setLatex(current => current.slice(0, start) + value + current.slice(end))
    requestAnimationFrame(() => {
      const caret = start + value.length
      textArea.setSelectionRange(caret, caret)
    })
  }

  const confirm = () => {
    if (!latex) {
      notifications.notify({ text: t('foundation.editor.latex.required'), type: 'error' })
      return
    }
    onSave(renderLatex(latex))
    onClose()
  }

  return (
    <Dialog onOpenChange={open => {
      if (!open) onClose()
    }} open>
      <DialogContent
        className="w-220 max-w-none gap-0 overflow-hidden p-5 sm:max-w-none"
        onOpenAutoFocus={event => {
          event.preventDefault()
          textAreaRef.current?.focus()
        }}
        showCloseButton={false}
      >
        <DialogHeader className="sr-only"><DialogTitle>{t('foundation.editor.latex.edit')}</DialogTitle></DialogHeader>
        <div className="h-140">
          <div className="flex h-[calc(100%-50px)]">
            <div className="flex h-full w-135 shrink-0 flex-col">
              <div className="flex-1">
                <Textarea className="h-full resize-none p-2.5 font-mono leading-relaxed" onChange={event => setLatex(event.target.value)} placeholder={t('foundation.editor.latex.placeholder')} ref={textAreaRef} rows={4} value={latex} />
              </div>
              <div className="mt-5 flex h-40 items-center justify-center rounded-surface border text-center select-none">
                {!latex ? <div className="text-sm text-muted-foreground">{t('foundation.editor.latex.preview')}</div> : (
                  <div className="flex h-full w-full items-center justify-center p-2.5"><FormulaContent height={138} latex={latex} width={518} /></div>
                )}
              </div>
            </div>
            <div className="ml-5 flex h-full w-70 flex-col overflow-hidden rounded-surface border bg-background select-none">
              <LatexCardTabs onChange={value => setToolbarState(value as FormulaToolbarState)} tabs={formulaTabs} value={toolbarState} />
              <div className="h-[calc(100%-40px)] text-sm">
                {toolbarState === 'symbol' ? (
                  <div className="flex h-full flex-col">
                    <div className="mx-2.5 mt-2.5"><LatexLineTabs onChange={setSelectedSymbolKey} tabs={symbolTabs} value={selectedSymbolKey} /></div>
                    <div className="flex flex-1 flex-wrap overflow-auto p-3">
                      {selectedSymbol.children.map(item => <div className="flex cursor-pointer items-center justify-center rounded-control hover:bg-muted" key={item.latex} onClick={() => insertSymbol(item.latex)}><FormulaSymbol latex={item.latex} /></div>)}
                    </div>
                  </div>
                ) : (
                  <div className="h-full space-y-2.5 overflow-auto p-3">
                    {FORMULA_LIST.map((item, index) => (
                      <div key={item.latex}>
                        <div className="mb-1.5">{t('foundation.editor.latex.formulaPresets.' + index)}</div>
                        <div className="flex h-15 cursor-pointer items-center rounded-control bg-muted p-1.25" onClick={() => setLatex(item.latex)}><FormulaContent height={60} latex={item.latex} width={236} /></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex h-12.5 items-end justify-end gap-2.5">
            <Button onClick={onClose} size="editor" variant="outline">{t('foundation.editor.latex.cancel')}</Button>
            <Button onClick={confirm} size="editor">{t('foundation.editor.latex.confirm')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
