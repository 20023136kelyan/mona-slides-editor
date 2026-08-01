import { BrowserWindow, ipcMain } from 'electron'

import { isDocumentJobId } from '@mona/document-jobs'
import { isProjectId } from '@mona/project-core'

import {
  projectJobStore,
  type ProjectJobStore,
} from './project-job-store.js'
import {
  projectStore,
  type ProjectStore,
} from './project-store.js'

const broadcast = (projectId: string): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('mona:project-jobs:changed', projectId)
    }
  }
}

export const registerProjectJobIpc = (
  jobs: ProjectJobStore = projectJobStore,
  projects: ProjectStore = projectStore,
): Promise<void> => {
  jobs.onChange(broadcast)
  ipcMain.handle('mona:project-jobs:list', (_event, projectId: string) => (
    jobs.list(projectId)
  ))
  ipcMain.handle(
    'mona:project-jobs:read',
    (_event, projectId: string, jobId: string) => jobs.read(projectId, jobId),
  )
  ipcMain.handle(
    'mona:project-jobs:cancel',
    (_event, projectId: string, jobId: string) => {
      if (!isProjectId(projectId) || !isDocumentJobId(jobId)) {
        throw new Error('Invalid document job identity.')
      }
      return jobs.requestCancel(projectId, jobId)
    },
  )

  return projects.list().then(items => Promise.all(
    items.map(project => jobs.interruptActive(project.id)),
  )).then(() => undefined).catch(() => undefined)
}
