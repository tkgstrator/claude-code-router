import { zodResolver } from '@hookform/resolvers/zod'
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
import { RouterSchema } from '@/schemas'
import type { Config } from '@/types'
import { useEnabledModelOptions } from '@/hooks/use-enabled-model-options'
import type { ShellOutletContext } from './AppShell'
import { useConfig } from './ConfigProvider'
import { SelectCombobox } from './SelectCombobox'

const formSchema = RouterSchema.extend({
  forceUseImageAgent: z.string().nonempty()
})

type RouterFormInput = z.input<typeof formSchema>
type RouterFormOutput = z.output<typeof formSchema>

export function Router() {
  const { config } = useConfig()
  if (!config) return null
  return <RouterForm config={config} />
}

function RouterForm({ config }: { config: Config }) {
  const { t } = useTranslation()
  const { setConfig } = useConfig()
  const { showToast } = useOutletContext<ShellOutletContext>()
  const modelOptions = useEnabledModelOptions()

  const form = useForm<RouterFormInput, unknown, RouterFormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      default: config.Router.default,
      background: config.Router.background,
      think: config.Router.think,
      longContext: config.Router.longContext,
      longContextThreshold: config.Router.longContextThreshold,
      webSearch: config.Router.webSearch,
      image: config.Router.image,
      forceUseImageAgent: config.forceUseImageAgent ? 'true' : 'false'
    }
  })

  const onSubmit = async (values: RouterFormOutput) => {
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
            <div className='grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-end'>
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
                        <Input
                          type='number'
                          {...field}
                          placeholder='60000'
                          onChange={(e) => field.onChange(e.target.valueAsNumber)}
                        />
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
