// Wire shapes for the Usage page's live-usage and API-cost panels.

export interface UsageSample {
  metric: string
  percent: number
  t: string
  resetAt: string | null
}
export interface HistoryResponse {
  samples: UsageSample[]
}

export interface ClaudeWindow {
  utilization: number
  resetsAt: string | null
}
export interface CodexWindow {
  usedPercent: number
  resetAt: string | null
  windowSeconds: number | null
}
export interface ClaudeAccountUsage {
  accountLabel: string
  fiveHour: ClaudeWindow | null
  sevenDay: ClaudeWindow | null
  sevenDaySonnet: ClaudeWindow | null
  sevenDayOpus: ClaudeWindow | null
  extraUsageEnabled: boolean
  capturedAt: string
}
export interface CodexAccountUsage {
  accountLabel: string
  planType: string | null
  primary: CodexWindow | null
  secondary: CodexWindow | null
  capturedAt: string
}
export interface CurrentUsageResponse {
  claude: ClaudeAccountUsage[]
  codex: CodexAccountUsage[]
}

export interface SeriesPoint {
  t: string
  v: number
}

export interface MetricMeta {
  label: string
  color: string
  windowHours: number
}

export interface ModelCost {
  model: string
  requestCount: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalCostUsd: number | null
}
export interface ProviderCost {
  provider: string
  models: ModelCost[]
  totalCostUsd: number | null
  isSubscription: boolean
  subscriptionMonthlyUsd: number | null
}
export interface UsageCostResponse {
  providers: ProviderCost[]
  days: number
}

export interface CostHistoryResponse {
  points: Array<Record<string, string | number>>
  providers: string[]
  granularity: 'day' | 'week'
  days: number
}
