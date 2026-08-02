import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { ElectronApplication, Locator, Page } from '@playwright/test'

import {
  expect,
  openApp,
  stubOpenDialog,
  stubSignedInAccount,
  test,
} from './electron-fixture'

const stubProjectAgentTurn = async (
  app: ElectronApplication,
  reply: string,
): Promise<void> => {
  await app.evaluate(({ ipcMain }, replyText) => {
    ipcMain.removeAllListeners('mona:project-agent:prompt')
    ipcMain.on('mona:project-agent:prompt', (event, prompt: { projectId: string }) => {
      const send = (chunk: unknown) => event.sender.send('mona:project-agent:chunk', {
        chunk,
        projectId: prompt.projectId,
      })
      send({ type: 'start' })
      send({ id: 'project-reply', type: 'text-start' })
      send({ delta: replyText, id: 'project-reply', type: 'text-delta' })
      send({ id: 'project-reply', type: 'text-end' })
      send({ type: 'finish' })
    })
  }, reply)
}

const createProject = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'New project' }).click()
  await page.waitForURL(/\/projects\/[^/?]+/)
  await expect(page.getByRole('region', { name: 'Project conversation' })).toBeVisible()
}

const expectVerticallyCentered = async (container: Locator) => {
  const centers = await container.evaluate(element => {
    const containerBox = element.getBoundingClientRect()
    const contentBoxes = Array.from(element.children, child => child.getBoundingClientRect())
    const contentTop = Math.min(...contentBoxes.map(box => box.top))
    const contentBottom = Math.max(...contentBoxes.map(box => box.bottom))
    return {
      container: containerBox.top + containerBox.height / 2,
      content: contentTop + (contentBottom - contentTop) / 2,
    }
  })
  expect(Math.abs(centers.container - centers.content)).toBeLessThanOrEqual(1)
}

test.beforeEach(async ({ app, page }) => {
  await page.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US'))
  await stubSignedInAccount(app)
  await openApp(page)
})

