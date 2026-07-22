import {
  defaultRichTextAttrs,
  type RichTextAction,
  type RichTextAttrs,
} from '@mona/rich-text'

export interface RichTextEditorController {
  execute: (action: RichTextAction | readonly RichTextAction[], historyKey?: string) => void
  getAttrs: () => RichTextAttrs
}

export interface RichTextRuntimeSnapshot {
  elementId: string | null
  attrs: RichTextAttrs
  formatPainter: TextFormatPainter | null
}

export interface TextFormatPainter {
  keep: boolean
  align?: RichTextAttrs['align']
  backcolor?: string
  bold?: boolean
  color?: string
  em?: boolean
  fontname?: string
  fontsize?: string
  strikethrough?: boolean
  underline?: boolean
}

export interface EditorRichTextRuntime {
  execute: (
    elementId: string,
    action: RichTextAction | readonly RichTextAction[],
    historyKey?: string,
  ) => boolean
  getSnapshot: () => RichTextRuntimeSnapshot
  getFormatPainterSnapshot: () => boolean
  applyFormatPainter: (elementId: string) => boolean
  register: (elementId: string, controller: RichTextEditorController) => () => void
  subscribe: (listener: () => void) => () => void
  sync: (elementId: string) => boolean
  toggleFormatPainter: (keep?: boolean) => void
}

const attrsEqual = (left: RichTextAttrs, right: RichTextAttrs) => (
  Object.keys(left).every(key => (
    left[key as keyof RichTextAttrs] === right[key as keyof RichTextAttrs]
  ))
)

export const createEditorRichTextRuntime = (): EditorRichTextRuntime => {
  const controllers = new Map<string, RichTextEditorController>()
  const listeners = new Set<() => void>()
  let snapshot: RichTextRuntimeSnapshot = {
    elementId: null,
    attrs: defaultRichTextAttrs,
    formatPainter: null,
  }

  const publish = (elementId: string, attrs: RichTextAttrs) => {
    if (snapshot.elementId === elementId && attrsEqual(snapshot.attrs, attrs)) return
    snapshot = { ...snapshot, elementId, attrs }
    for (const listener of listeners) listener()
  }

  const sync = (elementId: string) => {
    const controller = controllers.get(elementId)
    if (!controller) return false
    publish(elementId, controller.getAttrs())
    return true
  }

  return {
    applyFormatPainter: elementId => {
      const controller = controllers.get(elementId)
      const painter = snapshot.formatPainter
      if (!controller || !painter) return false
      const { keep, ...format } = painter
      const actions: RichTextAction[] = [{ command: 'clear' }]
      for (const [command, value] of Object.entries(format) as Array<[
        Exclude<keyof TextFormatPainter, 'keep'>,
        boolean | string | undefined,
      ]>) {
        if (value === true) actions.push({ command })
        else if (value) actions.push({ command, value })
      }
      controller.execute(actions)
      if (!keep) {
        snapshot = { ...snapshot, formatPainter: null }
        for (const listener of listeners) listener()
      }
      return true
    },
    execute: (elementId, action, historyKey) => {
      const controller = controllers.get(elementId)
      if (!controller) return false
      controller.execute(action, historyKey)
      sync(elementId)
      return true
    },
    getFormatPainterSnapshot: () => Boolean(snapshot.formatPainter),
    getSnapshot: () => snapshot,
    register: (elementId, controller) => {
      controllers.set(elementId, controller)
      return () => {
        if (controllers.get(elementId) === controller) controllers.delete(elementId)
      }
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    sync,
    toggleFormatPainter: (keep = false) => {
      snapshot = snapshot.formatPainter
        ? { ...snapshot, formatPainter: null }
        : {
          ...snapshot,
          formatPainter: {
            keep,
            align: snapshot.attrs.align,
            backcolor: snapshot.attrs.backcolor,
            bold: snapshot.attrs.bold,
            color: snapshot.attrs.color,
            em: snapshot.attrs.em,
            fontname: snapshot.attrs.fontname,
            fontsize: snapshot.attrs.fontsize,
            strikethrough: snapshot.attrs.strikethrough,
            underline: snapshot.attrs.underline,
          },
        }
      for (const listener of listeners) listener()
    },
  }
}
