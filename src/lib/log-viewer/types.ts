export interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string // This field now holds the raw JSON string directly
  source?: string
  reqId?: string
  [key: string]: any // Allow dynamic properties like msg, url, body, etc.
}

export interface LogFile {
  name: string
  path: string
  size: number
  lastModified: string
}

export interface GroupedLogs {
  [reqId: string]: LogEntry[]
}

export interface LogGroupSummary {
  reqId: string
  logCount: number
  firstLog: string
  lastLog: string
  model?: string
}

export interface GroupedLogsResponse {
  grouped: boolean
  groups: { [reqId: string]: LogEntry[] }
  summary: {
    totalRequests: number
    totalLogs: number
    requests: LogGroupSummary[]
  }
}
