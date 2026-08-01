/* oxlint-disable jsx-a11y/prefer-tag-over-role -- the shadcn Sidebar primitive renders a div; the navigation landmark is applied explicitly. */
import { useState, type ComponentProps, type ComponentType, type ReactNode, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Languages,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from 'lucide-react'
import ColorSettings from '~icons/fluent-color/settings-24'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { LOCALES, isSupportedLocale, setLocale, type SupportedLocale } from '@/i18n'
import { isMacChrome } from '@/lib/mona-bridge'
import { cn } from '@/lib/utils'
import {
  applicationSidebarIconHidden,
  applicationSidebarIconLabel,
  applicationSidebarIconRow,
  applicationSidebarIconRowInner,
  applicationSidebarIconSize,
  applicationSidebarTrailingControlRow,
} from '@/features/application-shell/application-sidebar-styles'

export function ApplicationSidebarItem({
  active = false,
  children,
  className,
  icon: Icon,
  label,
  title = label,
  ...props
}: Omit<ComponentProps<typeof SidebarMenuButton>, 'children' | 'isActive'> & {
  active?: boolean
  children?: ReactNode
  icon: ComponentType<{ className?: string }>
  label: string
}) {
  const macChrome = isMacChrome()

  return (
    <SidebarMenuButton
      {...props}
      aria-label={props['aria-label'] ?? label}
      className={cn(
        'h-10 w-full px-3',
        applicationSidebarIconRow,
        children && applicationSidebarTrailingControlRow,
        className,
      )}
      isActive={active}
      title={title}
    >
      <div className={cn('flex min-w-0 flex-1 items-center', applicationSidebarIconRowInner)}>
        <Icon className={cn('mona-rail-shift shrink-0 transition-[width,height] duration-200 ease-out', applicationSidebarIconSize(macChrome))} />
        <span className={cn('truncate', applicationSidebarIconLabel)}>{label}</span>
      </div>
      {children}
    </SidebarMenuButton>
  )
}

export function ApplicationSidebar({
  ariaLabel,
  children,
  collapsed,
  contentClassName,
  contentRef,
  onCollapsedChange,
  onOpenLibrary,
}: {
  ariaLabel: string
  children: ReactNode
  collapsed: boolean
  contentClassName?: string
  contentRef?: Ref<HTMLDivElement>
  onCollapsedChange: (collapsed: boolean) => void
  onOpenLibrary: () => void
}) {
  const { t } = useTranslation()
  const macChrome = isMacChrome()

  return (
    <Sidebar
      aria-label={ariaLabel}
      className={cn(
        'mona-application-sidebar mona-editor-rail group/rail w-56 shrink-0 border-r border-sidebar-border transition-[width] duration-200 max-snug:w-[3.25rem] data-[collapsed=true]:w-[3.25rem]',
        macChrome && 'mona-editor-rail-mac max-snug:w-(--mona-rail-collapsed-mac) data-[collapsed=true]:w-(--mona-rail-collapsed-mac)',
      )}
      collapsible="none"
      data-collapsed={collapsed}
      role="navigation"
      side="left"
    >
      <SidebarHeader
        className={cn(
          'mona-application-sidebar-titlebar h-11 flex-none flex-row items-center gap-1 px-3',
          applicationSidebarIconRow,
          macChrome && !collapsed && 'ps-(--mona-traffic-clear)',
        )}
      >
        <Button
          aria-label={t('header.allPresentations')}
          className={cn(
            'h-auto min-w-0 flex-1 justify-start gap-1.5 p-0 text-sm font-semibold tracking-tight text-foreground hover:bg-transparent',
            applicationSidebarIconRowInner,
            'mona-rail-shift max-w-56 overflow-hidden transition-[max-width,margin,opacity] duration-200 ease-out',
            'group-data-[collapsed=true]/rail:-me-1 group-data-[collapsed=true]/rail:max-w-0 group-data-[collapsed=true]/rail:opacity-0',
          )}
          onClick={onOpenLibrary}
          title={t('header.allPresentations')}
          type="button"
          variant="ghost"
        >
          <img alt="" aria-hidden="true" className="size-4 flex-none" src="/favicon.svg" />
          {macChrome ? null : <span className={cn('ms-1.5 truncate', applicationSidebarIconHidden)}>Mona</span>}
        </Button>
        <div
          className={cn(
            'mona-rail-shift flex-none overflow-hidden transition-[width,margin,opacity] duration-200 ease-out max-snug:-ms-1 max-snug:w-0 max-snug:opacity-0',
            macChrome && collapsed ? '-ms-1 w-0 opacity-0' : 'w-6 opacity-100',
          )}
          inert={macChrome && collapsed}
        >
          <Button
            aria-label={collapsed ? t('foundation.editor.rail.expandSidebar') : t('foundation.editor.rail.collapseSidebar')}
            aria-pressed={collapsed}
            className="mona-editor-rail-toggle shrink-0 text-foreground/70 hover:text-foreground"
            onClick={() => onCollapsedChange(!collapsed)}
            size="icon-xs"
            title={collapsed ? t('foundation.editor.rail.expandSidebar') : t('foundation.editor.rail.collapseSidebar')}
            type="button"
            variant="ghost"
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </Button>
        </div>
      </SidebarHeader>
      <SidebarContent className={contentClassName} ref={contentRef}>
        {children}
      </SidebarContent>
      <ApplicationSidebarFooter />
    </Sidebar>
  )
}

/**
 * The same expand keycap that the editor places in its content header when the
 * macOS traffic-light clearance owns the collapsed rail header.
 */
export function ApplicationSidebarContentToggle({
  className,
  collapsed,
  onExpand,
}: {
  className?: string
  collapsed: boolean
  onExpand: () => void
}) {
  const { t } = useTranslation()
  const macChrome = isMacChrome()
  if (!macChrome) return null

  return (
    <div
      className={cn(
        'mona-rail-shift flex-none overflow-clip [overflow-clip-margin:3px] transition-[width,margin,opacity] duration-200 ease-out',
        collapsed ? 'w-7 opacity-100' : 'w-0 -me-1 opacity-0',
        className,
      )}
      inert={!collapsed}
    >
      <Button
        aria-label={t('foundation.editor.rail.expandSidebar')}
        onClick={onExpand}
        size="header-icon"
        title={t('foundation.editor.rail.expandSidebar')}
        variant="header-pill"
      >
        <PanelLeftOpen />
      </Button>
    </div>
  )
}

function ApplicationSidebarFooter() {
  return (
    <SidebarFooter className="p-0">
      <SidebarGroup className="py-1">
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <ApplicationSettingsMenu />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarFooter>
  )
}

function ApplicationSettingsMenu() {
  const { i18n, t } = useTranslation()
  const [open, setOpen] = useState(false)
  const resolvedLanguage = i18n.resolvedLanguage ?? ''
  const activeLocale: SupportedLocale = isSupportedLocale(resolvedLanguage) ? resolvedLanguage : 'en-US'

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <ApplicationSidebarItem
          active={open}
          className="mona-editor-rail-settings"
          icon={ColorSettings}
          label={t('header.settings')}
        />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={t('header.settings')}
        className="w-68 rounded-overlay p-1 text-xs shadow-[0_10px_30px_rgb(15_23_42_/_13%),0_2px_8px_rgb(15_23_42_/_8%)]"
        collisionPadding={12}
        side="right"
        sideOffset={8}
      >
        <div className="flex items-center gap-2 border-b border-border px-0.5 pt-0.5 pb-2 text-sm font-semibold">
          <Settings className="size-3.5" />
          <span>{t('header.settings')}</span>
        </div>
        <div className="flex items-center gap-4 pt-2.5">
          <span className="flex-1 text-muted-foreground">{t('locale.language')}</span>
          <Select
            onValueChange={locale => {
              if (isSupportedLocale(locale)) void setLocale(locale)
            }}
            value={activeLocale}
          >
            <SelectTrigger
              aria-label={t('locale.language')}
              className="mona-panel-select mona-rail-locale-select relative h-7 w-35 flex-none justify-between rounded-control border-transparent text-start text-control hover:bg-muted"
              icon={<Languages />}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              align="start"
              className="z-[9999] w-max min-w-[var(--radix-select-trigger-width)] max-w-75 rounded-overlay border border-border bg-popover p-0 text-control shadow-[0_6px_16px_rgb(0_0_0_/_8%)]"
              collisionPadding={8}
              position="popper"
              sideOffset={8}
            >
              <SelectGroup>
                {LOCALES.map(locale => (
                  <SelectItem
                    className="flex h-8 w-full items-center overflow-hidden rounded-control px-1.5 text-left text-ellipsis whitespace-nowrap data-[state=checked]:font-bold"
                    key={locale.code}
                    value={locale.code}
                  >
                    {t(locale.labelKey)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </PopoverContent>
    </Popover>
  )
}
