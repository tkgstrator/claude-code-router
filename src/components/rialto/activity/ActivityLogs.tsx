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
import {
  groupByRequest,
  type LogGroup,
  type LogLevel,
  type LogLine,
  lineDetail,
  parseLogLines,
  shortReqId
} from '@/components/rialto/activity/log-lines'
import { ActivityTabs, NoteBox, ScreenMessage } from '@/components/rialto/activity/shared'
import { useActivityCounts } from '@/components/rialto/activity/use-activity-counts'
import { Pill, RButton, type Tone } from '@/components/rialto/primitives'
import { Screen } from '@/components/rialto/Screen'
import { api } from '@/lib/api'
import dayjs from '@/lib/dayjs'
import { formatFileSize } from '@/lib/log-viewer/format'
import type { LogFile } from '@/lib/log-viewer/types'
import { cn } from '@/lib/utils'

const FOLLOW_INTERVAL_MS = 5000

// The four levels an operator actually filters on. `fatal` folds into
// error and `trace` into debug so no line can hide from every chip.
type LevelChip = 'error' | 'warn' | 'info' | 'debug'

const LEVEL_CHIPS: readonly LevelChip[] = ['error', 'warn', 'info', 'debug']

const chipFor = (level: LogLevel): LevelChip => {
  if (level === 'fatal' || level === 'error') return 'error'
  if (level === 'warn') return 'warn'
  if (level === 'info') return 'info'
  return 'debug'
}

const LEVEL_TONE: Record<LevelChip, Tone> = { error: 'bad', warn: 'warn', info: 'mute', debug: 'mute' }

const GUTTER: Record<LevelChip, string> = {
  error: 'bg-destructive',
  warn: 'bg-amber-500',
  info: 'bg-transparent',
  debug: 'bg-transparent'
}

const LEVEL_TEXT: Record<LevelChip, string> = {
  error: 'text-destructive',
  warn: 'text-amber-600 dark:text-amber-400',
  info: 'text-muted-foreground/60',
  debug: 'text-muted-foreground/60'
}

const groupKey = (group: LogGroup): string => (group.id === null ? '' : group.id)

