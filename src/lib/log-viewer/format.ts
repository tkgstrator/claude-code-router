import dayjs from '@/lib/dayjs'

export function formatFileSize(bytes: number) {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / k ** i).toFixed(2)) + ' ' + sizes[i]
}

export function formatDate(dateString: string) {
  return dayjs(dateString).format('YYYY/MM/DD HH:mm:ss')
}
