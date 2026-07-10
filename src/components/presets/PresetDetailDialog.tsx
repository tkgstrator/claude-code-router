import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { PresetDetail } from '@/lib/presets/types'
import { DynamicConfigForm } from '../preset/DynamicConfigForm'

interface PresetDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  preset: PresetDetail | null
  // biome-ignore lint/suspicious/noExplicitAny: form values are arbitrary JSON keyed by schema field id
  initialValues: Record<string, any>
  isApplying: boolean
  // biome-ignore lint/suspicious/noExplicitAny: form values are arbitrary JSON keyed by schema field id
  onApply: (values: Record<string, any>) => void
}

export function PresetDetailDialog({
  open,
  onOpenChange,
  preset,
  initialValues,
  isApplying,
  onApply
}: PresetDetailDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-2xl max-h-[80vh] overflow-hidden flex flex-col' aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            {preset?.name}
            {preset?.version && <span className='text-sm font-normal text-muted-foreground'>v{preset.version}</span>}
          </DialogTitle>
        </DialogHeader>
        <div className='flex-1 overflow-y-auto py-4 px-2'>
          {preset?.description && <p className='text-foreground mb-4'>{preset.description}</p>}

          {preset?.author && (
            <p className='text-sm text-muted-foreground mb-1'>
              <strong>Author:</strong> {preset.author}
            </p>
          )}

          {preset?.homepage && (
            <p className='text-sm text-muted-foreground mb-1'>
              <strong>Homepage:</strong>{' '}
              <a
                href={preset.homepage}
                target='_blank'
                rel='noopener noreferrer'
                className='text-primary hover:underline'
              >
                {preset.homepage}
              </a>
            </p>
          )}

          {preset?.repository && (
            <p className='text-sm text-muted-foreground mb-1'>
              <strong>Repository:</strong>{' '}
              <a
                href={preset.repository}
                target='_blank'
                rel='noopener noreferrer'
                className='text-primary hover:underline'
              >
                {preset.repository}
              </a>
            </p>
          )}

          {preset?.keywords && preset.keywords.length > 0 && (
            <div className='mt-4'>
              <strong>Keywords:</strong>
              <div className='flex flex-wrap gap-2 mt-2'>
                {preset.keywords.map((keyword) => (
                  <span key={keyword} className='px-2 py-1 bg-muted rounded text-sm'>
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Configuration form */}
          {preset?.schema && preset.schema.length > 0 && (
            <div className='mt-6'>
              <h4 className='font-medium text-sm mb-4'>{t('presets.required_information')}</h4>
              <DynamicConfigForm
                schema={preset.schema}
                presetConfig={preset.config || {}}
                onSubmit={onApply}
                onCancel={() => onOpenChange(false)}
                isSubmitting={isApplying}
                initialValues={initialValues}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
