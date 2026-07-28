import type { Config } from '@/types'

export interface RequestLogItem {
  id: string
  sessionId: string
  provider: string
  model: string
  // What the client asked for pre-routing, and the routing lane it hit.
  // Null on rows written before routing capture landed.
  requestedModel: string | null
  scenario: string | null
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

export interface SessionSummary {
  sessionId: string
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
      // 401 invalidates the stored key; the app listens for this event
      // and routes back to the login screen (memory router — can't push
      // from here directly).
      localStorage.removeItem('apiKey')
      window.dispatchEvent(new CustomEvent('unauthorized'))
      return new Promise(() => {}) as Promise<T>
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

  async getRequestLogSessions(params?: { limit?: number; offset?: number; sinceHours?: number }): Promise<{
    sessions: SessionSummary[]
    total: number
  }> {
    const q = new URLSearchParams()
    if (params?.limit != null) q.set('limit', String(params.limit))
    if (params?.offset != null) q.set('offset', String(params.offset))
    if (params?.sinceHours != null) q.set('sinceHours', String(params.sinceHours))
    const qs = q.toString()
    return this.get<{ sessions: SessionSummary[]; total: number }>(`/request-logs/sessions${qs ? `?${qs}` : ''}`)
  }

  // Archive every active session: it drops out of the History list while its
  // cost/usage totals are preserved. Returns the number of sessions archived.
  async archiveAllSessions(): Promise<{ archived: number }> {
    return this.post<{ archived: number }>('/request-logs/sessions/archive', {})
  }

  // Requested-model → actual-target routing distribution. sinceHours=0
  // (default) counts all time.
  async getModelRouting(params?: { sinceHours?: number }): Promise<ModelRoutingResponse> {
    const q = new URLSearchParams()
    if (params?.sinceHours != null) q.set('sinceHours', String(params.sinceHours))
    const qs = q.toString()
    return this.get<ModelRoutingResponse>(`/request-logs/model-routing${qs ? `?${qs}` : ''}`)
  }
}

export const api = new ApiClient()
