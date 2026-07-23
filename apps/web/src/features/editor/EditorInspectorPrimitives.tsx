import { useState, type CSSProperties, type ReactNode } from 'react'

import DownIcon from '~icons/icon-park-outline/down'
import PaletteIcon from '~icons/icon-park-outline/platte'

import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { EditorColorPicker } from '@/features/editor/EditorColorPicker'
import { cn } from '@/lib/utils'

export interface InspectorOption<T extends number | string> {
  disabled?: boolean
  label: string
  value: T
}

export function InspectorCheckbox({
  checked,
  children,
  className,
  onChange,
  style,
}: {
  checked: boolean
  children: ReactNode
  className?: string
  onChange: (value: boolean) => void
  style?: CSSProperties
}) {
  return (
    <label className={cn('mona-inspector-checkbox', className)} style={style}>
      <Checkbox checked={checked} onCheckedChange={value => onChange(value === true)} />
      <span>{children}</span>
    </label>
  )
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
    <Button
      aria-label={ariaLabel}
      aria-pressed={active}
      className={cn('mona-panel-button', active && 'is-active', className)}
      disabled={disabled}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={style}
      title={ariaLabel}
      size="editor"
      variant="editor"
    >
      {children}
    </Button>
  )
}

export function InspectorButtonGroup({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <ButtonGroup className={cn('mona-panel-button-group', className)}>{children}</ButtonGroup>
}

export function InspectorPopoverButton({
  active = false,
  ariaLabel,
  children,
  className = '',
  content,
  onOpenChange,
  open,
  style,
}: {
  ariaLabel: string
  active?: boolean
  children: ReactNode
  className?: string
  content: ReactNode
  onOpenChange?: (open: boolean) => void
  open?: boolean
  style?: CSSProperties
}) {
  const triggerClassName = cn('mona-panel-button mona-panel-popover-trigger', active && 'is-active', className)
  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <PopoverTrigger asChild>
        <Button aria-label={ariaLabel} aria-pressed={active} className={triggerClassName} size="editor" style={style} title={ariaLabel} variant="editor">
          {children}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        className="mona-panel-popover-content"
        collisionPadding={5}
        onCloseAutoFocus={event => event.preventDefault()}
        onFocusOutside={event => event.preventDefault()}
        side="bottom"
        sideOffset={8}
      >
        {content}
      </PopoverContent>
    </Popover>
  )
}

export function InspectorPopoverClose({ children }: { children: ReactNode }) {
  return <PopoverClose asChild>{children}</PopoverClose>
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
  const [open, setOpen] = useState(false)
  const triggerLabel = renderLabel ? renderLabel(selectedOption) : label

  if (!search) {
    return (
      <Select
        onValueChange={next => {
          const option = options.find(candidate => String(candidate.value) === next)
          if (option) onChange(option.value)
        }}
        value={String(value)}
      >
        <SelectTrigger
          aria-label={ariaLabel}
          className={cn('mona-panel-select', className)}
          icon={icon}
          style={style}
        >
          <SelectValue className="mona-panel-select-label">{triggerLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start" className="mona-panel-select-popover" collisionPadding={8} position="popper" sideOffset={8}>
          {options.map(option => (
            <SelectItem
              className="mona-panel-select-option"
              disabled={option.disabled}
              key={String(option.value)}
              value={String(option.value)}
            >
              {renderOption ? renderOption(option) : option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-label={ariaLabel}
          className={cn('mona-panel-select', className)}
          size="editor"
          style={style}
          variant="outline"
        >
          <span className="mona-panel-select-label">{triggerLabel}</span>
          <span aria-hidden="true" className="mona-panel-select-icon">{icon ?? <DownIcon />}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="mona-panel-select-popover p-0" collisionPadding={8} side="bottom" sideOffset={8}>
        <Command>
          <CommandInput aria-label={searchLabel} placeholder={searchLabel} />
          <CommandList className="mona-panel-select-options">
            <CommandEmpty>{searchLabel}</CommandEmpty>
            <CommandGroup>
              {options.map(option => (
                <CommandItem
                  aria-selected={option.value === value}
                  className={cn('mona-panel-select-option', option.value === value && 'is-selected')}
                  data-checked={option.value === value}
                  disabled={option.disabled}
                  key={String(option.value)}
                  onSelect={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                  value={`${option.label} ${String(option.value)}`}
                >
                  {renderOption ? renderOption(option) : option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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
  const [editState, setEditState] = useState({ baseValue: value, draft: String(value) })
  const [focused, setFocused] = useState(false)
  const draft = editState.baseValue === value ? editState.draft : String(value)
  const setDraft = (next: string) => setEditState({ baseValue: value, draft: next })
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
        <Input
          aria-label={ariaLabel}
          className="mona-panel-number-input"
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
          <Button aria-label={`${ariaLabel} increase`} disabled={disabled} onClick={() => increment(1)} size="icon-xs" variant="ghost">
            <svg fill="currentColor" height="1em" viewBox="64 64 896 896" width="1em"><path d="M890.5 755.3L537.9 269.2c-12.8-17.6-39-17.6-51.7 0L133.5 755.3A8 8 0 00140 768h75c5.1 0 9.9-2.5 12.9-6.6L512 369.8l284.1 391.6c3 4.1 7.8 6.6 12.9 6.6h75c6.5 0 10.3-7.4 6.5-12.7z" /></svg>
          </Button>
          <Button aria-label={`${ariaLabel} decrease`} disabled={disabled} onClick={() => increment(-1)} size="icon-xs" variant="ghost">
            <svg fill="currentColor" height="1em" viewBox="64 64 896 896" width="1em"><path d="M884 256h-75c-5.1 0-9.9 2.5-12.9 6.6L512 654.2 227.9 262.6c-3-4.1-7.8-6.6-12.9-6.6h-75c-6.5 0-10.3 7.4-6.5 12.7l352.6 486.1c12.8 17.6 39 17.6 51.7 0l352.6-486.1c3.9-5.3.1-12.7-6.4-12.7z" /></svg>
          </Button>
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
  const [dragState, setDragState] = useState<{ baseValue: number; draftValue: number } | null>(null)
  const draftValue = dragState?.baseValue === value ? dragState.draftValue : value
  return (
    <Slider
      aria-label={ariaLabel}
      className="mona-panel-slider"
      getValueLabel={current => String(current)}
      max={max}
      min={min}
      onValueChange={next => setDragState({ baseValue: value, draftValue: next[0] ?? value })}
      onValueCommit={next => {
        setDragState(null)
        onChange(next[0] ?? value)
      }}
      step={step}
      value={[draftValue]}
    />
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
    <Switch
      aria-label={ariaLabel}
      className={`mona-panel-switch${checked ? ' is-active' : ''}`}
      checked={checked}
      onCheckedChange={onChange}
    />
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
