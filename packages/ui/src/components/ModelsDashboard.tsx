import { LayoutDashboard } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Placeholder for the model dashboard.
 *
 * The full dashboard (per-model reachability badges, "Test all", and
 * route-assignment visualisation) lands in a follow-up PR. This shell
 * page already gives it a home in the sidebar navigation.
 */
export function ModelsDashboard() {
  const { t } = useTranslation()

  return (
    <Card className='flex h-full flex-col rounded-lg border shadow-sm'>
      <CardHeader className='border-b p-4'>
        <CardTitle className='text-lg'>{t('nav.models')}</CardTitle>
      </CardHeader>
      <CardContent className='flex flex-grow flex-col items-center justify-center gap-3 p-4 text-center'>
        <LayoutDashboard className='h-10 w-10 text-gray-300' />
        <p className='text-sm text-gray-500'>{t('models.placeholder')}</p>
      </CardContent>
    </Card>
  )
}
