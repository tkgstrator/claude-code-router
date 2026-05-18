import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useOutletContext } from 'react-router-dom'
import { z } from 'zod'
import { PageContainer, PageContent, PageHeader } from '@/components/PageLayout'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import type { ShellOutletContext } from './AppShell'
import { useConfig } from './ConfigProvider'
import { SelectCombobox } from './SelectCombobox'

interface EnabledModel {
  provider: string
  model: string
}

const routerSchema = z.object({
  default: z.string().default(''),
  background: z.string().default(''),
  think: z.string().default(''),
  longContext: z.string().default(''),
  longContextThreshold: z.number().int().positive(),
  webSearch: z.string().default(''),
  image: z.string().default(''),
  forceUseImageAgent: z.string().nonempty()
})

type RouterFormValues = z.infer<typeof routerSchema>

export function Router() {
  const { t } = useTranslation()
  const { config, setConfig } = useConfig()
  const { showToast } = useOutletContext<ShellOutletContext>()
  const [models, setModels] = useState<EnabledModel[]>([])

  const form = useForm<RouterFormValues>({
    resolver: zodResolver(routerSchema),
    defaultValues: {
      default: '',
      background: '',
      think: '',
      longContext: '',
      longContextThreshold: 60000,
      webSearch: '',
      image: '',
      forceUseImageAgent: 'false'
    },
    values: config
      ? (() => {
          const r = config.Router || {}
          return {
            default: r.default || '',
            background: r.background || '',
            think: r.think || '',
            longContext: r.longContext || '',
            longContextThreshold: r.longContextThreshold || 60000,
            webSearch: r.webSearch || '',
            image: r.image || '',
            forceUseImageAgent: config.forceUseImageAgent ? 'true' : 'false'
          }
        })()
      : undefined
  })

  // The Router only ever offers enabled models. The backend decides
  // that (GET /api/models returns Model.enabled rows only); this just
  // renders the list — no client-side filtering.
  useEffect(() => {
    api
      .get<{ models: EnabledModel[] }>('/models')
      .then((data) => setModels(data.models))
      .catch((err) => console.error('Failed to load enabled models:', err))
  }, [])

  if (!config) return null

  const modelOptions = models.map(({ provider, model }) => ({
    value: `${provider},${model}`,
    label: `${provider}, ${model}`
  }))

  const onSubmit = async (values: RouterFormValues) => {
    const updated = {
      ...config,
      Router: {
        default: values.default,
        background: values.background,
        think: values.think,
        longContext: values.longContext,
        longContextThreshold: values.longContextThreshold,
        webSearch: values.webSearch,
        image: values.image
      },
      forceUseImageAgent: values.forceUseImageAgent === 'true'
    }
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
      <PageHeader title={t('router.title')} />
      <PageContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6'>
            <div className='grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6'>
              <FormField
                control={form.control}
                name='default'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('router.default')}</FormLabel>
                    <FormControl>
                      <SelectCombobox
                        options={modelOptions}
                        value={field.value}
                        onChange={field.onChange}
                        placeholder={t('router.selectModel')}
                        emptyPlaceholder={t('router.noModelFound')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='background'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('router.background')}</FormLabel>
                    <FormControl>
                      <SelectCombobox
                        options={modelOptions}
                        value={field.value}
                        onChange={field.onChange}
                        placeholder={t('router.selectModel')}
                        emptyPlaceholder={t('router.noModelFound')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='think'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('router.think')}</FormLabel>
                    <FormControl>
                      <SelectCombobox
                        options={modelOptions}
                        value={field.value}
                        onChange={field.onChange}
                        placeholder={t('router.selectModel')}
                        emptyPlaceholder={t('router.noModelFound')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='webSearch'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('router.webSearch')}</FormLabel>
                    <FormControl>
                      <SelectCombobox
                        options={modelOptions}
                        value={field.value}
                        onChange={field.onChange}
                        placeholder={t('router.selectModel')}
                        emptyPlaceholder={t('router.noModelFound')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className='flex items-end gap-3 md:col-span-2 xl:col-span-1'>
                <FormField
                  control={form.control}
                  name='longContext'
                  render={({ field }) => (
                    <FormItem className='flex-1'>
                      <FormLabel>{t('router.longContext')}</FormLabel>
                      <FormControl>
                        <SelectCombobox
                          options={modelOptions}
                          value={field.value}
                          onChange={field.onChange}
                          placeholder={t('router.selectModel')}
                          emptyPlaceholder={t('router.noModelFound')}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='longContextThreshold'
                  render={({ field }) => (
                    <FormItem className='w-32 flex-shrink-0'>
                      <FormLabel>{t('router.longContextThreshold')}</FormLabel>
                      <FormControl>
                        <Input type='number' {...field} placeholder='60000' onChange={(e) => field.onChange(e.target.valueAsNumber)} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className='flex items-end gap-3'>
                <FormField
                  control={form.control}
                  name='image'
                  render={({ field }) => (
                    <FormItem className='flex-1'>
                      <FormLabel>{t('router.image')} (beta)</FormLabel>
                      <FormControl>
                        <SelectCombobox
                          options={modelOptions}
                          value={field.value}
                          onChange={field.onChange}
                          placeholder={t('router.selectModel')}
                          emptyPlaceholder={t('router.noModelFound')}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='forceUseImageAgent'
                  render={({ field }) => (
                    <FormItem className='w-36 flex-shrink-0'>
                      <FormLabel>{t('router.forceUseImageAgent')}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className='w-full'>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value='false'>{t('common.no')}</SelectItem>
                          <SelectItem value='true'>{t('common.yes')}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <Button type='submit'>{t('app.save')}</Button>
          </form>
        </Form>
      </PageContent>
    </PageContainer>
  )
}
