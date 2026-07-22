import { Component, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface BoundaryProps {
  children: ReactNode
  fallback: (reset: () => void) => ReactNode
}

class Boundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error('[mona] editor surface crashed:', error)
  }

  render() {
    if (this.state.failed) return this.props.fallback(() => this.setState({ failed: false }))
    return this.props.children
  }
}

/**
 * Isolates a crash to one editor surface (an inspector panel, the thumbnail
 * rail, a chart canvas, ...) instead of unwinding to the route boundary and
 * taking the in-memory undo stack with it.
 */
export function EditorErrorBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <Boundary
      fallback={reset => (
        <div className="mona-surface-error" role="alert">
          <div className="mona-surface-error-text">{t('foundation.editor.surfaceError')}</div>
          <button className="mona-surface-error-retry" onClick={reset} type="button">{t('foundation.editor.surfaceRetry')}</button>
        </div>
      )}
    >{children}</Boundary>
  )
}
