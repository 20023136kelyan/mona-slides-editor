import { BrowserWindow, ipcMain } from 'electron'

import type {
  AddProjectArtifactInput,
  AppendProjectMessageInput,
  CreateProjectInput,
} from '@mona/project-core'

import { projectStore, type ProjectStore } from './project-store.js'

const broadcast = (channel: string): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel)
  }
}

export const registerProjectIpc = (store: ProjectStore = projectStore): void => {
  store.onChange(() => broadcast('mona:projects:changed'))

  ipcMain.handle('mona:projects:list', () => store.list())
  ipcMain.handle('mona:projects:create', (_event, input?: CreateProjectInput) => (
    store.create(input)
  ))
  ipcMain.handle('mona:projects:read', (_event, id: string) => store.read(id))
  ipcMain.handle('mona:projects:rename', (_event, id: string, title: string) => (
    store.rename(id, title)
  ))
  ipcMain.handle(
    'mona:projects:append-message',
    (_event, id: string, input: AppendProjectMessageInput) => store.appendMessage(id, input),
  )
  ipcMain.handle(
    'mona:projects:add-artifact',
    (_event, id: string, input: AddProjectArtifactInput) => store.addArtifact(id, input),
  )
  ipcMain.handle(
    'mona:projects:remove-artifact',
    (_event, id: string, artifactId: string) => store.removeArtifact(id, artifactId),
  )
  ipcMain.handle('mona:projects:delete', (_event, id: string) => store.delete(id))
}
