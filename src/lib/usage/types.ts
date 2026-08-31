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
// One per-model 7-day window surfaced under `limits[].weekly_scoped` on
// the Anthropic OAuth usage API. `modelName` is the vendor's display
// name verbatim (e.g. "Fable").
export interface ClaudeScopedWindow {
  modelName: string
  utilization: number
  resetsAt: string | null
}
export interface ClaudeAccountUsage {
  subAccountId: string
  accountLabel: string
  fiveHour: ClaudeWindow | null
  sevenDay: ClaudeWindow | null
  sevenDaySonnet: ClaudeWindow | null
  sevenDayOpus: ClaudeWindow | null
  weeklyScoped: ClaudeScopedWindow[]
  extraUsageEnabled: boolean
  capturedAt: string
}
export interface CodexAccountUsage {
  subAccountId: string
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

// Result of the last auth probe. `invalid` = the account needs
// re-authentication via the CLI. Mirrors the server AuthStatus enum.
export type AuthStatus = 'unknown' | 'live' | 'invalid'

// Account roster from /api/subscriptions — the authoritative list of every
// connected account (including ones whose auth is dead and therefore drop
// out of the live usage feed). The Usage rate-limit panel is driven by this
// roster and joins usage bars on by subAccountId.
export interface SubscriptionAccount {
  id: string
  label: string
  enabled: boolean
  userName: string | null
  userEmail: string | null
  plan: string | null
  monthlyPriceUsd: number | null
  // Access-token expiry (rotated automatically); NOT a health signal.
  expiresAt: number | null
  // Codex only: when the paid subscription lapses.
  subscriptionEndsAt: number | null
  authStatus: AuthStatus
  authCheckedAt: number | null
  authError: string | null
}
export interface SubscriptionProvider {
  providerName: string
  kind: 'claude' | 'codex' | 'other'
  enabled: boolean
  accounts: SubscriptionAccount[]
  activeAccount: SubscriptionAccount | null
}
export interface SubscriptionsResponse {
  subscriptions: SubscriptionProvider[]
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
