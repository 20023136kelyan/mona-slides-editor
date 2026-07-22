import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function MobileButton({ active = false, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean
  children: ReactNode
}) {
  return (
    <button
      {...props}
      className={`mona-mobile-button${active ? ' is-checked' : ''}${className ? ` ${className}` : ''}`}
      type={props.type || 'button'}
    >{children}</button>
  )
}

export function MobileButtonGroup({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mona-mobile-button-group${className ? ` ${className}` : ''}`}>{children}</div>
}

export function MobileDivider({ margin = 20 }: { margin?: number }) {
  return <i className="mona-mobile-divider is-horizontal" style={{ margin: `${margin}px 0` }} />
}
