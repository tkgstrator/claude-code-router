import dayjs from '@/lib/dayjs'
import type { MetricMeta, SeriesPoint, UsageSample } from './types'

export const CAP_PCT = 200
const SMOOTH_N = 6
const RESET_DROP_RATIO = 0.5

export const METRIC_META: Record<string, MetricMeta> = {
  'claude.five_hour': { label: 'Claude 5h', color: '#d97757', windowHours: 5 },
  'claude.seven_day': { label: 'Claude 7d', color: '#b35a3f', windowHours: 168 },
  'claude.seven_day_sonnet': { label: 'Claude 7d Sonnet', color: '#e6a08c', windowHours: 168 },
  'claude.seven_day_opus': { label: 'Claude 7d Opus', color: '#8c3d28', windowHours: 168 },
  'codex.primary': { label: 'Codex 5h', color: '#10a37f', windowHours: 5 },
  'codex.secondary': { label: 'Codex 7d', color: '#0a6f57', windowHours: 168 }
}

// Scoped-model 7-day metric keys are dynamic (`claude.seven_day_scoped.fable`,
// `.mythos`, ...) — Anthropic emits one per model in the account's plan.
// Rather than list them explicitly they get a derived label / palette color
// so a new model on the API renders without a code change.
const SCOPED_METRIC_PREFIX = 'claude.seven_day_scoped.'
const SCOPED_PALETTE = ['#8c3d28', '#e6a08c', '#a56b3f', '#c47a55', '#5d2818', '#f0b090']

// Stable palette index for a scoped model slug so the same model keeps the
// same color across renders (naive djb2-ish hash — small, deterministic).
const scopedPaletteIndex = (slug: string): number => {
  let h = 5381
  for (let i = 0; i < slug.length; i++) h = ((h << 5) + h + slug.charCodeAt(i)) | 0
  return Math.abs(h) % SCOPED_PALETTE.length
}

// Title-case a slug like "fable" or "iguana_necktie" so the chart legend
// reads "Fable" / "Iguana Necktie" rather than the raw metric key.
const titleCaseSlug = (slug: string): string =>
  slug
    .split('_')
    .filter((s) => s.length > 0)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(' ')

export function metaFor(metric: string): MetricMeta {
  const known = METRIC_META[metric]
  if (known) return known
  if (metric.startsWith(SCOPED_METRIC_PREFIX)) {
    const slug = metric.slice(SCOPED_METRIC_PREFIX.length)
    return {
      label: `Claude 7d ${titleCaseSlug(slug)}`,
      color: SCOPED_PALETTE[scopedPaletteIndex(slug)],
      windowHours: 168
    }
  }
  return { label: metric, color: '#888888', windowHours: 0 }
}

// A window "reset" is detected either from a sudden percent drop (vs. the
// previous sample) or from the vendor-supplied resetAt timestamp — whichever
// implies more elapsed time into the cycle — then the raw percent is
// projected onto the full cycle length so a partial window doesn't read as
// low usage.
function projectPoint(s: UsageSample, cycle: number, lastResetT: ReturnType<typeof dayjs> | null): SeriesPoint {
  const at = dayjs(s.t)
  const fromDrop = lastResetT ? at.diff(lastResetT, 'hour', true) : null
  const fromReset = s.resetAt ? cycle - Math.max(0, dayjs(s.resetAt).diff(at, 'hour', true)) : null
  const elapsedRaw =
    fromDrop !== null && fromReset !== null
      ? Math.max(fromDrop, fromReset)
      : fromDrop !== null
        ? fromDrop
        : fromReset !== null
          ? fromReset
          : Number.NaN
  if (cycle <= 0 || !Number.isFinite(elapsedRaw)) {
    return { t: s.t, v: Math.min(CAP_PCT, Math.max(0, s.percent)) }
  }
  const elapsed = Math.min(cycle, elapsedRaw)
  const projected = elapsed > 0 ? (s.percent * cycle) / elapsed : s.percent
  return { t: s.t, v: Math.min(CAP_PCT, Math.max(0, projected)) }
}

// Projects each raw usage sample onto its full reset-cycle percentage, then
// smooths the projection with a trailing moving average.
export function projectedUsage(samples: UsageSample[], metric: string): SeriesPoint[] {
  const cycle = metaFor(metric).windowHours
  const raw = samples
    .filter((s) => s.metric === metric)
    .reduce<{ lastResetT: ReturnType<typeof dayjs> | null; prevPct: number | null; points: SeriesPoint[] }>(
      (acc, s) => {
        const lastResetT =
          acc.prevPct !== null && s.percent < acc.prevPct * RESET_DROP_RATIO ? dayjs(s.t) : acc.lastResetT
        return { lastResetT, prevPct: s.percent, points: [...acc.points, projectPoint(s, cycle, lastResetT)] }
      },
      { lastResetT: null, prevPct: null, points: [] }
    ).points

  return raw.map((r, i) => {
    const win = raw.slice(Math.max(0, i - SMOOTH_N + 1), i + 1)
    return { t: r.t, v: Math.round((win.reduce((acc, w) => acc + w.v, 0) / win.length) * 10) / 10 }
  })
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

export function fmtCost(usd: number | null, noPricingLabel: string): string {
  if (usd === null) return noPricingLabel
  if (usd === 0) return '$0.00'
  if (usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

export function fmtReset(iso: string | null): string {
  if (!iso) return '—'
  const d = dayjs(iso)
  return d.isValid() ? d.format('YYYY/MM/DD HH:mm') : iso
}
