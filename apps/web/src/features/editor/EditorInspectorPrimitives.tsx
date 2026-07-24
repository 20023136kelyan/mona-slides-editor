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

/** Shared inspector layout recipes (Tailwind-first). */
export const inspectorRowClass = 'flex w-full items-center mb-2.5'
export const inspectorRowFullClass = 'flex w-full items-center mb-2.5'
export const inspectorSplitRowClass = 'grid w-full grid-cols-2 items-center gap-2.5 mb-2.5'
export const inspectorRowLabelClass = 'w-[48%] text-xs'
export const inspectorRowControlClass = 'w-[52%] [&>*]:w-full'
export const inspectorDividerClass = 'my-6 w-full border-t border-black/[0.06]'
export const inspectorButtonGroupClass = 'flex items-center [&_.mona-panel-button]:rounded-none [&_.mona-panel-button]:border-r-0 [&_:first-child]:rounded-l-[var(--radius-control)] [&_:last-child]:rounded-r-[var(--radius-control)] [&_:last-child]:border-r'
export const inspectorSelectGroupClass = 'flex items-center'
export const inspectorSwitchWrapperClass = 'w-full text-right'
export const inspectorPopoverMenuItemClass = 'min-w-20 rounded-[var(--radius-control)] border-0 bg-transparent px-2.5 py-1.5 text-[#333] hover:bg-[#f1f1f1]'
export const inspectorPopoverMenuItemCenteredClass = `${inspectorPopoverMenuItemClass} text-center`

export function InspectorRow({
  children,
  className,
  label,
}: {
  children: ReactNode
  className?: string
  label?: ReactNode
}) {
  if (label == null) {
    return <div className={cn(inspectorRowFullClass, className)}>{children}</div>
  }
  return (
    <div className={cn(inspectorRowClass, className)}>
      <div className={inspectorRowLabelClass}>{label}</div>
      <div className={inspectorRowControlClass}>{children}</div>
    </div>
  )
}

