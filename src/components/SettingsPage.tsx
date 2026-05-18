import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useOutletContext } from 'react-router-dom'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import type { StatusLineConfig } from '@/types'
import type { ShellOutletContext } from './AppShell'
import { useConfig } from './ConfigProvider'
import { PageContainer, PageContent, PageHeader } from './PageLayout'
import { SelectCombobox } from './SelectCombobox'
import { StatusLineConfigDialog } from './StatusLineConfigDialog'

const settingsSchema = z.object({
  LOG: z.boolean(),
  LOG_LEVEL: z.string().nonempty(),
  CLAUDE_PATH: z.string().default(''),
  HOST: z.string().default(''),
  PORT: z.number().int().positive(),
  API_TIMEOUT_MS: z.string().default(''),
  PROXY_URL: z.string().default(''),
  APIKEY: z.string().default(''),
  CUSTOM_ROUTER_PATH: z.string().default('')
})

type SettingsFormInput = z.input<typeof settingsSchema>
type SettingsFormOutput = z.output<typeof settingsSchema>

const LOG_LEVEL_OPTIONS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'].map((v) => ({ label: v, value: v }))

export function SettingsPage() {
  const { t } = useTranslation()
  const { config, setConfig } = useConfig()
  const { showToast } = useOutletContext<ShellOutletContext>()
  const [isStatusLineConfigOpen, setIsStatusLineConfigOpen] = useState(false)

  const form = useForm<SettingsFormInput, unknown, SettingsFormOutput>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      LOG: false,
      LOG_LEVEL: 'info',
      CLAUDE_PATH: '',
      HOST: '',
      PORT: 3000,
      API_TIMEOUT_MS: '',
      PROXY_URL: '',
      APIKEY: '',
      CUSTOM_ROUTER_PATH: ''
    },
    values: config
      ? {
          LOG: config.LOG || false,
          LOG_LEVEL: config.LOG_LEVEL || 'info',
          CLAUDE_PATH: config.CLAUDE_PATH,
          HOST: config.HOST,
          PORT: config.PORT || 3000,
          API_TIMEOUT_MS: config.API_TIMEOUT_MS,
          PROXY_URL: config.PROXY_URL,
          APIKEY: config.APIKEY,
          CUSTOM_ROUTER_PATH: config.CUSTOM_ROUTER_PATH || ''
        }
      : undefined
  })

  if (!config) return null

  const handleStatusLineEnabledChange = (checked: boolean) => {
    const newStatusLine: StatusLineConfig = {
      enabled: checked,
      currentStyle: config.StatusLine?.currentStyle || 'default',
      default: config.StatusLine?.default || { modules: [] },
      powerline: config.StatusLine?.powerline || { modules: [] }
    }
    setConfig({ ...config, StatusLine: newStatusLine })
  }

  const onSubmit = async (values: SettingsFormOutput) => {
    const updated = { ...config, ...values }
    setConfig(updated)
    try {
      const response = await api.updateConfig(updated)
      if (response && typeof response === 'object' && 'success' in response) {
        const res = response as { success: boolean; message?: string }
        showToast(
          res.message || t(res.success ? 'app.config_saved_success' : 'app.config_saved_failed'),
          res.success ? 'success' : 'error'
        )
      } else {
        showToast(t('app.config_saved_success'), 'success')
      }
    } catch (err) {
      showToast(`${t('app.config_saved_failed')}: ${(err as Error).message}`, 'error')
    }
  }

  return (
    <PageContainer>
      <PageHeader title={t('app.settings')} />
      <PageContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='max-w-2xl space-y-6'>
            <FormField
              control={form.control}
              name='LOG'
              render={({ field }) => (
                <FormItem className='flex flex-row items-center gap-3'>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <FormLabel className='!mt-0'>{t('toplevel.log')}</FormLabel>
                </FormItem>
              )}
            />

            <div className='border-t pt-4 space-y-4'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-3'>
                  <Switch
                    checked={config.StatusLine?.enabled || false}
                    onCheckedChange={handleStatusLineEnabledChange}
                  />
                  <span className='text-sm font-medium'>{t('statusline.title')}</span>
                </div>
                <Button variant='outline' size='sm' onClick={() => setIsStatusLineConfigOpen(true)}>
                  {t('app.settings')}
                </Button>
              </div>
            </div>

            <FormField
              control={form.control}
              name='LOG_LEVEL'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('toplevel.log_level')}</FormLabel>
                  <FormControl>
                    <SelectCombobox options={LOG_LEVEL_OPTIONS} value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='CLAUDE_PATH'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('toplevel.claude_path')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='HOST'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('toplevel.host')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='PORT'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('toplevel.port')}</FormLabel>
                  <FormControl>
                    <Input type='number' {...field} onChange={(e) => field.onChange(e.target.valueAsNumber)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='API_TIMEOUT_MS'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('toplevel.timeout')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='PROXY_URL'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('toplevel.proxy_url')}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder='http://127.0.0.1:7890' />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='APIKEY'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('toplevel.apikey')}</FormLabel>
                  <FormControl>
                    <Input type='password' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='CUSTOM_ROUTER_PATH'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('toplevel.custom_router_path')}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t('toplevel.custom_router_path_placeholder')} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type='submit'>{t('app.save')}</Button>
          </form>
        </Form>
      </PageContent>

      <StatusLineConfigDialog isOpen={isStatusLineConfigOpen} onOpenChange={setIsStatusLineConfigOpen} />
    </PageContainer>
  )
}
