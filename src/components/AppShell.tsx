import {
  CircleArrowUp,
  FileCog,
  FileJson,
  FileText,
  Gauge,
  Languages,
  LayoutDashboard,
  RefreshCw,
  Save,
  Server,
  Settings,
  Shuffle,
  Wand2
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useConfig } from '@/components/ConfigProvider'
import { JsonEditor } from '@/components/JsonEditor'
import { LogViewer } from '@/components/LogViewer'
import { SettingsDialog } from '@/components/SettingsDialog'
import { SetupDialog } from '@/components/SetupDialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Toast } from '@/components/ui/toast'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import '@/styles/animations.css'

export type ToastFn = (message: string, type: 'success' | 'error' | 'warning') => void

interface ShellOutletContext {
  showToast: ToastFn
}

const NAV_ITEMS = [
  { to: '/models', icon: LayoutDashboard, key: 'nav.models' },
  { to: '/providers', icon: Server, key: 'nav.providers' },
  { to: '/router', icon: Shuffle, key: 'nav.router' },
  { to: '/transformers', icon: Wand2, key: 'nav.transformers' },
  { to: '/usage', icon: Gauge, key: 'nav.usage' }
] as const

export function AppShell() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { config, error } = useConfig()
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isJsonEditorOpen, setIsJsonEditorOpen] = useState(false)
  const [isLogViewerOpen, setIsLogViewerOpen] = useState(false)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null)
  const [isNewVersionAvailable, setIsNewVersionAvailable] = useState(false)
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false)
  const [newVersionInfo, setNewVersionInfo] = useState<{ version: string; changelog: string } | null>(null)
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [hasCheckedUpdate, setHasCheckedUpdate] = useState(false)
  const [isUpdateFeatureAvailable, setIsUpdateFeatureAvailable] = useState(true)
  const hasAutoCheckedUpdate = useRef(false)

  const showToast: ToastFn = (message, type) => setToast({ message, type })

  const saveConfig = async () => {
    if (!config) {
      setToast({ message: t('app.config_missing'), type: 'error' })
      return
    }
    try {
      const response = await api.updateConfig(config)
      if (response && typeof response === 'object' && 'success' in response) {
        const apiResponse = response as { success: boolean; message?: string }
        setToast({
          message:
            apiResponse.message || t(apiResponse.success ? 'app.config_saved_success' : 'app.config_saved_failed'),
          type: apiResponse.success ? 'success' : 'error'
        })
      } else {
        setToast({ message: t('app.config_saved_success'), type: 'success' })
      }
    } catch (err) {
      setToast({ message: `${t('app.config_saved_failed')}: ${(err as Error).message}`, type: 'error' })
    }
  }

  const saveConfigAndRestart = async () => {
    if (!config) {
      setToast({ message: t('app.config_missing'), type: 'error' })
      return
    }
    try {
      const response = await api.updateConfig(config)
      let saveSuccessful = true
      if (response && typeof response === 'object' && 'success' in response) {
        const apiResponse = response as { success: boolean; message?: string }
        if (!apiResponse.success) {
          saveSuccessful = false
          setToast({ message: apiResponse.message || t('app.config_saved_failed'), type: 'error' })
        }
      }
      if (saveSuccessful) {
        const restartResponse = await api.restartService()
        if (restartResponse && typeof restartResponse === 'object' && 'success' in restartResponse) {
          const apiResponse = restartResponse as { success: boolean; message?: string }
          if (apiResponse.success) {
            setToast({ message: apiResponse.message || t('app.config_saved_restart_success'), type: 'success' })
          }
        } else {
          setToast({ message: t('app.config_saved_restart_success'), type: 'success' })
        }
      }
    } catch (err) {
      setToast({ message: `${t('app.config_saved_restart_failed')}: ${(err as Error).message}`, type: 'error' })
    }
  }

  const checkForUpdates = useCallback(
    async (showDialog: boolean = true) => {
      if (hasCheckedUpdate && isNewVersionAvailable) {
        if (showDialog) setIsUpdateDialogOpen(true)
        return
      }
      setIsCheckingUpdate(true)
      try {
        const updateInfo = await api.checkForUpdates()
        if (updateInfo.hasUpdate && updateInfo.latestVersion && updateInfo.changelog) {
          setIsNewVersionAvailable(true)
          setNewVersionInfo({ version: updateInfo.latestVersion, changelog: updateInfo.changelog })
          if (showDialog) setIsUpdateDialogOpen(true)
        } else if (showDialog) {
          setToast({ message: t('app.no_updates_available'), type: 'success' })
        }
        setHasCheckedUpdate(true)
      } catch (err) {
        setIsUpdateFeatureAvailable(false)
        if (showDialog) {
          setToast({ message: `${t('app.update_check_failed')}: ${(err as Error).message}`, type: 'error' })
        }
      } finally {
        setIsCheckingUpdate(false)
      }
    },
    [hasCheckedUpdate, isNewVersionAvailable, t]
  )

  useEffect(() => {
    const checkAuth = async () => {
      if (config) {
        setIsCheckingAuth(false)
        if (!hasCheckedUpdate && !hasAutoCheckedUpdate.current) {
          hasAutoCheckedUpdate.current = true
          checkForUpdates(false)
        }
        return
      }
      const apiKey = localStorage.getItem('apiKey')
      if (!apiKey) {
        setIsCheckingAuth(false)
        return
      }
      try {
        await api.getConfig()
      } catch (err) {
        if ((err as Error).message === 'Unauthorized') {
          navigate('/login')
        }
      } finally {
        setIsCheckingAuth(false)
        if (!hasCheckedUpdate && !hasAutoCheckedUpdate.current) {
          hasAutoCheckedUpdate.current = true
          checkForUpdates(false)
        }
      }
    }

    checkAuth()
    const handleUnauthorized = () => navigate('/login')
    window.addEventListener('unauthorized', handleUnauthorized)
    return () => window.removeEventListener('unauthorized', handleUnauthorized)
  }, [config, navigate, hasCheckedUpdate, checkForUpdates])

  const performUpdate = async () => {
    if (!newVersionInfo) return
    try {
      const result = await api.performUpdate()
      if (result.success) {
        setToast({ message: t('app.update_successful'), type: 'success' })
        setIsNewVersionAvailable(false)
        setIsUpdateDialogOpen(false)
        setHasCheckedUpdate(false)
      } else {
        setToast({ message: `${t('app.update_failed')}: ${result.message}`, type: 'error' })
      }
    } catch (err) {
      setToast({ message: `${t('app.update_failed')}: ${(err as Error).message}`, type: 'error' })
    }
  }

  if (isCheckingAuth) {
    return (
      <div className='h-screen bg-gray-50 font-sans flex items-center justify-center'>
        <div className='text-gray-500'>Loading application...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className='h-screen bg-gray-50 font-sans flex items-center justify-center'>
        <div className='text-red-500'>Error: {error.message}</div>
      </div>
    )
  }

  if (!config) {
    return (
      <div className='h-screen bg-gray-50 font-sans flex items-center justify-center'>
        <div className='text-gray-500'>Loading configuration...</div>
      </div>
    )
  }

  const needsSetup = !config.APIKEY
  const outletContext: ShellOutletContext = { showToast }

  return (
    <TooltipProvider>
      <SetupDialog open={needsSetup} />
      <div className='flex h-screen bg-gray-50 font-sans'>
        <aside className='flex w-56 flex-col border-r bg-white'>
          <div className='flex h-16 items-center border-b px-5'>
            <h1 className='text-lg font-semibold text-gray-800'>{t('app.title')}</h1>
          </div>
          <nav className='flex-1 space-y-1 p-3'>
            {NAV_ITEMS.map(({ to, icon: Icon, key }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-all-ease hover:scale-[1.02] ${
                    isActive ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'
                  }`
                }
              >
                <Icon className='h-4 w-4' />
                {t(key)}
              </NavLink>
            ))}
            <button
              type='button'
              onClick={() => navigate('/presets')}
              className='flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-gray-700 transition-all-ease hover:scale-[1.02] hover:bg-gray-100'
            >
              <FileCog className='h-4 w-4' />
              {t('app.presets')}
            </button>
          </nav>
        </aside>

        <div className='flex flex-1 flex-col overflow-hidden'>
          <header className='flex h-16 items-center justify-end gap-2 border-b bg-white px-6'>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={() => setIsSettingsOpen(true)}
                  className='transition-all-ease hover:scale-110'
                >
                  <Settings className='h-5 w-5' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t('app.settings')}</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={() => setIsJsonEditorOpen(true)}
                  className='transition-all-ease hover:scale-110'
                >
                  <FileJson className='h-5 w-5' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t('app.json_editor')}</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={() => setIsLogViewerOpen(true)}
                  className='transition-all-ease hover:scale-110'
                >
                  <FileText className='h-5 w-5' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t('app.log_viewer')}</p>
              </TooltipContent>
            </Tooltip>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant='ghost' size='icon' className='transition-all-ease hover:scale-110'>
                  <Languages className='h-5 w-5' />
                </Button>
              </PopoverTrigger>
              <PopoverContent className='w-32 p-2'>
                <div className='space-y-1'>
                  <Button
                    variant={i18n.language.startsWith('en') ? 'default' : 'ghost'}
                    className='w-full justify-start transition-all-ease hover:scale-[1.02]'
                    onClick={() => i18n.changeLanguage('en')}
                  >
                    English
                  </Button>
                  <Button
                    variant={i18n.language.startsWith('zh') ? 'default' : 'ghost'}
                    className='w-full justify-start transition-all-ease hover:scale-[1.02]'
                    onClick={() => i18n.changeLanguage('zh')}
                  >
                    中文
                  </Button>
                  <Button
                    variant={i18n.language.startsWith('ja') ? 'default' : 'ghost'}
                    className='w-full justify-start transition-all-ease hover:scale-[1.02]'
                    onClick={() => i18n.changeLanguage('ja')}
                  >
                    日本語
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            {isUpdateFeatureAvailable && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='icon'
                    onClick={() => checkForUpdates(true)}
                    disabled={isCheckingUpdate}
                    className='transition-all-ease hover:scale-110 relative'
                  >
                    <div className='relative'>
                      <CircleArrowUp className='h-5 w-5' />
                      {isNewVersionAvailable && !isCheckingUpdate && (
                        <div className='absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white' />
                      )}
                    </div>
                    {isCheckingUpdate && (
                      <div className='absolute inset-0 flex items-center justify-center'>
                        <div className='h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent' />
                      </div>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t('app.check_updates')}</p>
                </TooltipContent>
              </Tooltip>
            )}
            <Button
              onClick={saveConfig}
              variant='outline'
              className='transition-all-ease hover:scale-[1.02] active:scale-[0.98]'
            >
              <Save className='mr-2 h-4 w-4' />
              {t('app.save')}
            </Button>
            <Button
              onClick={saveConfigAndRestart}
              className='transition-all-ease hover:scale-[1.02] active:scale-[0.98]'
            >
              <RefreshCw className='mr-2 h-4 w-4' />
              {t('app.save_and_restart')}
            </Button>
          </header>

          <main className='flex-1 overflow-auto bg-white'>
            <Outlet context={outletContext} />
          </main>
        </div>

        <SettingsDialog isOpen={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
        <JsonEditor open={isJsonEditorOpen} onOpenChange={setIsJsonEditorOpen} showToast={showToast} />
        <LogViewer open={isLogViewerOpen} onOpenChange={setIsLogViewerOpen} showToast={showToast} />
        <Dialog open={isUpdateDialogOpen} onOpenChange={setIsUpdateDialogOpen}>
          <DialogContent className='max-w-2xl'>
            <DialogHeader>
              <DialogTitle>
                {t('app.new_version_available')}
                {newVersionInfo && (
                  <span className='ml-2 text-sm font-normal text-muted-foreground'>v{newVersionInfo.version}</span>
                )}
              </DialogTitle>
              <DialogDescription>{t('app.update_description')}</DialogDescription>
            </DialogHeader>
            <div className='max-h-96 overflow-y-auto py-4'>
              {newVersionInfo?.changelog ? (
                <div className='whitespace-pre-wrap text-sm'>{newVersionInfo.changelog}</div>
              ) : (
                <div className='text-muted-foreground'>{t('app.no_changelog_available')}</div>
              )}
            </div>
            <DialogFooter>
              <Button variant='outline' onClick={() => setIsUpdateDialogOpen(false)}>
                {t('app.later')}
              </Button>
              <Button onClick={performUpdate}>{t('app.update_now')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </div>
    </TooltipProvider>
  )
}

export type { ShellOutletContext }
