import type { RefObject, DragEvent as ReactDragEvent } from 'react'

import { editorActions, selectSession } from '@mona/editor-state'
import { createPresentationId, type PresentationState } from '@mona/presentation-core'
import type { PPTElement } from '@mona/presentation-core/model'

import { parseCustomEditorClipboard } from '@/features/editor/editor-clipboard'
import { MONA_CLIPBOARD_MIME, type EditorRuntime } from '@/features/editor/editor-runtime'

// Clipboard and drag-drop insertion for the slide canvas: native payloads,
// files, URLs, SVG source, and plain text. Split from EditorCanvas by input
// domain so canvas rendering remains independent of external inputs.

const MEDIA_EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/midi': 'mid',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'oga',
  'audio/wav': 'wav',
  'audio/webm': 'weba',
  'audio/x-aiff': 'aif',
  'audio/x-ms-wma': 'wma',
  'video/3gpp': '3gp',
  'video/3gpp2': '3g2',
  'video/mp4': 'mp4',
  'video/mpeg': 'mpeg',
  'video/ogg': 'ogv',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-flv': 'flv',
  'video/x-ms-wmv': 'wmv',
  'video/x-msvideo': 'avi',
}

const parseTextToParagraphs = (text: string) => text
  .replace(/[\n\r]+/g, '<br>')
  .split('<br>')
  .filter(Boolean)
  .map(paragraph => `<div>${paragraph}</div>`)
  .join('')

const getWebUrl = (text: string) => {
  try {
    const url = new URL(text)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  }
  catch {
    return null
  }
}
const isValidWebUrl = (text: string) => getWebUrl(text) !== null
const isSupportedImageUrl = (text: string) => {
  const url = getWebUrl(text)
  return !!url && /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(url.pathname)
}
const isSvgText = (text: string) => {
  if (!/<svg[\s\S]*?>[\s\S]*?<\/svg>/i.test(text)) return false
  try {
    return new DOMParser().parseFromString(text, 'image/svg+xml').documentElement.nodeName === 'svg'
  }
  catch {
    return false
  }
}

const fileAsDataUrl = (file: File) => new Promise<string>(resolve => {
  const reader = new FileReader()
  reader.addEventListener('load', () => resolve(reader.result as string), { once: true })
  reader.readAsDataURL(file)
})

const imageSize = (src: string) => new Promise<{ height: number; width: number }>((resolve, reject) => {
  const image = new Image()
  image.style.opacity = '0'
  image.addEventListener('load', () => {
    const size = { height: image.clientHeight || image.naturalHeight, width: image.clientWidth || image.naturalWidth }
    image.remove()
    resolve(size)
  }, { once: true })
  image.addEventListener('error', () => {
    image.remove()
    reject(new Error('Image failed to load'))
  }, { once: true })
  document.body.append(image)
  image.src = src
})

