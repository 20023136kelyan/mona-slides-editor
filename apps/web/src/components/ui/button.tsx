import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/80',
        outline:
          'border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        ghost:
          'hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50',
        destructive:
          'bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40',
        link: 'text-primary underline-offset-4 hover:underline',
        editor:
          'border-border bg-background text-foreground hover:bg-muted aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground',
        // Keycap treatment: a shaded face over a 1px cast shadow reads as
        // slightly raised. Pressing drops the shadow while the base class
        // nudges it down a pixel, so the button physically depresses. Every
        // tone is mixed from --foreground/--background, so it inverts in dark.
        'header-pill':
          'border-border bg-[color-mix(in_oklab,var(--foreground)_3%,var(--background))] text-foreground/80 shadow-[0_1px_2px_0_color-mix(in_oklab,var(--foreground)_12%,transparent)] hover:bg-[color-mix(in_oklab,var(--foreground)_6%,var(--background))] hover:text-foreground active:shadow-none aria-pressed:bg-[color-mix(in_oklab,var(--foreground)_10%,var(--background))] aria-pressed:text-foreground aria-pressed:shadow-none aria-expanded:bg-[color-mix(in_oklab,var(--foreground)_10%,var(--background))] aria-expanded:text-foreground aria-expanded:shadow-none',
        // The same keycap on the accent face, for the single affirmative action
        // in a group. A heavier cast than header-pill because the filled face
        // would otherwise swallow a 12% shadow.
        'action-pill':
          'border-transparent bg-primary text-primary-foreground shadow-[0_1px_2px_0_color-mix(in_oklab,var(--foreground)_22%,transparent)] hover:bg-primary/90 active:shadow-none disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none',
        // The keycap a run wears while it can be stopped. Same geometry and
        // raise as the send action it replaces, so only the colour changes and
        // the control does not appear to move.
        'stop-pill':
          'border-transparent bg-destructive text-white shadow-[0_1px_2px_0_color-mix(in_oklab,var(--foreground)_22%,transparent)] hover:bg-[color-mix(in_oklab,var(--destructive),black_8%)] active:shadow-none',
      },
      size: {
        default:
          'h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        icon: 'size-8',
        'icon-xs':
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        'icon-sm':
          'size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg',
        'icon-lg': 'size-9',
        editor: 'h-8 gap-1.5 rounded-control px-2.5 text-control',
        'editor-icon': 'size-8 rounded-control',
        'header-pill':
          'h-7 min-w-7 gap-1 rounded-action px-2 text-xs font-medium [&_svg:not([class*=\'size-\'])]:size-3.5',
        'header-icon':
          'size-7 rounded-action [&_svg:not([class*=\'size-\'])]:size-3.5',
        // Deliberately size-7, matching `header-pill`'s height: send, stop and
        // attach sit in a row with the model button, and three different heights
        // there read as misalignment rather than hierarchy.
        'action-icon':
          'size-7 rounded-action p-0 [&_svg:not([class*=\'size-\'])]:size-3.5',
        chip: 'h-7 gap-1 rounded-pill px-3 text-xs [&_svg:not([class*=\'size-\'])]:size-3.5',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
