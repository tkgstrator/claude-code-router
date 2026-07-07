import { type useForm, useWatch } from 'react-hook-form'
import { MultiSelectCombobox } from '@/components/MultiSelectCombobox'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import type { FallbackSlot } from '@/lib/router/fallback-slots'
import { providerOf } from '@/lib/router/fallback-slots'
import type { RouterFormInput, RouterFormOutput } from '@/schemas/forms.dto'

interface FallbackSlotFieldProps {
  slot: FallbackSlot
  control: ReturnType<typeof useForm<RouterFormInput, unknown, RouterFormOutput>>['control']
  modelOptions: { value: string; label: string }[]
  label: string
  selectPlaceholder: string
  searchPlaceholder: string
  emptyPlaceholder: string
}

// One fallback slot's MultiSelect, with same-provider options stripped.
// Watches the slot's primary value so toggling the primary live-updates
// the fallback option list (and prunes any selected entry that now
// matches the primary's provider — keeping the form state honest before
// submit, where applyUiConfig would drop it anyway).
export function FallbackSlotField({
  slot,
  control,
  modelOptions,
  label,
  selectPlaceholder,
  searchPlaceholder,
  emptyPlaceholder
}: FallbackSlotFieldProps) {
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
