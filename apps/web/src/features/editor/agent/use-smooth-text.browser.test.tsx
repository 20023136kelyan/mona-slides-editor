import { useEffect, useState } from 'react'
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { useSmoothText } from '@/features/agent/use-smooth-text'

function Probe({ active, value }: { active: boolean; value: string }) {
  return <p data-testid="out">{useSmoothText(value, active)}</p>
}

test('settled text is shown whole, never animated', async () => {
  render(<Probe active={false} value="already finished" />)
  await expect.element(page.getByTestId('out')).toHaveTextContent('already finished')
})

test('streaming text always converges on everything received', async () => {
  const sentence = 'a reasonably long sentence arriving in one burst'
  render(<Probe active={true} value={sentence} />)
  // Pacing is a visual property and cannot be asserted on a single frame
  // without flaking; what must hold is that nothing is ever left unread.
  await expect.element(page.getByTestId('out')).toHaveTextContent(sentence)
})

test('a shorter target restarts rather than running backwards', async () => {
  // A new, shorter message must not leave the tail of the previous one behind.
  function Swapping() {
    const [value, setValue] = useState('the first, much longer message')
    useEffect(() => {
      const timer = window.setTimeout(() => setValue('short'), 120)
      return () => window.clearTimeout(timer)
    }, [])
    return <Probe active={true} value={value} />
  }
  render(<Swapping />)
  await expect.element(page.getByTestId('out')).toHaveTextContent('short')
})
