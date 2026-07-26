import { LEGACY_NATIVE_FILE_EXTENSION } from '@/lib/legacy-compatibility'
import { monaBridge, type MonaFileFilter } from '@/lib/mona-bridge'

/**
 * Choosing files, and putting files somewhere.
 *
 * The shell owns the dialogs; this is the shape the editor wants to talk to them
 * in. `pickFiles` hands back real `File` objects so the code behind it does not
 * have to care that the bytes arrived from a native dialog rather than an
 * `<input type="file">` — that distinction stops at this module.
 *
 * Cancelling is not an error anywhere here. An empty list and a null path are
 * the two ways it shows up, and every caller has to allow for them, because
 * "the user changed their mind" is the most common outcome a file dialog has.
 */

/** Anything the media library will take, in one dialog. */
export const UPLOAD_FILTERS: MonaFileFilter[] = [
  { extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp4', 'webm', 'mov', 'm4v', 'mp3', 'wav', 'm4a', 'aac', 'ogg'], name: 'Media' },
  { extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'], name: 'Images' },
  { extensions: ['mp4', 'webm', 'mov', 'm4v'], name: 'Videos' },
  { extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg'], name: 'Audio' },
]

export const PRESENTATION_FILTERS = {
  image: [{ extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'], name: 'Images' }],
  json: [{ extensions: ['json'], name: 'JSON' }],
  native: [{ extensions: ['mona', LEGACY_NATIVE_FILE_EXTENSION.replace('.', '')], name: 'Mona Presentation' }],
  pptx: [{ extensions: ['pptx'], name: 'PowerPoint Presentation' }],
} satisfies Record<string, MonaFileFilter[]>

/** Keyed by the import kinds the header offers. */
export const IMPORT_FILTERS = {
  json: PRESENTATION_FILTERS.json,
  native: PRESENTATION_FILTERS.native,
  pptx: PRESENTATION_FILTERS.pptx,
} satisfies Record<'json' | 'native' | 'pptx', MonaFileFilter[]>

/**
 * Opens the platform's file dialog and returns what came back.
 *
 * `File` rather than raw bytes because that is what the editor's import,
 * upload and replace paths already take, and because `File` carries the name
 * and the media type alongside the content the way they need it.
 */
export const pickFiles = async (
  filters: MonaFileFilter[],
  options: { multiple?: boolean; title?: string } = {},
): Promise<File[]> => {
  const picked = await monaBridge().files.open({ filters, ...options })
  return (picked ?? []).map(file => new File([file.bytes], file.name, { type: file.mediaType }))
}

/** The first file, for the many callers that only ever want one. */
export const pickFile = async (
  filters: MonaFileFilter[],
  options: { title?: string } = {},
): Promise<File | undefined> => (await pickFiles(filters, options))[0]

/**
 * Asks where to put something, then puts it there.
 *
 * Returns the path so a caller can say where it went, or null when the dialog
 * was dismissed. Neither the location nor the name is decided here, which is the
 * whole difference from the download it replaces.
 */
export const saveFile = async (
  data: Blob | ArrayBuffer | Uint8Array | string,
  defaultName: string,
  filters: MonaFileFilter[],
): Promise<string | null> => {
  const bytes = await toArrayBuffer(data)
  return monaBridge().files.save({ bytes, defaultName, filters })
}

/**
 * Accepts everything the export paths already produce.
 *
 * `toPng` and `toJpeg` return a `data:` URL, `pptxgenjs` returns an ArrayBuffer,
 * and the JSON paths build a Blob; normalising here keeps that variety out of
 * the bridge, which only ever wants bytes.
 */
const toArrayBuffer = async (data: Blob | ArrayBuffer | Uint8Array | string): Promise<ArrayBuffer> => {
  if (typeof data === 'string') {
    // A data URL from the image exporters; anything else is text to be written.
    if (data.startsWith('data:')) return (await (await fetch(data)).arrayBuffer())
    return new TextEncoder().encode(data).buffer as ArrayBuffer
  }
  if (data instanceof Blob) return data.arrayBuffer()
  if (data instanceof Uint8Array) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  }
  return data
}
