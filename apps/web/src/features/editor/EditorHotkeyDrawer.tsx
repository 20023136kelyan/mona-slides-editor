import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import CloseIcon from '~icons/icon-park-outline/close'

interface HotkeyGroup {
  title: string
  items: Array<{ label: string; value?: string }>
}

export function EditorHotkeyDrawer({ onClose, open }: { onClose: () => void; open: boolean }) {
  const { t } = useTranslation()
  const [closing, setClosing] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const groups = t('hotkeys.groups', { returnObjects: true }) as unknown as HotkeyGroup[]
  const close = useCallback(() => {
    if (closing) return
    setClosing(true)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setClosing(false)
      onClose()
    }, 250)
  }, [closing, onClose])

  if (!open) return null
  return createPortal((
    <aside aria-label={t('header.keyboardShortcuts')} className={`mona-hotkey-drawer${closing ? ' is-closing' : ''}`}>
      <div className="mona-hotkey-drawer-header">
        {t('header.keyboardShortcuts')}
        <button aria-label={t('common.close')} onClick={close} type="button"><CloseIcon /></button>
      </div>
      <div className="mona-hotkey-drawer-content">
        <div className="mona-hotkey-doc">
          {groups.map(group => (
            <div className="mona-hotkey-group" key={group.title}>
              <div className="mona-hotkey-title">{group.title}</div>
              {group.items.map((item, index) => (
                <div className="mona-hotkey-item" key={`${item.label}-${item.value}-${index}`}>
                  {item.value ? <><div className="mona-hotkey-label">{item.label}</div><div>{item.value}</div></> : <div>{item.label}</div>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </aside>
  ), document.body)
}
