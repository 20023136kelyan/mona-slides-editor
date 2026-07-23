/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the source formula/symbol tiles and modal mask are pointer surfaces without keyboard roles. */
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FORMULA_LIST, SYMBOL_LIST } from '@mona/presentation-core/latex-presets'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
    <svg className="mona-latex-formula-content" fill="none" height={result.h} overflow="visible" stroke="#000" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" width={result.w}>
      <g style={{ transformOrigin: '0 50%' }} transform={'scale(' + scale + ', ' + scale + ') translate(0,0) matrix(1,0,0,1,0,0)'}><path d={result.path} /></g>
    </svg>
  )
}

function FormulaSymbol({ latex }: { latex: string }) {
  const svg = useMemo(() => renderLatexSymbol(latex), [latex])
  return <div className="mona-latex-symbol-content" dangerouslySetInnerHTML={{ __html: svg }} />
}

function LatexTabs({ card = false, onChange, spaceBetween = false, tabs, value }: {
  card?: boolean
  onChange: (value: string) => void
  spaceBetween?: boolean
  tabs: ReadonlyArray<{ key: string; label: string }>
  value: string
}) {
  return (
    <ToggleGroup
      className={'mona-latex-tabs' + (card ? ' is-card' : '') + (spaceBetween ? ' is-space-between' : '')}
      onValueChange={next => {
        if (next) onChange(next)
      }}
      type="single"
      value={value}
    >
      {tabs.map(tab => <ToggleGroupItem className={tab.key === value ? 'is-active' : ''} key={tab.key} value={tab.key}>{tab.label}</ToggleGroupItem>)}
    </ToggleGroup>
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
        className="mona-latex-modal-content"
        onOpenAutoFocus={event => {
          event.preventDefault()
          textAreaRef.current?.focus()
        }}
        overlayClassName="mona-latex-modal-mask"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only"><DialogTitle>{t('foundation.editor.latex.edit')}</DialogTitle></DialogHeader>
        <div className="mona-latex-editor">
          <div className="mona-latex-editor-container">
            <div className="mona-latex-editor-left">
              <div className="mona-latex-input-area">
                <Textarea onChange={event => setLatex(event.target.value)} placeholder={t('foundation.editor.latex.placeholder')} ref={textAreaRef} rows={4} value={latex} />
              </div>
              <div className="mona-latex-preview">
                {!latex ? <div className="mona-latex-preview-placeholder">{t('foundation.editor.latex.preview')}</div> : (
                  <div className="mona-latex-preview-content"><FormulaContent height={138} latex={latex} width={518} /></div>
                )}
              </div>
            </div>
            <div className="mona-latex-editor-right">
              <LatexTabs card onChange={value => setToolbarState(value as FormulaToolbarState)} tabs={formulaTabs} value={toolbarState} />
              <div className="mona-latex-editor-content">
                {toolbarState === 'symbol' ? (
                  <div className="mona-latex-symbol-pane">
                    <div className="mona-latex-symbol-tabs"><LatexTabs onChange={setSelectedSymbolKey} spaceBetween tabs={symbolTabs} value={selectedSymbolKey} /></div>
                    <div className="mona-latex-symbol-pool">
                      {selectedSymbol.children.map(item => <div className="mona-latex-symbol-item" key={item.latex} onClick={() => insertSymbol(item.latex)}><FormulaSymbol latex={item.latex} /></div>)}
                    </div>
                  </div>
                ) : (
                  <div className="mona-latex-formula-pane">
                    {FORMULA_LIST.map((item, index) => (
                      <div className="mona-latex-formula-item" key={item.latex}>
                        <div className="mona-latex-formula-title">{t('foundation.editor.latex.formulaPresets.' + index)}</div>
                        <div className="mona-latex-formula-item-content" onClick={() => setLatex(item.latex)}><FormulaContent height={60} latex={item.latex} width={236} /></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="mona-latex-editor-footer">
            <Button className="mona-latex-editor-button" onClick={onClose} size="editor" variant="outline">{t('foundation.editor.latex.cancel')}</Button>
            <Button className="mona-latex-editor-button" onClick={confirm} size="editor">{t('foundation.editor.latex.confirm')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
