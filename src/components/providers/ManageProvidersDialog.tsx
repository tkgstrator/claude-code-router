import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { ProviderIcon } from '@/lib/providerIcons'
import type { CatalogEntry } from '@/schemas/catalog.dto'
import type { Provider, ProviderAuthMode } from '@/types'

interface ManageProvidersDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  catalog: CatalogEntry[]
  activeAuthMode: ProviderAuthMode
  validProviders: Provider[]
  onToggleCatalog: (entry: CatalogEntry, checked: boolean) => void
}

// Manage: toggle catalog entries on/off. Toggling ON opens either the Edit
// dialog (api_key) or the OAuth flow (subscription). Toggling OFF removes
// the Provider row from config.
export function ManageProvidersDialog({
  open,
  onOpenChange,
  catalog,
  activeAuthMode,
  validProviders,
  onToggleCatalog
}: ManageProvidersDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[80vh] flex flex-col sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{t('providers.manage_title')}</DialogTitle>
          <DialogDescription>{t('providers.manage_description')}</DialogDescription>
        </DialogHeader>
        <div className='flex-1 overflow-y-auto'>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-2'>
            {catalog
              .filter((entry) => entry.authMode === activeAuthMode)
              .map((entry) => {
                const enabled = validProviders.some((p) => p.name === entry.name)
                return (
                  <div key={entry.name} className='flex items-center gap-3 rounded-md border px-3 py-2'>
                    <ProviderIcon name={entry.name} size={24} className='flex-shrink-0' />
                    <div className='min-w-0 flex-1'>
                      <div className='font-medium text-sm truncate'>{entry.displayName}</div>
                      <div className='text-xs text-muted-foreground truncate'>
                        {t('providers.catalog_models_count', { count: entry.models.length })}
                      </div>
                    </div>
                    <Switch checked={enabled} onCheckedChange={(next) => onToggleCatalog(entry, next)} />
                  </div>
                )
              })}
          </div>
        </div>
        <div className='flex justify-end'>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('app.cancel')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
