import { CheckCircle2, LoaderCircle, Pencil, Wifi, XCircle } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { ProviderIcon } from '@/lib/providerIcons'
import type { Provider } from '@/types'

type TestState = 'idle' | 'testing' | 'ok' | 'fail'

interface ProviderListProps {
  providers: Provider[]
  onEdit: (index: number) => void
  planByProvider?: Record<string, string | null>
}

export function ProviderList({ providers, onEdit, planByProvider }: ProviderListProps) {
  const [testState, setTestState] = useState<Record<string, TestState>>({})
  const [testError, setTestError] = useState<Record<string, string>>({})

  const handleTest = async (providerName: string) => {
    setTestState((prev) => ({ ...prev, [providerName]: 'testing' }))
    setTestError((prev) => {
      const next = { ...prev }
      delete next[providerName]
      return next
    })
    try {
      const result = await api.post<{ success: boolean; error?: string; latencyMs?: number }>('/providers/test', {
        name: providerName
      })
      setTestState((prev) => ({ ...prev, [providerName]: result.success ? 'ok' : 'fail' }))
      if (!result.success && result.error) {
        setTestError((prev) => ({ ...prev, [providerName]: result.error as string }))
      }
    } catch (err) {
      setTestState((prev) => ({ ...prev, [providerName]: 'fail' }))
      setTestError((prev) => ({ ...prev, [providerName]: err instanceof Error ? err.message : 'request failed' }))
    }
  }

  const renderTestIcon = (state: TestState | undefined) => {
    if (state === 'testing') return <LoaderCircle className='h-4 w-4 animate-spin' />
    if (state === 'ok') return <CheckCircle2 className='h-4 w-4 text-emerald-600' />
    if (state === 'fail') return <XCircle className='h-4 w-4 text-red-600' />
    return <Wifi className='h-4 w-4' />
  }
  // Handle case where providers might be null or undefined
  if (!providers || !Array.isArray(providers)) {
    return (
      <div className='space-y-3'>
        <div className='flex items-center justify-center rounded-md border bg-white p-8 text-gray-500'>
          No providers configured
        </div>
      </div>
    )
  }

  return (
    <div className='grid gap-3 lg:grid-cols-2'>
      {providers.map((provider, index) => {
        // Handle case where individual provider might be null or undefined
        if (!provider) {
          return (
            <div
              key={index}
              className='flex items-start justify-between rounded-md border bg-white p-4 transition-all hover:shadow-md animate-slide-in hover:scale-[1.01]'
            >
              <div className='flex-1 space-y-1.5'>
                <p className='text-md font-semibold text-gray-800'>Invalid Provider</p>
                <p className='text-sm text-gray-500'>Provider data is missing</p>
              </div>
              <div className='ml-4 flex flex-shrink-0 items-center gap-2'>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={() => onEdit(index)}
                  className='transition-all-ease hover:scale-110'
                  disabled
                >
                  <Pencil className='h-4 w-4' />
                </Button>
              </div>
            </div>
          )
        }

        // Handle case where provider.name might be null or undefined
        const providerName = provider.name || 'Unnamed Provider'

        const apiBasePath = (() => {
          if (!provider.api_base_url) return 'No API URL'
          try {
            return new URL(provider.api_base_url).pathname || '/'
          } catch {
            return provider.api_base_url
          }
        })()

        return (
          <div
            key={index}
            className='flex items-center justify-between rounded-md border bg-white p-4 transition-all hover:shadow-md animate-slide-in hover:scale-[1.01]'
          >
            <div className='flex flex-1 items-center gap-3'>
              <ProviderIcon name={providerName} size={28} className='flex-shrink-0' />
              <div className='flex-1 space-y-1'>
                <div className='flex items-center gap-2'>
                  <p className='text-md font-semibold text-gray-800'>{providerName}</p>
                  {planByProvider?.[providerName] && (
                    <Badge variant='secondary' className='text-xs uppercase tracking-wide'>
                      {planByProvider[providerName]}
                    </Badge>
                  )}
                </div>
                <p className='text-sm text-gray-500'>{apiBasePath}</p>
              </div>
            </div>
            <div className='ml-4 flex flex-shrink-0 items-center gap-2'>
              <Button
                variant='ghost'
                size='icon'
                onClick={() => handleTest(providerName)}
                disabled={testState[providerName] === 'testing'}
                className='transition-all-ease hover:scale-110'
                title={testError[providerName] ?? 'Test connection'}
              >
                {renderTestIcon(testState[providerName])}
              </Button>
              <Button
                variant='ghost'
                size='icon'
                onClick={() => onEdit(index)}
                className='transition-all-ease hover:scale-110'
              >
                <Pencil className='h-4 w-4' />
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
