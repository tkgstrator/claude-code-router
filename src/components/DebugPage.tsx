import MonacoEditor from '@monaco-editor/react'
import { ArrowLeft, Copy, History, Maximize, Send, Square } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import dayjs from '@/lib/dayjs'
import { requestHistoryDB } from '@/lib/db'
import { RequestHistoryDrawer } from './RequestHistoryDrawer'

export function DebugPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [requestData, setRequestData] = useState({
    url: '',
    method: 'POST',
    headers: '{}',
    body: '{}'
  })
  const [responseData, setResponseData] = useState({
    status: 0,
    responseTime: 0,
    body: '',
    headers: '{}'
  })
  const [isLoading, setIsLoading] = useState(false)
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false)
  const [fullscreenEditor, setFullscreenEditor] = useState<'headers' | 'body' | null>(null)
  const headersEditorRef = useRef<any>(null)
  const bodyEditorRef = useRef<any>(null)

  // Toggle fullscreen mode
  const toggleFullscreen = (editorType: 'headers' | 'body') => {
    const isEnteringFullscreen = fullscreenEditor !== editorType
    setFullscreenEditor(isEnteringFullscreen ? editorType : null)

    // Defer Monaco editor relayout to wait for the DOM update
    setTimeout(() => {
      if (headersEditorRef.current) {
        headersEditorRef.current.layout()
      }
      if (bodyEditorRef.current) {
        bodyEditorRef.current.layout()
      }
    }, 300)
  }

  // Parse log data from URL parameters
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const logDataParam = params.get('logData')

    if (logDataParam) {
      try {
        const parsedData = JSON.parse(decodeURIComponent(logDataParam))

        // Resolve URL - supports several field names
        const url = parsedData.url || parsedData.requestUrl || parsedData.endpoint || ''

        // Resolve method - supports several field names and casings
        const method = (parsedData.method || parsedData.requestMethod || 'POST').toUpperCase()

        // Resolve headers - supports several formats
        let headers: Record<string, string> = {}
        if (parsedData.headers) {
          if (typeof parsedData.headers === 'string') {
            try {
              headers = JSON.parse(parsedData.headers)
            } catch {
              // When it's a string, try to parse as key/value pairs
              const headerLines = parsedData.headers.split('\n')
              headerLines.forEach((line: string) => {
                const [key, ...values] = line.split(':')
                if (key && values.length > 0) {
                  headers[key.trim()] = values.join(':').trim()
                }
              })
            }
          } else {
            headers = parsedData.headers
          }
        }

        // Resolve body - supports several formats and nested structures
        let body: Record<string, unknown> = {}
        let bodyData = null

        // Supports several field names and nested structures
        if (parsedData.body) {
          bodyData = parsedData.body
        } else if (parsedData.request && parsedData.request.body) {
          bodyData = parsedData.request.body
        }

        if (bodyData) {
          if (typeof bodyData === 'string') {
            try {
              // Try to parse as a JSON object
              const parsed = JSON.parse(bodyData)
              body = parsed
            } catch {
              // Not JSON - check whether it's plain text
              const trimmed = bodyData.trim()
              if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                // Looks like JSON but failed to parse - keep as a raw string
                body = { raw: bodyData }
              } else {
                // Plain text - store as is
                body = { content: bodyData }
              }
            }
          } else if (typeof bodyData === 'object') {
            // Already an object - use it directly
            body = bodyData
          } else {
            // Other types - coerce to string
            body = { content: String(bodyData) }
          }
        }

        // Prefill the request form
        setRequestData({
          url,
          method,
          headers: JSON.stringify(headers, null, 2),
          body: JSON.stringify(body, null, 2)
        })

        console.log('Log data parsed successfully:', { url, method, headers, body })
      } catch (error) {
        console.error('Failed to parse log data:', error)
        console.error('Raw log data:', logDataParam)
      }
    }
  }, [location.search])

  // Send the request
  const sendRequest = async () => {
    try {
      setIsLoading(true)

      const headers = JSON.parse(requestData.headers)
      const body = JSON.parse(requestData.body)

      const startTime = dayjs()

      const response = await fetch(requestData.url, {
        method: requestData.method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: requestData.method !== 'GET' ? JSON.stringify(body) : undefined
      })

      const endTime = dayjs()
      const responseTime = endTime.diff(startTime)

      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value
      })

      const responseText = await response.text()
      let responseBody = responseText

      // Try to parse the response as JSON
      try {
        const jsonResponse = JSON.parse(responseText)
        responseBody = JSON.stringify(jsonResponse, null, 2)
      } catch {
        // Not JSON - keep the original text
      }

      const responseHeadersString = JSON.stringify(responseHeaders, null, 2)

      setResponseData({
        status: response.status,
        responseTime,
        body: responseBody,
        headers: responseHeadersString
      })

      // Persist to IndexedDB
      await requestHistoryDB.saveRequest({
        url: requestData.url,
        method: requestData.method,
        headers: requestData.headers,
        body: requestData.body,
        status: response.status,
        responseTime,
        responseBody,
        responseHeaders: responseHeadersString
      })
    } catch (error) {
      console.error('Request failed:', error)
      setResponseData({
        status: 0,
        responseTime: 0,
        body: `请求失败: ${error instanceof Error ? error.message : '未知错误'}`,
        headers: '{}'
      })
    } finally {
      setIsLoading(false)
    }
  }

  // Select a request from history
  const handleSelectRequest = (request: import('@/lib/db').RequestHistoryItem) => {
    setRequestData({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: request.body
    })

    setResponseData({
      status: request.status,
      responseTime: request.responseTime,
      body: request.responseBody,
      headers: request.responseHeaders
    })
  }

  // Copy the cURL command
  const copyCurl = () => {
    try {
      const headers = JSON.parse(requestData.headers)
      const body = JSON.parse(requestData.body)

      let curlCommand = `curl -X ${requestData.method} "${requestData.url}"`

      // Append headers
      Object.entries(headers).forEach(([key, value]) => {
        curlCommand += ` \\\n  -H "${key}: ${value}"`
      })

      // Append body
      if (requestData.method !== 'GET' && Object.keys(body).length > 0) {
        curlCommand += ` \\\n  -d '${JSON.stringify(body)}'`
      }

      navigator.clipboard.writeText(curlCommand)
      alert('cURL命令已复制到剪贴板')
    } catch (error) {
      console.error('Failed to copy cURL:', error)
      alert('复制cURL命令失败')
    }
  }

  return (
    <div className='h-screen bg-gray-50 font-sans'>
      {/* Header */}
      <header className='flex h-16 items-center justify-between border-b bg-background px-6'>
        <div className='flex items-center gap-4'>
          <Button variant='ghost' size='sm' onClick={() => navigate('/models')}>
            <ArrowLeft className='h-4 w-4 mr-2' />
            返回
          </Button>
          <h1 className='text-xl font-semibold text-gray-800'>HTTP 调试器</h1>
        </div>
        <div className='flex items-center gap-2'>
          <Button variant='outline' onClick={() => setIsHistoryDrawerOpen(true)}>
            <History className='h-4 w-4 mr-2' />
            历史记录
          </Button>
          <Button variant='outline' onClick={copyCurl}>
            <Copy className='h-4 w-4 mr-2' />
            复制 cURL
          </Button>
        </div>
      </header>

      {/* Main content */}
      <main className='flex h-[calc(100vh-4rem)] flex-col gap-4 p-4 overflow-hidden'>
        {/* Top: request parameter configuration - vertical layout */}
        <div className='h-1/2 flex flex-col gap-4'>
          <div className='bg-background rounded-lg border p-4 flex-1 flex flex-col'>
            <h3 className='font-medium mb-4'>请求参数配置</h3>
            <div className='flex flex-col gap-4 flex-1'>
              {/* Top: method, URL, and send-request button */}
              <div className='flex gap-4 items-end'>
                <div className='w-32'>
                  <label className='block text-sm font-medium mb-1'>Method</label>
                  <select
                    className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm'
                    value={requestData.method}
                    onChange={(e) => setRequestData((prev) => ({ ...prev, method: e.target.value }))}
                  >
                    <option value='GET'>GET</option>
                    <option value='POST'>POST</option>
                    <option value='PUT'>PUT</option>
                    <option value='DELETE'>DELETE</option>
                    <option value='PATCH'>PATCH</option>
                  </select>
                </div>
                <div className='flex-1'>
                  <label className='block text-sm font-medium mb-1'>URL</label>
                  <input
                    type='text'
                    className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm'
                    value={requestData.url}
                    onChange={(e) => setRequestData((prev) => ({ ...prev, url: e.target.value }))}
                    placeholder='https://api.example.com/endpoint'
                  />
                </div>
                <Button
                  variant={isLoading ? 'destructive' : 'default'}
                  onClick={isLoading ? () => {} : sendRequest}
                  disabled={isLoading || !requestData.url.trim()}
                >
                  {isLoading ? (
                    <>
                      <Square className='h-4 w-4 mr-2' />
                      请求中...
                    </>
                  ) : (
                    <>
                      <Send className='h-4 w-4 mr-2' />
                      发送请求
                    </>
                  )}
                </Button>
              </div>

              {/* Headers and body configuration - tabbed layout */}
              <div className='flex-1'>
                <Tabs defaultValue='headers' className='h-full flex flex-col'>
                  <TabsList className='grid w-full grid-cols-2'>
                    <TabsTrigger value='headers'>Headers</TabsTrigger>
                    <TabsTrigger value='body'>Body</TabsTrigger>
                  </TabsList>

                  <TabsContent value='headers' className='flex-1 mt-2'>
                    <div
                      className={`${fullscreenEditor === 'headers' ? '' : 'h-full'} flex flex-col ${
                        fullscreenEditor === 'headers'
                          ? 'fixed bg-background w-[100vw] h-[100vh] z-[9999] top-0 left-0 p-4'
                          : ''
                      }`}
                    >
                      <div className='flex items-center justify-between mb-2'>
                        <label className='block text-sm font-medium'>Headers (JSON)</label>
                        <Button variant='ghost' size='sm' onClick={() => toggleFullscreen('headers')}>
                          <Maximize className='h-4 w-4 mr-1' />
                          {fullscreenEditor === 'headers' ? '退出全屏' : '全屏'}
                        </Button>
                      </div>
                      <div
                        id='fullscreen-headers'
                        className={`${fullscreenEditor === 'headers' ? 'h-full' : 'flex-1'} border border-gray-300 rounded-md overflow-hidden relative`}
                      >
                        <MonacoEditor
                          height='100%'
                          language='json'
                          value={requestData.headers}
                          onChange={(value) => setRequestData((prev) => ({ ...prev, headers: value || '{}' }))}
                          onMount={(editor) => {
                            headersEditorRef.current = editor
                          }}
                          options={{
                            minimap: { enabled: fullscreenEditor === 'headers' },
                            scrollBeyondLastLine: false,
                            fontSize: 14,
                            lineNumbers: 'on',
                            wordWrap: 'on',
                            automaticLayout: true,
                            formatOnPaste: true,
                            formatOnType: true
                          }}
                        />
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value='body' className='flex-1 mt-2'>
                    <div
                      className={`${fullscreenEditor === 'body' ? '' : 'h-full'} flex flex-col ${
                        fullscreenEditor === 'body'
                          ? 'fixed bg-background w-[100vw] h-[100vh] z-[9999] top-0 left-0 p-4'
                          : ''
                      }`}
                    >
                      <div className='flex items-center justify-between mb-2'>
                        <label className='block text-sm font-medium'>Body (JSON)</label>
                        <Button variant='ghost' size='sm' onClick={() => toggleFullscreen('body')}>
                          <Maximize className='h-4 w-4 mr-1' />
                          {fullscreenEditor === 'body' ? '退出全屏' : '全屏'}
                        </Button>
                      </div>
                      <div
                        id='fullscreen-body'
                        className={`${fullscreenEditor === 'body' ? 'h-full' : 'flex-1'} border border-gray-300 rounded-md overflow-hidden relative`}
                      >
                        <MonacoEditor
                          height='100%'
                          language='json'
                          value={requestData.body}
                          onChange={(value) => setRequestData((prev) => ({ ...prev, body: value || '{}' }))}
                          onMount={(editor) => {
                            bodyEditorRef.current = editor
                          }}
                          options={{
                            minimap: { enabled: fullscreenEditor === 'body' },
                            scrollBeyondLastLine: false,
                            fontSize: 14,
                            lineNumbers: 'on',
                            wordWrap: 'on',
                            automaticLayout: true,
                            formatOnPaste: true,
                            formatOnType: true
                          }}
                        />
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom: response viewer */}
        <div className='h-1/2 flex flex-col gap-4'>
          <div className='flex-1 bg-background rounded-lg border p-4 flex flex-col'>
            <div className='flex items-center justify-between mb-4'>
              <h3 className='font-medium'>响应信息</h3>
              {responseData.status > 0 && (
                <div className='flex items-center gap-4 text-sm'>
                  <span className='flex items-center gap-1'>
                    状态码:{' '}
                    <span
                      className={`font-mono px-2 py-1 rounded ${
                        responseData.status >= 200 && responseData.status < 300
                          ? 'bg-green-100 text-green-800'
                          : responseData.status >= 400
                            ? 'bg-red-100 text-red-800'
                            : 'bg-yellow-100 text-yellow-800'
                      }`}
                    >
                      {responseData.status}
                    </span>
                  </span>
                  <span>
                    响应时间: <span className='font-mono'>{responseData.responseTime}ms</span>
                  </span>
                </div>
              )}
            </div>

            {responseData.body ? (
              <div className='flex-1'>
                <Tabs defaultValue='body' className='h-full flex flex-col'>
                  <TabsList className='grid w-full grid-cols-2'>
                    <TabsTrigger value='body'>响应体</TabsTrigger>
                    <TabsTrigger value='headers'>响应头</TabsTrigger>
                  </TabsList>

                  <TabsContent value='body' className='flex-1 mt-2'>
                    <div className='bg-gray-50 border rounded-md p-3 h-full overflow-auto'>
                      <pre className='text-sm whitespace-pre-wrap'>{responseData.body}</pre>
                    </div>
                  </TabsContent>

                  <TabsContent value='headers' className='flex-1 mt-2'>
                    <div className='bg-gray-50 border rounded-md p-3 h-full overflow-auto'>
                      <pre className='text-sm'>{responseData.headers}</pre>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            ) : (
              <div className='flex-1 flex items-center justify-center text-gray-500'>
                {isLoading ? '发送请求中...' : '发送请求后将在此显示响应'}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Request history drawer */}
      <RequestHistoryDrawer
        isOpen={isHistoryDrawerOpen}
        onClose={() => setIsHistoryDrawerOpen(false)}
        onSelectRequest={handleSelectRequest}
      />
    </div>
  )
}
