import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export interface ResponseData {
  status: number
  responseTime: number
  body: string
  headers: string
}

interface ResponseViewerProps {
  responseData: ResponseData
  isLoading: boolean
}

export function ResponseViewer({ responseData, isLoading }: ResponseViewerProps) {
  return (
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
  )
}
