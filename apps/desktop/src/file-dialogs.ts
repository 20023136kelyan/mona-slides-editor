import { readFile, writeFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'

/**
 * Opening and saving files, the way the operating system does it.
 *
 * As a web page these were a hidden `<input type="file">` and a synthesised
 * anchor click. Both are the browser's apology for not being allowed near a
 * filesystem: the input cannot be opened without a user gesture in the same
 * task, cannot say where it should start, and hands back a `File` whose path
 * the page is not permitted to know; the anchor cannot ask where to put
 * anything and drops it in Downloads with a name the user never approved.
 *
 * Here the dialogs are the real ones, sheeted to the window that asked.
 */

type Filter = { extensions: string[]; name: string }

interface OpenRequest {
  filters: Filter[]
  multiple?: boolean
  title?: string
}

interface SaveRequest {
  bytes: ArrayBuffer
  defaultName: string
  filters: Filter[]
}

interface PrintRequest {
  defaultName: string
  html: string
  /** CSS pixels, as the editor lays the page out. */
  page: { height: number; margin: number; width: number }
}

/** A picked file, in the shape the renderer needs to build a `File` from it. */
interface PickedFile {
  bytes: ArrayBuffer
  mediaType: string
  name: string
}

const MEDIA_TYPES = new Map(Object.entries({
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.png': 'image/png',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}))

/**
 * Sheeted to the window that asked, when there is one.
 *
 * Electron overloads these on arity rather than accepting a nullable parent, so
 * the branch is here once instead of at all three call sites.
 */
const openIn = (sender: Electron.WebContents, options: Electron.OpenDialogOptions) => {
  const parent = BrowserWindow.fromWebContents(sender)
  return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options)
}
const saveIn = (sender: Electron.WebContents, options: Electron.SaveDialogOptions) => {
  const parent = BrowserWindow.fromWebContents(sender)
  return parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options)
}

/**
 * The renderer holds one document at a time to be printed, served to the print
 * window through the app's own scheme.
 *
 * Same origin as the renderer on purpose: the document refers to `mona://asset/`
 * images and to the fonts the editor loaded, and a `data:` or `file:` document
 * would be a different origin from both. It is also why this is a path under the
 * app host rather than a host of its own — root-absolute references in the
 * scraped stylesheet have to keep meaning what they meant in the editor.
 */
export const PRINT_PATH = '/__print__'
let pendingPrintHtml = ''

/** Answers `mona://app/__print__` while a print is in flight; otherwise nothing. */
export const printDocument = (): string => pendingPrintHtml

/**
 * Renders a document to PDF in a window the user never sees.
 *
 * The web version could not do this. It built the same HTML, put it in a hidden
 * iframe and called `print()`, which opens the browser's print dialog and leaves
 * the outcome — printer or PDF, which paper size, whether it happened at all —
 * entirely outside the application's knowledge. `printToPDF` returns the bytes.
 *
 * JavaScript is off in the print window: the document is assembled from deck
 * content, and deck content arrives inside `.pptx` files that other people made.
 * It renders and it is measured; it does not run.
 */
const printToPdf = async (event: Electron.IpcMainInvokeEvent, request: PrintRequest): Promise<string | null> => {
  const target = await saveIn(event.sender, {
    defaultPath: `${request.defaultName}.pdf`,
    filters: [{ extensions: ['pdf'], name: 'PDF' }],
  })
  if (target.canceled || !target.filePath) return null

  pendingPrintHtml = request.html
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, javascript: false, nodeIntegration: false, sandbox: true },
  })
  try {
    await printWindow.loadURL(`mona://app${PRINT_PATH}`)
    // `did-finish-load` has already fired by the time `loadURL` resolves, which
    // covers stylesheets and images but not the web fonts they ask for. Nothing
    // reports those with scripting off, so this is a settle rather than a signal.
    await new Promise(resolve => setTimeout(resolve, 300))

    // Two different units in one call: the page is in microns, the margins are
    // in pixels, and the margin numbers are ignored outright unless `marginType`
    // says `custom`. Passing inches without it — the obvious reading of the
    // documentation — fails as `CompositePages: Page reading failed`, which
    // names neither the option nor the unit.
    // Inches, both of them. The `pageSize` object is documented as inches and
    // the margins go with it; the microns the API also talks about belong to
    // `webContents.print()`, which is a different call. Passing microns here
    // fails as `CompositePages: Page reading failed`, which names neither the
    // option nor the unit — and 960 x 540 read as inches is simply too large a
    // sheet to print, which is what that message was really saying.
    //
    // `marginType: 'custom'` is what makes the numbers count at all. Without it
    // they are read and ignored in favour of a default margin.
    const INCHES_PER_PX = 1 / 96
    const bytes = await printWindow.webContents.printToPDF({
      margins: request.page.margin > 0
        ? {
            bottom: request.page.margin * INCHES_PER_PX,
            left: request.page.margin * INCHES_PER_PX,
            marginType: 'custom' as const,
            right: request.page.margin * INCHES_PER_PX,
            top: request.page.margin * INCHES_PER_PX,
          }
        : { marginType: 'none' as const },
      pageSize: {
        height: (request.page.height + request.page.margin * 2) * INCHES_PER_PX,
        width: (request.page.width + request.page.margin * 2) * INCHES_PER_PX,
      },
      printBackground: true,
    })
    await writeFile(target.filePath, bytes)
    return target.filePath
  }
  finally {
    printWindow.destroy()
    pendingPrintHtml = ''
  }
}

export const registerFileIpc = (): void => {
  /** Returns the bytes, not paths: the renderer has no filesystem to open them with. */
  ipcMain.handle('mona:files:open', async (event, request: OpenRequest): Promise<PickedFile[] | null> => {
    const picked = await openIn(event.sender, {
      filters: request.filters,
      properties: request.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      ...(request.title ? { title: request.title } : {}),
    })
    if (picked.canceled || !picked.filePaths.length) return null
    return Promise.all(picked.filePaths.map(async path => {
      const bytes = await readFile(path)
      return {
        bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        mediaType: MEDIA_TYPES.get(extname(path).toLowerCase()) ?? 'application/octet-stream',
        name: basename(path),
      }
    }))
  })

  /** The saved path, or null if the user cancelled — which is not an error. */
  ipcMain.handle('mona:files:save', async (event, request: SaveRequest): Promise<string | null> => {
    const target = await saveIn(event.sender, {
      defaultPath: request.defaultName,
      filters: request.filters,
    })
    if (target.canceled || !target.filePath) return null
    await writeFile(target.filePath, Buffer.from(request.bytes))
    return target.filePath
  })

  ipcMain.handle('mona:files:print-pdf', printToPdf)
}
