import { Check, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProviderIcon } from '@/lib/providerIcons'
import type { Provider } from '@/types'

interface ProviderListProps {
  providers: Provider[]
  onEdit: (index: number) => void
  onRemove: (index: number) => void
}

export function ProviderList({ providers, onEdit, onRemove }: ProviderListProps) {
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
                <Button
                  variant='destructive'
                  size='icon'
                  onClick={() => onRemove(index)}
                  className='transition-all duration-200 hover:scale-110'
                >
                  <Trash2 className='h-4 w-4 text-current transition-colors duration-200' />
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

        const isSubscription = provider.auth_mode === 'subscription'
        const isConfigured = isSubscription || (provider.api_key?.trim().length ?? 0) > 0

        return (
          <div
            key={index}
            className='relative flex items-center justify-between rounded-md border bg-white p-4 transition-all hover:shadow-md animate-slide-in hover:scale-[1.01]'
          >
            {isConfigured && (
              <span className='absolute right-2 top-2 inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white'>
                <Check className='h-3 w-3' strokeWidth={3} />
              </span>
            )}
            <div className='flex flex-1 items-center gap-3'>
              <ProviderIcon name={providerName} size={28} className='flex-shrink-0' />
              <div className='flex-1 space-y-1'>
                <p className='text-md font-semibold text-gray-800'>{providerName}</p>
                <p className='text-sm text-gray-500'>{apiBasePath}</p>
              </div>
            </div>
            <div className='ml-4 flex flex-shrink-0 items-center gap-2'>
              <Button
                variant='ghost'
                size='icon'
                onClick={() => onEdit(index)}
                className='transition-all-ease hover:scale-110'
              >
                <Pencil className='h-4 w-4' />
              </Button>
              <Button
                variant='destructive'
                size='icon'
                onClick={() => onRemove(index)}
                className='transition-all duration-200 hover:scale-110'
              >
                <Trash2 className='h-4 w-4 text-current transition-colors duration-200' />
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