function FileRail({
  files,
  activePath,
  onSelect,
  levels,
  onToggleLevel
}: {
  files: LogFile[]
  activePath: string | null
  onSelect: (file: LogFile) => void
  levels: Set<LevelChip>
  onToggleLevel: (level: LevelChip) => void
}) {
  return (
    <aside className='min-w-0 overflow-y-auto border-r border-border'>
      <div className='flex items-center gap-2 px-4 pt-5 pb-2'>
        <h2 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Files</h2>
      </div>
      {files.map((file) => (
        <button
          key={file.path}
          type='button'
          onClick={() => onSelect(file)}
          className={cn(
            'flex w-full items-center gap-2 border-l-2 px-4 py-2 text-left transition-colors',
            file.path === activePath
              ? 'border-l-foreground bg-muted/60'
              : 'border-l-transparent hover:border-l-border hover:bg-muted/50'
          )}
        >
          <i className='ri-file-text-line text-sm text-muted-foreground' />
          <span className='truncate font-mono text-[11px]'>{file.name}</span>
          <span className='ml-auto shrink-0 font-mono text-[10px] text-muted-foreground'>
            {formatFileSize(file.size)}
          </span>
        </button>
      ))}
      <div className='border-t border-border px-4 py-3'>
        <div className='text-[11px] text-muted-foreground'>Level</div>
        <div className='mt-1.5 flex flex-wrap gap-1'>
          {LEVEL_CHIPS.map((level) => (
            <button
              key={level}
              type='button'
              onClick={() => onToggleLevel(level)}
              className={cn(
                'rounded border px-1.5 py-0.5 text-[10px] transition-colors',
                levels.has(level)
                  ? 'border-foreground/40 bg-muted/60'
                  : 'border-border text-muted-foreground hover:bg-muted/50'
              )}
            >
              {level}
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}

function GroupRail({
  groups,
  activeKey,
  onSelect
}: {
  groups: LogGroup[]
  activeKey: string
  onSelect: (key: string) => void
}) {
  return (
    <aside className='min-w-0 overflow-y-auto border-r border-border'>
      <div className='flex items-center gap-2 px-4 pt-5 pb-2'>
        <h2 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Requests</h2>
        <span className='ml-auto font-mono text-[10px] text-muted-foreground'>{groups.length}</span>
      </div>
      {groups.map((group) => {
        const chip = chipFor(group.level)
        return (
          <button
            key={groupKey(group)}
            type='button'
            onClick={() => onSelect(groupKey(group))}
            className={cn(
              'block w-full border-l-2 px-4 py-2.5 text-left transition-colors',
              groupKey(group) === activeKey
                ? 'border-l-foreground bg-muted/60'
                : 'border-l-transparent hover:border-l-border hover:bg-muted/50'
            )}
          >
            <div className='flex items-center gap-2'>
              <span className='font-mono text-[11px] tabular-nums text-muted-foreground'>
                {group.firstTime === 0 ? '--:--:--' : dayjs(group.firstTime).format('HH:mm:ss')}
              </span>
              <Pill tone={LEVEL_TONE[chip]}>{chip}</Pill>
              <span className='ml-auto font-mono text-[10px] text-muted-foreground'>{group.lines.length} lines</span>
            </div>
            <div className='mt-1 truncate text-[11px]'>{group.summary}</div>
            <div className='mt-0.5 font-mono text-[10px] text-muted-foreground'>{shortReqId(group.id)}</div>
          </button>
        )
      })}
    </aside>
  )
}

function LogRow({ line }: { line: LogLine }) {
  const chip = chipFor(line.level)
  const detail = useMemo(() => lineDetail(line.raw), [line.raw])
  return (
    <div className='group flex gap-0 hover:bg-muted/50'>
      <span className={cn('w-0.5 shrink-0', GUTTER[chip])} />
      <span className='w-28 shrink-0 py-1 pl-3 font-mono text-[11px] tabular-nums text-muted-foreground'>
        {line.time === 0 ? '' : dayjs(line.time).format('HH:mm:ss.SSS')}
      </span>
      <span className={cn('w-16 shrink-0 py-1 pl-2 font-mono text-[10px] uppercase', LEVEL_TEXT[chip])}>
        {line.level}
      </span>
      <span className='min-w-0 flex-1 py-1 pr-4'>
        <span className='font-mono text-[11px]'>{line.msg}</span>
        {detail === '' ? null : <span className='ml-2 font-mono text-[11px] text-muted-foreground'>{detail}</span>}
      </span>
    </div>
  )
}

function LogBody({
  fileName,
  group,
  query,
  onQuery,
  raw,
  onToggleRaw
}: {
  fileName: string
  group: LogGroup | null
  query: string
  onQuery: (next: string) => void
  raw: boolean
  onToggleRaw: () => void
}) {
  const lines = group === null ? [] : group.lines
  const shown = query === '' ? lines : lines.filter((l) => l.raw.toLowerCase().includes(query.toLowerCase()))
  const copy = () => {
    void navigator.clipboard.writeText(lines.map((l) => l.raw).join('\n'))
  }
  return (
    <div className='min-w-0 overflow-y-auto'>
      <div className='flex items-center gap-2 border-b border-border px-4 py-2.5'>
        <span className='font-mono text-[11px] text-muted-foreground'>{fileName}</span>
        <i className='ri-arrow-right-s-line text-sm text-muted-foreground/50' />
        <span className='font-mono text-[11px]'>{group === null ? '—' : shortReqId(group.id)}</span>
        {group === null ? null : <Pill tone={LEVEL_TONE[chipFor(group.level)]}>{chipFor(group.level)}</Pill>}
        <div className='ml-auto flex items-center gap-2'>
          <div className='flex h-7 w-44 items-center gap-2 rounded-md border border-border px-2.5 text-xs text-muted-foreground'>
            <i className='ri-search-line text-sm' />
            <input
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder='Search in group'
              className='min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground'
            />
          </div>
          <RButton variant='ghost' icon='ri-file-copy-line' onClick={copy} disabled={lines.length === 0}>
            Copy
          </RButton>
          <RButton variant='ghost' icon='ri-code-line' aria-pressed={raw} onClick={onToggleRaw}>
            Raw
          </RButton>
        </div>
      </div>
      {raw ? (
        <pre className='overflow-x-auto px-4 py-2 font-mono text-[11px] leading-relaxed'>
          {shown.map((l) => l.raw).join('\n')}
        </pre>
      ) : (
        <div className='py-1'>
          {shown.map((line) => (
            <LogRow key={line.key} line={line} />
          ))}
        </div>
      )}
      <div className='px-4 py-4'>
        <NoteBox>
          Grouped by request id, so a failover reads as one story instead of two interleaved ones. The 429 and the retry
          that succeeded are the same group.
        </NoteBox>
      </div>
      <div className='h-6' />
    </div>
  )
}

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
