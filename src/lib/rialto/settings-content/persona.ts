/**
 * Pure helpers for the Personas settings section.
 *
 * Dependency-free so the size estimate and the preview excerpt can be
 * tested without mounting React.
 */
import type { Persona } from '@/types'

/**
 * A persona with its uuid guaranteed. `Persona.id` is optional only for
 * back-compat with configs written before the uuid migration, but the
 * editor keys every selection and every save on it, so the screen works
 * on this shape instead.
 */
export interface PersonaDraft {
  id: string
  name: string
  prompt: string
}

export function toDrafts(personas: Persona[]): PersonaDraft[] {
  return personas.map((persona) => ({
    id: typeof persona.id === 'string' && persona.id !== '' ? persona.id : crypto.randomUUID(),
    name: persona.name,
    prompt: persona.prompt
  }))
}

/** Whitespace-separated word count — what the header pill reports. */
export function countWords(prompt: string): number {
  const trimmed = prompt.trim()
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length
}

/**
 * Size of the persona in tokens, to one significant decision: is this
 * cheap or expensive to prepend to every turn. The real count comes from
 * tiktoken server-side; four characters per token is the rule of thumb
 * that gets within ~10% for English prose, which is why every caller
 * renders it behind a "≈".
 */
export function estimateTokens(prompt: string): number {
  return Math.round(prompt.length / 4)
}

/**
 * First non-empty line, clipped. The preview block shows one line of the
 * persona as the model will receive it, so a leading blank line or a
 * markdown heading must not swallow the whole excerpt.
 */
export function promptExcerpt(prompt: string, max = 80): string {
  const first = prompt.split('\n').find((line) => line.trim() !== '')
  if (first === undefined) return ''
  const trimmed = first.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`
}

/**
 * A free display name for a duplicated persona. Names are free-form
 * labels (personas are keyed by uuid), so a collision is legal — it is
 * just confusing, hence the counter.
 */
export function copyName(name: string, taken: string[]): string {
  const base = `${name} copy`
  if (!taken.includes(base)) return base
  // One candidate per existing name is always enough to find a free slot.
  const numbered = Array.from({ length: taken.length + 1 }, (_, i) => `${base} ${i + 2}`)
  const free = numbered.find((candidate) => !taken.includes(candidate))
  return free === undefined ? `${base} ${taken.length + 2}` : free
}
