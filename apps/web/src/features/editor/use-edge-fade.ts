import { useEffect, type RefObject } from 'react'

// Marks a scroller with data-fade-start / data-fade-end while content is cut
// off on that side, so CSS can fade the clipped edge instead of hard-cutting
// it. `refresh` re-arms the effect when the scroller (re)mounts or its
// content is swapped wholesale.
export function useEdgeFade(ref: RefObject<HTMLElement | null>, axis: 'x' | 'y', refresh?: unknown) {
  useEffect(() => {
    const node = ref.current
    if (!node) return undefined
    const update = () => {
      const start = axis === 'x' ? node.scrollLeft : node.scrollTop
      const viewport = axis === 'x' ? node.clientWidth : node.clientHeight
      const total = axis === 'x' ? node.scrollWidth : node.scrollHeight
      node.toggleAttribute('data-fade-start', start > 1)
      node.toggleAttribute('data-fade-end', start + viewport < total - 1)
    }
    update()
    node.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(node)
    for (const child of node.children) observer.observe(child)
    const mutations = new MutationObserver(() => {
      update()
      for (const child of node.children) observer.observe(child)
    })
    mutations.observe(node, { childList: true })
    return () => {
      node.removeEventListener('scroll', update)
      observer.disconnect()
      mutations.disconnect()
    }
  }, [axis, ref, refresh])
}
