import { AlertTriangle, Compass, House, RotateCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isRouteErrorResponse, useLocation, useNavigate, useRouteError } from 'react-router-dom'
import { Button } from '@/components/ui/button'

// Renders both React Router 404s (thrown Response 404) and runtime errors
// thrown from a rendered route. The layout matches OauthResultPage so a
// dev landing on an error still sees a familiar centered card.
export function ErrorPage() {
  const error = useRouteError()
  const view = classify(error)
  return view.kind === 'not_found' ? <NotFoundCard /> : <RuntimeErrorCard error={view.error} />
}

type ClassifiedView = { kind: 'not_found' } | { kind: 'runtime'; error: unknown }

function classify(error: unknown): ClassifiedView {
  if (isRouteErrorResponse(error) && error.status === 404) return { kind: 'not_found' }
  if (error == null) return { kind: 'not_found' }
  return { kind: 'runtime', error }
}

function NotFoundCard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  return (
    <ErrorShell>
      <div className='w-full max-w-md space-y-6'>
        <div className='flex items-center gap-3 border-b pb-4'>
          <div className='rounded-full bg-muted p-2'>
            <Compass className='h-5 w-5 text-muted-foreground' />
          </div>
          <div>
            <h1 className='text-base font-semibold'>{t('errors.not_found_title')}</h1>
            <p className='text-sm text-muted-foreground'>{t('errors.not_found_body')}</p>
          </div>
        </div>
        <div className='space-y-4'>
          <div className='border bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground break-all'>
            {pathname}
          </div>
          <div className='flex gap-2'>
            <Button type='button' onClick={() => navigate('/')}>
              <House className='h-4 w-4' />
              {t('errors.go_home')}
            </Button>
          </div>
        </div>
      </div>
    </ErrorShell>
  )
}

function RuntimeErrorCard({ error }: { error: unknown }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const summary = summarise(error)
  const details = describe(error)
  return (
    <ErrorShell>
      <div className='w-full max-w-lg space-y-6'>
        <div className='flex items-center gap-3 border-b pb-4'>
          <div className='rounded-full bg-destructive/10 p-2'>
            <AlertTriangle className='h-5 w-5 text-destructive' />
          </div>
          <div>
            <h1 className='text-base font-semibold'>{t('errors.generic_title')}</h1>
            <p className='text-sm text-muted-foreground'>{t('errors.generic_body')}</p>
          </div>
        </div>
        <div className='space-y-4'>
          <div className='border bg-muted/40 px-3 py-2 text-sm break-words'>{summary}</div>
          {details && (
            <div>
              <button
                type='button'
                className='text-xs text-muted-foreground underline underline-offset-2'
                onClick={() => setDetailsOpen((v) => !v)}
              >
                {detailsOpen ? t('errors.hide_details') : t('errors.show_details')}
              </button>
              {detailsOpen && (
                <pre className='mt-2 max-h-64 overflow-auto border bg-muted/40 px-3 py-2 font-mono text-[10px] whitespace-pre-wrap break-all'>
                  {details}
                </pre>
              )}
            </div>
          )}
          <div className='flex gap-2'>
            <Button type='button' onClick={() => window.location.reload()}>
              <RotateCw className='h-4 w-4' />
              {t('errors.retry')}
            </Button>
            <Button type='button' variant='outline' onClick={() => navigate('/')}>
              <House className='h-4 w-4' />
              {t('errors.go_home')}
            </Button>
          </div>
        </div>
      </div>
    </ErrorShell>
  )
}

function ErrorShell({ children }: { children: React.ReactNode }) {
  return <div className='flex min-h-screen items-center justify-center bg-background p-6'>{children}</div>
}

function summarise(error: unknown): string {
  if (isRouteErrorResponse(error)) {
    return error.statusText ? `${error.status} ${error.statusText}` : String(error.status)
  }
  if (error instanceof Error) return error.message.length > 0 ? error.message : error.name
  if (typeof error === 'string') return error
  return String(error)
}

function describe(error: unknown): string | null {
  if (isRouteErrorResponse(error)) return routeErrorData(error)
  if (error instanceof Error && error.stack) return error.stack
  return null
}

function routeErrorData(error: { data: unknown }): string | null {
  if (typeof error.data === 'string' && error.data.length > 0) return error.data
  if (error.data == null) return null
  return JSON.stringify(error.data, null, 2)
}
