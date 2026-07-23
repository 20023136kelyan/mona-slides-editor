import { describe, expect, it } from 'vitest'

import { applyPptxSlideMetadata } from '@/features/editor/editor-pptx-slide-metadata'

describe('PowerPoint page metadata export', () => {
  it('writes the native hidden-slide flag for hidden and visible pages', () => {
    const hidden: { hidden?: boolean } = {}
    const visible: { hidden?: boolean } = {}

    applyPptxSlideMetadata(hidden, { id: 'hidden', elements: [], hidden: true })
    applyPptxSlideMetadata(visible, { id: 'visible', elements: [] })

    expect(hidden.hidden).toBe(true)
    expect(visible.hidden).toBe(false)
  })
})
