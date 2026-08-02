import { useState } from 'react'
import { beforeAll, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import type { UIMessage } from 'ai'

import { AgentComposer } from '@/features/agent/AgentComposer'
import { AgentTranscript } from '@/features/agent/AgentTranscript'
import { initializeI18n, setLocale } from '@/i18n'

beforeAll(async () => {
  await initializeI18n()
  await setLocale('en-US')
})

function ComposerHarness({
  busy = false,
  onStop,
  onSubmit,
}: {
  busy?: boolean
  onStop?: () => void
  onSubmit: () => void
}) {
  const [value, setValue] = useState('Arrange the attached documents')
  return (
    <AgentComposer
      ariaLabel="Message Mona"
      attachment={{ label: 'Attach', onClick: () => undefined }}
      busy={busy}
      context={<span>Quarterly plan</span>}
      onStop={onStop}
      onSubmit={onSubmit}
      onValueChange={setValue}
      placeholder="Ask Mona"
      value={value}
    />
  )
}

test('the shared composer carries the editor controls and nested surface intact', async () => {
  const submit = vi.fn<() => void>()
  await render(<ComposerHarness onSubmit={submit} />)

  await expect.element(page.getByRole('textbox', { name: 'Message Mona' })).toBeVisible()
  await expect.element(page.getByText('Quarterly plan')).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Attach' })).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Choose a model' })).toBeVisible()
  expect(document.querySelector('[data-agent-composer]')?.classList.contains('mona-agent-composer')).toBe(true)
  expect(document.querySelector('[data-agent-composer] [data-agent-provider-icon]')).not.toBeNull()

  await page.getByRole('button', { name: 'Send message' }).click()
  expect(submit).toHaveBeenCalledOnce()
})

test('a running shared composer exposes the same stop and steering controls', async () => {
  const stop = vi.fn<() => void>()
  await render(<ComposerHarness busy onStop={stop} onSubmit={() => undefined} />)

  await page.getByRole('button', { name: 'Cancel generation' }).click()
  expect(stop).toHaveBeenCalledOnce()
  await expect.element(page.getByRole('button', { name: 'Send to the running agent' })).toBeVisible()
})

test('the shared picker switches provider and model without changing the composer', async () => {
  await render(<ComposerHarness onSubmit={() => undefined} />)
  await page.getByRole('button', { name: 'Choose a model' }).click()
  await page.getByRole('button', { name: 'Codex Test' }).click()
  await expect.element(page.getByRole('button', { name: 'Choose a model' })).toHaveTextContent('Codex Test')
  expect(document.querySelectorAll('[data-agent-composer]').length).toBe(1)
})

test('the wide transcript is the same smooth ordered renderer, without response branding', async () => {
  const messages: UIMessage[] = [
    {
      id: 'user-1',
      parts: [{ text: 'Inspect this deck', type: 'text' }],
      role: 'user',
    },
    {
      id: 'assistant-1',
      parts: [
        { state: 'done', text: 'I checked it.', type: 'text' },
        {
          input: {},
          output: {},
          state: 'output-available',
          toolCallId: 'tool-1',
          type: 'tool-inspect',
        },
        { state: 'done', text: 'The layout is consistent.', type: 'text' },
      ],
      role: 'assistant',
    },
  ]

  await render(
    <AgentTranscript
      busy={false}
      messages={messages}
      toolLabel={name => `Ran ${name}`}
    />,
  )

  await expect.element(page.getByText('Inspect this deck')).toBeVisible()
  await expect.element(page.getByText('I checked it.')).toBeVisible()
  await expect.element(page.getByText('Ran inspect')).toBeVisible()
  await expect.element(page.getByText('The layout is consistent.')).toBeVisible()
  expect(document.querySelector('[data-agent-transcript] [data-agent-provider-icon]')).toBeNull()
})
