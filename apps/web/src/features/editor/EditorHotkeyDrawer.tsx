import { useTranslation } from 'react-i18next'

import CloseIcon from '~icons/icon-park-outline/close'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet'

interface HotkeyGroup {
  title: string
  items: Array<{ label: string; value?: string }>
}

export function EditorHotkeyDrawer({ onClose, open }: { onClose: () => void; open: boolean }) {
  const { t } = useTranslation()
  const groups = t('hotkeys.groups', { returnObjects: true }) as unknown as HotkeyGroup[]

  return (
    <Sheet onOpenChange={next => {
      if (!next) onClose()
    }} open={open}>
      <SheetContent aria-describedby={undefined} className="mona-hotkey-drawer" showCloseButton={false} side="right">
        <div className="mona-hotkey-drawer-header">
          <SheetTitle>{t('header.keyboardShortcuts')}</SheetTitle>
          <SheetClose asChild>
            <Button aria-label={t('common.close')} size="icon-xs" variant="ghost"><CloseIcon /></Button>
          </SheetClose>
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
      </SheetContent>
    </Sheet>
  )
}
