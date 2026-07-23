const search = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search)
  : null

export const referenceAgentEnabled = import.meta.env.DEV
  && Boolean(
    search?.has('developmentFixture')
    || search?.get('agentFixture') === 'reference',
  )
