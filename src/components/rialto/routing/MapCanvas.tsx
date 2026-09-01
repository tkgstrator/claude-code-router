/**
 * The routing graph: inbound surface → scenario → target.
 *
 * Drawn as plain SVG rather than a graph library because the layout is
 * three fixed columns with computed rows — there is no free-form canvas to
 * pan, and a library's node measurement would fight the fixed column
 * widths that make the paths readable.
 *
 * The surface column is the part the old map lacked: it had no way to show
 * that three of the four surfaces never entered the graph at all.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { InboundSurfaceWire, RoutingSchedulerWeightEntry, SurfaceId } from '@/lib/api'
import { STATE_LABEL_KEYS, targetState } from './derive'
import type { PreferenceByScenario, ScenarioKey, TargetState } from './types'
import { SCENARIOS } from './types'

const NODE_H = 40
const SURFACE_X = 60
const SURFACE_W = 198
const SCENARIO_X = 340
const SCENARIO_W = 160
const TARGET_X = 700
const TARGET_W = 320
const CANVAS_W = 1080

const surfaceY = (i: number): number => 70 + i * 80
const scenarioY = (i: number): number => 60 + i * 80
const targetY = (i: number): number => 40 + i * 70

const EDGE_STROKE: Record<TargetState, string> = {
  ready: 'stroke-emerald-500',
  throttled: 'stroke-amber-500',
  exhausted: 'stroke-destructive',
  unknown: 'stroke-muted-foreground/50'
}

const DOT_FILL: Record<TargetState, string> = {
  ready: 'fill-emerald-500',
  throttled: 'fill-amber-500',
  exhausted: 'fill-destructive',
  unknown: 'fill-muted-foreground/40'
}

const SCENARIO_LABELS: Record<ScenarioKey, string> = {
  default: 'default',
  think: 'think',
  longContext: 'longContext',
  webSearch: 'webSearch',
  image: 'image'
}

function Edge({
  x1,
  y1,
  x2,
  y2,
  cls,
  dashed
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  cls: string
  dashed?: boolean
}) {
  const mid = (x1 + x2) / 2
  return (
    <path
      d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
      fill='none'
      strokeWidth='1.25'
      className={cls}
      strokeDasharray={dashed === true ? '3 3' : undefined}
      opacity='0.75'
    />
  )
}

function Node({
  x,
  y,
  w,
  label,
  sub,
  accent,
  dashed
}: {
  x: number
  y: number
  w: number
  label: string
  sub: string
  accent?: string
  dashed?: boolean
}) {
  return (
    <>
      <rect
        x={x}
        y={y}
        width={w}
        height={NODE_H}
        rx='6'
        className='fill-background stroke-border'
        strokeWidth='1'
        strokeDasharray={dashed === true ? '4 3' : undefined}
      />
      {accent === undefined ? null : <rect x={x} y={y} width='2.5' height={NODE_H} rx='1.25' className={accent} />}
      <text x={x + 12} y={y + 17} className='fill-foreground' fontSize='11' fontFamily='var(--font-mono)'>
        {label}
      </text>
      <text x={x + 12} y={y + 31} className='fill-muted-foreground' fontSize='9.5' fontFamily='var(--font-sans)'>
        {sub}
      </text>
    </>
  )
}

function ColumnLabel({ x, text }: { x: number; text: string }) {
  return (
    <text
      x={x}
      y='30'
      className='fill-muted-foreground'
      fontSize='9.5'
      letterSpacing='1.2'
      fontFamily='var(--font-sans)'
    >
      {text}
    </text>
  )
}

export interface MapCanvasProps {
  surfaces: readonly InboundSurfaceWire[]
  byScenario: PreferenceByScenario
  targets: readonly string[]
  weights: Map<string, RoutingSchedulerWeightEntry>
  /** Press a surface, release on a scenario, to put that surface into routed mode. */
  onDropOnScenario: (surface: SurfaceId) => void
  /** Press and release on the same surface — a plain click — to flip its mode. */
  onToggleSurface: (surface: SurfaceId) => void
}

