import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useOutletContext } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui-ext/input'
import { api } from '@/lib/api'
import { type SettingsFormInput, type SettingsFormOutput, SettingsFormSchema } from '@/schemas/forms.dto'
import type { Config, StatusLineConfig } from '@/types'
import type { ShellOutletContext } from './AppShell'
import { useConfig } from './ConfigProvider'
import { PageContainer, PageContent, PageHeader } from './PageLayout'
import { SelectCombobox } from './SelectCombobox'
import { StatusLineConfigDialog } from './StatusLineConfigDialog'

const LOG_LEVEL_OPTIONS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'].map((v) => ({ label: v, value: v }))

const ROUTER_MODE_OPTIONS = [
  { label: 'scenario (routing map)', value: 'scenario' },
  { label: 'preference (gate-only chain)', value: 'preference' },
  { label: 'quota-aware (scheduler-weighted)', value: 'quota-aware' }
]

const ROUTER_SHADOW_OPTIONS = [
  { label: 'off', value: 'off' },
  { label: 'preference', value: 'preference' },
  { label: 'quota-aware', value: 'quota-aware' }
]

export function SettingsPage() {
  const { config } = useConfig()
  if (!config) return null
  return <SettingsForm config={config} />
}

function SettingsForm({ config }: { config: Config }) {
  const { t } = useTranslation()
  const { setConfig } = useConfig()
  const { showToast } = useOutletContext<ShellOutletContext>()
  const [isStatusLineConfigOpen, setIsStatusLineConfigOpen] = useState(false)

  const form = useForm<SettingsFormInput, unknown, SettingsFormOutput>({
    resolver: zodResolver(SettingsFormSchema),
    defaultValues: {
      LOG: config.LOG,
      LOG_LEVEL: config.LOG_LEVEL,
      CLAUDE_PATH: config.CLAUDE_PATH,
      HOST: config.HOST,
      PORT: config.PORT,
      API_TIMEOUT_MS: config.API_TIMEOUT_MS,
      PROXY_URL: config.PROXY_URL,
      APIKEY: config.APIKEY,
      CUSTOM_ROUTER_PATH: config.CUSTOM_ROUTER_PATH,
      ROUTER_MODE: config.ROUTER_MODE ?? 'scenario',
      ROUTER_SHADOW: config.ROUTER_SHADOW ?? 'off',
      ROUTER_ROLLOUT_PCT: config.ROUTER_ROLLOUT_PCT ?? 100,
      CROSS_PROVIDER_FALLBACK: config.CROSS_PROVIDER_FALLBACK ?? false
    }
  })

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
                    <Input
                      type='number'
                      {...field}
                      className='tabular-nums'
                      onChange={(e) => field.onChange(e.target.valueAsNumber)}
                    />
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
                    <Input
                      type='number'
                      {...field}
                      className='tabular-nums'
                      onChange={(e) => field.onChange(e.target.valueAsNumber)}
                    />
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

            <div className='space-y-4 border-t pt-4'>
              <div className='space-y-0.5'>
                <h3 className='font-medium text-sm'>{t('toplevel.router_section')}</h3>
                <p className='text-muted-foreground text-xs'>{t('toplevel.router_section_help')}</p>
              </div>

              <FormField
                control={form.control}
                name='ROUTER_MODE'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('toplevel.router_mode')}</FormLabel>
                    <FormControl>
                      <SelectCombobox
                        options={ROUTER_MODE_OPTIONS}
                        value={field.value}
                        onChange={(v) => field.onChange(v as SettingsFormOutput['ROUTER_MODE'])}
                      />
                    </FormControl>
                    <p className='text-muted-foreground text-xs'>{t('toplevel.router_mode_help')}</p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='ROUTER_SHADOW'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('toplevel.router_shadow')}</FormLabel>
                    <FormControl>
                      <SelectCombobox
                        options={ROUTER_SHADOW_OPTIONS}
                        value={field.value}
                        onChange={(v) => field.onChange(v as SettingsFormOutput['ROUTER_SHADOW'])}
                      />
                    </FormControl>
                    <p className='text-muted-foreground text-xs'>{t('toplevel.router_shadow_help')}</p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='ROUTER_ROLLOUT_PCT'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('toplevel.router_rollout_pct')}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={0}
                        max={100}
                        step={1}
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.valueAsNumber)}
                        className='w-32 tabular-nums'
                      />
                    </FormControl>
                    <p className='text-muted-foreground text-xs'>{t('toplevel.router_rollout_pct_help')}</p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='CROSS_PROVIDER_FALLBACK'
                render={({ field }) => (
                  <FormItem className='flex flex-row items-center justify-between'>
                    <div className='space-y-0.5'>
                      <FormLabel>{t('toplevel.cross_provider_fallback')}</FormLabel>
                      <p className='text-muted-foreground text-xs'>{t('toplevel.cross_provider_fallback_help')}</p>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <Button type='submit'>{t('app.save')}</Button>
          </form>
        </Form>
      </PageContent>

      <StatusLineConfigDialog isOpen={isStatusLineConfigOpen} onOpenChange={setIsStatusLineConfigOpen} />
    </PageContainer>
  )
}
