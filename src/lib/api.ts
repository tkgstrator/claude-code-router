import type { RouterConfig } from '@/schemas'
import type { Config } from '@/types'

export interface RoutingPresetItem {
  id: string
  name: string
  config: RouterConfig
  createdAt: string
  updatedAt: string
}

export interface RequestLogItem {
  id: string
  sessionId: string
  provider: string
  model: string
  // What the client asked for pre-routing, and the routing lane it hit.
  // Null on rows written before routing capture landed.
  requestedModel: string | null
  scenario: string | null
  // Which inbound surface served the request (an `InboundSurface.id`
  // slug). Finer than inboundType: /v1/chat/completions and
  // /v1/responses are both 'openai'. Null on pre-migration rows.
  surface: string | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalInputTokens: number
  cacheHitPct: number
  durationMs: number
  status: number
  createdAt: string
  inputCostUsd: number | null
  outputCostUsd: number | null
  cacheReadCostUsd: number | null
  totalCostUsd: number | null
}

export type InboundType = 'anthropic' | 'openai'

export interface SessionSummary {
  sessionId: string
  // Wire format the session first came in on. Null on pre-migration
  // sessions.
  inboundType: InboundType | null
  // Surface of the session's most recent request; null when untracked.
  surface: string | null
  requestCount: number
  providers: string[]
  models: string[]
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
  avgCacheHitPct: number
  totalDurationMs: number
  totalCostUsd: number | null
  firstAt: string
  lastAt: string
  preview: string | null
}

// One archived chat turn. Content is Anthropic-shaped block arrays for
// assistant rows, and either a string or a tool_result block array for
// user rows (Claude Code's tool-result turns). Kept as `unknown` on the
// wire — the renderer branches on shape at read time.
export interface SessionMessageItem {
  id: string
  role: string
  content: unknown
  createdAt: string
}

// One actual upstream target a requested model was routed to.
export interface ModelRoutingTarget {
  provider: string
  model: string
  scenario: string | null
  isSubagent: boolean
  count: number
}

// All targets a single requested model fanned out to, with its total.
// requestedModel is null for rows written before routing capture landed.
export interface ModelRoutingRow {
  requestedModel: string | null
  total: number
  targets: ModelRoutingTarget[]
}

export interface ModelRoutingResponse {
  rows: ModelRoutingRow[]
  total: number
}

// Browser-side API client. Fetches under `${baseUrl}<endpoint>` with the
// envelope APIKEY (mirrored onto X-API-Key) attached automatically. The
// temp key from `?tempApiKey=` lets the integrated `ccr ui` flow open the
// UI pre-authenticated without persisting the long-lived key.
class ApiClient {
  private baseUrl: string
  private apiKey: string
  private tempApiKey: string | null

  constructor(baseUrl: string = '/api', apiKey: string = '') {
    this.baseUrl = baseUrl
    this.apiKey = apiKey || localStorage.getItem('apiKey') || ''
    this.tempApiKey = new URLSearchParams(window.location.search).get('tempApiKey')
  }

  setApiKey(apiKey: string) {
    this.apiKey = apiKey
    if (apiKey) {
      localStorage.setItem('apiKey', apiKey)
    } else {
      localStorage.removeItem('apiKey')
    }
  }

  private authHeader(): Record<string, string> {
    if (this.tempApiKey) return { 'X-Temp-API-Key': this.tempApiKey }
    if (this.apiKey) return { 'X-API-Key': this.apiKey }
    return {}
  }

