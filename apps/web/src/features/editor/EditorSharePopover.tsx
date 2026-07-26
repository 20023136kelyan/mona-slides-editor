import { useTranslation } from 'react-i18next'
import { Code2, Globe, UserPlus, X } from 'lucide-react'

import type { ComponentType } from 'react'

import { Button } from '@/components/ui/button'
import { PopoverContent } from '@/components/ui/popover'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * Sharing, which is now only about sharing.
 *
 * This panel used to carry Export as a fourth tab, and the header button that
 * opened it was the only way to reach exporting other than the File menu — so
 * one surface answered to two names, "Share" in its own heading and "Export" in
 * the menu that opened it. Export has its own dialog now, reached from File
 * where saving a copy of a document belongs.
 *
 * What is left is genuinely unbuilt rather than misplaced. Invite, public link
 * and embed are the three things sharing will mean, and they say so.
 *
 * Kept in its own module, away from the export panel: that one pulls in
 * pptxgenjs and html-to-image, and three static panels should not.
 */

const SHARE_TABS: Array<{
  descriptionKey: string
  icon: ComponentType<{ className?: string }>
  id: string
  labelKey: string
  titleKey: string
}> = [
  { descriptionKey: 'share.inviteDescription', icon: UserPlus, id: 'invite', labelKey: 'share.invite', titleKey: 'share.inviteSoon' },
  { descriptionKey: 'share.publicDescription', icon: Globe, id: 'public', labelKey: 'share.public', titleKey: 'share.publicSoon' },
  { descriptionKey: 'share.embedDescription', icon: Code2, id: 'embed', labelKey: 'share.embed', titleKey: 'share.embedSoon' },
]

export function EditorSharePanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <PopoverContent
      align="end"
      aria-label={t('share.title')}
      className="w-110 gap-0 p-0 text-control shadow-[0_10px_30px_rgb(15_23_42_/_13%),0_2px_8px_rgb(15_23_42_/_8%)]"
      sideOffset={8}
    >
      <Tabs className="gap-0" defaultValue="invite">
        <div className="flex items-center justify-between gap-2 px-3 pt-3">
          <h3 className="text-base font-semibold">{t('share.title')}</h3>
          <Button aria-label={t('common.close')} className="size-7" onClick={onClose} size="icon-sm" type="button" variant="ghost">
            <X />
          </Button>
        </div>

        <div className="px-3 pt-3 pb-3">
          <TabsList className="h-9 w-full gap-0.5" variant="default">
            {SHARE_TABS.map(entry => {
              const Icon = entry.icon
              return (
                <TabsTrigger
                  className="min-w-0 flex-auto gap-1.5 px-2 text-xs font-medium"
                  key={entry.id}
                  value={entry.id}
                >
                  <Icon aria-hidden className="size-3.5" />
                  <span className="truncate">{t(entry.labelKey)}</span>
                </TabsTrigger>
              )
            })}
          </TabsList>
        </div>

        {SHARE_TABS.map(entry => {
          const Icon = entry.icon
          return (
            <TabsContent className="mt-0 px-3 pb-3 outline-none" key={entry.id} value={entry.id}>
              <div className="flex flex-col items-center gap-2 rounded-[var(--radius-md)] border border-border bg-muted/40 px-4 py-8 text-center">
                <span className="flex size-10 items-center justify-center rounded-full bg-background text-foreground/70 shadow-sm">
                  <Icon aria-hidden className="size-5" />
                </span>
                <p className="text-sm font-medium text-foreground">{t(entry.titleKey)}</p>
                <p className="max-w-65 text-xs leading-relaxed text-muted-foreground">{t(entry.descriptionKey)}</p>
              </div>
            </TabsContent>
          )
        })}
      </Tabs>
    </PopoverContent>
  )
}
