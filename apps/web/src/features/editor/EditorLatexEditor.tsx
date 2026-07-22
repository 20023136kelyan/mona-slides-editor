/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the source formula/symbol tiles and modal mask are pointer surfaces without keyboard roles. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { FORMULA_LIST, SYMBOL_LIST } from '@mona/presentation-core/latex-presets'

import { renderLatex, renderLatexSymbol, type LatexRenderResult } from '@/features/editor/editor-latex'

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
    <div className={'mona-latex-tabs' + (card ? ' is-card' : '') + (spaceBetween ? ' is-space-between' : '')}>
      {tabs.map(tab => <button className={tab.key === value ? 'is-active' : ''} key={tab.key} onClick={() => onChange(tab.key)} type="button">{tab.label}</button>)}
    </div>
  )
}

export function EditorLatexEditor({ initialValue = '', onClose, onSave }: {
  initialValue?: string
  onClose: () => void
  onSave: (result: LatexRenderResult) => void
}) {
  const { t } = useTranslation()
  const [latex, setLatex] = useState(initialValue)
  const [closing, setClosing] = useState(false)
  const [toolbarState, setToolbarState] = useState<FormulaToolbarState>('symbol')
  const [selectedSymbolKey, setSelectedSymbolKey] = useState(SYMBOL_LIST[0]!.type)
  const textAreaRef = useRef<HTMLTextAreaElement>(null)
  const closeTimerRef = useRef<number | null>(null)
  useEffect(() => {
    const timer = window.setTimeout(() => textAreaRef.current?.focus(), 0)
    return () => {
      window.clearTimeout(timer)
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
    }
  }, [])
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

  const requestClose = () => {
    if (closing) return
    setClosing(true)
    closeTimerRef.current = window.setTimeout(onClose, 250)
  }

  const confirm = () => {
    if (!latex) {
      window.dispatchEvent(new CustomEvent('mona:notice', { detail: { text: t('foundation.editor.latex.required'), type: 'error' } }))
      return
    }
    onSave(renderLatex(latex))
    requestClose()
  }

  return createPortal((
    <div className={'mona-latex-modal' + (closing ? ' is-closing' : '')} onKeyUp={event => {
      if (event.key === 'Escape') requestClose() 
    }} tabIndex={-1}>
      <div className="mona-latex-modal-mask" onClick={requestClose} />
      <div className="mona-latex-modal-content">
        <div className="mona-latex-editor">
          <div className="mona-latex-editor-container">
            <div className="mona-latex-editor-left">
              <div className="mona-latex-input-area">
                <textarea onChange={event => setLatex(event.target.value)} placeholder={t('foundation.editor.latex.placeholder')} ref={textAreaRef} rows={4} value={latex} />
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
            <button className="mona-latex-editor-button is-default" onClick={requestClose} type="button">{t('foundation.editor.latex.cancel')}</button>
            <button className="mona-latex-editor-button is-primary" onClick={confirm} type="button">{t('foundation.editor.latex.confirm')}</button>
          </div>
        </div>
      </div>
    </div>
  ), document.body)
}
