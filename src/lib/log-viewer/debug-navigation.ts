import type { useNavigate } from 'react-router-dom'
import type { GroupedLogsResponse } from './types'

// Resolves which log entry corresponds to a clicked "final request" gutter
// line, then navigates to /debug with it serialised in the query string.
export function createDebugClickHandler(
  logs: string[],
  groupedLogs: GroupedLogsResponse | null,
  groupByReqId: boolean,
  selectedReqId: string | null,
  navigate: ReturnType<typeof useNavigate>
) {
  return (lineNumber: number) => {
    console.log('handleDebugClick called with lineNumber:', lineNumber)
    console.log('Current state:', { groupByReqId, selectedReqId, logsLength: logs.length })

    let logData = null

    if (groupByReqId && groupedLogs && selectedReqId && groupedLogs.groups[selectedReqId]) {
      // Fetch log data in grouping mode
      const requestLogs = groupedLogs.groups[selectedReqId]
      console.log('Group mode - requestLogs length:', requestLogs.length)
      logData = requestLogs[lineNumber - 1] // Convert the line number to an array index
      console.log('Group mode - logData:', logData)
    } else {
      // Fetch log data outside grouping mode
      console.log('Non-group mode - logs length:', logs.length)
      try {
        const logLine = logs[lineNumber - 1]
        console.log('Log line:', logLine)
        logData = JSON.parse(logLine)
        console.log('Parsed logData:', logData)
      } catch (e) {
        console.error('Failed to parse log data:', e)
      }
    }

    if (logData) {
      console.log('Navigating to debug page with logData:', logData)
      // Navigate to the debug page, passing log data via the URL parameter
      const logDataParam = encodeURIComponent(JSON.stringify(logData))
      console.log('Encoded logDataParam length:', logDataParam.length)
      navigate(`/debug?logData=${logDataParam}`)
    } else {
      console.error('No log data found for line:', lineNumber)
    }
  }
}
