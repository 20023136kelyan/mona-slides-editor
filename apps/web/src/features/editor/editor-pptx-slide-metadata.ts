import type { Slide } from '@mona/presentation-core/model'

export interface WritablePptxSlideMetadata {
  hidden?: boolean
}

/**
 * PPTX supports a native hidden-slide flag. Mona's title and duration remain
 * in the lossless .mona/JSON formats because pptxgenjs does not expose the
 * corresponding authored page metadata.
 */
export const applyPptxSlideMetadata = (
  output: WritablePptxSlideMetadata,
  slide: Slide,
): void => {
  output.hidden = Boolean(slide.hidden)
}
