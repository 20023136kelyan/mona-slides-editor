import { cn } from '@/lib/utils'

/** Hook class + status-bar item chrome (labels collapse under @container max 1060px). */
export function statusBarItemClassName(active = false) {
  return cn(
    'mona-statusbar-item',
    'flex h-8 items-center gap-1.75 rounded-action px-2.5 text-control font-semibold text-ink/70',
    'hover:bg-ink-deep/6 hover:text-ink-deep',
    '[&_svg]:size-3.75',
    '@max-[1060px]:px-2 @max-[1060px]:[&>span]:hidden',
    active && 'is-active bg-ink-deep/8 text-ink-deep',
  )
}
