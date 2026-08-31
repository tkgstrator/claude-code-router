import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui-ext/input'
import { api } from '@/lib/api'

export function Login() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // Check if user is already authenticated
  useEffect(() => {
    const checkAuth = async () => {
      const apiKey = localStorage.getItem('apiKey')
      if (apiKey) {
        setIsLoading(true)
        // Verify the API key is still valid
        try {
          await api.getConfig()
          navigate('/overview')
        } catch {
          // If verification fails, remove the API key
          localStorage.removeItem('apiKey')
        } finally {
          setIsLoading(false)
        }
      }
    }

    checkAuth()

    // Listen for unauthorized events
    const handleUnauthorized = () => {
      navigate('/login')
    }

    window.addEventListener('unauthorized', handleUnauthorized)

    return () => {
      window.removeEventListener('unauthorized', handleUnauthorized)
    }
  }, [navigate])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      // Set the API key
      api.setApiKey(apiKey)

      // Dispatch storage event to notify other components of the change
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'apiKey',
          newValue: apiKey,
          url: window.location.href
        })
      )

      // Test the API key by fetching config
      await api.getConfig()

      // The key works. ConfigProvider refetches on the storage event
      // dispatched above, so the shell has a config by the time it mounts.
      // A full reload rather than navigate(): ConfigProvider already
      // recorded the auth failure, and only a remount clears it.
      window.location.assign('/overview')
    } catch (error: any) {
      // Clear the API key on failure
      api.setApiKey('')

      // apiFetch throws 'Unauthorized' on a 401; older paths surfaced the
      // status in the message. Accept either rather than letting a wrong
      // key look like an unrelated failure.
      const message = typeof error?.message === 'string' ? error.message : ''
      if (message === 'Unauthorized' || message.includes('401')) {
        setError(t('login.invalidApiKey'))
      } else {
        // Anything else is the server being unreachable, not a bad key —
        // say so instead of waving the operator through to a shell that
        // cannot load either.
        setError(message.length > 0 ? message : t('login.invalidApiKey'))
      }
    }
  }

  if (isLoading) {
    return (
      <div className='flex min-h-screen items-center justify-center bg-background p-6'>
        <div className='w-full max-w-md space-y-6'>
          <h1 className='text-2xl font-semibold'>{t('login.title')}</h1>
          <div>
            <div className='flex justify-center py-8'>
              <div className='h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent'></div>
            </div>
            <p className='text-center text-sm text-muted-foreground'>{t('login.validating')}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='flex min-h-screen items-center justify-center bg-background p-6'>
      <div className='w-full max-w-md space-y-6'>
        <div className='space-y-1 border-b pb-4'>
          <h1 className='text-2xl font-semibold'>{t('login.title')}</h1>
          <p className='text-sm text-muted-foreground'>{t('login.description')}</p>
        </div>
        <form onSubmit={handleLogin} className='space-y-6'>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='apiKey'>{t('login.apiKey')}</Label>
              <Input
                id='apiKey'
                type='password'
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={t('login.apiKeyPlaceholder')}
              />
            </div>
            <p className='text-sm text-muted-foreground'>{t('login.keyHint')}</p>
            {error && <div className='text-sm text-red-500'>{error}</div>}
          </div>
          <div>
            <Button className='w-full' type='submit'>
              {t('login.signIn')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