test('creates a durable three-panel project conversation', async ({ app, page }, testInfo) => {
  await createProject(page)
  await expect(page.getByRole('navigation', { name: 'Mona navigation' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Artifacts' })).toBeVisible()
  await expect(page.getByText('What are we working on?')).toBeVisible()
  const surfaceBars = page.locator('.mona-application-surface-bar')
  await expect(surfaceBars).toHaveCount(2)
  await expect(surfaceBars.first()).toHaveCSS('height', '44px')
  await expect(surfaceBars.first()).toHaveCSS('border-bottom-width', '0px')
  await expect(surfaceBars.last()).toHaveCSS('height', '44px')
  await expect(surfaceBars.last()).toHaveCSS('border-bottom-width', '0px')
  await expect(page.getByText('ci@example.com')).toHaveCount(0)
  const conversationEmpty = page.getByRole('region', { name: 'Project conversation' })
    .locator('[data-slot="empty"]')
  const artifactEmpty = page.getByRole('complementary', { name: 'Artifacts' })
    .locator('[data-slot="empty"]')
  await expectVerticallyCentered(conversationEmpty)
  await expectVerticallyCentered(artifactEmpty)

  await stubProjectAgentTurn(app, 'I mapped the requested changes across the attached documents.')
  await page.getByRole('textbox', { name: 'Message Mona' }).fill('Refresh the launch narrative')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByText('I mapped the requested changes across the attached documents.')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Project title' }))
    .toHaveValue('Refresh the launch narrative')
  await expect(page.getByRole('button', { name: 'Refresh the launch narrative' })).toBeVisible()
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('project-chat.png'),
  })

  await page.reload()
  await expect(page.getByLabel('Project conversation')
    .getByText('Refresh the launch narrative', { exact: true })).toBeVisible()
  await expect(page.getByText('I mapped the requested changes across the attached documents.')).toBeVisible()

  await page.getByRole('button', { name: 'Refresh the launch narrative' })
    .click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  const deleteDialog = page.getByRole('alertdialog', { name: 'Delete project?' })
  await expect(deleteDialog).toContainText('Referenced source documents will not be deleted.')
  await deleteDialog.getByRole('button', { name: 'Delete' }).click()
  await page.waitForURL(/\/$/)
  await expect(page.getByRole('button', { name: 'Refresh the launch narrative' })).toHaveCount(0)
})

test('turns a Home request into the first durable project turn', async ({ app, page }) => {
  await stubProjectAgentTurn(app, 'I am ready to coordinate the deck and its supporting documents.')
  await page.getByRole('textbox', { name: 'Start a project with Mona' })
    .fill('Prepare the board review package')
  await page.getByRole('button', { name: 'Start project' }).click()
  await page.waitForURL(/\/projects\/[^/?]+/)
  await expect(page.getByLabel('Project conversation')
    .getByText('Prepare the board review package', { exact: true })).toBeVisible()
  await expect(page.getByText('I am ready to coordinate the deck and its supporting documents.'))
    .toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Project title' }))
    .toHaveValue('Prepare the board review package')
})

test('references source documents without copying them into the project', async ({
  app,
  page,
}, testInfo) => {
  const sourceRoot = join(testInfo.outputDir, 'Project files')
  const fixture = join(import.meta.dirname, '../../../tests/corpus/public/corpus-01-text.pptx')
  await mkdir(sourceRoot, { recursive: true })
  await copyFile(fixture, join(sourceRoot, 'Launch deck.pptx'))
  await stubOpenDialog(app, [sourceRoot])
  await page.getByRole('button', { name: 'Add local folder' }).click()
  await createProject(page)

  await page.getByRole('button', { name: 'Attach' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add documents' })
  await dialog.getByRole('button', { name: /Launch deck\.pptx/ }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('complementary', { name: 'Artifacts' }))
    .toContainText('Launch deck.pptx')

  const projectId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1)!
  const stored = await page.evaluate(id => window.mona!.projects.read(id), projectId)
  expect(stored?.artifacts).toMatchObject([{
    name: 'Launch deck.pptx',
    reference: {
      itemId: expect.any(String),
    },
  }])
  expect(stored?.artifacts[0]).not.toHaveProperty('bytes')
  expect(stored?.artifacts[0]).not.toHaveProperty('path')
})

test('shows durable document-job progress and sends cancellation through the desktop bridge', async ({
  app,
  page,
}) => {
  await createProject(page)
  const projectId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1)!
  await app.evaluate(({ BrowserWindow, ipcMain }, id) => {
    const now = Date.now()
    let job = {
      cancelRequested: false,
      createdAt: now,
      explanation: 'Refresh two attached presentations',
      id: 'job-progress',
      projectId: id,
      status: 'running',
      steps: [{
        artifactId: 'artifact-one',
        createdAt: now,
        expectedRevision: {
          contentHash: 'a'.repeat(64),
          modifiedAt: now,
          size: 100,
        },
        finishedAt: now,
        id: 'step-one',
        name: 'Launch deck.mona',
        operation: 'presentation.replace',
        reference: { itemId: 'document-one', sourceId: 'source-one' },
        startedAt: now,
        status: 'succeeded',
        updatedAt: now,
      }, {
        artifactId: 'artifact-two',
        createdAt: now,
        expectedRevision: {
          contentHash: 'b'.repeat(64),
          modifiedAt: now,
          size: 100,
        },
        id: 'step-two',
        name: 'Sales deck.mona',
        operation: 'presentation.replace',
        reference: { itemId: 'document-two', sourceId: 'source-one' },
        startedAt: now,
        status: 'running',
        updatedAt: now,
      }],
      updatedAt: now,
      version: 1,
    }
    const changed = () => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('mona:project-jobs:changed', id)
      }
    }
    ipcMain.removeHandler('mona:project-jobs:list')
    ipcMain.handle('mona:project-jobs:list', () => [job])
    ipcMain.removeHandler('mona:project-jobs:cancel')
    ipcMain.handle('mona:project-jobs:cancel', () => {
      const finishedAt = Date.now()
      job = {
        ...job,
        cancelRequested: true,
        finishedAt,
        status: 'partial',
        steps: job.steps.map(step => (
          step.status === 'running'
            ? { ...step, finishedAt, status: 'cancelled', updatedAt: finishedAt }
            : step
        )),
        updatedAt: finishedAt,
      }
      changed()
      return job
    })
    changed()
  }, projectId)

  const activity = page.getByRole('region', { name: 'Document job' })
  await expect(activity).toContainText('Refresh two attached presentations')
  await expect(activity.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
  await activity.getByRole('button', { name: 'Cancel' }).click()
  await expect(activity).toContainText('Partially complete')
  await expect(activity.getByRole('button', { name: 'Cancel' })).toHaveCount(0)
})
