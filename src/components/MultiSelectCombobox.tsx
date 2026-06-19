import { Check, ChevronsUpDown } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface Option {
  label: string
  value: string
}

interface MultiSelectComboboxProps {
  options: Option[]
  value?: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyPlaceholder?: string
}

// Multi-select dropdown that renders the picked labels inline on the
// trigger instead of a separate badge row, so the trigger height stays
// fixed and aligns cleanly when laid out in a grid alongside siblings
// that may have different selection counts. Order of `value` is
// preserved: toggling a new option appends, so callers that interpret
// the array as an ordered chain (e.g. fallback routing) see picks in
// click order.
export function MultiSelectCombobox({
  options,
  value = [],
  onChange,
  placeholder = 'Select options...',
  searchPlaceholder = 'Search...',
  emptyPlaceholder = 'No options found.'
}: MultiSelectComboboxProps) {
  const [open, setOpen] = useState(false)

  const handleSelect = (currentValue: string) => {
    if (value.includes(currentValue)) {
      onChange(value.filter((v) => v !== currentValue))
    } else {
      onChange([...value, currentValue])
    }
  }

  const summary =
    value.length > 0 ? value.map((v) => options.find((o) => o.value === v)?.label || v).join(', ') : placeholder

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant='outline' role='combobox' aria-expanded={open} className='w-full justify-between font-normal'>
          <span className={cn('min-w-0 flex-1 truncate text-left', value.length === 0 && 'text-muted-foreground')}>
            {summary}
          </span>
          <ChevronsUpDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[--radix-popover-trigger-width] p-0'>
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyPlaceholder}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                // cmdk filters by `value`, so use the visible label there
                // and keep the raw form value as a keyword. onSelect uses
                // a closure to pass the real value, ignoring cmdk's arg.
                <CommandItem
                  key={option.value}
                  value={option.label}
                  keywords={[option.value]}
                  onSelect={() => handleSelect(option.value)}
                >
                  <Check className={cn('mr-2 h-4 w-4', value.includes(option.value) ? 'opacity-100' : 'opacity-0')} />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
