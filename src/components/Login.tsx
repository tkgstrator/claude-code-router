import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
          navigate('/models')
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

      // Navigate to dashboard
      // The ConfigProvider will handle fetching the config
      navigate('/models')
    } catch (error: any) {
      // Clear the API key on failure
      api.setApiKey('')

      // Check if it's an unauthorized error
      if (error.message && error.message.includes('401')) {
        setError(t('login.invalidApiKey'))
      } else {
        // For other errors, still allow access (restricted mode)
        navigate('/models')
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
