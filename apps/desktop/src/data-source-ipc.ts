import { BrowserWindow, dialog, ipcMain } from 'electron'

import type {
  DataSourceDocumentReference,
  DataSourceQuery,
} from '@mona/data-source'

import { DataSourceService } from './data-source-service.js'

export const dataSourceService = new DataSourceService()

const openDirectoryIn = (sender: Electron.WebContents, title: string) => {
  const options: Electron.OpenDialogOptions = {
    properties: ['openDirectory'],
    title,
  }
  const parent = BrowserWindow.fromWebContents(sender)
  return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options)
}

const broadcast = (channel: string, payload: unknown): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

export const registerDataSourceIpc = (service = dataSourceService): void => {
  service.onChange(event => broadcast('mona:data-sources:changed', event))

  ipcMain.handle('mona:data-sources:list', () => service.listSources())
  ipcMain.handle('mona:data-sources:add-local', async event => {
    const picked = await openDirectoryIn(event.sender, 'Add a local files folder')
    if (picked.canceled || !picked.filePaths[0]) return null
    return service.addLocalFolder(picked.filePaths[0])
  })
  ipcMain.handle('mona:data-sources:choose-default-local', async event => {
    const picked = await openDirectoryIn(event.sender, 'Choose where Mona should save new presentations')
    if (picked.canceled || !picked.filePaths[0]) return null
    return service.addLocalFolder(picked.filePaths[0], { defaultSaveLocation: true })
  })
  ipcMain.handle('mona:data-sources:set-default', (_event, sourceId: string) => (
    service.setDefaultSaveLocation(sourceId)
  ))
  ipcMain.handle('mona:data-sources:remove', (_event, sourceId: string) => (
    service.removeSource(sourceId)
  ))
  ipcMain.handle(
    'mona:data-sources:children',
    (_event, sourceId: string, parentItemId: string) => (
      service.listChildren(sourceId, parentItemId)
    ),
  )
  ipcMain.handle('mona:data-sources:documents', (_event, query?: DataSourceQuery) => (
    service.queryDocuments(query)
  ))
  ipcMain.handle(
    'mona:data-sources:read',
    (_event, reference: DataSourceDocumentReference) => service.readDocument(reference),
  )
}
