import type { PPTImageElement, PresentationCommand, PresentationState } from '@mona/presentation-core'

export const fileToDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(reader.error ?? new Error('Unable to read image file'))
  reader.onload = () => typeof reader.result === 'string'
    ? resolve(reader.result)
    : reject(new Error('Image file did not produce a data URL'))
  reader.readAsDataURL(file)
})

export const getImageSize = (src: string): Promise<{ height: number; width: number }> => new Promise((resolve, reject) => {
  const image = new Image()
  image.onerror = () => reject(new Error('Unable to load image'))
  image.onload = () => resolve({ height: image.naturalHeight, width: image.naturalWidth })
  image.src = src
})

export const fitImageToPresentation = (
  presentation: Pick<PresentationState, 'viewportRatio' | 'viewportSize'>,
  size: { height: number; width: number },
) => {
  let { height, width } = size
  const ratio = height / width
  if (ratio < presentation.viewportRatio && width > presentation.viewportSize) {
    width = presentation.viewportSize
    height = width * ratio
  }
  else if (height > presentation.viewportSize * presentation.viewportRatio) {
    height = presentation.viewportSize * presentation.viewportRatio
    width = height / ratio
  }
  return {
    height,
    left: (presentation.viewportSize - width) / 2,
    top: (presentation.viewportSize * presentation.viewportRatio - height) / 2,
    width,
  }
}

export const getImageBeforeCrop = (element: PPTImageElement) => {
  const originClipRange = element.clip?.range ?? [[0, 0], [100, 100]] as [[number, number], [number, number]]
  const originWidth = element.width / ((originClipRange[1][0] - originClipRange[0][0]) / 100)
  const originHeight = element.height / ((originClipRange[1][1] - originClipRange[0][1]) / 100)
  const originLeft = element.left - originWidth * (originClipRange[0][0] / 100)
  const originTop = element.top - originHeight * (originClipRange[0][1] / 100)
  return { originClipRange, originHeight, originLeft, originTop, originWidth }
}

export const getPresetImageCrop = (
  element: PPTImageElement,
  shape: string,
  ratio = 0,
): Partial<PPTImageElement> => {
  const { originClipRange, originHeight, originLeft, originTop, originWidth } = getImageBeforeCrop(element)
  if (!ratio) {
    const clip = { ...element.clip, shape, range: originClipRange }
    return shape === 'rect' ? { clip, radius: 0 } : { clip }
  }

  const imageRatio = originHeight / originWidth
  let range: [[number, number], [number, number]]
  if (imageRatio > ratio) {
    const distance = ((1 - ratio / imageRatio) / 2) * 100
    range = [[0, distance], [100, 100 - distance]]
  }
  else {
    const distance = ((1 - imageRatio / ratio) / 2) * 100
    range = [[distance, 0], [100 - distance, 100]]
  }
  return {
    clip: { ...element.clip, shape, range },
    height: originHeight * (range[1][1] - range[0][1]) / 100,
    left: originLeft + originWidth * (range[0][0] / 100),
    top: originTop + originHeight * (range[0][1] / 100),
    width: originWidth * (range[1][0] - range[0][0]) / 100,
  }
}

export const getReplacementImageCommands = async (
  element: PPTImageElement,
  file: File,
): Promise<PresentationCommand[]> => {
  const src = await fileToDataUrl(file)
  const size = await getImageSize(src)
  const centerX = element.left + element.width / 2
  const centerY = element.top + element.height / 2
  const height = element.height
  const width = size.width * (height / size.height)
  const props: Partial<PPTImageElement> = {
    src,
    width,
    height,
    left: centerX - width / 2,
    top: centerY - height / 2,
  }
  if (element.clip && element.clip.shape !== 'rect') {
    props.clip = { ...element.clip, range: [[0, 0], [100, 100]] }
    return [{ type: 'element.update', payload: { id: element.id, props } }]
  }
  return [
    { type: 'element.properties.remove', payload: { id: element.id, property: 'clip' } },
    { type: 'element.update', payload: { id: element.id, props } },
  ]
}
