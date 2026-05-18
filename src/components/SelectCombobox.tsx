import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface Option {
  label: string
  value: string
}

interface SelectComboboxProps {
  options: Option[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  emptyPlaceholder?: string
  disabled?: boolean
}

export function SelectCombobox({
  options,
  value,
  onChange,
  placeholder,
  disabled,
}: SelectComboboxProps) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className='w-full'>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
