import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useOutletContext } from 'react-router-dom'
import { PageContainer, PageContent, PageHeader } from '@/components/PageLayout'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useEnabledModelOptions } from '@/hooks/use-enabled-model-options'
import { api } from '@/lib/api'
import { FALLBACK_SLOTS } from '@/lib/router/fallback-slots'
import { type RouterFormInput, type RouterFormOutput, RouterFormSchema } from '@/schemas/forms.dto'
import type { Config } from '@/types'
import type { ShellOutletContext } from './AppShell'
import { useConfig } from './ConfigProvider'
import { FallbackSlotField } from './router/FallbackSlotField'
import { ModelSlotField } from './router/ModelSlotField'

// Sentinel used for the "no active persona" choice. Radix Select cannot
// carry an empty-string item value, so we map this back to '' (the wire
// contract for "off") on save.
const PERSONA_NONE_VALUE = '__none__'

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

  // Personas available to assign to this router, keyed by their uuid `id`
  // (the value Router.persona stores) with the free-form name as the label.
  // The active value defaults from Router.persona, but only when it still
  // points at a persona in the library — a dangling id falls back to "None".
  const personaOptions = config.Personas.map((persona) => ({
    id: persona.id ?? '',
    name: persona.name
  }))
  const savedPersona = typeof config.Router.persona === 'string' ? config.Router.persona : ''
  const defaultPersona = savedPersona !== '' && personaOptions.some((p) => p.id === savedPersona) ? savedPersona : ''

  const form = useForm<RouterFormInput, unknown, RouterFormOutput>({
    resolver: zodResolver(RouterFormSchema),
    defaultValues: {
      default: config.Router.default,
      background: config.Router.background,
      think: config.Router.think,
      longContext: config.Router.longContext,
      longContextThreshold: config.Router.longContextThreshold,
      webSearch: config.Router.webSearch,
      image: config.Router.image,
      fallbacks: config.Router.fallbacks,
      force: {
        default: config.Router.force?.default ?? false,
        background: config.Router.force?.background ?? false,
        think: config.Router.force?.think ?? false,
        webSearch: config.Router.force?.webSearch ?? false,
        longContext: config.Router.force?.longContext ?? false,
        image: config.Router.force?.image ?? false
      },
      persona: defaultPersona
    }
  })

  const onSubmit = async (values: RouterFormOutput) => {
    // EmptyStringToNullSchema folds '' to null on parse; the wire contract
    // clears the persona with an empty string, so map null/absent back to ''.
    const persona = values.persona === null || values.persona === undefined ? '' : values.persona
    const updated = {
      ...config,
      Router: {
        default: values.default,
        background: values.background,
        think: values.think,
        longContext: values.longContext,
        longContextThreshold: values.longContextThreshold,
        webSearch: values.webSearch,
        image: values.image,
        fallbacks: values.fallbacks,
        force: values.force,
        persona
      }
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
            <div className='grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-start'>
              <ModelSlotField
                control={form.control}
                name='default'
                label={t('router.default')}
                modelOptions={modelOptions}
                selectPlaceholder={t('router.selectModel')}
                emptyPlaceholder={t('router.noModelFound')}
                forceName='force.default'
                forceLabel={t('router.force')}
                forceHint={t('router.forceHint')}
              />

              <ModelSlotField
                control={form.control}
                name='background'
                label={t('router.background')}
                modelOptions={modelOptions}
                selectPlaceholder={t('router.selectModel')}
                emptyPlaceholder={t('router.noModelFound')}
                forceName='force.background'
                forceLabel={t('router.force')}
                forceHint={t('router.forceHint')}
              />

              <ModelSlotField
                control={form.control}
                name='think'
                label={t('router.think')}
                modelOptions={modelOptions}
                selectPlaceholder={t('router.selectModel')}
                emptyPlaceholder={t('router.noModelFound')}
                forceName='force.think'
                forceLabel={t('router.force')}
                forceHint={t('router.forceHint')}
              />

              <ModelSlotField
                control={form.control}
                name='webSearch'
                label={t('router.webSearch')}
                modelOptions={modelOptions}
                selectPlaceholder={t('router.selectModel')}
                emptyPlaceholder={t('router.noModelFound')}
                forceName='force.webSearch'
                forceLabel={t('router.force')}
                forceHint={t('router.forceHint')}
              />

              <div className='flex items-start gap-3 md:col-span-2 xl:col-span-1'>
                <ModelSlotField
                  control={form.control}
                  name='longContext'
                  label={t('router.longContext')}
                  modelOptions={modelOptions}
                  selectPlaceholder={t('router.selectModel')}
                  emptyPlaceholder={t('router.noModelFound')}
                  className='flex-1'
                  forceName='force.longContext'
                  forceLabel={t('router.force')}
                  forceHint={t('router.forceHint')}
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

              <ModelSlotField
                control={form.control}
                name='image'
                label={`${t('router.image')} (beta)`}
                modelOptions={modelOptions}
                selectPlaceholder={t('router.selectModel')}
                emptyPlaceholder={t('router.noModelFound')}
                forceName='force.image'
                forceLabel={t('router.force')}
                forceHint={t('router.forceHint')}
              />

              <FormField
                control={form.control}
                name='persona'
                render={({ field }) => {
                  // Radix Select needs a non-empty value, so '' (none) maps
                  // to the sentinel for display and back to '' on change.
                  const selectValue = field.value === '' || field.value === null ? PERSONA_NONE_VALUE : field.value
                  return (
                    // A regular grid cell (same width as the model slots). The
                    // helper text makes it taller, but the grid is `items-start`
                    // so neighbors align to the top and nothing misaligns.
                    <FormItem>
                      <FormLabel>{t('router.persona')}</FormLabel>
                      <Select
                        value={selectValue}
                        onValueChange={(value) => field.onChange(value === PERSONA_NONE_VALUE ? '' : value)}
                      >
                        <FormControl>
                          <SelectTrigger className='w-full'>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={PERSONA_NONE_VALUE}>{t('router.personaNone')}</SelectItem>
                          {personaOptions.map((persona) => (
                            <SelectItem key={persona.id} value={persona.id}>
                              {persona.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>{t('router.personaHelper')}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )
                }}
              />
            </div>

            <div className='space-y-3'>
              <div>
                <h3 className='text-sm font-medium'>{t('router.fallbacks')}</h3>
                <p className='text-xs text-muted-foreground'>{t('router.fallbacksDescription')}</p>
              </div>
              <div className='grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-start'>
                {FALLBACK_SLOTS.map((slot) => (
                  <FallbackSlotField
                    key={slot}
                    slot={slot}
                    control={form.control}
                    modelOptions={modelOptions}
                    label={t(`router.${slot}`)}
                    selectPlaceholder={t('router.selectModel')}
                    searchPlaceholder={t('router.searchModel')}
                    emptyPlaceholder={t('router.noModelFound')}
                  />
                ))}
              </div>
            </div>

            <Button type='submit'>{t('app.save')}</Button>
          </form>
        </Form>
      </PageContent>
    </PageContainer>
  )
}
