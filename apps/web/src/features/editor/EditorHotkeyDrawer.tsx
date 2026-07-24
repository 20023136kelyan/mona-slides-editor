import { useTranslation } from 'react-i18next'

import CloseIcon from '~icons/icon-park-outline/close'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
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
      <SheetContent aria-describedby={undefined} className="gap-0" showCloseButton={false} side="right">
        <SheetHeader className="relative flex h-12.5 flex-none flex-row items-center justify-between space-y-0 px-3.5 py-0">
          <SheetTitle>{t('header.keyboardShortcuts')}</SheetTitle>
          <SheetClose asChild>
            <Button aria-label={t('common.close')} size="icon-xs" variant="ghost"><CloseIcon /></Button>
          </SheetClose>
        </SheetHeader>
        <div className="flex-1 overflow-auto px-3.5 pb-3.5 text-xs">
          {groups.map((group, groupIndex) => (
            <div key={group.title}>
              <div className={`border-b pb-1 text-sm font-bold ${groupIndex === 0 ? 'pt-0' : 'pt-6'}`}>{group.title}</div>
              {group.items.map((item, index) => (
                <div className="flex items-center border-b pt-3.5 pb-1" key={`${item.label}-${item.value}-${index}`}>
                  {item.value ? <><div className="w-35 truncate">{item.label}</div><div>{item.value}</div></> : <div>{item.label}</div>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
