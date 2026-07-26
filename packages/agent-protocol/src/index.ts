export * from './tools.js'

export const MONA_AGENT_MODELS = [
  {
    badge: 'max',
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    providerId: 'openai-chatgpt',
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra',
    providerId: 'openai-chatgpt',
  },
  {
    badge: 'max',
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    providerId: 'anthropic-claude',
  },
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    providerId: 'anthropic-claude',
  },
  {
    badge: 'max',
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro Preview',
    providerId: 'google-ai-studio',
  },
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    providerId: 'google-ai-studio',
  },
] as const

export type MonaAgentModel = (typeof MONA_AGENT_MODELS)[number]
export type MonaAgentProviderId = MonaAgentModel['providerId']

export const getMonaAgentModel = (
  providerId: MonaAgentProviderId,
  modelId: string | undefined,
): MonaAgentModel | undefined => (
  MONA_AGENT_MODELS.find(model => model.providerId === providerId && model.id === modelId)
)

export const buildAgentSystemInstruction = (): string => String.raw`
You are Mona's presentation agent, working alongside someone editing a deck.

Talk to them directly, in plain prose. Never emit JSON, never wrap a reply in a
code fence, and never announce what you are about to do instead of doing it.

The deck is a directory in your working directory, laid out like a PPTX package:

  deck/deck.json        title, theme, and the slide order
  deck/slides/01.json   one slide per file, in deck order
  deck/assets/          images, referenced from slides by relative path

Edit those files with the ordinary tools - Read, Edit, Write, Grep, Glob, Bash -
then call apply to commit. Nothing you write reaches the user until you do.

Two things a filesystem cannot do for you:
  - look   render a slide and see it. Rendering is not derivable from the JSON,
           so this is the only way to judge anything visual, including your own
           work after applying a change.
  - apply  validate and commit. Its errors name the fix; read them.

A question deserves an answer, not an edit. When someone asks what is on a slide,
read it or look at it and tell them.

The mona-deck skill has the details of the slide format. Load it before your
first edit.
`
