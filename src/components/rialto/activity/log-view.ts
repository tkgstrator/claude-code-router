/**
 * The vocabulary the three Logs panes agree on.
 *
 * Extracted from the screen because a chip's tone, its gutter colour and
 * its text colour are three tables keyed by the same four values, read
 * from three different panes. Split them across those panes and a fifth
 * level — or a renamed one — has to be found in three places; here it is
 * one edit and the compiler names the rest.
 *
 * `groupKey` rides along for the same reason: a group with no request id
 * is keyed as '' by the rail that lists it and by the screen that tracks
 * the selection, and those two have to agree or nothing stays selected.
 */
import type { LogGroup, LogLevel } from '@/components/rialto/activity/log-lines'
import type { Tone } from '@/components/rialto/primitives'

// The four levels an operator actually filters on. `fatal` folds into
// error and `trace` into debug so no line can hide from every chip.
export type LevelChip = 'error' | 'warn' | 'info' | 'debug'

export const LEVEL_CHIPS: readonly LevelChip[] = ['error', 'warn', 'info', 'debug']

export const chipFor = (level: LogLevel): LevelChip => {
  if (level === 'fatal' || level === 'error') return 'error'
  if (level === 'warn') return 'warn'
  if (level === 'info') return 'info'
  return 'debug'
}

export const LEVEL_TONE: Record<LevelChip, Tone> = { error: 'bad', warn: 'warn', info: 'mute', debug: 'mute' }

export const GUTTER: Record<LevelChip, string> = {
  error: 'bg-destructive',
  warn: 'bg-amber-500',
  info: 'bg-transparent',
  debug: 'bg-transparent'
}

export const LEVEL_TEXT: Record<LevelChip, string> = {
  error: 'text-destructive',
  warn: 'text-amber-600 dark:text-amber-400',
  info: 'text-muted-foreground/60',
  debug: 'text-muted-foreground/60'
}

export const groupKey = (group: LogGroup): string => (group.id === null ? '' : group.id)
