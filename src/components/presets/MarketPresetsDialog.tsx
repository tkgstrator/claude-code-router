import { Check, Download, Loader2, Package, Search, Store } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { filterMarketPresets, isMarketPresetInstalled } from '@/lib/presets/market'
import type { MarketPreset, PresetMetadata } from '@/lib/presets/types'

interface MarketPresetsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  search: string
  onSearchChange: (value: string) => void
  presets: MarketPreset[]
  loading: boolean
  installedPresets: PresetMetadata[]
  installingId: string | null
  onInstall: (preset: MarketPreset) => void
}

export function MarketPresetsDialog({
  open,
  onOpenChange,
  search,
  onSearchChange,
  presets,
  loading,
  installedPresets,
  installingId,
  onInstall
}: MarketPresetsDialogProps) {
  const { t } = useTranslation()
  const filteredPresets = filterMarketPresets(presets, search)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-4xl max-h-[80vh] overflow-hidden flex flex-col'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Store className='h-5 w-5' />
            {t('presets.market_title')}
          </DialogTitle>
          <DialogDescription>{t('presets.market_description')}</DialogDescription>
        </DialogHeader>

        <div className='flex items-center gap-2 py-4'>
          <div className='relative flex-1'>
            <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground' />
            <Input
              placeholder={t('presets.search_placeholder')}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className='pl-9'
            />
          </div>
        </div>

        <div className='flex-1 overflow-y-auto'>
          {loading ? (
            <div className='flex items-center justify-center h-64'>
              <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
            </div>
          ) : filteredPresets.length === 0 ? (
            <div className='flex flex-col items-center justify-center h-64 text-muted-foreground'>
              <Package className='h-12 w-12 mb-4 opacity-50' />
              <p>{t('presets.no_presets_found')}</p>
              <p className='text-sm'>{t('presets.no_presets_found_hint')}</p>
            </div>
          ) : (
            <div className='divide-y border-y'>
              {filteredPresets.map((preset) => {
                const isInstalled = isMarketPresetInstalled(preset, installedPresets)

                return (
                  <div key={preset.id} className='px-1 py-3 hover:bg-muted/50 transition-colors'>
                    <div className='flex items-start justify-between gap-4'>
                      <div className='flex-1'>
                        <div className='flex items-center gap-2 mb-2'>
                          <h3 className='font-semibold text-lg'>{preset.name}</h3>
                        </div>
                        {preset.description && (
                          <p className='text-sm text-muted-foreground mb-2'>{preset.description}</p>
                        )}
                        <div className='flex items-center gap-4 text-sm text-muted-foreground'>
                          {preset.author && (
                            <div className='flex items-center gap-1.5'>
                              <span className='font-medium'>{t('presets.by', { author: preset.author })}</span>
                              <a
                                href={`https://github.com/${preset.repo}`}
                                target='_blank'
                                rel='noopener noreferrer'
                                className='text-muted-foreground hover:text-foreground transition-colors'
                                title={t('presets.github_repository')}
                              >
                                <i className='ri-github-fill text-xl'></i>
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                      <Button
                        onClick={() => onInstall(preset)}
                        disabled={installingId === preset.id || isInstalled}
                        variant={isInstalled ? 'secondary' : 'default'}
                        className='shrink-0'
                      >
                        {installingId === preset.id ? (
                          <>
                            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                            {t('presets.installing')}
                          </>
                        ) : isInstalled ? (
                          <>
                            <Check className='mr-2 h-4 w-4' />
                            {t('presets.installed_label')}
                          </>
                        ) : (
                          <>
                            <Download className='mr-2 h-4 w-4' />
                            {t('presets.install')}
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
