import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useOutletContext } from 'react-router-dom'
import { MultiSelectCombobox } from '@/components/MultiSelectCombobox'
import { PageContainer, PageContent, PageHeader } from '@/components/PageLayout'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useEnabledModelOptions } from '@/hooks/use-enabled-model-options'
import { api } from '@/lib/api'
import { type RouterFormInput, type RouterFormOutput, RouterFormSchema } from '@/schemas/forms.dto'
import type { Config } from '@/types'
import type { ShellOutletContext } from './AppShell'
import { useConfig } from './ConfigProvider'
import { SelectCombobox } from './SelectCombobox'

// Slots that carry an ordered fallback chain, in the order they're
// rendered in the fallback section below.
const FALLBACK_SLOTS = ['default', 'background', 'think', 'webSearch', 'longContext', 'image'] as const

type FallbackSlot = (typeof FALLBACK_SLOTS)[number]

// Pull the "provider" segment off a "provider,model" wire string. Empty
// when the value is null/undefined/'' (no primary picked yet, in which
// case there is no same-provider rule to enforce).
function providerOf(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.length === 0) return ''
  const idx = value.indexOf(',')
  return idx === -1 ? value : value.slice(0, idx)
}

// Sentinel used for the "no active persona" choice. Radix Select cannot
// carry an empty-string item value, so we map this back to '' (the wire
// contract for "off") on save.
const PERSONA_NONE_VALUE = '__none__'

export function Router() {
  const { config } = useConfig()
  if (!config) return null
  return <RouterForm config={config} />
}

// One fallback slot's MultiSelect, with same-provider options stripped.
// Watches the slot's primary value so toggling the primary live-updates
// the fallback option list (and prunes any selected entry that now
// matches the primary's provider — keeping the form state honest before
// submit, where applyUiConfig would drop it anyway).
function FallbackSlotField({
  slot,
  control,
  modelOptions,
  label,
  selectPlaceholder,
  searchPlaceholder,
  emptyPlaceholder
}: {
  slot: FallbackSlot
  control: ReturnType<typeof useForm<RouterFormInput, unknown, RouterFormOutput>>['control']
  modelOptions: { value: string; label: string }[]
  label: string
  selectPlaceholder: string
  searchPlaceholder: string
  emptyPlaceholder: string
}) {
  const primaryValue = useWatch({ control, name: slot })
  const primaryProvider = providerOf(typeof primaryValue === 'string' ? primaryValue : null)
  const filteredOptions =
    primaryProvider === '' ? modelOptions : modelOptions.filter((opt) => providerOf(opt.value) !== primaryProvider)
  return (
    <FormField
      control={control}
      name={`fallbacks.${slot}`}
      render={({ field }) => {
        // Drop any previously-selected fallback that now belongs to the
        // same provider as the primary — the dropdown will not offer it
        // any more, so leaving it in field.value would be misleading.
        const current = Array.isArray(field.value) ? field.value : []
        const sanitized =
          primaryProvider === '' ? current : current.filter((v: string) => providerOf(v) !== primaryProvider)
        return (
          <FormItem>
            <FormLabel>{label}</FormLabel>
            <FormControl>
              <MultiSelectCombobox
                options={filteredOptions}
                value={sanitized}
                onChange={field.onChange}
                placeholder={selectPlaceholder}
                searchPlaceholder={searchPlaceholder}
                emptyPlaceholder={emptyPlaceholder}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )
      }}
    />
  )
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
      persona: defaultPersona,
      forceUseImageAgent: config.forceUseImageAgent ? 'true' : 'false'
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
        persona
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

              <FormField
                control={form.control}
                name='persona'
                render={({ field }) => {
                  // Radix Select needs a non-empty value, so '' (none) maps
                  // to the sentinel for display and back to '' on change.
                  const selectValue = field.value === '' || field.value === null ? PERSONA_NONE_VALUE : field.value
                  return (
                    // Full-width own row: the helper text makes this cell
                    // taller than the model-slot selects, so on the shared
                    // `items-end` grid it would misalign with a half-width
                    // neighbor. Spanning every column keeps it on its own row.
                    <FormItem className='md:col-span-2 xl:col-span-3'>
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
