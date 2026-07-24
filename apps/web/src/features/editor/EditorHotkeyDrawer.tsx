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
      <SheetContent aria-describedby={undefined} className="gap-0" showCloseButton={false} side="right">
        <div className="relative flex h-[50px] flex-none items-center justify-between px-[15px]">
          <SheetTitle>{t('header.keyboardShortcuts')}</SheetTitle>
          <SheetClose asChild>
            <Button aria-label={t('common.close')} size="icon-xs" variant="ghost"><CloseIcon /></Button>
          </SheetClose>
        </div>
        <div className="flex-1 overflow-auto px-[15px]">
          <div className="mx-[-15px] h-full overflow-auto px-[15px] pb-[15px] text-xs">
            {groups.map((group, groupIndex) => (
              <div key={group.title}>
                <div className={`border-b pb-[5px] text-sm font-bold ${groupIndex === 0 ? 'pt-0' : 'pt-[25px]'}`}>{group.title}</div>
                {group.items.map((item, index) => (
                  <div className="flex items-center border-b pt-[15px] pb-[5px]" key={`${item.label}-${item.value}-${index}`}>
                    {item.value ? <><div className="w-[140px] truncate">{item.label}</div><div>{item.value}</div></> : <div>{item.label}</div>}
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
