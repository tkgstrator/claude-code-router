import * as React from 'react'
import * as RechartsPrimitive from 'recharts'
import { cn } from '@/lib/utils'

// Trimmed shadcn-style chart wrapper: a themed container that injects
// `--color-<key>` CSS vars from the config and applies the shadcn
// chart styling to recharts' grid/axis/tooltip, plus tooltip/legend
// content that matches the shadcn card look.

export type ChartConfig = Record<string, { label: React.ReactNode; color?: string }>

interface ChartContextValue {
  config: ChartConfig
}

const ChartContext = React.createContext<ChartContextValue | null>(null)

function useChart(): ChartContextValue {
  const ctx = React.useContext(ChartContext)
  if (!ctx) throw new Error('useChart must be used within <ChartContainer>')
  return ctx
}

export function ChartContainer({
  config,
  className,
  children
}: {
  config: ChartConfig
  className?: string
  children: React.ReactElement
}) {
  const vars: React.CSSProperties & Record<string, string> = {}
  for (const [key, item] of Object.entries(config)) {
    if (item.color) vars[`--color-${key}`] = item.color
  }
  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-chart
        style={vars}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-none [&_.recharts-surface]:outline-none",
          className
        )}
      >
        <RechartsPrimitive.ResponsiveContainer width='100%' height='100%'>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
}

export const ChartTooltip = RechartsPrimitive.Tooltip
export const ChartLegend = RechartsPrimitive.Legend

interface TooltipEntry {
  dataKey?: string | number
  name?: string | number
  value?: number | string
  color?: string
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter
}: {
  active?: boolean
  payload?: TooltipEntry[]
  label?: string | number
  labelFormatter?: (label: string | number) => React.ReactNode
}) {
  const { config } = useChart()
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className='grid min-w-[8rem] gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl'>
      <div className='font-medium'>{labelFormatter && label !== undefined ? labelFormatter(label) : label}</div>
      <div className='grid gap-1'>
        {payload.map((entry) => {
          const key = String(entry.dataKey)
          const item = config[key]
          if (!item) return null
          return (
            <div key={key} className='flex items-center justify-between gap-3'>
              <span className='flex items-center gap-1.5 text-muted-foreground'>
                <span className='h-2 w-2 rounded-[2px]' style={{ backgroundColor: entry.color }} />
                {item.label}
              </span>
              <span className='font-mono font-medium tabular-nums text-foreground'>{entry.value}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface LegendEntry {
  dataKey?: string | number
  color?: string
}

export function ChartLegendContent({ payload }: { payload?: LegendEntry[] }) {
  const { config } = useChart()
  if (!payload) return null
  return (
    <div className='flex flex-wrap items-center justify-center gap-4 pt-3'>
      {payload.map((entry) => {
        const key = String(entry.dataKey)
        const item = config[key]
        if (!item) return null
        return (
          <span key={key} className='flex items-center gap-1.5 text-xs text-muted-foreground'>
            <span className='h-2 w-2 rounded-[2px]' style={{ backgroundColor: entry.color }} />
            {item.label}
          </span>
        )
      })}
    </div>
  )
}
