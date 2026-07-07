import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ColorPicker } from '@/components/ui/color-picker'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { StatusLineModuleConfig } from '@/types'
import { IconSearchInput } from './IconSearchInput'

interface ModulePropertiesPanelProps {
  title: string
  selectHint: string
  selectedModule: StatusLineModuleConfig | null
  selectedModuleIndex: number | null
  fontKey: string
  fontFamily: string
  onModuleChange: (index: number, field: keyof StatusLineModuleConfig, value: string) => void
  onDeleteModule: () => void
  t: (key: string) => string
}

// Right column: field editor for whichever module chip is currently selected.
export function ModulePropertiesPanel({
  title,
  selectHint,
  selectedModule,
  selectedModuleIndex,
  fontKey,
  fontFamily,
  onModuleChange,
  onDeleteModule,
  t
}: ModulePropertiesPanelProps) {
  return (
    <div className='border rounded-lg flex flex-col overflow-hidden col-span-1'>
      <h3 className='text-sm font-medium p-4 pb-0 mb-3'>{title}</h3>
      <div className='overflow-y-auto px-4 pb-4 flex-1'>
        {selectedModule && selectedModuleIndex !== null ? (
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='module-icon'>{t('statusline.module_icon')}</Label>
              <IconSearchInput
                key={fontKey}
                value={selectedModule.icon || ''}
                onChange={(value) => onModuleChange(selectedModuleIndex, 'icon', value)}
                fontFamily={fontFamily}
                t={t}
              />
              <p className='text-xs text-muted-foreground'>{t('statusline.icon_description')}</p>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='module-text'>{t('statusline.module_text')}</Label>
              <Input
                id='module-text'
                value={selectedModule.text}
                onChange={(e) => onModuleChange(selectedModuleIndex, 'text', e.target.value)}
                placeholder={t('statusline.text_placeholder')}
              />
              <div className='text-xs text-muted-foreground'>
                <p>{t('statusline.module_text_description')}</p>
                <div className='flex flex-wrap gap-1 mt-1'>
                  <Badge variant='secondary' className='text-xs py-0.5 px-1.5'>
                    {'{{workDirName}}'}
                  </Badge>
                  <Badge variant='secondary' className='text-xs py-0.5 px-1.5'>
                    {'{{gitBranch}}'}
                  </Badge>
                  <Badge variant='secondary' className='text-xs py-0.5 px-1.5'>
                    {'{{model}}'}
                  </Badge>
                  <Badge variant='secondary' className='text-xs py-0.5 px-1.5'>
                    {'{{inputTokens}}'}
                  </Badge>
                  <Badge variant='secondary' className='text-xs py-0.5 px-1.5'>
                    {'{{outputTokens}}'}
                  </Badge>
                </div>
              </div>
            </div>

            <div className='space-y-2'>
              <Label>{t('statusline.module_color')}</Label>
              <ColorPicker
                value={selectedModule.color || ''}
                onChange={(value) => onModuleChange(selectedModuleIndex, 'color', value)}
              />
              <p className='text-xs text-muted-foreground'>{t('statusline.module_color_description')}</p>
            </div>

            <div className='space-y-2'>
              <Label>{t('statusline.module_background')}</Label>
              <ColorPicker
                value={selectedModule.background || ''}
                onChange={(value) => onModuleChange(selectedModuleIndex, 'background', value)}
              />
              <p className='text-xs text-muted-foreground'>{t('statusline.module_background_description')}</p>
            </div>

            {/* Script Path input - only shown when type is "script" */}
            {selectedModule.type === 'script' && (
              <div className='space-y-2'>
                <Label htmlFor='module-script-path'>{t('statusline.module_script_path')}</Label>
                <Input
                  id='module-script-path'
                  value={selectedModule.scriptPath || ''}
                  onChange={(e) => onModuleChange(selectedModuleIndex, 'scriptPath', e.target.value)}
                  placeholder={t('statusline.script_placeholder')}
                />
                <p className='text-xs text-muted-foreground'>{t('statusline.module_script_path_description')}</p>
              </div>
            )}

            <Button variant='destructive' size='sm' onClick={onDeleteModule}>
              {t('statusline.delete_module')}
            </Button>
          </div>
        ) : (
          <div className='flex items-center justify-center h-full min-h-[200px]'>
            <p className='text-muted-foreground text-sm'>{selectHint}</p>
          </div>
        )}
      </div>
    </div>
  )
}
