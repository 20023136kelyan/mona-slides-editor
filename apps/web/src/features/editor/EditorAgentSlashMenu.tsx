import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import type { AgentSlashCommand } from '@/features/editor/agent/agent-slash-commands'
import { cn } from '@/lib/utils'

/**
 * Command completion above the composer.
 *
 * Appears while the draft is a partial command, so the agent's capabilities are
 * discoverable by typing rather than only through icons. Arrow keys move the
 * selection; the composer owns the keyboard so typing is never interrupted.
 */
export function EditorAgentSlashMenu({
  commands,
  onSelect,
  selected,
}: {
  commands: readonly AgentSlashCommand[]
  onSelect: (command: AgentSlashCommand) => void
  selected: number
}) {
  const { t } = useTranslation()

  useEffect(() => {
    document.querySelector('[data-slash-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  if (!commands.length) return null
  return (
    <div
      aria-label={t('foundation.editor.agent.slashCommands')}
      className="mona-agent-slash mb-1.5 max-h-44 overflow-y-auto rounded-overlay border border-border bg-background p-1 shadow-[0_8px_26px_rgb(15_23_42/8%)]"
      role="listbox"
    >
      {commands.map((command, index) => (
        <Button
          aria-selected={index === selected}
          className={cn(
            'h-auto w-full justify-start gap-2 rounded-control px-2 py-1.25 text-left font-normal',
            index === selected && 'bg-ink-deep/6',
          )}
          data-slash-selected={index === selected ? 'true' : undefined}
          key={command.name}
          onClick={() => onSelect(command)}
          role="option"
          size="sm"
          type="button"
          variant="ghost"
        >
          <span className="font-mono text-[12px] font-medium">/{command.name}</span>
          {command.argument ? <span className="font-mono text-micro text-muted-foreground">{command.argument}</span> : null}
          <span className="ml-auto truncate text-mini text-muted-foreground">{t(command.descriptionKey)}</span>
        </Button>
      ))}
    </div>
  )
}
