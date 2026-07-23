import { cn } from '@/lib/utils'

/** Hook class + status-bar item chrome (labels collapse under @container max 1060px). */
export function statusBarItemClassName(active = false) {
  return cn(
    'mona-statusbar-item',
    'flex h-8 items-center gap-[7px] rounded-[var(--radius-action)] px-2.5 text-[13px] font-semibold text-[rgb(16_18_25/70%)]',
    'hover:bg-[rgb(15_16_21/6%)] hover:text-[rgb(15_16_21)]',
    '[&_svg]:size-[15px]',
    '@max-[1060px]:px-2 @max-[1060px]:[&>span]:hidden',
    active && 'is-active bg-[rgb(15_16_21/8%)] text-[rgb(15_16_21)]',
  )
}
