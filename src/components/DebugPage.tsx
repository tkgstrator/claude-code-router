import { ArrowLeft, Copy, History, Send, Square } from 'lucide-react'
import type { editor } from 'monaco-editor'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import dayjs from '@/lib/dayjs'
import { requestHistoryDB } from '@/lib/db'
import { buildCurlCommand } from '@/lib/debug/curl'
import { parseLogData } from '@/lib/debug/parse-log-data'
import { JsonEditorPanel } from './debug/JsonEditorPanel'
import { type ResponseData, ResponseViewer } from './debug/ResponseViewer'
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
  const [responseData, setResponseData] = useState<ResponseData>({
    status: 0,
    responseTime: 0,
    body: '',
    headers: '{}'
  })
  const [isLoading, setIsLoading] = useState(false)
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false)
  const [fullscreenEditor, setFullscreenEditor] = useState<'headers' | 'body' | null>(null)
  const headersEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const bodyEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null)

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
    if (!logDataParam) {
      return
    }

    try {
      const parsed = parseLogData(logDataParam)
      setRequestData({
        url: parsed.url,
        method: parsed.method,
        headers: JSON.stringify(parsed.headers, null, 2),
        body: JSON.stringify(parsed.body, null, 2)
      })
      console.log('Log data parsed successfully:', parsed)
    } catch (error) {
      console.error('Failed to parse log data:', error)
      console.error('Raw log data:', logDataParam)
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
      // Try to parse the response as JSON; otherwise keep the original text.
      const responseBody = jsonPrettyOrRaw(responseText)

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
      const curlCommand = buildCurlCommand(requestData.method, requestData.url, headers, body)

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
                    <JsonEditorPanel
                      label='Headers (JSON)'
                      value={requestData.headers}
                      onChange={(value) => setRequestData((prev) => ({ ...prev, headers: value }))}
                      editorRef={headersEditorRef}
                      domId='fullscreen-headers'
                      isFullscreen={fullscreenEditor === 'headers'}
                      onToggleFullscreen={() => toggleFullscreen('headers')}
                    />
                  </TabsContent>

                  <TabsContent value='body' className='flex-1 mt-2'>
                    <JsonEditorPanel
                      label='Body (JSON)'
                      value={requestData.body}
                      onChange={(value) => setRequestData((prev) => ({ ...prev, body: value }))}
                      editorRef={bodyEditorRef}
                      domId='fullscreen-body'
                      isFullscreen={fullscreenEditor === 'body'}
                      onToggleFullscreen={() => toggleFullscreen('body')}
                    />
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom: response viewer */}
        <ResponseViewer responseData={responseData} isLoading={isLoading} />
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

// Pretty-print the response body when it's JSON; otherwise return the raw text.
function jsonPrettyOrRaw(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}
