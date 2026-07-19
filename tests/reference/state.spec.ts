import { expect, test, waitForReferenceEditor } from './fixtures'

test('captures the normalized initial editor state', async ({ page }) => {
  await page.goto('/')
  await waitForReferenceEditor(page)

  const state = await page.evaluate(() => window.__MONA_TEST__?.getState())
  expect(state).toBeTruthy()

  const normalizedState = structuredClone(state) as {
    editor: { databaseId: string }
  }
  normalizedState.editor.databaseId = '<database-id>'

  expect(JSON.stringify(normalizedState, null, 2)).toMatchSnapshot('initial-editor-state.json')
})
