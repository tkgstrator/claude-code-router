import type { useForm } from 'react-hook-form'
import { SelectCombobox } from '@/components/SelectCombobox'
import { Checkbox } from '@/components/ui/checkbox'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import type { RouterFormInput, RouterFormOutput } from '@/schemas/forms.dto'

type ModelSlotName = 'default' | 'background' | 'think' | 'webSearch' | 'longContext' | 'image'
// Every slot (image included) can carry the Force checkbox in the UI. image
// force is persisted but not consumed at runtime (see RouterForceSchema).
type ForceFieldName =
  | 'force.default'
  | 'force.background'
  | 'force.think'
  | 'force.webSearch'
  | 'force.longContext'
  | 'force.image'

interface ModelSlotFieldProps {
  control: ReturnType<typeof useForm<RouterFormInput, unknown, RouterFormOutput>>['control']
  name: ModelSlotName
  label: string
  modelOptions: { value: string; label: string }[]
  selectPlaceholder: string
  emptyPlaceholder: string
  className?: string
  // When set, a "force" checkbox is rendered under the select, bound to
  // this form field. Omit to render the slot without a Force checkbox.
  forceName?: ForceFieldName
  forceLabel?: string
  forceHint?: string
}

// A single model-slot select (Default/Background/Think/WebSearch/LongContext/
// Image), all backed by the same SelectCombobox + form-field wiring.
export function ModelSlotField({
  control,
  name,
  label,
  modelOptions,
  selectPlaceholder,
  emptyPlaceholder,
  className,
  forceName,
  forceLabel,
  forceHint
}: ModelSlotFieldProps) {
  return (
    <FormItem className={className}>
      <FormLabel>{label}</FormLabel>
      <FormField
        control={control}
        name={name}
        render={({ field }) => (
          <>
            <FormControl>
              <SelectCombobox
                options={modelOptions}
                value={field.value}
                onChange={field.onChange}
                placeholder={selectPlaceholder}
                emptyPlaceholder={emptyPlaceholder}
              />
            </FormControl>
            <FormMessage />
          </>
        )}
      />
      {forceName && (
        <FormField
          control={control}
          name={forceName}
          render={({ field }) => (
            <label className='mt-1.5 flex items-center gap-2 text-xs text-muted-foreground' title={forceHint}>
              <Checkbox checked={field.value === true} onCheckedChange={(v) => field.onChange(v === true)} />
              {forceLabel}
            </label>
          )}
        />
      )}
    </FormItem>
  )
}
