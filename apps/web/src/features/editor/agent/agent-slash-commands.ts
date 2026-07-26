export interface AgentSlashCommand {
  /** Argument hint shown after the name, when the command takes one. */
  argument?: string
  descriptionKey: string
  name: string
}

/**
 * Commands the composer understands.
 *
 * Each maps to something the harness can already do, surfaced by name so the
 * capabilities are discoverable from the keyboard rather than hidden behind
 * icons. Typing `/` filters this list; anything unmatched is sent as an
 * ordinary message.
 */
export const AGENT_SLASH_COMMANDS: readonly AgentSlashCommand[] = [
  { descriptionKey: 'foundation.editor.agent.slash.clear', name: 'clear' },
  { descriptionKey: 'foundation.editor.agent.slash.look', name: 'look' },
  { descriptionKey: 'foundation.editor.agent.slash.stop', name: 'stop' },
]

/** The command being typed, if the draft is a command rather than a message. */
export const matchSlashCommands = (draft: string): readonly AgentSlashCommand[] => {
  if (!draft.startsWith('/')) return []
  const typed = draft.slice(1).split(/\s/)[0]?.toLowerCase() ?? ''
  // A trailing space means the name is settled and an argument is being typed.
  if (/\s/.test(draft)) return AGENT_SLASH_COMMANDS.filter(command => command.name === typed)
  return AGENT_SLASH_COMMANDS.filter(command => command.name.startsWith(typed))
}

export interface ParsedSlashCommand {
  argument?: string
  name: string
}

/** Splits a settled command into its name and argument, or null for a message. */
export const parseSlashCommand = (draft: string): ParsedSlashCommand | null => {
  if (!draft.startsWith('/')) return null
  const [name, ...rest] = draft.slice(1).trim().split(/\s+/)
  if (!name) return null
  const known = AGENT_SLASH_COMMANDS.find(command => command.name === name.toLowerCase())
  if (!known) return null
  const argument = rest.join(' ').trim()
  return argument ? { argument, name: known.name } : { name: known.name }
}
