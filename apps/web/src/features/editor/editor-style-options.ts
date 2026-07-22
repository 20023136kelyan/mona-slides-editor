import type { LineStyleType } from '@mona/presentation-core/model'

export const lineStyleOptions: Array<{ label: string; value: LineStyleType }> = [
  { label: 'Solid', value: 'solid' },
  { label: 'Dashed', value: 'dashed' },
  { label: 'Dotted', value: 'dotted' },
]
