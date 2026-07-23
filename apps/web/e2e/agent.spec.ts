import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('mona:ui-locale', 'en-US')
    }
    catch {
      // Sandboxed agent frames intentionally have an opaque origin.
    }
  })
})

test('keeps the deterministic reference engine out of the normal product UI', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Generate presentation with AI' }).click()
  await expect(page.getByRole('button', { name: 'Choose AI provider' })).toContainText('Mona 1')
  await page.getByRole('button', { name: 'Choose AI provider' }).click()
  const picker = page.getByRole('dialog')
  await expect(picker).not.toContainText('Reference engine')
  await expect(picker).toContainText('GPT-5.6 Sol')
  await expect(picker).toContainText('Claude Sonnet 5')
  await expect(picker).toContainText('Gemini 3.6 Flash')
})

test('previews, atomically applies, and single-step undoes a native agent edit', async ({ page }) => {
  const agentRequests: string[] = []
  const problems: string[] = []
  page.on('request', request => {
    if (request.url().includes('EditorAgentDock')) agentRequests.push(request.url())
  })
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`)
  })
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))

  await page.goto('/?developmentFixture=slides')
  await expect(page.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
  expect(agentRequests).toEqual([])
  const initialCount = await page.evaluate(() => window.__MONA_TEST__!.getState().presentation.slides[0]!.elements.length)

  await page.getByRole('button', { name: 'Generate presentation with AI' }).click()
  await expect(page.getByRole('complementary', { name: 'Mona AI' })).toBeVisible()
  await expect.poll(() => agentRequests.length).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Choose AI provider' }).click()
  const picker = page.getByRole('dialog')
  await expect(picker).toContainText('Reference engine')
  await expect(picker).toContainText('OpenAI')
  await expect(picker).toContainText('Anthropic')
  await expect(picker).toContainText('Google AI Studio')
  await expect(picker).toContainText('Mona managed')
  // Signed-out providers show grayed model rows behind a sign-in.
  await expect(picker.getByRole('button', { name: 'Sign in to use GPT-5.6 Sol' })).toBeVisible()
  // Mona managed is unavailable on this deployment; its sign-in explains why.
  await picker.getByRole('button', { name: 'Sign in to Mona managed' }).click()
  await expect(picker).toContainText('Not configured on this deployment')
  await page.keyboard.press('Escape')

  await page.getByRole('textbox', { name: 'Message Mona AI' }).fill('Create a clean editable three-card summary layout')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByRole('button', { name: 'Apply edit' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Current slide before the agent edit' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Proposed slide after the agent edit' })).toBeVisible()
  await expect(page.getByText('5 created')).toBeVisible()
  expect(await page.evaluate(() => window.__MONA_TEST__!.getState().presentation.slides[0]!.elements.length)).toBe(initialCount)

  await page.getByRole('button', { name: 'Apply edit' }).click()
  await expect(page.getByRole('application', { name: 'Editable slide canvas' }).getByText('A clear story, designed to be edited')).toBeVisible()
  expect(await page.evaluate(() => window.__MONA_TEST__!.getState().presentation.slides[0]!.elements.length)).toBe(initialCount + 5)
  await page.locator('#mona-agent-dock').getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByRole('application', { name: 'Editable slide canvas' }).getByText('A clear story, designed to be edited')).toHaveCount(0)
  expect(await page.evaluate(() => window.__MONA_TEST__!.getState().presentation.slides[0]!.elements.length)).toBe(initialCount)
  expect(problems).toEqual([])
})

test('blocks stale previews and never persists a user-provided Google key', async ({ page }) => {
  await page.goto('/?developmentFixture=slides')
  await page.getByRole('button', { name: 'Generate presentation with AI' }).click()
  await page.getByRole('textbox', { name: 'Message Mona AI' }).fill('Propose a visual layout')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByRole('button', { name: 'Apply edit' })).toBeVisible()

  const title = page.getByRole('textbox', { name: 'Presentation title' })
  await title.click()
  await expect(title).not.toHaveAttribute('readonly')
  await title.fill('Changed while previewing')
  await title.press('Enter')
  await page.getByRole('button', { name: 'Apply edit' }).click()
  await expect(page.getByText(/presentation changed after this preview/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Apply edit' })).toHaveCount(0)
  await expect(page.getByRole('application', { name: 'Editable slide canvas' }).getByText('A clear story, designed to be edited')).toHaveCount(0)

  await page.getByRole('button', { name: 'Choose AI provider' }).click()
  await page.getByRole('button', { name: 'Sign in to Google AI Studio' }).click()
  await page.getByLabel('Google AI Studio key').fill('temporary-test-key')
  await expect(page.getByLabel('Google AI Studio key')).toHaveValue('temporary-test-key')
  expect(await page.evaluate(() => (
    Object.entries(localStorage).some(([, value]) => value.includes('temporary-test-key'))
  ))).toBe(false)

  await page.reload()
  await page.getByRole('button', { name: 'Generate presentation with AI' }).click()
  await expect(page.getByRole('button', { name: 'Choose AI provider' })).toContainText('Reference engine')
})

test('supports hosted OpenAI device login and Anthropic manual callback login', async ({ page }) => {
  const connected = new Map<string, boolean>()
  const flowPolls = new Map<string, number>()
  await page.route('**/api/agent/auth/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const provider = path.includes('openai-chatgpt') ? 'openai-chatgpt' : 'anthropic-claude'
    const respond = (status: number, body: unknown) => route.fulfill({
      body: JSON.stringify(body),
      contentType: 'application/json',
      status,
    })

    if (path.endsWith('/status')) {
      await respond(200, connected.get(provider)
        ? {
            accountLabel: provider === 'openai-chatgpt' ? 'OpenAI account connected' : 'Anthropic account connected',
            connected: true,
            planLabel: provider === 'openai-chatgpt' ? 'ChatGPT Plus / Pro' : 'Claude Pro / Max',
          }
        : { connected: false })
      return
    }
    if (path.endsWith('/start')) {
      if (provider === 'openai-chatgpt') {
        await respond(201, {
          deviceCode: {
            userCode: 'TEST-CODE',
            verificationUri: 'about:blank',
          },
          flowId: 'openai-flow',
          status: 'pending',
        })
      }
      else {
        await respond(201, {
          authorizationUrl: 'about:blank',
          flowId: 'anthropic-flow',
          prompt: {
            id: 'manual-prompt',
            message: 'Paste the final callback URL',
            placeholder: 'http://localhost:54545/callback',
            type: 'manual_code',
          },
          status: 'pending',
        })
      }
      return
    }
    if (path.includes('/prompts/manual-prompt')) {
      expect(request.postDataJSON()).toEqual({
        answer: 'http://localhost:54545/callback?code=one-time-code',
      })
      await respond(200, { flowId: 'anthropic-flow', status: 'pending' })
      return
    }
    if (path.includes('/flows/')) {
      const count = (flowPolls.get(provider) ?? 0) + 1
      flowPolls.set(provider, count)
      if (count >= 2) {
        connected.set(provider, true)
        await respond(200, {
          flowId: provider === 'openai-chatgpt' ? 'openai-flow' : 'anthropic-flow',
          status: 'complete',
        })
      }
      else {
        await respond(200, {
          ...(provider === 'openai-chatgpt'
            ? {
                deviceCode: {
                  userCode: 'TEST-CODE',
                  verificationUri: 'about:blank',
                },
              }
            : {}),
          flowId: provider === 'openai-chatgpt' ? 'openai-flow' : 'anthropic-flow',
          status: 'pending',
        })
      }
      return
    }
    if (request.method() === 'DELETE') {
      connected.set(provider, false)
      await respond(200, { connected: false })
      return
    }
    await respond(404, { message: 'Unexpected authentication route' })
  })

  await page.goto('/?developmentFixture=slides')
  await page.getByRole('button', { name: 'Generate presentation with AI' }).click()
  await page.getByRole('button', { name: 'Choose AI provider' }).click()
  // A locked provider's Sign in shortcut opens its auth panel in place.
  await page.getByRole('button', { name: 'Sign in to OpenAI' }).click()
  await page.getByRole('button', { name: 'Sign in with OpenAI' }).click()
  await expect(page.getByText('TEST-CODE')).toBeVisible()
  await expect(page.getByText('OpenAI account connected')).toBeVisible()
  await expect(page.getByText('ChatGPT Plus / Pro')).toBeVisible()
  await page.getByRole('button', { name: 'Disconnect' }).click()
  await expect(page.getByRole('button', { name: 'Sign in with OpenAI' })).toBeVisible()

  // Back to the model list, then into Anthropic's manual-callback sign-in.
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.getByRole('button', { name: 'Sign in to Anthropic' }).click()
  await page.getByRole('button', { name: 'Sign in with Anthropic' }).click()
  await page.getByLabel('Paste the final callback URL').fill('http://localhost:54545/callback?code=one-time-code')
  await page.getByRole('button', { name: 'Continue sign-in' }).click()
  await expect(page.getByText('Anthropic account connected')).toBeVisible()
  await expect(page.getByText('Claude Pro / Max')).toBeVisible()
})
