import { expect, test } from 'vitest'

import { matchSlashCommands, parseSlashCommand } from '@/features/editor/agent/agent-slash-commands'

test('an ordinary message is never treated as a command', () => {
  expect(matchSlashCommands('make the title bigger')).toEqual([])
  expect(parseSlashCommand('make the title bigger')).toBeNull()
})

test('a partial name filters the list', () => {
  expect(matchSlashCommands('/l').map(command => command.name)).toEqual(['look'])
  expect(matchSlashCommands('/s').map(command => command.name)).toEqual(['stop'])
})

test('every listed command is one the composer actually handles', () => {
  // `/compact`, `/think` and `/tools` were listed while doing nothing: their
  // handlers only set state no one read, and their catalog keys were gone, so
  // the menu offered three commands that silently did nothing.
  expect(matchSlashCommands('/').map(command => command.name).sort()).toEqual(['clear', 'look', 'stop'])
})

test('once the name is settled the list narrows to it', () => {
  expect(matchSlashCommands('/look ').map(command => command.name)).toEqual(['look'])
})

test('parses a command', () => {
  expect(parseSlashCommand('/look')).toEqual({ name: 'look' })
  expect(parseSlashCommand('/clear')).toEqual({ name: 'clear' })
})

test('an unknown command is sent as a message rather than swallowed', () => {
  expect(parseSlashCommand('/nonsense')).toBeNull()
})
