import {
  CircleArrowUp,
  FileJson,
  FileText,
  Gauge,
  History,
  Languages,
  LayoutDashboard,
  Moon,
  Save,
  Server,
  Settings,
  Shuffle,
  Sun
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useConfig } from '@/components/ConfigProvider'
import { JsonEditor } from '@/components/JsonEditor'
import { LogViewer } from '@/components/LogViewer'
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
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger
} from '@/components/ui/sidebar'
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
  { to: '/usage', icon: Gauge, key: 'nav.usage' },
  { to: '/history', icon: History, key: 'nav.history' },
  { to: '/settings', icon: Settings, key: 'nav.settings' }
] as const

function AppSidebar() {
  const { t } = useTranslation()
  const { pathname } = useLocation()

  return (
    <Sidebar collapsible='icon'>
      <SidebarHeader className='h-16 justify-center border-b px-4'>
        <span className='text-sm font-semibold group-data-[collapsible=icon]:hidden'>
          {t('app.title')}
        </span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {NAV_ITEMS.map(({ to, icon: Icon, key }) => (
              <SidebarMenuItem key={to}>
                <SidebarMenuButton size='lg' asChild isActive={pathname.startsWith(to)} tooltip={t(key)}>
                  <NavLink to={to}>
                    <Icon />
                    <span>{t(key)}</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}

export function AppShell() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { config, error } = useConfig()
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
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))

  const toggleDark = () => {
    const next = !isDark
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
    setIsDark(next)
  }

  useEffect(() => {
    const stored = localStorage.getItem('theme')
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const dark = stored ? stored === 'dark' : prefersDark
    document.documentElement.classList.toggle('dark', dark)
    setIsDark(dark)
  }, [])

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
      <div className='h-screen bg-background font-sans flex items-center justify-center'>
        <div className='text-muted-foreground'>Loading application...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className='h-screen bg-background font-sans flex items-center justify-center'>
        <div className='text-red-500'>Error: {error.message}</div>
      </div>
    )
  }

  if (!config) {
    return (
      <div className='h-screen bg-background font-sans flex items-center justify-center'>
        <div className='text-muted-foreground'>Loading configuration...</div>
      </div>
    )
  }

  const needsSetup = !config.APIKEY
  const outletContext: ShellOutletContext = { showToast }

  return (
    <TooltipProvider>
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className='flex h-16 shrink-0 items-center justify-between gap-2 border-b bg-background px-4'>
          <SidebarTrigger />
          <div className='flex items-center gap-2'>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant='ghost' size='icon' onClick={() => setIsJsonEditorOpen(true)}>
                  <FileJson className='h-5 w-5' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('app.json_editor')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant='ghost' size='icon' onClick={() => setIsLogViewerOpen(true)}>
                  <FileText className='h-5 w-5' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('app.log_viewer')}</TooltipContent>
            </Tooltip>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant='ghost' size='icon'>
                  <Languages className='h-5 w-5' />
                </Button>
              </PopoverTrigger>
              <PopoverContent className='w-32 p-2'>
                <div className='space-y-1'>
                  {(['en', 'zh', 'ja'] as const).map((lang) => (
                    <Button
                      key={lang}
                      variant={i18n.language.startsWith(lang) ? 'default' : 'ghost'}
                      className='w-full justify-start'
                      onClick={() => i18n.changeLanguage(lang)}
                    >
                      {lang === 'en' ? 'English' : lang === 'zh' ? '中文' : '日本語'}
                    </Button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Button variant='ghost' size='icon' onClick={toggleDark}>
              {isDark ? <Sun className='h-5 w-5' /> : <Moon className='h-5 w-5' />}
            </Button>
            {isUpdateFeatureAvailable && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='icon'
                    onClick={() => checkForUpdates(true)}
                    disabled={isCheckingUpdate}
                    className='relative'
                  >
                    <CircleArrowUp className='h-5 w-5' />
                    {isNewVersionAvailable && !isCheckingUpdate && (
                      <span className='absolute -top-1 -right-1 h-3 w-3 rounded-full bg-red-500 border-2 border-white' />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('app.check_updates')}</TooltipContent>
              </Tooltip>
            )}
            <Button onClick={saveConfig} variant='outline'>
              <Save className='mr-2 h-4 w-4' />
              {t('app.save')}
            </Button>
          </div>
        </header>
        <main className='flex-1 overflow-auto'>
          <Outlet context={outletContext} />
        </main>
      </SidebarInset>

      <SetupDialog open={needsSetup} />
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
    </SidebarProvider>
    </TooltipProvider>
  )
}

export type { ShellOutletContext }
