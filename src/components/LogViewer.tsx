import Editor from '@monaco-editor/react'
import { ArrowLeft, Bug, Download, File, Layers, RefreshCw, Trash2, X } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import dayjs from '@/lib/dayjs'

interface LogViewerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  showToast?: (message: string, type: 'success' | 'error' | 'warning') => void
}

interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string // This field now holds the raw JSON string directly
  source?: string
  reqId?: string
  [key: string]: any // Allow dynamic properties like msg, url, body, etc.
}

interface LogFile {
  name: string
  path: string
  size: number
  lastModified: string
}

interface GroupedLogs {
  [reqId: string]: LogEntry[]
}

interface LogGroupSummary {
  reqId: string
  logCount: number
  firstLog: string
  lastLog: string
  model?: string
}

interface GroupedLogsResponse {
  grouped: boolean
  groups: { [reqId: string]: LogEntry[] }
  summary: {
    totalRequests: number
    totalLogs: number
    requests: LogGroupSummary[]
  }
}

export function LogViewer({ open, onOpenChange, showToast }: LogViewerProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [logs, setLogs] = useState<string[]>([])
  const [logFiles, setLogFiles] = useState<LogFile[]>([])
  const [selectedFile, setSelectedFile] = useState<LogFile | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [groupByReqId, setGroupByReqId] = useState(false)
  const [groupedLogs, setGroupedLogs] = useState<GroupedLogsResponse | null>(null)
  const [selectedReqId, setSelectedReqId] = useState<string | null>(null)
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))
  const containerRef = useRef<HTMLDivElement>(null)
  const refreshInterval = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'))
    })
    observer.observe(document.documentElement, { attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  const workerRef = useRef<Worker | null>(null)
  const editorRef = useRef<any>(null)

  useEffect(() => {
    if (open) {
      loadLogFiles()
    }
  }, [open])

  // Create an inline Web Worker
  const createInlineWorker = (): Worker => {
    const workerCode = `
      // Log aggregation Web Worker
      self.onmessage = function(event) {
        const { type, data } = event.data;
        
        if (type === 'groupLogsByReqId') {
          try {
            const { logs } = data;
            
            // Group logs by reqId
            const groupedLogs = {};
            
            logs.forEach((log, index) => {
              log = JSON.parse(log);
              let reqId = log.reqId || 'no-req-id';
              
              if (!groupedLogs[reqId]) {
                groupedLogs[reqId] = [];
              }
              groupedLogs[reqId].push(log);
            });

            // Sort each group's logs by timestamp
            Object.keys(groupedLogs).forEach(reqId => {
              groupedLogs[reqId].sort((a, b) => a.time - b.time);
            });

            // Extract model information
            const extractModelInfo = (reqId) => {
              const logGroup = groupedLogs[reqId];
              for (const log of logGroup) {
                try {
                  // Try to parse JSON from the message field
                  if (log.type === 'request body' && log.data && log.data.model) {
                    return log.data.model;
                  }
                } catch (e) {
                  // Parsing failed - keep trying the next log entry
                }
              }
              return undefined;
            };

            // Build summary information
            const summary = {
              totalRequests: Object.keys(groupedLogs).length,
              totalLogs: logs.length,
              requests: Object.keys(groupedLogs).map(reqId => ({
                reqId,
                logCount: groupedLogs[reqId].length,
                firstLog: groupedLogs[reqId][0]?.time,
                lastLog: groupedLogs[reqId][groupedLogs[reqId].length - 1]?.time,
                model: extractModelInfo(reqId)
              }))
            };

            const response = {
              grouped: true,
              groups: groupedLogs,
              summary
            };

            // Post the result back to the main thread
            self.postMessage({
              type: 'groupLogsResult',
              data: response
            });
          } catch (error) {
            // Post the error back to the main thread
            self.postMessage({
              type: 'error',
              error: error instanceof Error ? error.message : 'Unknown error occurred'
            });
          }
        }
      };
    `

    const blob = new Blob([workerCode], { type: 'application/javascript' })
    const workerUrl = URL.createObjectURL(blob)
    return new Worker(workerUrl)
  }

  // Initialize the Web Worker
  useEffect(() => {
    if (typeof Worker !== 'undefined') {
      try {
        // Create the inline Web Worker
        workerRef.current = createInlineWorker()

        // Listen for messages from the Worker
        workerRef.current.onmessage = (event) => {
          const { type, data, error } = event.data

          if (type === 'groupLogsResult') {
            setGroupedLogs(data)
          } else if (type === 'error') {
            console.error('Worker error:', error)
            if (showToast) {
              showToast(t('log_viewer.worker_error') + ': ' + error, 'error')
            }
          }
        }

        // Listen for Worker errors
        workerRef.current.onerror = (error) => {
          console.error('Worker error:', error)
          if (showToast) {
            showToast(t('log_viewer.worker_init_failed'), 'error')
          }
        }
      } catch (error) {
        console.error('Failed to create worker:', error)
        if (showToast) {
          showToast(t('log_viewer.worker_init_failed'), 'error')
        }
      }
    }

    // Clean up the Worker
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate()
        workerRef.current = null
      }
    }
  }, [showToast, t])

  useEffect(() => {
    if (autoRefresh && open && selectedFile) {
      refreshInterval.current = setInterval(() => {
        loadLogs()
      }, 5000) // Refresh every 5 seconds
    } else if (refreshInterval.current) {
      clearInterval(refreshInterval.current)
    }

    return () => {
      if (refreshInterval.current) {
        clearInterval(refreshInterval.current)
      }
    }
  }, [autoRefresh, open, selectedFile])

  // Load logs when selected file changes
  useEffect(() => {
    if (selectedFile && open) {
      setLogs([]) // Clear existing logs
      loadLogs()
    }
  }, [selectedFile, open])

  // Handle open/close animations
  useEffect(() => {
    if (open) {
      setIsVisible(true)
      // Trigger the animation after a small delay to ensure the element is rendered
      requestAnimationFrame(() => {
        setIsAnimating(true)
      })
    } else {
      setIsAnimating(false)
      // Wait for the animation to complete before hiding
      const timer = setTimeout(() => {
        setIsVisible(false)
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [open])

  const loadLogFiles = async () => {
    try {
      setIsLoading(true)
      const response = await api.getLogFiles()

      if (response && Array.isArray(response)) {
        setLogFiles(response)
        setSelectedFile(null)
        setLogs([])
      } else {
        setLogFiles([])
        if (showToast) {
          showToast(t('log_viewer.no_log_files_available'), 'warning')
        }
      }
    } catch (error) {
      console.error('Failed to load log files:', error)
      if (showToast) {
        showToast(t('log_viewer.load_files_failed') + ': ' + (error as Error).message, 'error')
      }
    } finally {
      setIsLoading(false)
    }
  }

  const loadLogs = async () => {
    if (!selectedFile) return

    try {
      setIsLoading(true)
      setGroupedLogs(null)
      setSelectedReqId(null)

      // Always load the raw log data
      const response = await api.getLogs(selectedFile.path)

      if (response && Array.isArray(response)) {
        // The endpoint now returns an array of raw log strings - store it directly
        setLogs(response)

        // If grouping is enabled, aggregate via the Web Worker (must convert to LogEntry shape for the Worker)
        if (groupByReqId && workerRef.current) {
          // const workerLogs: LogEntry[] = response.map((logLine, index) => ({
          //   timestamp: dayjs().toISOString(),
          //   level: 'info',
          //   message: logLine,
          //   source: undefined,
          //   reqId: undefined
          // }));

          workerRef.current.postMessage({
            type: 'groupLogsByReqId',
            data: { logs: response }
          })
        } else {
          setGroupedLogs(null)
        }
      } else {
        setLogs([])
        setGroupedLogs(null)
        if (showToast) {
          showToast(t('log_viewer.no_logs_available'), 'warning')
        }
      }
    } catch (error) {
      console.error('Failed to load logs:', error)
      if (showToast) {
        showToast(t('log_viewer.load_failed') + ': ' + (error as Error).message, 'error')
      }
    } finally {
      setIsLoading(false)
    }
  }

  const clearLogs = async () => {
    if (!selectedFile) return

    try {
      await api.clearLogs(selectedFile.path)
      setLogs([])
      if (showToast) {
        showToast(t('log_viewer.logs_cleared'), 'success')
      }
    } catch (error) {
      console.error('Failed to clear logs:', error)
      if (showToast) {
        showToast(t('log_viewer.clear_failed') + ': ' + (error as Error).message, 'error')
      }
    }
  }

  const selectFile = (file: LogFile) => {
    setSelectedFile(file)
    setAutoRefresh(false) // Reset auto refresh when changing files
  }

  const toggleGroupByReqId = () => {
    const newValue = !groupByReqId
    setGroupByReqId(newValue)

    if (newValue && selectedFile && logs.length > 0) {
      // When enabling aggregation, if logs are already loaded, send them to the Worker
      if (workerRef.current) {
        workerRef.current.postMessage({
          type: 'groupLogsByReqId',
          data: { logs }
        })
      }
    } else if (!newValue) {
      // When disabling aggregation, clear the cached result
      setGroupedLogs(null)
      setSelectedReqId(null)
    }
  }

  const selectReqId = (reqId: string) => {
    setSelectedReqId(reqId)
  }

  const getDisplayLogs = () => {
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

  const downloadLogs = () => {
    if (!selectedFile || logs.length === 0) return

    // Download the raw log strings directly, one entry per line
    const logText = logs.join('\n')

    const blob = new Blob([logText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selectedFile.name}-${dayjs().toISOString().split('T')[0]}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    if (showToast) {
      showToast(t('log_viewer.logs_downloaded'), 'success')
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / k ** i).toFixed(2)) + ' ' + sizes[i]
  }

  const formatDate = (dateString: string) => {
    return dayjs(dateString).format('YYYY/MM/DD HH:mm:ss')
  }

  // Breadcrumb item type
  interface BreadcrumbItem {
    id: string
    label: string
    onClick: () => void
  }

  // Build the breadcrumb items
  const getBreadcrumbs = (): BreadcrumbItem[] => {
    const breadcrumbs: BreadcrumbItem[] = [
      {
        id: 'root',
        label: t('log_viewer.title'),
        onClick: () => {
          setSelectedFile(null)
          setAutoRefresh(false)
          setLogs([])
          setGroupedLogs(null)
          setSelectedReqId(null)
          setGroupByReqId(false)
        }
      }
    ]

    if (selectedFile) {
      breadcrumbs.push({
        id: 'file',
        label: selectedFile.name,
        onClick: () => {
          if (groupByReqId) {
            // In grouping mode, clicking the file level returns to the group list
            setSelectedReqId(null)
          } else {
            // Outside grouping mode, clicking the file level disables grouping
            setSelectedReqId(null)
            setGroupedLogs(null)
            setGroupByReqId(false)
          }
        }
      })
    }

    if (selectedReqId) {
      breadcrumbs.push({
        id: 'req',
        label: `${t('log_viewer.request')} ${selectedReqId}`,
        onClick: () => {
          // Do nothing when the current level is clicked
        }
      })
    }

    return breadcrumbs
  }

  // Resolve the back-button handler
  const getBackAction = (): (() => void) | null => {
    if (selectedReqId) {
      return () => {
        setSelectedReqId(null)
      }
    } else if (selectedFile) {
      return () => {
        setSelectedFile(null)
        setAutoRefresh(false)
        setLogs([])
        setGroupedLogs(null)
        setSelectedReqId(null)
        setGroupByReqId(false)
      }
    }
    return null
  }

  const formatLogsForEditor = () => {
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
  const getFinalRequestLines = () => {
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

  // Handle clicks on the debug button
  const handleDebugClick = (lineNumber: number) => {
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

  // Configure Monaco Editor
  const configureEditor = (editor: any) => {
    editorRef.current = editor

    // Enable the glyph margin
    editor.updateOptions({
      glyphMargin: true
    })

    // Track the current decoration IDs
    let currentDecorations: string[] = []

    // Apply glyph-margin decorations
    const updateDecorations = () => {
      const finalRequestLines = getFinalRequestLines()
      const decorations = finalRequestLines.map((lineNumber) => ({
        range: {
          startLineNumber: lineNumber,
          startColumn: 1,
          endLineNumber: lineNumber,
          endColumn: 1
        },
        options: {
          glyphMarginClassName: 'debug-button-glyph',
          glyphMarginHoverMessage: { value: '点击调试此请求' }
        }
      }))

      // Use deltaDecorations to update decorations properly and clean up stale ones
      currentDecorations = editor.deltaDecorations(currentDecorations, decorations)
    }

    // Initial decoration pass
    updateDecorations()

    // Listen for glyph-margin clicks - use the proper event channel
    editor.onMouseDown((e: any) => {
      console.log('Mouse down event:', e.target)
      console.log('Event details:', {
        type: e.target.type,
        hasDetail: !!e.target.detail,
        glyphMarginLane: e.target.detail?.glyphMarginLane,
        offsetX: e.target.detail?.offsetX,
        glyphMarginLeft: e.target.detail?.glyphMarginLeft,
        glyphMarginWidth: e.target.detail?.glyphMarginWidth
      })

      // Check whether the click landed in the glyph-margin area
      const isGlyphMarginClick =
        e.target.detail &&
        e.target.detail.glyphMarginLane !== undefined &&
        e.target.detail.offsetX !== undefined &&
        e.target.detail.offsetX <= e.target.detail.glyphMarginLeft + e.target.detail.glyphMarginWidth

      console.log('Is glyph margin click:', isGlyphMarginClick)

      if (e.target.position && isGlyphMarginClick) {
        const finalRequestLines = getFinalRequestLines()
        console.log('Final request lines:', finalRequestLines)
        console.log('Clicked line number:', e.target.position.lineNumber)
        if (finalRequestLines.includes(e.target.position.lineNumber)) {
          console.log('Opening debug page for line:', e.target.position.lineNumber)
          handleDebugClick(e.target.position.lineNumber)
        }
      }
    })

    // Use onGlyphMarginClick when available
    if (typeof editor.onGlyphMarginClick === 'function') {
      editor.onGlyphMarginClick((e: any) => {
        console.log('Glyph margin click event:', e)
        const finalRequestLines = getFinalRequestLines()
        if (finalRequestLines.includes(e.target.position.lineNumber)) {
          console.log('Opening debug page for line (glyph):', e.target.position.lineNumber)
          handleDebugClick(e.target.position.lineNumber)
        }
      })
    }

    // Use mouse-move events to detect hovering over the debug button
    editor.onMouseMove((e: any) => {
      if (e.target.position && (e.target.type === 4 || e.target.type === 'glyph-margin')) {
        const finalRequestLines = getFinalRequestLines()
        if (finalRequestLines.includes(e.target.position.lineNumber)) {
          // A hover effect could be applied here
          editor.updateOptions({
            glyphMargin: true
          })
        }
      }
    })

    // Refresh decorations as the logs change
    const interval = setInterval(updateDecorations, 1000)

    return () => {
      clearInterval(interval)
      // Clear decorations
      if (editorRef.current) {
        editorRef.current.deltaDecorations(currentDecorations, [])
      }
    }
  }

  if (!isVisible && !open) {
    return null
  }

  return (
    <>
      {(isVisible || open) && (
        <div
          className={`fixed inset-0 z-50 transition-all duration-300 ease-out ${
            isAnimating && open ? 'bg-black/50 opacity-100' : 'bg-black/0 opacity-0 pointer-events-none'
          }`}
          onClick={() => onOpenChange(false)}
        />
      )}

      <div
        ref={containerRef}
        className={`fixed bottom-0 left-0 right-0 z-50 flex flex-col bg-background shadow-2xl transition-all duration-300 ease-out transform ${
          isAnimating && open ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{
          height: '100vh',
          maxHeight: '100vh'
        }}
      >
        <div className='flex items-center justify-between border-b p-4'>
          <div className='flex items-center gap-2'>
            {getBackAction() && (
              <Button variant='ghost' size='sm' onClick={getBackAction()!}>
                <ArrowLeft className='h-4 w-4 mr-2' />
                {t('log_viewer.back')}
              </Button>
            )}

            {/* Breadcrumb navigation */}
            <nav className='flex items-center space-x-1 text-sm'>
              {getBreadcrumbs().map((breadcrumb, index) => (
                <React.Fragment key={breadcrumb.id}>
                  {index > 0 && <span className='text-muted-foreground mx-1'>/</span>}
                  {index === getBreadcrumbs().length - 1 ? (
                    <span className='text-foreground font-medium'>{breadcrumb.label}</span>
                  ) : (
                    <button
                      onClick={breadcrumb.onClick}
                      className='text-primary hover:text-primary/80 transition-colors'
                    >
                      {breadcrumb.label}
                    </button>
                  )}
                </React.Fragment>
              ))}
            </nav>
          </div>
          <div className='flex gap-2'>
            {selectedFile && (
              <>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={toggleGroupByReqId}
                  className={groupByReqId ? 'bg-primary/10 text-primary' : ''}
                >
                  <Layers className='h-4 w-4 mr-2' />
                  {groupByReqId ? t('log_viewer.grouped_on') : t('log_viewer.group_by_req_id')}
                </Button>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => setAutoRefresh(!autoRefresh)}
                  className={autoRefresh ? 'bg-primary/10 text-primary' : ''}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${autoRefresh ? 'animate-spin' : ''}`} />
                  {autoRefresh ? t('log_viewer.auto_refresh_on') : t('log_viewer.auto_refresh_off')}
                </Button>
                <Button variant='outline' size='sm' onClick={downloadLogs} disabled={logs.length === 0}>
                  <Download className='h-4 w-4 mr-2' />
                  {t('log_viewer.download')}
                </Button>
                <Button variant='outline' size='sm' onClick={clearLogs} disabled={logs.length === 0}>
                  <Trash2 className='h-4 w-4 mr-2' />
                  {t('log_viewer.clear')}
                </Button>
              </>
            )}
            <Button variant='outline' size='sm' onClick={() => onOpenChange(false)}>
              <X className='h-4 w-4 mr-2' />
              {t('log_viewer.close')}
            </Button>
          </div>
        </div>

        <div className='flex-1 min-h-0 bg-muted/50'>
          {isLoading ? (
            <div className='flex items-center justify-center h-full'>
              <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-primary'></div>
            </div>
          ) : selectedFile ? (
            <>
              {groupByReqId && groupedLogs && !selectedReqId ? (
                // Show the log-group list
                <div className='flex flex-col h-full p-6'>
                  <div className='mb-4 flex-shrink-0'>
                    <h3 className='text-lg font-medium mb-2'>{t('log_viewer.request_groups')}</h3>
                    <p className='text-sm text-muted-foreground'>
                      {t('log_viewer.total_requests')}: {groupedLogs.summary.totalRequests} |
                      {t('log_viewer.total_logs')}: {groupedLogs.summary.totalLogs}
                    </p>
                  </div>
                  <div className='flex-1 min-h-0 overflow-y-auto space-y-3'>
                    {groupedLogs.summary.requests.map((request) => (
                      <div
                        key={request.reqId}
                        className='border rounded-lg p-4 hover:bg-muted/50 cursor-pointer transition-colors'
                        onClick={() => selectReqId(request.reqId)}
                      >
                        <div className='flex items-center justify-between mb-2'>
                          <div className='flex items-center gap-2'>
                            <File className='h-5 w-5 text-primary' />
                            <span className='font-medium text-sm'>{request.reqId}</span>
                            {request.model && (
                              <span className='text-xs bg-green-100 text-green-800 px-2 py-1 rounded'>
                                {request.model}
                              </span>
                            )}
                          </div>
                          <span className='text-xs bg-primary/10 text-primary px-2 py-1 rounded'>
                            {request.logCount} {t('log_viewer.logs')}
                          </span>
                        </div>
                        <div className='text-xs text-muted-foreground space-y-1'>
                          <div>
                            {t('log_viewer.first_log')}: {formatDate(request.firstLog)}
                          </div>
                          <div>
                            {t('log_viewer.last_log')}: {formatDate(request.lastLog)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                // Show the log content
                <div className='relative h-full'>
                  <Editor
                    height='100%'
                    defaultLanguage='json'
                    value={formatLogsForEditor()}
                    theme={isDark ? 'vs-dark' : 'vs'}
                    options={{
                      minimap: { enabled: true },
                      fontSize: 14,
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      wordWrap: 'on',
                      readOnly: true,
                      lineNumbers: 'on',
                      folding: true,
                      renderWhitespace: 'all',
                      glyphMargin: true
                    }}
                    onMount={configureEditor}
                  />
                </div>
              )}
            </>
          ) : (
            <div className='p-6'>
              <h3 className='text-lg font-medium mb-4'>{t('log_viewer.select_file')}</h3>
              {logFiles.length === 0 ? (
                <div className='text-muted-foreground text-center py-8'>
                  <File className='h-12 w-12 mx-auto mb-4 text-muted-foreground' />
                  <p>{t('log_viewer.no_log_files_available')}</p>
                </div>
              ) : (
                <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'>
                  {logFiles.map((file) => (
                    <div
                      key={file.path}
                      className='border rounded-lg p-4 hover:bg-muted/50 cursor-pointer transition-colors'
                      onClick={() => selectFile(file)}
                    >
                      <div className='flex items-start justify-between mb-2'>
                        <div className='flex items-center gap-2'>
                          <File className='h-5 w-5 text-primary' />
                          <span className='font-medium text-sm'>{file.name}</span>
                        </div>
                      </div>
                      <div className='text-xs text-muted-foreground space-y-1'>
                        <div>{formatFileSize(file.size)}</div>
                        <div>{formatDate(file.lastModified)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