export function InspectorSection({
  children,
  className,
  title,
}: {
  children: ReactNode
  className?: string
  title?: ReactNode
}) {
  return (
    <div className={cn('w-full', className)}>
      {title ? <div className="mb-2 text-xs font-semibold text-foreground">{title}</div> : null}
      {children}
    </div>
  )
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
    <label className={cn('flex h-5 cursor-pointer items-center text-[13px] leading-5 select-none [&>span:last-child]:ml-1.5', className)} style={style}>
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
      className={cn('mona-panel-button tracking-wide', className)}
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
  return <ButtonGroup className={cn(inspectorButtonGroupClass, className)}>{children}</ButtonGroup>
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
  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-label={ariaLabel}
          aria-pressed={active}
          className={cn('mona-panel-button tracking-wide', className)}
          size="editor"
          style={style}
          title={ariaLabel}
          variant="editor"
        >
          {children}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label={ariaLabel}
        align="center"
        className="z-[9999] w-max max-w-[300px] rounded-[var(--radius-overlay)] border border-border bg-popover p-0 text-[13px] text-popover-foreground shadow-[0_6px_16px_rgb(0_0_0_/_8%)]"
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
  const triggerClass = cn(
    'mona-panel-select relative h-8 w-full justify-between rounded-[var(--radius-control)] text-start text-[13px]',
    className,
  )

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
          className={triggerClass}
          icon={icon}
          style={style}
        >
          <SelectValue className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{triggerLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent
          align="start"
          className="z-[9999] w-max min-w-[var(--radix-select-trigger-width)] max-w-[300px] rounded-[var(--radius-overlay)] border border-border bg-popover p-0 text-[13px] shadow-[0_6px_16px_rgb(0_0_0_/_8%)]"
          collisionPadding={8}
          position="popper"
          sideOffset={8}
        >
          {options.map(option => (
            <SelectItem
              className="flex h-8 w-full items-center overflow-hidden rounded-[var(--radius-control)] px-1.5 text-left text-ellipsis whitespace-nowrap data-[state=checked]:font-bold"
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
          className={triggerClass}
          size="editor"
          style={style}
          variant="outline"
        >
          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">{triggerLabel}</span>
          <span aria-hidden="true" className="flex items-center justify-center text-muted-foreground">{icon ?? <DownIcon />}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label={ariaLabel}
        align="start"
        className="z-[9999] w-max min-w-[var(--radix-popover-trigger-width)] max-w-[300px] rounded-[var(--radius-overlay)] border border-border bg-popover p-0 text-[13px] shadow-[0_6px_16px_rgb(0_0_0_/_8%)]"
        collisionPadding={8}
        side="bottom"
        sideOffset={8}
      >
        <Command>
          <CommandInput aria-label={searchLabel} placeholder={searchLabel} />
          <CommandList className="max-h-[260px] overflow-auto p-1.5 text-left text-[13px] select-none">
            <CommandEmpty>{searchLabel}</CommandEmpty>
            <CommandGroup>
              {options.map(option => (
                <CommandItem
                  aria-selected={option.value === value}
                  className={cn(
                    'flex h-8 w-full items-center overflow-hidden rounded-[var(--radius-control)] px-1.5 text-left text-ellipsis whitespace-nowrap',
                    option.value === value && 'font-bold',
                  )}
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
    <div
      className={cn(
        'mona-panel-number inline-flex h-8 min-w-0 items-center rounded-[var(--radius-control)] border border-input bg-background pl-1.5 text-[13px] transition-[border-color]',
        focused && 'border-ring',
        !disabled && !focused && 'hover:border-ring',
        disabled && 'opacity-50',
      )}
      style={style}
    >
      {label ? <span className="mona-panel-number-prefix min-w-0 flex-[0_1_auto] overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-[30px]">{label}</span> : null}
      <span className="mona-panel-number-input-wrap relative min-w-9 flex-1 pl-1.5 text-[#41464b]">
        <Input
          aria-label={ariaLabel}
          className="h-full min-w-0 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
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
        <span className="absolute top-0 right-0 flex h-full flex-col">
          <Button aria-label={`${ariaLabel} increase`} className="h-1/2 w-5 rounded-none p-0" disabled={disabled} onClick={() => increment(1)} size="icon-xs" variant="ghost">
            <svg fill="currentColor" height="1em" viewBox="64 64 896 896" width="1em"><path d="M890.5 755.3L537.9 269.2c-12.8-17.6-39-17.6-51.7 0L133.5 755.3A8 8 0 00140 768h75c5.1 0 9.9-2.5 12.9-6.6L512 369.8l284.1 391.6c3 4.1 7.8 6.6 12.9 6.6h75c6.5 0 10.3-7.4 6.5-12.7z" /></svg>
          </Button>
          <Button aria-label={`${ariaLabel} decrease`} className="h-1/2 w-5 rounded-none p-0" disabled={disabled} onClick={() => increment(-1)} size="icon-xs" variant="ghost">
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
      className="w-full"
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
      checked={checked}
      onCheckedChange={onChange}
    />
  )
}

const checkerBg = 'url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAAXNSR0IArs4c6QAAAEBJREFUOE9jfPbs2X8GIoCkpCQRqhgYGEcNxBlOo2GIM2iGQLL5//8/UTnl+fPnxOWUUQNxhtNoGOLOKYM+2QAAh2Nq10DwkukAAAAASUVORK5CYII=)'
const stripBg = 'url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAAXNSR0IArs4c6QAAACdJREFUGFdjfPbs2X8GBgYGSUlJEMXAiCHw//9/sIrnz59DVKALAADNxxVfaiODNQAAAABJRU5ErkJggg==)'

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
      className={cn(
        'relative flex h-8 items-center justify-center border border-[#d9d9d9] bg-white p-0 text-[#41464b] hover:border-[var(--editor-selection)] hover:text-[var(--editor-selection)]',
        icon ? 'flex-col' : 'flex-row',
      )}
      content={<EditorColorPicker onChange={onChange} value={color || '#000000'} />}
      onOpenChange={setOpen}
      open={open}
      style={style}
    >
      {icon ? (
        <>
          {icon}
          <span className="mt-px h-1 w-[17px]" style={{ backgroundImage: stripBg }}>
            <span className="block size-full" style={{ backgroundColor: color }} />
          </span>
        </>
      ) : (
        <>
          <span
            className="ml-2 h-5 flex-1 outline outline-1 outline-[rgb(102_102_102_/_12%)]"
            style={{ backgroundImage: checkerBg }}
          >
            <span className="block size-full" style={{ backgroundColor: color }} />
          </span>
          <span className="flex w-8 items-center justify-center text-[13px] text-[#bfbfbf] [&_svg]:w-8">
            <PaletteIcon />
          </span>
        </>
      )}
    </InspectorPopoverButton>
  )
}
