import { flushSync } from 'react-dom'

type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => unknown
}

/**
 * Runs a discrete slide-navigation update inside a scoped View Transition
 * where the platform supports it (Chromium 111+, Safari 18+, Firefox 144+).
 * Everywhere else — and for users preferring reduced motion — the update
 * applies instantly, exactly as before. The animation is scoped to the
 * canvas frame via view-transition-name in editor.css; the page root opts
 * out so the rest of the UI never crossfades.
 */
export const navigateWithSlideTransition = (update: () => void) => {
  const doc = document as DocumentWithViewTransition
  if (
    typeof doc.startViewTransition !== 'function' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    update()
    return
  }
  const transition = doc.startViewTransition(() => {
    // The browser snapshots the before/after states around this callback, so
    // the React commit must land synchronously inside it.
    flushSync(update)
  }) as {
    finished?: Promise<unknown>
    ready?: Promise<unknown>
    updateCallbackDone?: Promise<unknown>
  }
  // Skipped transitions (interrupted by a newer one, or torn down mid-test)
  // reject with AbortError. Use name checks — `instanceof DOMException` can
  // fail across vitest-browser realms and leave the rejection unhandled.
  const ignoreSkipped = (error: unknown) => {
    if (error && typeof error === 'object' && 'name' in error && (error as { name: string }).name === 'AbortError') return
    console.error(error)
  }
  void transition.updateCallbackDone?.catch(ignoreSkipped)
  void transition.ready?.catch(ignoreSkipped)
  void transition.finished?.catch(ignoreSkipped)
}
