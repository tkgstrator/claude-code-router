import { ArrowLeft, Download, Loader2, Store } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Toast } from '@/components/ui/toast'
import { api } from '@/lib/api'
import { buildInitialValues } from '@/lib/presets/initial-values'
import type { MarketPreset, PresetDetail, PresetMetadata } from '@/lib/presets/types'
import { DeletePresetDialog } from './presets/DeletePresetDialog'
import { InstallPresetDialog } from './presets/InstallPresetDialog'
import { MarketPresetsDialog } from './presets/MarketPresetsDialog'
import { PresetDetailDialog } from './presets/PresetDetailDialog'
import { PresetListItem } from './presets/PresetListItem'

export function Presets() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [presets, setPresets] = useState<PresetMetadata[]>([])
  const [loading, setLoading] = useState(true)
  const [installDialogOpen, setInstallDialogOpen] = useState(false)
  const [detailDialogOpen, setDetailDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [marketDialogOpen, setMarketDialogOpen] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState<PresetDetail | null>(null)
  const [presetToDelete, setPresetToDelete] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null)
  const [installMethod, setInstallMethod] = useState<'file' | 'url'>('file')
  const [installUrl, setInstallUrl] = useState('')
  const [installFile, setInstallFile] = useState<File | null>(null)
  const [installName, setInstallName] = useState('')
  const [isInstalling, setIsInstalling] = useState(false)
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [isApplying, setIsApplying] = useState(false)
  const [marketSearch, setMarketSearch] = useState('')
  const [marketPresets, setMarketPresets] = useState<MarketPreset[]>([])
  const [marketLoading, setMarketLoading] = useState(false)
  const [installingFromMarket, setInstallingFromMarket] = useState<string | null>(null)

  // Go back to the previous page
  const handleGoBack = () => {
    navigate('/models')
  }

  // Load market presets
  const loadMarketPresets = async () => {
    setMarketLoading(true)
    try {
      const response = await api.getMarketPresets()
      setMarketPresets(response.presets || [])
    } catch (error) {
      console.error('Failed to load market presets:', error)
      setToast({ message: t('presets.load_market_failed'), type: 'error' })
    } finally {
      setMarketLoading(false)
    }
  }

  // Install preset from market
  const handleInstallFromMarket = async (preset: MarketPreset) => {
    try {
      setInstallingFromMarket(preset.id)

      // Step 1: Install preset (extract to directory)
      const installResult = await api.installPresetFromGitHub(preset.repo)

      // Step 2: Get preset details (check if configuration is required)
      try {
        const installedPresetName = installResult.presetName || preset.name
        const detail = await api.getPreset(installedPresetName)
        const presetDetail: PresetDetail = { ...preset, ...detail, id: installedPresetName }

        // Check if configuration is required
        if (detail.schema && detail.schema.length > 0) {
          // Configuration required, open configuration dialog
          setSelectedPreset(presetDetail)
          setSecrets(buildInitialValues(detail.schema, detail.userValues))

          // Close market dialog, open details dialog
          setMarketDialogOpen(false)
          setDetailDialogOpen(true)

          setToast({ message: t('presets.preset_installed_config_required'), type: 'warning' })
        } else {
          // No configuration required, complete directly
          setToast({ message: t('presets.preset_installed'), type: 'success' })
          setMarketDialogOpen(false)
          await loadPresets()
        }
      } catch (error) {
        // Failed to get details, but installation succeeded, refresh list
        console.error('Failed to get preset details after installation:', error)
        setToast({ message: t('presets.preset_installed'), type: 'success' })
        setMarketDialogOpen(false)
        await loadPresets()
      }
    } catch (error: any) {
      console.error('Failed to install preset:', error)
      // Check if it's an "already installed" error
      const errorMessage = error.message || ''
      if (errorMessage.includes('already installed') || errorMessage.includes('已安装')) {
        setToast({ message: t('presets.preset_already_installed'), type: 'warning' })
      } else {
        setToast({ message: t('presets.preset_install_failed', { error: errorMessage }), type: 'error' })
      }
    } finally {
      setInstallingFromMarket(null)
    }
  }

  // Load presets when opening market dialog
  useEffect(() => {
    if (marketDialogOpen && marketPresets.length === 0) {
      loadMarketPresets()
    }
  }, [marketDialogOpen])

  // Load presets list
  const loadPresets = async () => {
    try {
      setLoading(true)
      const response = await api.getPresets()
      setPresets(response.presets || [])
    } catch (error) {
      console.error('Failed to load presets:', error)
      setToast({ message: t('presets.load_presets_failed'), type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPresets()
  }, [])

  // View preset details
  const handleViewDetail = async (preset: PresetMetadata) => {
    try {
      const detail = await api.getPreset(preset.id)
      setSelectedPreset({ ...preset, ...detail })
      setDetailDialogOpen(true)

      // Initialize form values: prefer saved userValues, otherwise fall back to defaultValue
      if (detail.schema && detail.schema.length > 0) {
        setSecrets(buildInitialValues(detail.schema, detail.userValues))
      }
    } catch (error) {
      console.error('Failed to load preset details:', error)
      setToast({ message: t('presets.load_preset_details_failed'), type: 'error' })
    }
  }

  // Install a preset
  const handleInstall = async () => {
    try {
      setIsInstalling(true)

      // Validate inputs
      if (installMethod === 'url' && !installUrl) {
        setToast({ message: t('presets.please_provide_url'), type: 'warning' })
        return
      }
      if (installMethod === 'file' && !installFile) {
        setToast({ message: t('presets.please_provide_file'), type: 'warning' })
        return
      }

      // Resolve the preset name
      const presetName = installName || ''

      // Step 1: Install preset from GitHub repository
      let installResult: Awaited<ReturnType<typeof api.installPresetFromGitHub>> | undefined
      if (installMethod === 'url' && installUrl) {
        // Install from GitHub repository
        installResult = await api.installPresetFromGitHub(installUrl, presetName)
      } else {
        setToast({ message: t('presets.please_provide_url'), type: 'warning' })
        return
      }

      // Step 2: Get preset details (check if configuration is required)
      try {
        // Use the actual preset name returned by the server
        const actualPresetName = installResult?.presetName || presetName
        const detail = await api.getPreset(actualPresetName)

        // Check if configuration is required
        if (detail.schema && detail.schema.length > 0) {
          // Configuration required, open configuration dialog
          setSelectedPreset({
            id: actualPresetName,
            name: detail.name || actualPresetName,
            version: detail.version || '1.0.0',
            installed: true,
            ...detail
          })
          setSecrets(buildInitialValues(detail.schema, detail.userValues))

          // Close installation dialog, open details dialog
          setInstallDialogOpen(false)
          setInstallUrl('')
          setInstallFile(null)
          setInstallName('')
          setDetailDialogOpen(true)

          setToast({ message: t('presets.preset_installed_config_required'), type: 'warning' })
        } else {
          // No configuration required, complete directly
          setToast({ message: t('presets.preset_installed'), type: 'success' })
          setInstallDialogOpen(false)
          setInstallUrl('')
          setInstallFile(null)
          setInstallName('')
          await loadPresets()
        }
      } catch (error) {
        // Failed to get details, but installation succeeded, refresh list
        console.error('Failed to get preset details after installation:', error)
        setToast({ message: t('presets.preset_installed'), type: 'success' })
        setInstallDialogOpen(false)
        setInstallUrl('')
        setInstallFile(null)
        setInstallName('')
        await loadPresets()
      }
    } catch (error: any) {
      console.error('Failed to install preset:', error)
      // Check if it's an "already installed" error
      const errorMessage = error.message || ''
      if (errorMessage.includes('already installed') || errorMessage.includes('已安装')) {
        setToast({ message: t('presets.preset_already_installed'), type: 'warning' })
      } else {
        setToast({ message: t('presets.preset_install_failed', { error: errorMessage }), type: 'error' })
      }
    } finally {
      setIsInstalling(false)
    }
  }

  // Apply preset (configure sensitive information)
  const handleApplyPreset = async (values?: Record<string, any>) => {
    try {
      setIsApplying(true)

      // Use passed values or existing secrets
      const inputValues = values || secrets

      // Verify all required fields are filled
      if (selectedPreset?.schema && selectedPreset.schema.length > 0) {
        // Validation completed in DynamicConfigForm
        // Only a sanity check here (for the confirm type, false is a valid value)
        for (const input of selectedPreset.schema) {
          const value = inputValues[input.id]
          const isEmpty =
            value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)

          if (input.required !== false && isEmpty) {
            setToast({ message: t('presets.please_fill_field', { field: input.label || input.id }), type: 'warning' })
            setIsApplying(false)
            return
          }
        }
      }

      await api.applyPreset(selectedPreset!.id, inputValues)
      setToast({ message: t('presets.preset_applied'), type: 'success' })
      setDetailDialogOpen(false)
      setSecrets({})
      // Refresh presets list
      await loadPresets()
    } catch (error: any) {
      console.error('Failed to apply preset:', error)
      setToast({ message: t('presets.preset_apply_failed', { error: error.message }), type: 'error' })
    } finally {
      setIsApplying(false)
    }
  }

  // Delete preset
  const handleDelete = async () => {
    if (!presetToDelete) return

    try {
      await api.deletePreset(presetToDelete)
      setToast({ message: t('presets.preset_deleted'), type: 'success' })
      setDeleteDialogOpen(false)
      setPresetToDelete(null)
      await loadPresets()
    } catch (error: any) {
      console.error('Failed to delete preset:', error)
      setToast({ message: t('presets.preset_delete_failed', { error: error.message }), type: 'error' })
    }
  }

  return (
    <Card className='flex h-full flex-col rounded-lg border shadow-sm'>
      <CardHeader className='flex flex-row items-center justify-between border-b p-4'>
        <Button variant='ghost' size='icon' onClick={handleGoBack}>
          <ArrowLeft className='h-5 w-5' />
        </Button>
        <CardTitle className='text-lg'>
          {t('presets.title')} <span className='text-sm font-normal text-muted-foreground'>({presets.length})</span>
        </CardTitle>
        <Button variant='ghost' size='icon' onClick={() => setMarketDialogOpen(true)}>
          <Store className='h-5 w-5' />
        </Button>
      </CardHeader>
      <CardContent className='flex-grow overflow-y-auto p-4'>
        {loading ? (
          <div className='flex items-center justify-center h-full'>
            <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
          </div>
        ) : presets.length === 0 ? (
          <div className='flex flex-col items-center justify-center h-full text-muted-foreground'>
            <Download className='h-12 w-12 mb-4 opacity-50' />
            <p>{t('presets.no_presets')}</p>
            <p className='text-sm'>{t('presets.no_presets_hint')}</p>
          </div>
        ) : (
          <div className='space-y-3'>
            {presets.map((preset) => (
              <PresetListItem
                key={preset.name}
                preset={preset}
                onViewDetail={handleViewDetail}
                onRequestDelete={(presetId) => {
                  setPresetToDelete(presetId)
                  setDeleteDialogOpen(true)
                }}
              />
            ))}
          </div>
        )}
      </CardContent>

      <InstallPresetDialog
        open={installDialogOpen}
        onOpenChange={setInstallDialogOpen}
        installUrl={installUrl}
        onInstallUrlChange={setInstallUrl}
        installName={installName}
        onInstallNameChange={setInstallName}
        onSelectUrlMethod={() => setInstallMethod('url')}
        onInstall={handleInstall}
        isInstalling={isInstalling}
      />

      <PresetDetailDialog
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
        preset={selectedPreset}
        initialValues={secrets}
        isApplying={isApplying}
        onApply={handleApplyPreset}
      />

      <MarketPresetsDialog
        open={marketDialogOpen}
        onOpenChange={setMarketDialogOpen}
        search={marketSearch}
        onSearchChange={setMarketSearch}
        presets={marketPresets}
        loading={marketLoading}
        installedPresets={presets}
        installingId={installingFromMarket}
        onInstall={handleInstallFromMarket}
      />

      <DeletePresetDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        presetName={presetToDelete}
        onConfirm={handleDelete}
      />

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </Card>
  )
}
