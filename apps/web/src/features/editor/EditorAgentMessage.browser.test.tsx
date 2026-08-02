import { beforeAll, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import {
  AgentActivity as EditorAgentActivity,
  AgentMessage as EditorAgentMessage,
} from '@/features/agent/AgentMessage'
import {
  agentMessageHasLiveBlock as messageHasLiveBlock,
  agentMessageText as messageAnswerText,
} from '@/features/agent/agent-message-parts'
import { initializeI18n, setLocale } from '@/i18n'

beforeAll(async () => {
  await initializeI18n()
  await setLocale('en-US')
})

const toolLabel = (name: string) => name === 'look' ? 'Looking at this slide' : name

// UIMessage.parts interleave prose, reasoning and tool calls in the order the
// model produced them. Flattening that into "the text" and "the thinking" is
// what this guards against.
const interleaved = {
  parts: [
    { state: 'done', text: 'Let me take a look.', type: 'text' },
    { state: 'done', text: 'The title may overlap the chart.', type: 'reasoning' },
    { state: 'output-available', toolCallId: 'call-1', type: 'tool-look' },
    { state: 'done', text: 'The title overlaps the chart.', type: 'text' },
  ],
  role: 'assistant',
}

test('renders message parts in the order the model produced them', async () => {
  render(<EditorAgentMessage message={interleaved} streaming={false} toolLabel={toolLabel} />)

  await expect.element(page.getByText('Let me take a look.')).toBeVisible()
  await expect.element(page.getByText('The title overlaps the chart.')).toBeVisible()
  await expect.element(page.getByText('Looking at this slide')).toBeVisible()

  const root = document.body.querySelector('.mona-agent-prose')?.parentElement
  const kinds = [...(root?.children ?? [])]
    .map(child => child.classList.contains('mona-agent-thinking')
      ? 'thinking'
      : child.querySelector('.mona-agent-prose') || child.classList.contains('mona-agent-prose') ? 'text' : 'tool')
    .filter((_, index) => index < 4)
  expect(kinds).toEqual(['text', 'thinking', 'tool', 'text'])
})

test('reasoning stays collapsed once it has settled, and stops saying it is thinking', async () => {
  render(<EditorAgentMessage message={interleaved} streaming={false} toolLabel={toolLabel} />)
  // A settled block used to keep the present-tense label forever whenever it
  // finished inside one timer tick, which read as an agent stuck thinking.
  await expect.element(page.getByRole('button', { name: 'Thought' }))
    .toHaveAttribute('aria-expanded', 'false')
  expect(page.getByRole('button', { name: 'Thinking' }).query()).toBeNull()
})

test('renders a settled and an arriving part together, with no typing caret', async () => {
  // The last part is still streaming; the earlier ones already have state done.
  const streamingMessage = {
    parts: [
      { state: 'done', text: 'Settled prose.', type: 'text' },
      { state: 'streaming', text: 'Still arriving', type: 'text' },
    ],
    role: 'assistant',
  }
  render(<EditorAgentMessage message={streamingMessage} streaming={true} toolLabel={toolLabel} />)
  await expect.element(page.getByText('Still arriving')).toBeVisible()
  // Text streams in smoothly rather than imitating someone at a keyboard.
  expect(document.body.querySelectorAll('.mona-agent-caret')).toHaveLength(0)
})

test('a live block is what suppresses the standalone activity line', () => {
  // Both used to show at once, reading as two things running when only one was.
  const settled = {
    parts: [{ state: 'done', text: 'All done.', type: 'text' }],
    role: 'assistant',
  }
  const arriving = {
    parts: [
      { state: 'done', text: 'Done.', type: 'text' },
      { state: 'streaming', text: 'Arriving', type: 'text' },
    ],
    role: 'assistant',
  }
  const runningTool = {
    parts: [{ input: {}, state: 'input-available', toolCallId: 'c', type: 'tool-look' }],
    role: 'assistant',
  }
  const finishedTool = {
    parts: [{ input: {}, state: 'output-available', toolCallId: 'c', type: 'tool-look' }],
    role: 'assistant',
  }

  expect(messageHasLiveBlock(settled)).toBe(false)
  expect(messageHasLiveBlock(arriving)).toBe(true)
  expect(messageHasLiveBlock(runningTool)).toBe(true)
  // A failed call is finished too - the row already carries the reason.
  expect(messageHasLiveBlock(finishedTool)).toBe(false)
})

test('a failed tool call reports why, not just that it failed', async () => {
  const failed = {
    parts: [{ errorText: 'The edit was rejected', state: 'output-error', toolCallId: 'c', type: 'tool-edit' }],
    role: 'assistant',
  }
  render(<EditorAgentMessage message={failed} streaming={false} toolLabel={name => name} />)
  await expect.element(page.getByText('The edit was rejected')).toBeVisible()
})

test('renders assistant prose as markdown', async () => {
  render(<EditorAgentMessage message={{ parts: [{ state: 'done', text: 'A **bold** claim and `code`.', type: 'text' }], role: 'assistant' }} streaming={false} toolLabel={toolLabel} />)
  await expect.element(page.getByText('bold')).toBeVisible()
  expect(document.body.querySelector('.mona-agent-prose strong')?.textContent).toBe('bold')
  expect(document.body.querySelector('.mona-agent-prose code')?.textContent).toBe('code')
})

test('the working indicator is large enough to read, and to see the shimmer on', async () => {
  // It used to render at 10px beside a 20px mark, which made the shimmer
  // sweep illegible and the whole line easy to miss during a run.
  render(<EditorAgentActivity startedAt={Date.now()} />)
  const line = await vi.waitFor(() => {
    const found = document.body.querySelector('output')
    if (!found) throw new Error('no activity line')
    return found
  })

  const fontSize = Number.parseFloat(getComputedStyle(line).fontSize)
  expect(fontSize).toBeGreaterThanOrEqual(12)

  // The standalone orb design, not the inline one.
  const orb = await vi.waitFor(() => {
    const found = line.querySelector('canvas')
    if (!found) throw new Error('no orb')
    return found
  })
  expect(orb.getBoundingClientRect().width).toBeGreaterThanOrEqual(28)
})

test('a settled answer can be copied, without the reasoning or tool rows', async () => {
  render(<EditorAgentMessage message={interleaved} streaming={false} toolLabel={toolLabel} />)
  const copy = page.getByRole('button', { name: 'Copy' })
  await expect.element(copy).toBeVisible()

  // The clipboard is unavailable to the test browser, so assert what would be
  // written rather than the write itself.
  expect(messageAnswerText(interleaved)).toBe('Let me take a look.\n\nThe title overlaps the chart.')
  expect(messageAnswerText(interleaved)).not.toContain('overlap the chart')
})

test('no copy control while the answer is still arriving', async () => {
  const arriving = {
    parts: [{ state: 'streaming', text: 'Half a sen', type: 'text' }],
    role: 'assistant',
  }
  render(<EditorAgentMessage message={arriving} streaming={true} toolLabel={toolLabel} />)
  await expect.element(page.getByText('Half a sen')).toBeVisible()
  // Offering it mid-stream invites copying an unfinished sentence.
  expect(page.getByRole('button', { name: 'Copy' }).query()).toBeNull()
})
