/**
 * Editing operations on one (scenario, lane) chain.
 *
 * Kept out of the screen component: every mutation is the same
 * "replace one lane inside the per-scenario map" shape, and inlining five
 * of them is what turned the old preference editor into an 800-line file.
 */
import { useCallback, useMemo } from 'react'
import type { ChainRowActions } from './ChainTable'
import { renumber } from './derive'
import type { Lane, PreferenceByScenario, PreferenceEntry, PreferenceProfile, ScenarioKey } from './types'
import { SCENARIOS } from './types'

export interface ChainEditing {
  entries: PreferenceEntry[]
  actions: ChainRowActions
  addTarget: (target: string) => void
  /** Entry count per scenario for the tab badges, on the active lane. */
  counts: Record<ScenarioKey, number>
}

const laneCounts = (byScenario: PreferenceByScenario, lane: Lane): Record<ScenarioKey, number> => {
  const out: Record<ScenarioKey, number> = { default: 0, think: 0, longContext: 0, webSearch: 0, image: 0 }
  for (const scenario of SCENARIOS) out[scenario] = byScenario[scenario][lane].length
  return out
}

const move = (entries: readonly PreferenceEntry[], from: number, to: number): PreferenceEntry[] => {
  if (to < 0 || to >= entries.length) return [...entries]
  const next = [...entries]
  const [pulled] = next.splice(from, 1)
  next.splice(to, 0, pulled)
  return renumber(next)
}

export function useChainEditing(
  profile: PreferenceProfile,
  setProfile: React.Dispatch<React.SetStateAction<PreferenceProfile>>,
  scenario: ScenarioKey,
  lane: Lane
): ChainEditing {
  const mutate = useCallback(
    (fn: (prev: PreferenceEntry[]) => PreferenceEntry[]) => {
      setProfile((prev) => ({
        ...prev,
        entriesByScenario: {
          ...prev.entriesByScenario,
          [scenario]: { ...prev.entriesByScenario[scenario], [lane]: fn(prev.entriesByScenario[scenario][lane]) }
        }
      }))
    },
    [setProfile, scenario, lane]
  )

  const actions = useMemo<ChainRowActions>(
    () => ({
      onToggle: (index, enabled) => mutate((prev) => prev.map((e, i) => (i === index ? { ...e, enabled } : e))),
      onMove: (from, to) => mutate((prev) => move(prev, from, to)),
      onRemove: (index) => mutate((prev) => renumber(prev.filter((_, i) => i !== index)))
    }),
    [mutate]
  )

  const addTarget = useCallback(
    (target: string) => {
      mutate((prev) =>
        prev.some((e) => e.target === target) ? prev : [...prev, { priority: prev.length + 1, target, enabled: true }]
      )
    },
    [mutate]
  )

  const counts = useMemo(() => laneCounts(profile.entriesByScenario, lane), [profile, lane])

  return { entries: profile.entriesByScenario[scenario][lane], actions, addTarget, counts }
}
