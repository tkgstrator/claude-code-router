import { Clock, History, Trash2, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import dayjs from '@/lib/dayjs'
import { type RequestHistoryItem, requestHistoryDB } from '@/lib/db'

interface RequestHistoryDrawerProps {
  isOpen: boolean
  onClose: () => void
  onSelectRequest: (request: RequestHistoryItem) => void
}

export function RequestHistoryDrawer({ isOpen, onClose, onSelectRequest }: RequestHistoryDrawerProps) {
  const [requests, setRequests] = useState<RequestHistoryItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (isOpen) {
      loadRequests()
    }
  }, [isOpen])

  const loadRequests = async () => {
    try {
      setLoading(true)
      const history = await requestHistoryDB.getRequests()
      setRequests(history)
    } catch (error) {
      console.error('Failed to load request history:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation()
    try {
      await requestHistoryDB.deleteRequest(id)
      setRequests((prev) => prev.filter((req) => req.id !== id))
    } catch (error) {
      console.error('Failed to delete request:', error)
    }
  }

  const handleClearAll = async () => {
    if (window.confirm('确定要清空所有请求历史吗？')) {
      try {
        await requestHistoryDB.clearAllRequests()
        setRequests([])
      } catch (error) {
        console.error('Failed to clear request history:', error)
      }
    }
  }

  const formatTime = (timestamp: string) => {
    const date = dayjs(timestamp)
    const minutes = dayjs().diff(date, 'minute')

    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes}分钟前`
    if (minutes < 1440) return `${Math.floor(minutes / 60)}小时前`
    return date.format('YYYY/MM/DD')
  }

  if (!isOpen) return null

  return (
    <div className='fixed inset-0 z-50'>
      {/* Backdrop */}
      <div className='absolute inset-0 bg-black bg-opacity-50' onClick={onClose} />

      {/* Drawer */}
      <div className='absolute right-0 top-0 h-full w-96 bg-background shadow-xl flex flex-col'>
        {/* Header */}
        <div className='flex items-center justify-between p-4 border-b'>
          <div className='flex items-center gap-2'>
            <History className='h-5 w-5' />
            <h2 className='text-lg font-semibold'>请求历史</h2>
          </div>
          <div className='flex items-center gap-2'>
            <Button variant='outline' size='sm' onClick={handleClearAll} disabled={requests.length === 0}>
              <Trash2 className='h-4 w-4 mr-1' />
              清空
            </Button>
            <Button variant='ghost' size='sm' onClick={onClose}>
              <X className='h-4 w-4' />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className='flex-1 overflow-y-auto p-4'>
          {loading ? (
            <div className='flex items-center justify-center h-32 text-muted-foreground'>加载中...</div>
          ) : requests.length > 0 ? (
            <div className='divide-y border-y'>
              {requests.map((item) => (
                <div
                  key={item.id}
                  className='px-1 py-3 cursor-pointer hover:bg-muted/50 transition-colors'
                  onClick={() => {
                    onSelectRequest(item)
                    onClose()
                  }}
                >
                  <div className='flex items-center justify-between mb-2'>
                    <div className='flex items-center gap-2'>
                      <span className='font-mono text-xs bg-muted px-2 py-1 rounded'>{item.method}</span>
                      <span className='text-sm font-medium truncate flex-1'>{item.url}</span>
                    </div>
                    <Button variant='ghost' size='sm' onClick={(e) => handleDelete(item.id, e)} className='h-6 w-6 p-0'>
                      <Trash2 className='h-3 w-3' />
                    </Button>
                  </div>

                  <div className='flex items-center justify-between text-xs text-muted-foreground'>
                    <div className='flex items-center gap-2'>
                      <span
                        className={`font-mono px-1 rounded ${
                          item.status >= 200 && item.status < 300
                            ? 'bg-green-100 text-green-800'
                            : item.status >= 400
                              ? 'bg-red-100 text-red-800'
                              : 'bg-yellow-100 text-yellow-800'
                        }`}
                      >
                        {item.status}
                      </span>
                      <span>{item.responseTime}ms</span>
                    </div>
                    <div className='flex items-center gap-1'>
                      <Clock className='h-3 w-3' />
                      <span>{formatTime(item.timestamp)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className='text-center text-muted-foreground py-8'>
              <History className='h-12 w-12 mx-auto mb-4 text-muted-foreground/50' />
              <p>暂无请求历史</p>
              <p className='text-sm mt-2'>发送请求后会在此显示历史记录</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
