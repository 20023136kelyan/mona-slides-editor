/* oxlint-disable jsx-a11y/prefer-tag-over-role -- PPTist's custom slider DOM and commit-on-release interaction are required for parity. */
import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

import DownIcon from '~icons/icon-park-outline/down'
import PaletteIcon from '~icons/icon-park-outline/platte'
import NP from 'number-precision'
import { Popover as PopoverPrimitive } from 'radix-ui'

import { EditorColorPicker } from '@/features/editor/EditorColorPicker'

// Values are clamped before slider arithmetic. number-precision's optional
// diagnostic can nevertheless fire while it scales valid decimals to an
// internal integer, so silence that diagnostic without changing the result.
NP.enableBoundaryChecking(false)

export interface InspectorOption<T extends number | string> {
  disabled?: boolean
  label: string
  value: T
}

export function InspectorButton({
  active = false,
  ariaLabel,
  children,
  className = '',
  disabled = false,
  onClick,
  onDoubleClick,
  style,
}: {
  active?: boolean
  ariaLabel: string
  children: ReactNode
  className?: string
  disabled?: boolean
  onClick?: () => void
  onDoubleClick?: () => void
  style?: CSSProperties
}) {
  return (
    <button
      aria-label={ariaLabel}
      aria-pressed={active}
      className={`mona-panel-button${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
      disabled={disabled}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={style}
      title={ariaLabel}
      type="button"
    >
      {children}
    </button>
  )
}

export function InspectorButtonGroup({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`mona-panel-button-group${className ? ` ${className}` : ''}`}>{children}</div>
}

export function InspectorPopoverButton({
  active = false,
  ariaLabel,
  asDiv = false,
  children,
  className = '',
  content,
  onOpenChange,
  open,
  style,
}: {
  ariaLabel: string
  active?: boolean
  asDiv?: boolean
  children: ReactNode
  className?: string
  content: ReactNode
  onOpenChange?: (open: boolean) => void
  open?: boolean
  style?: CSSProperties
}) {
  const triggerClassName = `mona-panel-button mona-panel-popover-trigger${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`
  return (
    <PopoverPrimitive.Root onOpenChange={onOpenChange} open={open}>
      {asDiv ? (
        <PopoverPrimitive.Trigger asChild>
          <div
            aria-label={ariaLabel}
            aria-pressed={active}
            className={triggerClassName}
            role="button"
            style={style}
            tabIndex={0}
            title={ariaLabel}
          >
            {children}
          </div>
        </PopoverPrimitive.Trigger>
      ) : (
        <PopoverPrimitive.Trigger
          aria-label={ariaLabel}
          aria-pressed={active}
          className={triggerClassName}
          style={style}
          title={ariaLabel}
          type="button"
        >
          {children}
        </PopoverPrimitive.Trigger>
      )}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="center"
          className="mona-panel-popover-content"
          collisionPadding={5}
          onCloseAutoFocus={event => event.preventDefault()}
          onFocusOutside={event => event.preventDefault()}
          side="bottom"
          sideOffset={8}
        >
          {content}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

export function InspectorPopoverClose({ children }: { children: ReactNode }) {
  return <PopoverPrimitive.Close asChild>{children}</PopoverPrimitive.Close>
}

export function InspectorSelect<T extends number | string>({
  ariaLabel,
  className = '',
  icon,
  onChange,
  options,
  renderLabel,
  renderOption,
  search = false,
  searchLabel = '',
  style,
  value,
}: {
  ariaLabel: string
  className?: string
  icon?: ReactNode
  onChange: (value: T) => void
  options: readonly InspectorOption<T>[]
  renderLabel?: (option: InspectorOption<T> | undefined) => ReactNode
  renderOption?: (option: InspectorOption<T>) => ReactNode
  search?: boolean
  searchLabel?: string
  style?: CSSProperties
  value: T
}) {
  const selectedOption = options.find(option => option.value === value)
  const label = selectedOption?.label ?? String(value)
  const [query, setQuery] = useState('')
  const visibleOptions = search && query.trim()
    ? options.filter(option => option.label.toLowerCase().includes(query.toLowerCase()))
    : options
  return (
    <PopoverPrimitive.Root onOpenChange={open => {
      if (!open) setQuery('') 
    }}>
      <PopoverPrimitive.Trigger asChild>
        <div
          aria-label={ariaLabel}
          className={`mona-panel-select${className ? ` ${className}` : ''}`}
          onKeyDown={event => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            event.currentTarget.click()
          }}
          role="button"
          style={style}
          tabIndex={0}
        >
          <div className="mona-panel-select-label">{renderLabel ? renderLabel(selectedOption) : label}</div>
          <div aria-hidden="true" className="mona-panel-select-icon">
            {icon ?? <DownIcon />}
          </div>
        </div>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          className="mona-panel-select-popover"
          collisionPadding={8}
          side="bottom"
          sideOffset={8}
        >
          {search ? (
            <>
              <div className="mona-panel-select-search">
                <input
                  aria-label={searchLabel}
                  onChange={event => setQuery(event.target.value)}
                  placeholder={searchLabel}
                  value={query}
                />
              </div>
              <div className="mona-panel-select-divider" />
            </>
          ) : null}
          <div className="mona-panel-select-options">
            {(visibleOptions.length ? visibleOptions : options).map(option => (
              <PopoverPrimitive.Close asChild key={String(option.value)}>
                <button
                  aria-label={option.label}
                  aria-pressed={option.value === value}
                  className={`mona-panel-select-option${option.value === value ? ' is-selected' : ''}`}
                  disabled={option.disabled}
                  onClick={() => onChange(option.value)}
                  type="button"
                >
                  {renderOption ? renderOption(option) : option.label}
                </button>
              </PopoverPrimitive.Close>
            ))}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

export function InspectorNumberInput({
  ariaLabel,
  disabled = false,
  label,
  max = Number.POSITIVE_INFINITY,
  min = Number.NEGATIVE_INFINITY,
  onChange,
  onEnter,
  step = 1,
  style,
  value,
}: {
  ariaLabel: string
  disabled?: boolean
  label?: string
  max?: number
  min?: number
  onChange: (value: number) => void
  onEnter?: (value: number) => void
  step?: number
  style?: CSSProperties
  value: number
}) {
  const [draft, setDraft] = useState(String(value))
  const [previousValue, setPreviousValue] = useState(value)
  const [focused, setFocused] = useState(false)
  if (value !== previousValue) {
    // Vue's NumberInput watches external value changes even while focused.
    // Keep an in-progress equivalent draft, but accept gesture-driven parent
    // updates so a later blur cannot restore a stale pre-drag value.
    setPreviousValue(value)
    if (value !== Number(draft)) setDraft(String(value))
  }
  const normalize = (candidate: string | number) => {
    let next = Number(candidate)
    if (Number.isNaN(next)) next = min
    else if (next > max) next = max
    else if (next < min) next = min
    setDraft(String(next))
    onChange(next)
    return next
  }
  const updateDraft = (candidate: string) => {
    setDraft(candidate)
    const next = Number(candidate)
    if (Number.isNaN(next) || next > max || next < min) return
    onChange(next)
  }
  const increment = (direction: 1 | -1) => {
    if (disabled) return
    const next = Number(focused ? draft : value) + (step * direction)
    setDraft(String(next))
    if (!Number.isNaN(next) && next <= max && next >= min) onChange(next)
  }
  return (
    <div className={`mona-panel-number${focused ? ' is-focused' : ''}${disabled ? ' is-disabled' : ''}`} style={style}>
      {label ? <span className="mona-panel-number-prefix">{label}</span> : null}
      <span className="mona-panel-number-input-wrap">
        <input
          aria-label={ariaLabel}
          disabled={disabled}
          onBlur={() => {
            normalize(draft)
            setFocused(false)
          }}
          onChange={event => updateDraft(event.target.value)}
          onFocus={() => {
            setDraft(String(value))
            setFocused(true)
          }}
          onKeyDown={event => {
            if (event.key === 'Enter') onEnter?.(normalize(draft))
          }}
          type="text"
          value={draft}
        />
        <span className="mona-panel-number-handlers">
          <button aria-label={`${ariaLabel} increase`} disabled={disabled} onClick={() => increment(1)} type="button">
            <svg fill="currentColor" height="1em" viewBox="64 64 896 896" width="1em"><path d="M890.5 755.3L537.9 269.2c-12.8-17.6-39-17.6-51.7 0L133.5 755.3A8 8 0 00140 768h75c5.1 0 9.9-2.5 12.9-6.6L512 369.8l284.1 391.6c3 4.1 7.8 6.6 12.9 6.6h75c6.5 0 10.3-7.4 6.5-12.7z" /></svg>
          </button>
          <button aria-label={`${ariaLabel} decrease`} disabled={disabled} onClick={() => increment(-1)} type="button">
            <svg fill="currentColor" height="1em" viewBox="64 64 896 896" width="1em"><path d="M884 256h-75c-5.1 0-9.9 2.5-12.9 6.6L512 654.2 227.9 262.6c-3-4.1-7.8-6.6-12.9-6.6h-75c-6.5 0-10.3 7.4-6.5 12.7l352.6 486.1c12.8 17.6 39 17.6 51.7 0l352.6-486.1c3.9-5.3.1-12.7-6.4-12.7z" /></svg>
          </button>
        </span>
      </span>
    </div>
  )
}

export function InspectorSlider({
  ariaLabel,
  max = 100,
  min = 0,
  onChange,
  step = 1,
  value,
}: {
  ariaLabel: string
  max?: number
  min?: number
  onChange: (value: number) => void
  step?: number
  value: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [dragPercentage, setDragPercentage] = useState<number | null>(null)
  const clampPercentage = (candidate: number) => Math.min(Math.max(candidate, 0), 100)
  const valuePercentage = max === min ? 0 : clampPercentage(((value - min) / (max - min)) * 100)
  const percentage = dragPercentage ?? valuePercentage
  const getPercentage = (clientX: number) => {
    const element = ref.current
    if (!element) return 0
    let progress = (clientX - element.getBoundingClientRect().left) / element.clientWidth
    progress = Math.max(0, Math.min(1, progress))
    let next = progress * 100
    const percentageStep = (step / (max - min)) * 100
    const remainder = next % percentageStep
    if (remainder > 0) next = remainder <= percentageStep / 2 ? next - remainder : next - remainder + percentageStep
    return next
  }
  const getNewValue = (candidate: number) => {
    let difference = (candidate / 100) * (max - min)
    if (step >= 1) difference = Math.fround(difference)
    else {
      const match = step.toString().match(/^[0.]*([1-9])/)
      if (match) {
        const position = step.toString().indexOf(match[1]!) - 1
        if (position > 0) {
          const accuracy = 10 ** position
          difference = Math.fround(difference * accuracy) / accuracy
        }
      }
    }
    return NP.plus(difference, min)
  }
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const update = (pointer: PointerEvent) => setDragPercentage(getPercentage(pointer.clientX))
    const stop = (pointer: PointerEvent) => {
      const next = getPercentage(pointer.clientX)
      setDragPercentage(null)
      onChange(getNewValue(next))
      document.removeEventListener('pointermove', update)
      document.removeEventListener('pointerup', stop)
    }
    document.addEventListener('pointermove', update)
    document.addEventListener('pointerup', stop)
  }
  return (
    <div
      aria-label={ariaLabel}
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={getNewValue(percentage)}
      className="mona-panel-slider"
      onPointerDown={handlePointerDown}
      ref={ref}
      role="slider"
      tabIndex={0}
    >
      <div className="mona-panel-slider-bar">
        <div className="mona-panel-slider-track" style={{ width: `${percentage}%` }} />
        <div className="mona-panel-slider-thumb" data-tooltip={getNewValue(percentage)} style={{ left: `${percentage}%` }} />
      </div>
    </div>
  )
}

export function InspectorSwitch({
  ariaLabel,
  checked,
  onChange,
}: {
  ariaLabel: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button
      aria-label={ariaLabel}
      aria-checked={checked}
      className={`mona-panel-switch${checked ? ' is-active' : ''}`}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span />
    </button>
  )
}

export function InspectorColorButton({
  ariaLabel,
  color,
  icon,
  onChange,
  style,
}: {
  ariaLabel: string
  color: string
  icon?: ReactNode
  onChange: (value: string) => void
  style?: CSSProperties
}) {
  const [open, setOpen] = useState(false)
  return (
    <InspectorPopoverButton
      ariaLabel={ariaLabel}
      className={`mona-panel-color-button${icon ? ' is-text-color' : ''}`}
      content={<EditorColorPicker onChange={onChange} value={color || '#000000'} />}
      onOpenChange={setOpen}
      open={open}
      style={style}
    >
      {icon ? (
        <>
          {icon}
          <span className="mona-panel-text-color-strip"><span style={{ backgroundColor: color }} /></span>
        </>
      ) : (
        <>
          <span className="mona-panel-color-swatch"><span style={{ backgroundColor: color }} /></span>
          <span className="mona-panel-color-palette"><PaletteIcon /></span>
        </>
      )}
    </InspectorPopoverButton>
  )
}
