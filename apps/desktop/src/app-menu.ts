import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'

/**
 * The macOS menu bar.
 *
 * On a Mac, File and View belong at the top of the screen — an app that keeps them
 * inside its own window reads as a web page in a frame. Everywhere else the editor's
 * own header is the menu, so this builds nothing and Electron's default is removed.
 *
 * The items do not act. They send a command to the focused window, and the renderer
 * runs the same handler its in-window menu always did, so the two can never drift
 * into doing different things.
 */

/** Sent to the renderer; the same strings its header already switches on. */
const send = (command: string) => () => {
  BrowserWindow.getFocusedWindow()?.webContents.send('mona:menu', command)
}

const template = (): MenuItemConstructorOptions[] => [
  {
    label: app.name,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { label: 'Keyboard Shortcuts', accelerator: 'Cmd+/', click: send('tools.shortcuts') },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  },
  {
    label: 'File',
    submenu: [
      { label: 'All Presentations', accelerator: 'Cmd+Shift+O', click: send('file.home') },
      { label: 'New Presentation', accelerator: 'Cmd+N', click: send('file.new') },
      { type: 'separator' },
      { label: 'Import PowerPoint…', accelerator: 'Cmd+O', click: send('file.import.pptx') },
      { label: 'Import Mona File…', click: send('file.import.native') },
      { label: 'Import JSON…', click: send('file.import.json') },
      { type: 'separator' },
      {
        label: 'Export',
        submenu: [
          { label: 'PowerPoint', click: send('file.export.pptx') },
          { label: 'PDF', accelerator: 'Cmd+P', click: send('file.export.pdf') },
          { label: 'Image', click: send('file.export.image') },
          { label: 'Mona File', click: send('file.export.native') },
          { label: 'JSON', click: send('file.export.json') },
        ],
      },
    ],
  },
  {
    label: 'Edit',
    // Roles rather than commands: these are the OS's own editing verbs, and
    // wiring them by hand would break text fields, which handle them natively.
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'pasteAndMatchStyle' },
      { role: 'delete' },
      { role: 'selectAll' },
    ],
  },
  {
    label: 'View',
    submenu: [
      { label: 'Comments', click: send('view.comments') },
      { label: 'Selection Pane', click: send('view.layers') },
      { label: 'Find and Replace', accelerator: 'Cmd+F', click: send('tools.find') },
      { label: 'Mark Slide Types', click: send('tools.semantics') },
      { type: 'separator' },
      { label: 'Play from Beginning', accelerator: 'F5', click: send('view.present.beginning') },
      { label: 'Play from This Slide', accelerator: 'Shift+F5', click: send('view.present.current') },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
    ],
  },
  {
    label: 'Window',
    submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }],
  },
]

export const installApplicationMenu = (): void => {
  if (process.platform !== 'darwin') {
    // The editor's own header carries these on Windows and Linux. Electron's
    // default menu would otherwise appear above it, saying different things.
    Menu.setApplicationMenu(null)
    return
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template()))
}
