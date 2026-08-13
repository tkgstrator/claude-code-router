import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SelectCombobox as Combobox } from '@/components/SelectCombobox'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { MODULE_TYPES, NERD_FONTS } from '@/lib/statusline/constants'
import { buildHexColorCss, collectHexBackgroundColors } from '@/lib/statusline/hex-colors'
import {
  createModuleForType,
  getCurrentModules,
  removeModuleAt,
  reorderModules,
  withCurrentModules
} from '@/lib/statusline/modules'
import { POWERLINE_SEPARATOR_STYLES } from '@/lib/statusline/powerline-styles'
import type { StatusLineConfig, StatusLineModuleConfig } from '@/types'
import { createDefaultStatusLineConfig, formatValidationError, validateStatusLineConfig } from '@/utils/statusline'
import { useConfig } from './ConfigProvider'
import { ModulePreviewPanel } from './statusline/ModulePreviewPanel'
import { ModulePropertiesPanel } from './statusline/ModulePropertiesPanel'
import { ModuleTypeList } from './statusline/ModuleTypeList'
import { StatusLineAlert } from './statusline/StatusLineAlert'

interface StatusLineConfigDialogProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
}

export function StatusLineConfigDialog({ isOpen, onOpenChange }: StatusLineConfigDialogProps) {
  const { t } = useTranslation()
  const { config, setConfig } = useConfig()

  const [statusLineConfig, setStatusLineConfig] = useState<StatusLineConfig>(
    config?.StatusLine || createDefaultStatusLineConfig()
  )

  // Font state
  const [fontFamily, setFontFamily] = useState<string>(config?.StatusLine?.fontFamily || 'Hack Nerd Font Mono')

  const [selectedModuleIndex, setSelectedModuleIndex] = useState<number | null>(null)
  const [hexBackgroundColors, setHexBackgroundColors] = useState<Set<string>>(new Set())

  // Inject Powerline separator styles
  useEffect(() => {
    const styleElement = document.createElement('style')
    styleElement.innerHTML = POWERLINE_SEPARATOR_STYLES
    document.head.appendChild(styleElement)

    // Cleanup
    return () => {
      document.head.removeChild(styleElement)
    }
  }, [])

  // Dynamically update the hex background color styles
  useEffect(() => {
    const hexColors = collectHexBackgroundColors(statusLineConfig)
    setHexBackgroundColors(hexColors)

    // Create the dynamic style element
    const styleElement = document.createElement('style')
    styleElement.id = 'hex-powerline-styles'
    styleElement.innerHTML = buildHexColorCss(hexColors)
    document.head.appendChild(styleElement)

    // Cleanup
    return () => {
      const existingStyle = document.getElementById('hex-powerline-styles')
      if (existingStyle) {
        document.head.removeChild(existingStyle)
      }
    }
  }, [statusLineConfig])

  // Module type options
  const MODULE_TYPES_OPTIONS = MODULE_TYPES.map((item) => ({
    ...item,
    label: t(`statusline.${item.label}`)
  }))

  const handleThemeChange = (value: string) => {
    setStatusLineConfig((prev) => ({ ...prev, currentStyle: value }))
  }

  const handleModuleChange = (index: number, field: keyof StatusLineModuleConfig, value: string) => {
    const modules = [...getCurrentModules(statusLineConfig)]
    if (modules[index]) {
      modules[index] = { ...modules[index], [field]: value }
    }

    setStatusLineConfig((prev) => withCurrentModules(prev, modules))
  }

  const [validationErrors, setValidationErrors] = useState<string[]>([])

  const handleSave = async () => {
    // Validate the configuration
    const validationResult = validateStatusLineConfig(statusLineConfig)

    if (!validationResult.isValid) {
      // Format the error messages
      const errorMessages = validationResult.errors.map((error) => formatValidationError(error, t))
      setValidationErrors(errorMessages)
      return
    }

    // Clear previous errors
    setValidationErrors([])

    if (config) {
      const nextConfig = {
        ...config,
        StatusLine: {
          ...statusLineConfig,
          fontFamily
        }
      }
      setConfig(nextConfig)
      onOpenChange(false)
      await api.updateConfig(nextConfig)
    }
  }

  const currentModules = getCurrentModules(statusLineConfig)
  const selectedModule =
    selectedModuleIndex !== null && currentModules.length > selectedModuleIndex
      ? currentModules[selectedModuleIndex]
      : null

  // Delete the currently selected module
  const deleteSelectedModule = useCallback(() => {
    if (selectedModuleIndex === null) return

    const modules = getCurrentModules(statusLineConfig)

    if (selectedModuleIndex >= 0 && selectedModuleIndex < modules.length) {
      setStatusLineConfig((prev) => withCurrentModules(prev, removeModuleAt(modules, selectedModuleIndex)))
      setSelectedModuleIndex(null)
    }
  }, [selectedModuleIndex, statusLineConfig])

  // Add a module dropped from the components list onto the preview area
  const handleAddModule = (moduleType: string) => {
    const modules = getCurrentModules(statusLineConfig)
    const newModule = createModuleForType(moduleType)
    setStatusLineConfig((prev) => withCurrentModules(prev, [...modules, newModule]))
  }

  // Reorder modules by dragging one chip onto another in the preview area
  const handleReorderModules = (fromIndex: number, toIndex: number) => {
    const modules = getCurrentModules(statusLineConfig)
    if (fromIndex >= 0 && fromIndex < modules.length && toIndex >= 0 && toIndex <= modules.length) {
      setStatusLineConfig((prev) => withCurrentModules(prev, reorderModules(modules, fromIndex, toIndex)))

      // Update the selected index
      if (selectedModuleIndex === fromIndex) {
        setSelectedModuleIndex(toIndex)
      } else if (selectedModuleIndex === toIndex) {
        setSelectedModuleIndex(fromIndex)
      }
    }
  }

  // Font style
  const fontStyle = fontFamily ? { fontFamily } : {}

  // Keyboard listener that supports deleting the selected module
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Is a module selected?
      if (selectedModuleIndex === null) return

      // Did the user press a delete key (Delete or Backspace)?
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Inspect the currently focused element
        const activeElement = document.activeElement as HTMLElement

        // Check whether focus is on a preview-area module (has the cursor-pointer class and a tabIndex)
        const isPreviewModule =
          activeElement?.classList.contains('cursor-pointer') && activeElement?.hasAttribute('tabIndex')

        // Only delete when focus is on a preview-area module
        if (isPreviewModule) {
          e.preventDefault()
          deleteSelectedModule()
        }
      }
    }

    // Register the listener
    document.addEventListener('keydown', handleKeyDown)

    // Cleanup
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [selectedModuleIndex, deleteSelectedModule])

  // Force a re-render when the font or theme changes
  const fontKey = `${fontFamily}-${statusLineConfig.currentStyle}`

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-w-4xl h-[90vh] overflow-hidden sm:max-w-5xl md:max-w-6xl lg:max-w-7xl animate-in fade-in-90 slide-in-from-bottom-10 duration-300 flex flex-col'
        aria-describedby={undefined}
      >
        <DialogHeader data-testid='statusline-config-dialog-header' className='border-b pb-4'>
          <DialogTitle className='flex items-center'>
            <svg
              xmlns='http://www.w3.org/2000/svg'
              width='24'
              height='24'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
              className='mr-2'
            >
              <path d='M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' />
              <path d='M14 3v4a2 2 0 0 0 2 2h4' />
              <path d='M3 12h18' />
            </svg>
            {t('statusline.title')}
          </DialogTitle>
        </DialogHeader>

        {/* Error display area */}
        {validationErrors.length > 0 && (
          <div className='px-6'>
            <StatusLineAlert
              variant='destructive'
              title='配置验证失败'
              description={
                <ul className='list-disc pl-5 space-y-1'>
                  {validationErrors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              }
            />
          </div>
        )}

        <div className='flex flex-col gap-6 flex-1 overflow-hidden'>
          {/* Configuration panel */}
          <div className='space-y-6'>
            {/* Theme style and font selection */}
            <div className='grid grid-cols-2 gap-4'>
              <div className='space-y-2'>
                <Label htmlFor='theme-style' className='text-sm font-medium'>
                  {t('statusline.theme')}
                </Label>
                <Combobox
                  options={[
                    { label: t('statusline.theme_default'), value: 'default' },
                    { label: t('statusline.theme_powerline'), value: 'powerline' }
                  ]}
                  value={statusLineConfig.currentStyle}
                  onChange={handleThemeChange}
                  data-testid='theme-selector'
                  placeholder={t('statusline.theme_placeholder')}
                />
              </div>

              <div className='space-y-2'>
                <Label htmlFor='font-family' className='text-sm font-medium'>
                  {t('statusline.module_icon')}
                </Label>
                <Combobox
                  options={NERD_FONTS}
                  value={fontFamily}
                  onChange={(value) => setFontFamily(value)}
                  data-testid='font-family-selector'
                  placeholder={t('statusline.font_placeholder')}
                />
              </div>
            </div>
          </div>

          {/* Three-column layout: component list | preview area | property panel */}
          <div className='grid grid-cols-5 gap-6 overflow-hidden flex-1'>
            <ModuleTypeList title={t('statusline.components')} options={MODULE_TYPES_OPTIONS} />

            <ModulePreviewPanel
              title={t('statusline.preview')}
              dragHint={t('statusline.drag_hint')}
              fontKey={fontKey}
              fontStyle={fontStyle}
              currentStyle={statusLineConfig.currentStyle}
              currentModules={currentModules}
              selectedModuleIndex={selectedModuleIndex}
              onSelectModule={setSelectedModuleIndex}
              onAddModule={handleAddModule}
              onReorderModules={handleReorderModules}
            />

            <ModulePropertiesPanel
              title={t('statusline.properties')}
              selectHint={t('statusline.select_hint')}
              selectedModule={selectedModule}
              selectedModuleIndex={selectedModuleIndex}
              fontKey={fontKey}
              fontFamily={fontFamily}
              onModuleChange={handleModuleChange}
              onDeleteModule={deleteSelectedModule}
              t={t}
            />
          </div>
        </div>

        <DialogFooter className='border-t pt-4 mt-4'>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('app.cancel')}
          </Button>
          <Button onClick={handleSave} data-testid='save-statusline-config'>
            {t('app.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
