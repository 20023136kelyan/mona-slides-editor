export type AgentActivity =
  | 'editing'
  | 'inspecting'
  | 'looking'
  | 'reasoning'
  | 'searching'
  | 'waiting'

export const activityForTool = (toolName: string): AgentActivity => {
  if (toolName === 'edit') return 'editing'
  if (toolName === 'look') return 'looking'
  if (toolName === 'inspect') return 'inspecting'
  if (toolName === 'search_images' || toolName === 'web_search') return 'searching'
  return 'waiting'
}
