/**
 * Activity › Logs — the pino file tail, grouped by request id.
 *
 * Absorbs LogViewer and its four sub-components. Same three-pane shape as
 * before, but the middle pane is a list of requests rather than a flat
 * tail: once two clients are active the interleaved lines of a failover
 * read as two half-stories, and the 429 and the retry that succeeded
 * belong to one.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { downloadText } from '@/components/rialto/activity/data'
import { LogBody } from '@/components/rialto/activity/LogBody'
import { FileRail, GroupRail } from '@/components/rialto/activity/LogRails'
import { groupByRequest, type LogLine, parseLogLines } from '@/components/rialto/activity/log-lines'
import { chipFor, groupKey, type LevelChip } from '@/components/rialto/activity/log-view'
import { ActivityTabs, ScreenMessage } from '@/components/rialto/activity/shared'
import { useActivityCounts } from '@/components/rialto/activity/use-activity-counts'
import { RButton } from '@/components/rialto/primitives'
import { Screen } from '@/components/rialto/Screen'
import { api } from '@/lib/api'
import { formatFileSize } from '@/lib/log-viewer/format'
import type { LogFile } from '@/lib/log-viewer/types'

const FOLLOW_INTERVAL_MS = 5000

/**
 * File list + line fetch. Split out of the screen so the screen itself
 * stays a layout: the fetch has four states and the layout has three
 * panes, and holding both in one function pushed it past the complexity
 * ceiling.
 */
function useLogFiles() {
  const [files, setFiles] = useState<LogFile[]>([])
  const [file, setFile] = useState<LogFile | null>(null)
  const [rawLines, setRawLines] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getLogFiles()
      .then((res) => {
        setFiles(res)
        setFile(res.length === 0 ? null : res[0])
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  const loadLines = useCallback(() => {
    if (file === null) return
    api
      .getLogs(file.path)
      .then((res) => {
        setRawLines(res)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [file])

  useEffect(loadLines, [loadLines])

  return { files, file, setFile, rawLines, error, loadLines }
}

/** The three panes. Owns the reading state (level, selection, search). */
function LogPanes({
  files,
  file,
  onSelectFile,
  lines
}: {
  files: LogFile[]
  file: LogFile
  onSelectFile: (next: LogFile) => void
  lines: LogLine[]
}) {
  const [levels, setLevels] = useState<Set<LevelChip>>(new Set(['error', 'warn', 'info']))
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showRaw, setShowRaw] = useState(false)

  const groups = useMemo(() => groupByRequest(lines.filter((l) => levels.has(chipFor(l.level)))), [lines, levels])

  const found = groups.find((g) => groupKey(g) === selectedKey)
  const active = found === undefined ? (groups.length === 0 ? null : groups[0]) : found

  const toggleLevel = (level: LevelChip) => {
    const next = new Set(levels)
    if (next.has(level)) next.delete(level)
    else next.add(level)
    setLevels(next)
  }

  return (
    <div className='grid h-full grid-cols-[14rem_20rem_1fr]'>
      <FileRail
        files={files}
        activePath={file.path}
        onSelect={onSelectFile}
        levels={levels}
        onToggleLevel={toggleLevel}
      />
      <GroupRail
        groups={groups}
        activeKey={active === null ? '' : groupKey(active)}
        onSelect={(key) => {
          setSelectedKey(key)
          setQuery('')
        }}
      />
      <LogBody
        fileName={file.name}
        group={active}
        query={query}
        onQuery={setQuery}
        raw={showRaw}
        onToggleRaw={() => setShowRaw((v) => !v)}
      />
    </div>
  )
}

export function ActivityLogs() {
  const { files, file, setFile, rawLines, error, loadLines } = useLogFiles()
  const [follow, setFollow] = useState(false)
  const counts = useActivityCounts()

  useEffect(() => {
    if (!follow) return
    const timer = setInterval(loadLines, FOLLOW_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [follow, loadLines])

  const lines = useMemo(() => parseLogLines(rawLines), [rawLines])

  const download = () => {
    if (file === null) return
    downloadText(file.name, rawLines.join('\n'), 'application/x-ndjson')
  }

  return (
    <Screen
      title='Logs'
      subtitle={file === null ? undefined : `${file.name} · ${formatFileSize(file.size)} · grouped by request`}
      actions={
        <>
          <RButton
            variant='outline'
            icon='ri-broadcast-line'
            aria-pressed={follow}
            onClick={() => setFollow((v) => !v)}
            className={follow ? 'bg-muted/60' : ''}
          >
            Follow
          </RButton>
          <RButton variant='ghost' icon='ri-download-line' onClick={download} disabled={rawLines.length === 0}>
            Download
          </RButton>
        </>
      }
    >
      <ActivityTabs active='logs' sessionCount={counts.sessions} requestCount={counts.requests} />
      {error !== null ? (
        <ScreenMessage tone='bad'>{error}</ScreenMessage>
      ) : file === null ? (
        <ScreenMessage>No log files yet. File logging is off unless LOG is enabled.</ScreenMessage>
      ) : (
        // Remount per file so the selected request and search box reset with it.
        <LogPanes key={file.path} files={files} file={file} onSelectFile={setFile} lines={lines} />
      )}
    </Screen>
  )
}
