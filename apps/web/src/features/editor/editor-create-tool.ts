import type { LinePoolItem, ShapePoolItem } from '@mona/presentation-core'

export type EditorCreateTool =
  | { type: 'line'; key: 'line'; data: LinePoolItem }
  | { type: 'shape'; key: 'ellipse' | 'shape'; data: ShapePoolItem }
  | { type: 'text'; key: 'text'; vertical: boolean }

export type EditorCreateToolType = EditorCreateTool['type']
