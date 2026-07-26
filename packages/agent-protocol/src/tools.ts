// Zod 4. The Claude Agent SDK peers on zod ^4 and `ai` accepts either line, so
// v4 is the one shape both harnesses take - and these schemas reach both.
import { z } from 'zod'

/**
 * The agent's tool surface, shared by the server that advertises it and the
 * browser that fulfils it.
 *
 * Deliberately small, because the deck is a directory of files and the ordinary
 * tools already know how to work with one. `Read`, `Edit`, `Grep`, `Glob` and
 * `Bash` do the editing; what has to be added is only what a filesystem cannot
 * express:
 *
 *   - `look`  rendering is not derivable from JSON, and it is how the agent
 *             checks its own work
 *   - `apply` the commit boundary: file edits become one transaction, validated
 *             once, so a whole run is a single undo
 *   - `sync`  re-take the workspace when the user has edited underneath it
 *
 * The previous surface was `look`/`inspect`/`edit`, where the whole document
 * arrived through one tool result and changes went back as a program in an
 * invented vocabulary. It failed in the way narrow interfaces do: a 23-slide deck
 * came through `inspect` as 193 MB, and `edit` accepting `text: "TEAM FIVE"` on a
 * shape produced a blank label - a valid call to an API the model had to guess at.
 *
 * What the browser fulfils is not quite what the model calls: `sync` is served by
 * asking for a fresh `snapshot` and rewriting the workspace, so the browser never
 * sees that word. `asset` is likewise internal - `snapshot` returns a manifest and
 * each asset's bytes are fetched on their own, because a deck's images do not fit
 * in one frame: measured at 342 MB against a 100 MiB socket limit.
 */
export const AGENT_CLIENT_TOOL_NAMES = ['look', 'snapshot', 'asset', 'apply'] as const
export const AGENT_SERVER_TOOL_NAMES = ['search_images', 'web_search'] as const

export type AgentClientToolName = (typeof AGENT_CLIENT_TOOL_NAMES)[number]

const slideIds = z.array(z.string())
  .optional()
  .describe('Slide ids to act on. Omit for the current slide.')

export const agentToolSchemas = {
  apply: z.object({
    explanation: z.string().describe('One short sentence describing the change, for the user.'),
  }),
  look: z.object({ slideIds }),
  search_images: z.object({ query: z.string().describe('A precise visual description.') }),
  sync: z.object({}),
  web_search: z.object({ query: z.string() }),
} as const

export const agentToolDescriptions = {
  apply: 'Commit your file changes to the deck. Reads deck/ back, validates it, and applies it as one undoable change. Nothing you write to disk reaches the user until you call this.',
  look: 'Render slides as images and look at them. Use this to answer questions about how a slide looks, and to check your own work after applying a change.',
  search_images: 'Search the shared photo library. Follow it with look to judge the candidates before choosing one.',
  sync: 'Re-read the deck from the editor into deck/, discarding uncommitted file changes. Only needed when apply reports that the deck changed underneath you.',
  web_search: 'Search the web for facts, figures or references to put on the slides.',
} as const
