import type { ComponentProps, ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'

export function MobileButton({ active = false, children, className = '', ...props }: ComponentProps<typeof Button> & {
  active?: boolean
  children: ReactNode
}) {
  return (
    <Button
      {...props}
      aria-pressed={active}
      className={`mona-mobile-button${active ? ' is-checked' : ''}${className ? ` ${className}` : ''}`}
      size={props.size || 'editor'}
      type={props.type || 'button'}
      variant={props.variant || 'outline'}
    >{children}</Button>
  )
}

export function MobileButtonGroup({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <ButtonGroup className={`mona-mobile-button-group${className ? ` ${className}` : ''}`}>{children}</ButtonGroup>
}

export function MobileDivider({ margin = 20 }: { margin?: number }) {
  return <i className="mona-mobile-divider is-horizontal" style={{ margin: `${margin}px 0` }} />
}
