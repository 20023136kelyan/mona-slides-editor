import { createPortal } from 'react-dom'

export function EditorFullscreenSpin({ loading, tip }: { loading: boolean; tip: string }) {
  if (!loading) return null
  return createPortal((
    <div className="mona-fullscreen-spin is-masked">
      <div className="mona-fullscreen-spin-content">
        <div className="mona-fullscreen-spinner" />
        <div className="mona-fullscreen-spin-text">{tip}</div>
      </div>
    </div>
  ), document.body)
}
