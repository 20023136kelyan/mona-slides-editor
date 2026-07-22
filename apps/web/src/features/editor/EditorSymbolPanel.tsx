/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- PPTist's movable panel and symbol tiles are literal pointer surfaces. */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'

import CloseIcon from '~icons/icon-park-outline/close'
import { SYMBOL_LIST } from '@mona/presentation-core/symbol-presets'

const EMOJI_TYPES = ['face', 'gesture', 'nature', 'food', 'travel', 'activity', 'object', 'symbol'] as const
const PANEL_WIDTH = 350
const PANEL_HEIGHT = 560

export function EditorSymbolPanel({ onClose, onSelect }: {
  onClose: () => void
  onSelect: (value: string) => void
}) {
  const { t } = useTranslation()
  const [position, setPosition] = useState(() => ({ left: document.body.clientWidth - 270 - PANEL_WIDTH, top: 90 }))
  const [selectedSymbolKey, setSelectedSymbolKey] = useState(SYMBOL_LIST[0]!.key)
  const [selectedEmojiTypeIndex, setSelectedEmojiTypeIndex] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const poolRef = useRef<HTMLDivElement>(null)
  const selectedSymbol = SYMBOL_LIST.find(item => item.key === selectedSymbolKey) || SYMBOL_LIST[0]!
  const symbolPool: readonly (readonly string[])[] = selectedSymbol.key === 'emoji'
    ? [selectedSymbol.children[selectedEmojiTypeIndex] || []]
    : selectedSymbol.children

  useEffect(() => {
    poolRef.current?.scrollTo(0, 0)
  }, [selectedEmojiTypeIndex, selectedSymbolKey])

  const startMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = position
    const start = { x: event.pageX, y: event.pageY }
    const move = (nativeEvent: PointerEvent) => {
      const left = Math.min(document.body.clientWidth - PANEL_WIDTH, Math.max(0, origin.left + nativeEvent.pageX - start.x))
      const top = Math.min(document.body.clientHeight - PANEL_HEIGHT, Math.max(0, origin.top + nativeEvent.pageY - start.y))
      setPosition({ left, top })
    }
    const stop = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', stop)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', stop)
  }

  return (
    <div className="mona-symbol-panel" ref={panelRef} style={position}>
      <div className="mona-symbol-panel-content" onPointerDown={startMove}>
        <button aria-label={t('foundation.editor.symbolPanel.close')} className="mona-symbol-panel-close" onClick={onClose} onPointerDown={event => event.stopPropagation()} type="button"><CloseIcon /></button>
        <div className="mona-symbol-tabs">
          {SYMBOL_LIST.map(item => <button className={item.key === selectedSymbolKey ? 'is-active' : ''} key={item.key} onClick={() => setSelectedSymbolKey(item.key)} type="button">{t('foundation.editor.symbolPanel.tabs.' + item.key)}</button>)}
        </div>
        {selectedSymbolKey === 'emoji' ? (
          <div className="mona-symbol-emoji-types">
            {EMOJI_TYPES.map((type, index) => <button className={selectedEmojiTypeIndex === index ? 'is-active' : ''} key={type} onClick={() => setSelectedEmojiTypeIndex(index)} type="button">{t('foundation.editor.symbolPanel.categories.' + type)}</button>)}
          </div>
        ) : null}
        <div className="mona-symbol-pool" ref={poolRef}>
          {symbolPool.map((group, groupIndex) => (
            <div className="mona-symbol-group" key={groupIndex}>
              {group.map((item, index) => (
                <button
                  className="mona-symbol-item"
                  key={item + '-' + index}
                  onClick={() => onSelect(item)}
                  onMouseDown={event => event.preventDefault()}
                  type="button"
                >
                  <span>{item}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
