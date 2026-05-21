/**
 * Landing page the OAuth callback flow redirects to after the
 * server-side token exchange completes. The actual token exchange + DB
 * upsert happens in /callback (claude) or the standalone 1455 listener
 * (codex) — by the time the browser lands here, the result is already
 * persisted, so this component is read-only.
 *
 * Query params:
 *   status   = "ok" | "error"
 *   provider = "claude" | "codex"  (only used for the i18n display name)
 *   message  = optional human-readable error detail (status=error only)
 */

import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Status = 'ok' | 'error'
type Provider = 'claude' | 'codex'

const isStatus = (v: string | null): v is Status => v === 'ok' || v === 'error'
const isProvider = (v: string | null): v is Provider => v === 'claude' || v === 'codex'

export function OauthResultPage() {
  const [params] = useSearchParams()
  const { t } = useTranslation()

  const statusRaw = params.get('status')
  const providerRaw = params.get('provider')
  const message = params.get('message')

  const status: Status = isStatus(statusRaw) ? statusRaw : 'error'
  const provider: Provider = isProvider(providerRaw) ? providerRaw : 'claude'

  const providerLabel = t(
    provider === 'claude' ? 'providers.oauth_result_provider_claude' : 'providers.oauth_result_provider_codex'
  )

  const title = t(status === 'ok' ? 'providers.oauth_result_success_title' : 'providers.oauth_result_failure_title')
  const body =
    status === 'ok'
      ? t('providers.oauth_result_success_body', { provider: providerLabel })
      : (message ?? 'Unknown error during sign-in.')

  return (
    <div className='flex min-h-screen items-center justify-center bg-background p-6'>
      <Card className='w-full max-w-md'>
        <CardHeader>
          <CardTitle className={status === 'ok' ? 'text-emerald-600' : 'text-destructive'}>{title}</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          <p className='text-sm text-muted-foreground'>{body}</p>
          <Button
            type='button'
            variant='outline'
            onClick={() => {
              window.close()
            }}
          >
            {t('providers.oauth_result_close_tab')}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
