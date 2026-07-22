import { useEffect, useState } from 'react'

import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { MobileEditor } from '@/features/mobile/MobileEditor'
import { MobilePlayer } from '@/features/mobile/MobilePlayer'
import { MobilePreview } from '@/features/mobile/MobilePreview'

import './mobile.css'

export type MobileMode = 'editor' | 'player' | 'preview'

export function MobileView({ runtime }: { runtime: EditorRuntime }) {
  const [mode, setMode] = useState<MobileMode>('preview')

  useEffect(() => {
    if (!import.meta.env.DEV) return undefined
    const bridge = Object.freeze({
      getHistoryState: runtime.getHistoryState,
      getRichTextState: runtime.richText.getSnapshot,
      getShapeFormatPainterState: runtime.shapeFormatPainter.getSnapshot,
      getState: () => structuredClone(runtime.store.getState()),
      isReady: () => true,
    })
    window.__MONA_REACT_TEST__ = bridge
    return () => {
      if (window.__MONA_REACT_TEST__ === bridge) delete window.__MONA_REACT_TEST__
    }
  }, [runtime])

  return (
    <div className="mona-mobile" data-mobile-mode={mode}>
      {mode === 'preview' ? <MobilePreview changeMode={setMode} runtime={runtime} /> : null}
      {mode === 'editor' ? <MobileEditor changeMode={setMode} runtime={runtime} /> : null}
      {mode === 'player' ? <MobilePlayer changeMode={setMode} runtime={runtime} /> : null}
    </div>
  )
}