export function MapCanvas({
  surfaces,
  byScenario,
  targets,
  weights,
  onDropOnScenario,
  onToggleSurface
}: MapCanvasProps) {
  const { t } = useTranslation()
  // Which surface the pointer went down on, so a release over a scenario
  // reads as "route this surface" and a release over the same node reads
  // as a plain click.
  const [pressed, setPressed] = useState<SurfaceId | null>(null)
  const rowOf = new Map(targets.map((target, i) => [target, targetY(i)]))
  const callerY = targetY(targets.length)
  const height = Math.max(460, callerY + NODE_H + 20)
  const passthrough = surfaces.filter((s) => s.routingMode === 'passthrough')

  return (
    <svg
      viewBox={`0 0 ${CANVAS_W} ${height}`}
      className='w-full select-none'
      style={{ height }}
      onPointerUp={() => setPressed(null)}
    >
      <title>{t('routing.map.canvasTitle')}</title>

      {surfaces.map((surface, i) =>
        surface.routingMode === 'routed' ? (
          SCENARIOS.map((scenario, j) => (
            <Edge
              key={`${surface.id}-${scenario}`}
              x1={SURFACE_X + SURFACE_W}
              y1={surfaceY(i) + 20}
              x2={SCENARIO_X - 10}
              y2={scenarioY(j) + 20}
              cls='stroke-muted-foreground/50'
            />
          ))
        ) : (
          <Edge
            key={surface.id}
            x1={SURFACE_X + SURFACE_W}
            y1={surfaceY(i) + 20}
            x2={TARGET_X}
            y2={callerY + 20}
            cls='stroke-muted-foreground/40'
            dashed
          />
        )
      )}

      {SCENARIOS.map((scenario, j) =>
        targets.flatMap((target) => {
          const y = rowOf.get(target)
          const used = (['agent', 'subagent'] as const).some((lane) =>
            byScenario[scenario][lane].some((e) => e.target === target)
          )
          if (y === undefined || !used) return []
          return [
            <Edge
              key={`${scenario}-${target}`}
              x1={SCENARIO_X + SCENARIO_W}
              y1={scenarioY(j) + 20}
              x2={TARGET_X}
              y2={y + 20}
              cls={EDGE_STROKE[targetState(weights.get(target))]}
            />
          ]
        })
      )}

      <ColumnLabel x={SURFACE_X} text={t('routing.map.columnSurface')} />
      <ColumnLabel x={SCENARIO_X} text={t('routing.map.columnScenario')} />
      <ColumnLabel x={TARGET_X + 10} text={t('routing.map.columnTarget')} />

      {surfaces.map((surface, i) => (
        <g
          key={surface.id}
          className='cursor-pointer'
          onPointerDown={() => setPressed(surface.id)}
          onPointerUp={() => {
            if (pressed === surface.id) onToggleSurface(surface.id)
          }}
        >
          <Node
            x={SURFACE_X}
            y={surfaceY(i)}
            w={SURFACE_W}
            label={surface.path}
            sub={t(surface.routingMode === 'routed' ? 'routing.common.modeRouted' : 'routing.common.modePassthrough')}
            accent={surface.routingMode === 'routed' ? 'fill-emerald-500' : 'fill-muted-foreground/40'}
          />
        </g>
      ))}

      {SCENARIOS.map((scenario, j) => {
        const count = new Set(
          (['agent', 'subagent'] as const).flatMap((lane) => byScenario[scenario][lane].map((e) => e.target))
        ).size
        return (
          <g
            key={scenario}
            onPointerUp={() => {
              if (pressed !== null) onDropOnScenario(pressed)
            }}
          >
            <Node
              x={SCENARIO_X}
              y={scenarioY(j)}
              w={SCENARIO_W}
              label={SCENARIO_LABELS[scenario]}
              sub={t('routing.common.targetCount', { n: count })}
              accent='fill-foreground/30'
            />
          </g>
        )
      })}

      {targets.map((target, i) => {
        const state = targetState(weights.get(target))
        return (
          <g key={target}>
            <Node x={TARGET_X} y={targetY(i)} w={TARGET_W} label={target} sub={t(STATE_LABEL_KEYS[state])} />
            <circle cx={TARGET_X + TARGET_W - 14} cy={targetY(i) + 20} r='3.5' className={DOT_FILL[state]} />
          </g>
        )
      })}

      {passthrough.length === 0 ? null : (
        <Node x={TARGET_X} y={callerY} w={TARGET_W} label='body.model' sub={t('routing.map.callerNamed')} dashed />
      )}
    </svg>
  )
}
