import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { LogEditor } from '@/components/log-viewer/LogEditor'
import { LogFileList } from '@/components/log-viewer/LogFileList'
import { LogViewerHeader } from '@/components/log-viewer/LogViewerHeader'
import { RequestGroupList } from '@/components/log-viewer/RequestGroupList'
import { api } from '@/lib/api'
import dayjs from '@/lib/dayjs'
import { createDebugClickHandler } from '@/lib/log-viewer/debug-navigation'
import { formatLogsForEditor, getFinalRequestLines } from '@/lib/log-viewer/logs'
import { createEditorMountHandler } from '@/lib/log-viewer/monaco-debug-gutter'
import { buildBreadcrumbs, resolveBackAction } from '@/lib/log-viewer/navigation'
import type { GroupedLogsResponse, LogFile } from '@/lib/log-viewer/types'
import { createInlineWorker } from '@/lib/log-viewer/worker'

interface LogViewerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  showToast?: (message: string, type: 'success' | 'error' | 'warning') => void
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

  // Reset back to the root file-list view
  const resetToFileList = () => {
    setSelectedFile(null)
    setAutoRefresh(false)
    setLogs([])
    setGroupedLogs(null)
    setSelectedReqId(null)
    setGroupByReqId(false)
  }

  // Clicking the file-level breadcrumb pops back to the group list in
  // grouping mode, or clears grouping entirely otherwise.
  const onFileBreadcrumbClick = () => {
    if (groupByReqId) {
      setSelectedReqId(null)
    } else {
      setSelectedReqId(null)
      setGroupedLogs(null)
      setGroupByReqId(false)
    }
  }

  const breadcrumbs = buildBreadcrumbs({ t, selectedFile, selectedReqId, resetToFileList, onFileBreadcrumbClick })
  const backAction = resolveBackAction(selectedFile, selectedReqId, () => setSelectedReqId(null), resetToFileList)

  const handleDebugClick = createDebugClickHandler(logs, groupedLogs, groupByReqId, selectedReqId, navigate)

  const configureEditor = createEditorMountHandler(
    editorRef,
    () => getFinalRequestLines(logs, groupedLogs, groupByReqId, selectedReqId),
    handleDebugClick
  )

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
        <LogViewerHeader
          backAction={backAction}
          breadcrumbs={breadcrumbs}
          showFileActions={Boolean(selectedFile)}
          groupByReqId={groupByReqId}
          onToggleGroupByReqId={toggleGroupByReqId}
          autoRefresh={autoRefresh}
          onToggleAutoRefresh={() => setAutoRefresh(!autoRefresh)}
          onDownload={downloadLogs}
          onClear={clearLogs}
          hasLogs={logs.length > 0}
          onClose={() => onOpenChange(false)}
          t={t}
        />

        <div className='flex-1 min-h-0'>
          {isLoading ? (
            <div className='flex items-center justify-center h-full'>
              <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-primary'></div>
            </div>
          ) : selectedFile ? (
            <>
              {groupByReqId && groupedLogs && !selectedReqId ? (
                <RequestGroupList summary={groupedLogs.summary} onSelectReqId={selectReqId} t={t} />
              ) : (
                <LogEditor
                  value={formatLogsForEditor(logs, groupedLogs, groupByReqId, selectedReqId)}
                  isDark={isDark}
                  onMount={configureEditor}
                />
              )}
            </>
          ) : (
            <LogFileList files={logFiles} onSelect={selectFile} t={t} />
          )}
        </div>
      </div>
    </>
  )
}