  private async apiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...this.authHeader(),
        ...options.headers
      }
    })

    if (response.status === 401) {
      // 401 invalidates the stored key. The event tells the shell to send
      // the operator to the login screen; the throw is what stops every
      // caller here.
      //
      // This used to `return new Promise(() => {})` — a promise that
      // never settles — on the theory that navigation would unmount the
      // caller anyway. It does not: a hanging promise means no `.catch`
      // and no `.finally` ever runs, so every screen that fetched sat on
      // its loading state forever with nothing on screen to explain why.
      localStorage.removeItem('apiKey')
      window.dispatchEvent(new CustomEvent('unauthorized'))
      throw new Error('Unauthorized')
    }

    if (!response.ok) {
      let errorMessage = `API request failed: ${response.status} ${response.statusText}`
      try {
        const errorData = await response.json()
        if (errorData.error || errorData.message) {
          errorMessage = errorData.message || errorData.error || errorMessage
        }
      } catch {
        // body wasn't JSON; fall back to status line
      }
      throw new Error(errorMessage)
    }

    if (response.status === 204) return {} as T
    const text = await response.text()
    return text ? JSON.parse(text) : ({} as T)
  }

  async get<T>(endpoint: string): Promise<T> {
    return this.apiFetch<T>(endpoint, { method: 'GET' })
  }

  async post<T>(endpoint: string, data: unknown): Promise<T> {
    return this.apiFetch<T>(endpoint, { method: 'POST', body: JSON.stringify(data) })
  }

  async put<T>(endpoint: string, data: unknown): Promise<T> {
    return this.apiFetch<T>(endpoint, { method: 'PUT', body: JSON.stringify(data) })
  }

  private async deleteRequest<T>(endpoint: string, body: unknown = {}): Promise<T> {
    return this.apiFetch<T>(endpoint, { method: 'DELETE', body: JSON.stringify(body) })
  }

  // Configuration
  async getConfig(): Promise<Config> {
    return this.get<Config>('/config')
  }

  async updateConfig(config: Config): Promise<Config> {
    return this.post<Config>('/config', config)
  }

  // Service control
  async restartService(): Promise<unknown> {
    return this.post<void>('/restart', {})
  }

  async checkForUpdates(): Promise<{ hasUpdate: boolean; latestVersion?: string; changelog?: string }> {
    return this.get<{ hasUpdate: boolean; latestVersion?: string; changelog?: string }>('/update/check')
  }

  async performUpdate(): Promise<{ success: boolean; message: string }> {
    return this.post<{ success: boolean; message: string }>('/api/update/perform', {})
  }

  // Logs
  async getLogFiles(): Promise<Array<{ name: string; path: string; size: number; lastModified: string }>> {
    return this.get<Array<{ name: string; path: string; size: number; lastModified: string }>>('/logs/files')
  }

  async getLogs(filePath: string): Promise<string[]> {
    return this.get<string[]>(`/logs?file=${encodeURIComponent(filePath)}`)
  }

  async clearLogs(filePath: string): Promise<void> {
    return this.deleteRequest<void>(`/logs?file=${encodeURIComponent(filePath)}`)
  }

  // Presets
  async getPresets(): Promise<{ presets: Array<any> }> {
    return this.get<{ presets: Array<any> }>('/presets')
  }

  async getPreset(name: string): Promise<any> {
    return this.get<any>(`/presets/${encodeURIComponent(name)}`)
  }

  async applyPreset(name: string, secrets: Record<string, string>): Promise<any> {
    return this.post<any>(`/presets/${encodeURIComponent(name)}/apply`, { secrets })
  }

  async deletePreset(name: string): Promise<any> {
    return this.deleteRequest<any>(`/presets/${encodeURIComponent(name)}`)
  }

  async getMarketPresets(): Promise<{ presets: Array<any> }> {
    return this.get<{ presets: Array<any> }>('/presets/market')
  }

  async installPresetFromGitHub(repo: string, name?: string): Promise<any> {
    return this.post<any>('/presets/install/github', { repo, name })
  }

  // Request logs
  async getSessionSummary(sessionId: string): Promise<SessionSummary> {
    return this.get<SessionSummary>(`/request-logs/sessions/${encodeURIComponent(sessionId)}/summary`)
  }

  async getSessionLogs(sessionId: string): Promise<{ items: RequestLogItem[] }> {
    return this.get<{ items: RequestLogItem[] }>(`/request-logs/sessions/${encodeURIComponent(sessionId)}`)
  }

  async getSessionMessages(
    sessionId: string,
    params?: { limit?: number; before?: string }
  ): Promise<{ items: SessionMessageItem[]; nextCursor: string | null }> {
    const q = new URLSearchParams()
    if (params?.limit != null) q.set('limit', String(params.limit))
    if (params?.before != null) q.set('before', params.before)
    const qs = q.toString()
    return this.get<{ items: SessionMessageItem[]; nextCursor: string | null }>(
      `/request-logs/sessions/${encodeURIComponent(sessionId)}/messages${qs ? `?${qs}` : ''}`
    )
  }

  async getRequestLogSessions(params?: {
    limit?: number
    offset?: number
    sinceHours?: number
    inboundType?: InboundType
  }): Promise<{
    sessions: SessionSummary[]
    total: number
  }> {
    const q = new URLSearchParams()
    if (params?.limit != null) q.set('limit', String(params.limit))
    if (params?.offset != null) q.set('offset', String(params.offset))
    if (params?.sinceHours != null) q.set('sinceHours', String(params.sinceHours))
    if (params?.inboundType != null) q.set('inboundType', params.inboundType)
    const qs = q.toString()
    return this.get<{ sessions: SessionSummary[]; total: number }>(`/request-logs/sessions${qs ? `?${qs}` : ''}`)
  }

  // Archive every active session: it drops out of the History list while its
  // cost/usage totals are preserved. Returns the number of sessions archived.
  async archiveAllSessions(): Promise<{ archived: number }> {
    return this.post<{ archived: number }>('/request-logs/sessions/archive', {})
  }

  // Router snapshots — Draft model. Applying a preset is a client-side
  // action (replace the RoutingEditor's local state); this API just
  // stores/reads/updates/deletes the snapshots themselves.
  async listRoutingPresets(): Promise<{ presets: RoutingPresetItem[] }> {
    return this.get<{ presets: RoutingPresetItem[] }>('/routing-presets')
  }

  async createRoutingPreset(input: { name: string; config: RouterConfig }): Promise<RoutingPresetItem> {
    return this.post<RoutingPresetItem>('/routing-presets', input)
  }

  async updateRoutingPreset(id: string, input: { name?: string; config?: RouterConfig }): Promise<RoutingPresetItem> {
    return this.apiFetch<RoutingPresetItem>(`/routing-presets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input)
    })
  }

  async deleteRoutingPreset(id: string): Promise<void> {
    return this.deleteRequest<void>(`/routing-presets/${encodeURIComponent(id)}`)
  }

  // Requested-model → actual-target routing distribution. sinceHours=0
  // (default) counts all time.
  async getModelRouting(params?: { sinceHours?: number }): Promise<ModelRoutingResponse> {
    const q = new URLSearchParams()
    if (params?.sinceHours != null) q.set('sinceHours', String(params.sinceHours))
    const qs = q.toString()
    return this.get<ModelRoutingResponse>(`/request-logs/model-routing${qs ? `?${qs}` : ''}`)
  }

  // Router preferences (Phase 6). The singleton preference chain that
  // the quota-aware router walks. GET is empty on a fresh DB, PUT
  // replaces the whole chain atomically.
  async getRouterPreferences(): Promise<RouterPreferenceProfileWire> {
    return this.get<RouterPreferenceProfileWire>('/router-preferences')
  }

  async putRouterPreferences(profile: RouterPreferenceProfileWire): Promise<RouterPreferencesApplyResponse> {
    return this.put<RouterPreferencesApplyResponse>('/router-preferences', profile)
  }

  // Router scheduler snapshot (Phase 5). Read-only. Cold-boot returns
  // an empty snapshot with tickAt=null so the UI renders "no data yet"
  // without a special path.
  async getRoutingSchedulerState(): Promise<RoutingSchedulerStateResponse> {
    return this.get<RoutingSchedulerStateResponse>('/routing-scheduler-state')
  }

  // Set a per-model manual tier override (Tier Editor). Send null to
  // clear and fall back to name inference. Reuses PATCH
  // /api/providers/{name}/models/{model}.
  async setModelTier(
    providerName: string,
    modelName: string,
    manualTier: 'fable' | 'opus' | 'sonnet' | 'haiku' | null
  ): Promise<{ success: boolean }> {
    return this.apiFetch<{ success: boolean }>(
      `/providers/${encodeURIComponent(providerName)}/models/${encodeURIComponent(modelName)}`,
      { method: 'PATCH', body: JSON.stringify({ manualTier }) }
    )
  }

  // Set a per-model reasoning-effort override. Send null to clear and
  // fall back to the vendor default. Reuses the same PATCH endpoint.
  async setModelReasoningEffort(
    providerName: string,
    modelName: string,
    reasoningEffort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null
  ): Promise<{ success: boolean }> {
    return this.apiFetch<{ success: boolean }>(
      `/providers/${encodeURIComponent(providerName)}/models/${encodeURIComponent(modelName)}`,
      { method: 'PATCH', body: JSON.stringify({ reasoningEffort }) }
    )
  }

  // Router utilization dashboard (Phase 7). Aggregations over the
  // requested window in hours (default 24).
  async getRouterUtilization(params?: { windowHours?: number }): Promise<RouterUtilizationResponse> {
    const q = new URLSearchParams()
    if (params?.windowHours != null) q.set('windowHours', String(params.windowHours))
    const qs = q.toString()
    return this.get<RouterUtilizationResponse>(`/router-utilization${qs ? `?${qs}` : ''}`)
  }

  // Overview screen. One call for the whole summary so its blocks all
  // describe the same instant.
  async getOverview(params?: { windowHours?: number }): Promise<OverviewResponse> {
    const q = new URLSearchParams()
    if (params?.windowHours != null) q.set('windowHours', String(params.windowHours))
    const qs = q.toString()
    return this.get<OverviewResponse>(`/overview${qs ? `?${qs}` : ''}`)
  }

  // Inbound surfaces + their effective routing mode.
  async getInboundSurfaces(): Promise<{ surfaces: InboundSurfaceWire[] }> {
    return this.get<{ surfaces: InboundSurfaceWire[] }>('/inbound-surfaces')
  }

  async updateInboundSurface(body: {
    surface: SurfaceId
    routingMode: RoutingMode
    profileKey?: string | null
  }): Promise<{ surfaces: InboundSurfaceWire[] }> {
    return this.post<{ surfaces: InboundSurfaceWire[] }>('/inbound-surfaces', body)
  }

  // Access tokens (Phase 3.5). Issue returns the plaintext once; there is
  // no endpoint that can show it again.
  async getAccessTokens(): Promise<{ tokens: AccessTokenWire[] }> {
    return this.get<{ tokens: AccessTokenWire[] }>('/access-tokens')
  }

  async issueAccessToken(body: {
    name: string
    surface?: SurfaceId | null
    profileKey?: string | null
    expiresAt?: string | null
  }): Promise<{ token: AccessTokenWire; plaintext: string }> {
    return this.post<{ token: AccessTokenWire; plaintext: string }>('/access-tokens', body)
  }

  async revokeAccessToken(id: string): Promise<AccessTokenWire> {
    return this.post<AccessTokenWire>(`/access-tokens/${encodeURIComponent(id)}/revoke`, {})
  }

  // Prefer revoke: deleting a token also deletes the answer to "whose
  // requests were these" on every RequestLog row it authenticated.
  async deleteAccessToken(id: string): Promise<{ deleted: boolean }> {
    return this.deleteRequest<{ deleted: boolean }>(`/access-tokens/${encodeURIComponent(id)}`)
  }

  // Identity for the shell footer. Verified upstream by adminAuth — a
  // forged Cf-Access-* header never reaches the handler.
  async getIdentity(): Promise<IdentityResponse> {
    return this.get<IdentityResponse>('/identity')
  }

  // Liveness. Served outside the API-key gate (it is a probe endpoint),
  // hence the absolute path rather than the /api base.
  async getHealth(): Promise<HealthResponse> {
    const res = await fetch('/health', { headers: { Accept: 'application/json' } })
    return res.json()
  }
}

export interface HealthResponse {
  status: 'ok' | 'degraded'
  version: string
  uptime_seconds: number
  checks: Record<string, 'ok' | 'fail' | 'skip'>
}

export type SurfaceId = 'anthropic-messages' | 'openai-chat' | 'openai-responses' | 'gemini-generate'
export type RoutingMode = 'routed' | 'passthrough'

export interface InboundSurfaceWire {
  id: SurfaceId
  path: string
  client: string
  inboundType: 'anthropic' | 'openai' | 'gemini'
  auth: 'x-api-key' | 'bearer' | 'google'
  errorShape: 'anthropic' | 'openai' | 'google'
  routingMode: RoutingMode
  defaultRoutingMode: RoutingMode
  profileKey: string
  overridden: boolean
}

export interface AccessTokenWire {
  id: string
  name: string
  /** First characters only — identifies a token without being usable. */
  prefix: string
  surface: string | null
  profileKey: string | null
  lastUsedAt: string | null
  requestCount: number
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
}

export interface IdentityResponse {
  mode: 'cloudflare_access' | 'token'
  email: string | null
  // False means /api/* is gated by the single bootstrap token alone.
  accessConfigured: boolean
}

export interface OverviewSurfaceTraffic {
  id: string
  path: string
  client: string
  routingMode: RoutingMode
  requests: number
  p50Ms: number | null
  errorRate: number | null
}

export interface OverviewSpendRow {
  label: 'today' | 'week' | 'month' | 'savedBySubscription'
  usd: number | null
  deltaRatio: number | null
}

export interface OverviewQuotaRow {
  subAccountId: string
  account: string
  window: string
  pct: number
  resetAt: string | null
}

export interface OverviewFailoverRow {
  kind: 'rate_limit' | 'weight'
  tone: 'bad' | 'warn'
  label: string
  headline: string
  detail: string
  at: string
}

export interface OverviewRecentSession {
  sessionId: string
  surface: string | null
  model: string
  turns: number
  tokens: number
  costUsd: number | null
  lastAt: string
}

export interface OverviewResponse {
  windowHours: number
  generatedAt: string
  providerCount: number
  enabledModelCount: number
  surfaces: OverviewSurfaceTraffic[]
  spend: OverviewSpendRow[]
  quota: OverviewQuotaRow[]
  failover: OverviewFailoverRow[]
  recentSessions: OverviewRecentSession[]
}

export interface RouterPreferenceEntryWire {
  priority: number
  target: string
  enabled: boolean
  // Optional per-entry override of the global escalation / demotion
  // gates. Undefined = inherit the global constraint.
  allowEscalation?: boolean
  allowDemotion?: boolean
}

export type PreferenceScenarioKey = 'default' | 'think' | 'longContext' | 'webSearch' | 'image'
export type PreferenceKind = 'agent' | 'subagent'

// Each scenario carries two independent ordered chains: `agent` for
// main-agent traffic, `subagent` for requests carrying a
// <CCR-SUBAGENT-MODEL> tag. Both are always present so the UI can
// render an empty tab without a "missing" branch.
export interface PreferenceEntriesByKindWire {
  agent: RouterPreferenceEntryWire[]
  subagent: RouterPreferenceEntryWire[]
}

export type PreferenceEntriesByScenarioWire = Record<PreferenceScenarioKey, PreferenceEntriesByKindWire>

export interface RouterPreferenceProfileWire {
  entriesByScenario: PreferenceEntriesByScenarioWire
  constraints: Record<string, unknown> | null
}

export interface RouterPreferencesApplyResponse {
  success: boolean
  warnings: string[]
}

export interface RoutingSchedulerWeightEntry {
  target: string
  weight: number
  healthiness: number
  remainingBudgetPct: number | null
  earliestResetAt: string | null
  reasons: string[]
}

export interface RoutingSchedulerAccountView {
  subAccountId: string
  providerName: string
  kind: 'claude' | 'codex'
  fiveHour: { used: number; limit: number; resetAt: string | null } | null
  weekly: { used: number; limit: number; resetAt: string | null } | null
  refreshedAt: string | null
  stale: boolean
}

export interface RoutingSchedulerStateResponse {
  tickAt: string | null
  tickCount: number
  consecutiveFailures: number
  degraded: boolean
  weights: RoutingSchedulerWeightEntry[]
  accounts: RoutingSchedulerAccountView[]
  soonestResetAt: string | null
  recentChanges: Array<{ target: string; from: number; to: number; reason: string; tickAt: string }>
}

export interface RouterUtilizationPerScenarioRow {
  scenario: string
  total: number
  ok: number
  err429: number
  errOther: number
}

export interface RouterUtilizationPerTargetRow {
  requestedModel: string | null
  sentTo: string
  count: number
}

export interface RouterUtilizationPerAccountRow {
  subAccountId: string
  providerName: string
  kind: 'claude' | 'codex'
  currentBudgetPct: number | null
  fiveHourResetAt: string | null
  weeklyResetAt: string | null
  stale: boolean
}

export interface RouterUtilizationSuggestion {
  kind: 'primary_never_reached' | 'fallback_over_used' | 'exhausted_no_secondary'
  target: string
  detail: string
  proposedDiff: Record<string, unknown>
}

export interface RouterUtilizationResponse {
  windowHours: number
  generatedAt: string
  perScenario: RouterUtilizationPerScenarioRow[]
  perTarget: RouterUtilizationPerTargetRow[]
  perAccount: RouterUtilizationPerAccountRow[]
  suggestions: RouterUtilizationSuggestion[]
}

export const api = new ApiClient()
