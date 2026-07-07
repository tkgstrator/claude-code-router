import { CheckCircle2, Circle, LoaderCircle, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Reachability } from '@/lib/models/types'

export function StatusIcon({ state }: { state: Reachability }) {
  const { t } = useTranslation()
  if (state === 'testing') {
    return (
      <LoaderCircle className='h-4 w-4 animate-spin text-muted-foreground' aria-label={t('models.status_testing')} />
    )
  }
  if (state === 'ok') {
    return <CheckCircle2 className='h-4 w-4 text-green-600' aria-label={t('models.status_ok')} />
  }
  if (state === 'fail') {
    return <XCircle className='h-4 w-4 text-red-600' aria-label={t('models.status_fail')} />
  }
  return <Circle className='h-4 w-4 text-muted-foreground/40' aria-label={t('models.status_unknown')} />
}
