import type { CSSProperties, MouseEventHandler, PointerEventHandler, ReactNode } from 'react'

import type { PPTTextElement } from '@mona/presentation-core/model'

import { ElementOutline } from '@/features/presentation-renderer/elements/ElementOutline'
import {
  getShadowStyle,
  type SlideCSSProperties,
} from '@/features/presentation-renderer/render-utils'

export interface TextElementEditor {
  content: ReactNode
  onContextMenu: MouseEventHandler<HTMLDivElement>
  onPointerDown: PointerEventHandler<HTMLDivElement>
}

interface TextElementProps {
  editor?: TextElementEditor
  element: PPTTextElement
  thumbnail?: boolean
}

const verticalAlignment: Record<NonNullable<PPTTextElement['vAlign']>, CSSProperties['justifyContent']> = {
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end',
}

export function TextElement({ editor, element, thumbnail = false }: TextElementProps) {
  const inset = element.inset || [10, 10, 10, 10]
  const shadow = getShadowStyle(element.shadow)
  const contentStyle: SlideCSSProperties = {
    width: element.vertical && !element.fixedHeight ? 'auto' : `${element.width}px`,
    height: !element.vertical && !element.fixedHeight ? 'auto' : `${element.height}px`,
    backgroundColor: element.fill,
    opacity: element.opacity,
    textShadow: shadow,
    lineHeight: element.lineHeight,
    letterSpacing: `${element.wordSpace || 0}px`,
    color: element.defaultColor,
    fontFamily: element.defaultFontName,
    writingMode: element.vertical ? 'vertical-rl' : 'horizontal-tb',
    padding: `${inset[0]}px ${inset[1]}px ${inset[2]}px ${inset[3]}px`,
    display: element.fixedHeight ? 'flex' : undefined,
    flexDirection: element.fixedHeight ? 'column' : undefined,
    justifyContent: element.fixedHeight ? verticalAlignment[element.vAlign || 'top'] : undefined,
    '--paragraphSpace': `${element.paragraphSpace === undefined ? 5 : element.paragraphSpace}px`,
  }
  const markup = { __html: element.content }

  return (
    <div
      className="mona-element mona-text-element"
      data-element-id={element.id}
      data-element-type="text"
      style={{
        top: element.top,
        left: element.left,
        width: element.width,
        height: element.height,
      }}
    >
      <div className="mona-rotate-wrapper" style={{ transform: `rotate(${element.rotate}deg)` }}>
        <div
          className={`mona-text-content${element.lock ? ' is-locked' : ''}`}
          onContextMenu={editor?.onContextMenu}
          onPointerDown={editor?.onPointerDown}
          style={contentStyle}
        >
          <ElementOutline height={element.height} outline={element.outline} width={element.width} />
          {editor?.content ?? (
            <div
              className={`mona-rich-text ProseMirror-static${thumbnail ? ' is-thumbnail' : ''}`}
              dangerouslySetInnerHTML={markup}
            />
          )}
          {editor ? (
            <>
              <div aria-hidden="true" className="mona-text-drag-handler is-top" />
              <div aria-hidden="true" className="mona-text-drag-handler is-bottom" />
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
