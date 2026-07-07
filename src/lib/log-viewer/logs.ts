import dayjs from '@/lib/dayjs'
import type { GroupedLogsResponse, LogEntry } from './types'

// Kept for callers relying on this surface; no longer wired into the log
// viewer UI (raw log strings are rendered via the Monaco editor instead).
export function getDisplayLogs(
  logs: string[],
  groupedLogs: GroupedLogsResponse | null,
  groupByReqId: boolean,
  selectedReqId: string | null
): LogEntry[] {
  if (groupByReqId && groupedLogs) {
    if (selectedReqId && groupedLogs.groups[selectedReqId]) {
      return groupedLogs.groups[selectedReqId]
    }
    // In grouping mode without a selected request, fall back to the raw log strings
    return logs.map((logLine) => ({
      timestamp: dayjs().toISOString(),
      level: 'info',
      message: logLine,
      source: undefined,
      reqId: undefined
    }))
  }
  // Outside grouping mode, display the raw log strings as is
  return logs.map((logLine) => ({
    timestamp: dayjs().toISOString(),
    level: 'info',
    message: logLine,
    source: undefined,
    reqId: undefined
  }))
}

export function formatLogsForEditor(
  logs: string[],
  groupedLogs: GroupedLogsResponse | null,
  groupByReqId: boolean,
  selectedReqId: string | null
): string {
  // In grouping mode with a selected request, show that request's logs
  if (groupByReqId && groupedLogs && selectedReqId && groupedLogs.groups[selectedReqId]) {
    const requestLogs = groupedLogs.groups[selectedReqId]
    return requestLogs.map((log) => JSON.stringify(log, null, 2)).join('\n\n')
  }

  // Otherwise pretty-print each line as JSON when possible, falling back to the raw text
  return logs
    .map((logLine) => {
      try {
        return JSON.stringify(JSON.parse(logLine), null, 2)
      } catch {
        return logLine
      }
    })
    .join('\n\n')
}

// Parse log lines and return the line numbers of "final request" entries
export function getFinalRequestLines(
  logs: string[],
  groupedLogs: GroupedLogsResponse | null,
  groupByReqId: boolean,
  selectedReqId: string | null
): number[] {
  const lines: number[] = []

  if (groupByReqId && groupedLogs && selectedReqId && groupedLogs.groups[selectedReqId]) {
    // In grouping mode, scan the selected request's logs
    const requestLogs = groupedLogs.groups[selectedReqId]
    requestLogs.forEach((log, index) => {
      try {
        // @ts-expect-error log is read back as the parsed object
        const parsed = JSON.parse(log)
        // Check whether the log's msg field equals "final request"
        if (parsed.msg === 'final request') {
          lines.push(index + 1) // Line numbers are 1-based
        }
      } catch (_e) {
        // Parsing failed - skip
      }
    })
  } else {
    // Outside grouping mode, scan the raw logs
    logs.forEach((logLine, index) => {
      try {
        const log = JSON.parse(logLine)
        // Check whether the log's msg field equals "final request"
        if (log.msg === 'final request') {
          lines.push(index + 1) // Line numbers are 1-based
        }
      } catch (e) {
        // Parsing failed - skip
      }
    })
  }

  return lines
}
