import { cloneElement, useEffect, useState, type ReactElement } from 'react'
import tippy from 'tippy.js'

import 'tippy.js/animations/scale.css'

export function ScreenTooltip({
  children,
  content,
}: {
  children: ReactElement<Record<string, unknown>>
  content: string
}) {
  const [target, setTarget] = useState<Element | null>(null)

  useEffect(() => {
    if (!target) return undefined
    const instance = tippy(target, {
      animation: 'scale',
      allowHTML: true,
      content,
      delay: [300, 0],
      duration: 100,
      placement: 'top',
      theme: 'tooltip',
    })
    return () => instance.destroy()
  }, [content, target])

  return cloneElement(children, { ref: setTarget })
}