export function useCanvasClipboard({ presentation, runtime, shiftPressedRef }: {
  presentation: PresentationState
  runtime: EditorRuntime
  shiftPressedRef: RefObject<boolean>
}) {
  const commitPastedElement = (label: string, element: PPTElement, historyKey: 'clipboard-file' | 'clipboard-text') => {
    if (!runtime.commit(label, [{ type: 'element.add', elements: element }], { historyKey })) return
    runtime.store.dispatch(editorActions.selectionChanged([element.id]))
    runtime.store.dispatch(editorActions.canvasFocusChanged(true))
  }

  const createTextFromClipboard = (text: string, contentIsHtml = false) => {
    commitPastedElement('Paste text', {
      type: 'text',
      id: createPresentationId(10),
      left: 0,
      top: 0,
      width: 600,
      height: 50,
      content: contentIsHtml ? text : parseTextToParagraphs(text),
      rotate: 0,
      defaultFontName: presentation.theme.fontName,
      defaultColor: presentation.theme.fontColor,
      vertical: false,
    }, 'clipboard-text')
  }

  const createImageFromClipboard = async (src: string, historyKey: 'clipboard-file' | 'clipboard-text' = 'clipboard-text') => {
    try {
      let { height, width } = await imageSize(src)
      const ratio = height / width
      if (ratio < presentation.viewportRatio && width > presentation.viewportSize) {
        width = presentation.viewportSize
        height = width * ratio
      }
      else if (height > presentation.viewportSize * presentation.viewportRatio) {
        height = presentation.viewportSize * presentation.viewportRatio
        width = height / ratio
      }
      commitPastedElement('Paste image', {
        type: 'image',
        id: createPresentationId(10),
        src,
        width,
        height,
        left: (presentation.viewportSize - width) / 2,
        top: (presentation.viewportSize * presentation.viewportRatio - height) / 2,
        fixedRatio: true,
        rotate: 0,
      }, historyKey)
    }
    catch { /* An unreadable image paste is intentionally a no-op. */ }
  }

  const createMediaFromClipboard = (file: File) => {
    const src = URL.createObjectURL(file)
    const ext = MEDIA_EXTENSION_BY_MIME[file.type]
    if (file.type.includes('video')) {
      commitPastedElement('Paste video', {
        type: 'video',
        id: createPresentationId(10),
        width: 500,
        height: 300,
        rotate: 0,
        left: (presentation.viewportSize - 500) / 2,
        top: (presentation.viewportSize * presentation.viewportRatio - 300) / 2,
        src,
        autoplay: false,
        ...(ext ? { ext } : {}),
      }, 'clipboard-file')
    }
    else {
      commitPastedElement('Paste audio', {
        type: 'audio',
        id: createPresentationId(10),
        width: 50,
        height: 50,
        rotate: 0,
        left: (presentation.viewportSize - 50) / 2,
        top: (presentation.viewportSize * presentation.viewportRatio - 50) / 2,
        loop: false,
        autoplay: false,
        fixedRatio: true,
        color: presentation.theme.themeColors[0]!,
        src,
        ...(ext ? { ext } : {}),
      }, 'clipboard-file')
    }
  }

  const handlePaste = (event: ClipboardEvent) => {
    const state = runtime.store.getState().session
    if ((!state.canvasFocus && !state.thumbnailsFocus) || state.disableHotkeys) return
    if (!event.clipboardData) return
    let handledFile = false
    for (const item of event.clipboardData.items) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (!file) continue
      if (item.type.includes('image')) {
        handledFile = true
        void fileAsDataUrl(file).then(src => createImageFromClipboard(src, 'clipboard-file'))
      }
      else if (item.type.includes('video') || item.type.includes('audio')) {
        handledFile = true
        createMediaFromClipboard(file)
      }
    }
    if (handledFile) return
    const serialized = event.clipboardData.getData(MONA_CLIPBOARD_MIME) || event.clipboardData.getData('text/plain')
    if (!serialized) return
    const payload = parseCustomEditorClipboard(serialized)
    if (typeof payload !== 'string') {
      // Every successfully decrypted JSON value is custom clipboard data.
      // Unsupported object shapes are a no-op; they must not fall through and
      // become a text element containing the ciphertext.
      if (payload && typeof payload === 'object' && 'type' in payload) {
        if (payload.type === 'elements') runtime.paste(serialized)
        else if (payload.type === 'slides') runtime.pasteSlides(serialized)
      }
      return
    }
    if (!shiftPressedRef.current && isSupportedImageUrl(payload)) void createImageFromClipboard(payload)
    else if (!shiftPressedRef.current && isValidWebUrl(payload)) {
      createTextFromClipboard(`<a href="${payload}" title="${payload}" target="_blank">${payload}</a>`, true)
    }
    else if (!shiftPressedRef.current && isSvgText(payload)) {
      void createImageFromClipboard(`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(payload)))}`)
    }
    else createTextFromClipboard(payload)
  }

  // Vue's useDrop: dropped media files insert through the shared paste
  // routing; dropped plain text becomes a 600x50 text element at the origin.
  const handleDrop = (event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault()
    const transfer = event.dataTransfer
    if (!transfer || transfer.items.length === 0) return
    let handledFile = false
    for (const item of transfer.items) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (!file) continue
      if (item.type.includes('image')) {
        handledFile = true
        void fileAsDataUrl(file).then(src => createImageFromClipboard(src, 'clipboard-file'))
      }
      else if (item.type.includes('video') || item.type.includes('audio')) {
        handledFile = true
        createMediaFromClipboard(file)
      }
    }
    if (handledFile) return
    const first = transfer.items[0]
    if (first && first.kind === 'string' && first.type === 'text/plain') {
      first.getAsString(text => {
        if (selectSession(runtime.store.getState()).disableHotkeys) return
        createTextFromClipboard(text)
      })
    }
  }
  return { handleDrop, handlePaste }
}
