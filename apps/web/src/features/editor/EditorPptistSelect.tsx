/* oxlint-disable jsx-a11y/prefer-tag-over-role -- PPTist's Select is a source-matched composite popup, not a native select; the trigger and options retain explicit combobox/listbox semantics. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import DownIcon from '~icons/icon-park-outline/down'

export interface EditorPptistSelectOption {
  disabled?: boolean
  label: string
  value: string
}

export function EditorPptistSelect({
  ariaLabel,
  onChange,
  options,
  value,
}: {
  ariaLabel: string
  onChange: (value: string) => void
  options: readonly EditorPptistSelectOption[]
  value: string
}) {
  const listboxId = `mona-pptist-select-${ariaLabel.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`
  const triggerRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0 })
  const selected = options.find(option => option.value === value)

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPosition({ left: rect.left - 1, top: rect.bottom + 4, width: rect.width + 2 })
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const dismiss = (event: MouseEvent) => {
      if (triggerRef.current?.contains(event.target as Node)) return
      if ((event.target as Element).closest('.mona-pptist-select-options')) return
      setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', dismiss)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', dismiss)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const choose = (option: EditorPptistSelectOption) => {
    if (option.disabled) return
    onChange(option.value)
    setOpen(false)
  }

  const popup = open ? createPortal((
    <div className="mona-pptist-select-popover" style={position}>
      <div className="mona-pptist-select-options" id={listboxId} role="listbox">
        {options.map(option => (
          <div
            aria-disabled={option.disabled || undefined}
            aria-selected={option.value === value}
            className={`mona-pptist-select-option${option.value === value ? ' is-selected' : ''}${option.disabled ? ' is-disabled' : ''}`}
            key={option.value}
            onClick={() => choose(option)}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                choose(option)
              }
            }}
            role="option"
            tabIndex={option.disabled ? -1 : 0}
          >{option.label}</div>
        ))}
      </div>
    </div>
  ), document.body) : null

  return (
    <>
      <div
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-controls={listboxId}
        className="mona-pptist-select"
        onClick={() => setOpen(current => !current)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
          }
          else if (event.key === 'Escape') setOpen(false)
        }}
        ref={triggerRef}
        role="combobox"
        tabIndex={0}
      >
        <div className="mona-pptist-select-value">{selected?.label ?? value}</div>
        <div className="mona-pptist-select-icon"><DownIcon /></div>
      </div>
      {popup}
    </>
  )
}
