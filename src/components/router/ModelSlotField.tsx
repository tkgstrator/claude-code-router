import type { useForm } from 'react-hook-form'
import { SelectCombobox } from '@/components/SelectCombobox'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import type { RouterFormInput, RouterFormOutput } from '@/schemas/forms.dto'

type ModelSlotName = 'default' | 'background' | 'think' | 'webSearch' | 'longContext' | 'image'

interface ModelSlotFieldProps {
  control: ReturnType<typeof useForm<RouterFormInput, unknown, RouterFormOutput>>['control']
  name: ModelSlotName
  label: string
  modelOptions: { value: string; label: string }[]
  selectPlaceholder: string
  emptyPlaceholder: string
  className?: string
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
  className
}: ModelSlotFieldProps) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
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
        </FormItem>
      )}
    />
  )
}
