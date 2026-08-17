import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui-ext/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { getOptions, shouldShowField, validateField } from '@/lib/presets/form-logic'
import type { PresetConfigSection, RequiredInput } from '@/lib/presets/types'

interface DynamicConfigFormProps {
  schema: RequiredInput[]
  presetConfig: PresetConfigSection
  onSubmit: (values: Record<string, any>) => void
  onCancel: () => void
  isSubmitting?: boolean
  initialValues?: Record<string, any>
}

export function DynamicConfigForm({
  schema,
  presetConfig,
  onSubmit,
  onCancel,
  isSubmitting = false,
  initialValues = {}
}: DynamicConfigFormProps) {
  const { t } = useTranslation()
  const [values, setValues] = useState<Record<string, any>>(initialValues)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set())

  // Calculate visible fields
  useEffect(() => {
    const updateVisibility = () => {
      const visible = new Set<string>()

      for (const field of schema) {
        if (shouldShowField(field, values)) {
          visible.add(field.id)
        }
      }

      setVisibleFields(visible)
    }

    updateVisibility()
  }, [values, schema])

  // Update field value
  const updateValue = (fieldId: string, value: any) => {
    setValues((prev) => ({
      ...prev,
      [fieldId]: value
    }))
    // Clear errors for this field
    setErrors((prev) => {
      const newErrors = { ...prev }
      delete newErrors[fieldId]
      return newErrors
    })
  }

  // Submit form
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    // Validate all visible fields
    const newErrors: Record<string, string> = {}

    for (const field of schema) {
      if (!visibleFields.has(field.id)) {
        continue
      }

      const error = validateField(field, values, t)
      if (error) {
        newErrors[field.id] = error
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    onSubmit(values)
  }

  return (
    <form onSubmit={handleSubmit} className='space-y-4'>
      {schema.map((field) => {
        if (!visibleFields.has(field.id)) {
          return null
        }

        const label = field.label || field.id
        const prompt = field.prompt
        const error = errors[field.id]

        return (
          <div key={field.id} className='space-y-2'>
            <Label htmlFor={`field-${field.id}`}>
              {label}
              {field.required !== false && <span className='text-red-500 ml-1'>*</span>}
            </Label>

            {prompt && <p className='text-sm text-gray-600'>{prompt}</p>}

            {/* Password / Input */}
            {(field.type === 'password' || field.type === 'input' || !field.type) && (
              <Input
                id={`field-${field.id}`}
                type={field.type === 'password' ? 'password' : 'text'}
                placeholder={field.placeholder}
                value={values[field.id] || ''}
                onChange={(e) => updateValue(field.id, e.target.value)}
                disabled={isSubmitting}
              />
            )}

            {/* Number */}
            {field.type === 'number' && (
              <Input
                id={`field-${field.id}`}
                type='number'
                placeholder={field.placeholder}
                value={values[field.id] || ''}
                onChange={(e) => updateValue(field.id, Number(e.target.value))}
                min={field.min}
                max={field.max}
                disabled={isSubmitting}
              />
            )}

            {/* Select */}
            {field.type === 'select' && (
              <Select
                value={values[field.id] || ''}
                onValueChange={(value: string) => updateValue(field.id, value)}
                disabled={isSubmitting}
              >
                <SelectTrigger id={`field-${field.id}`}>
                  <SelectValue placeholder={field.placeholder || t('presets.form.select', { label })} />
                </SelectTrigger>
                <SelectContent>
                  {getOptions(field, presetConfig, values).map((option) => (
                    <SelectItem key={String(option.value)} value={String(option.value)} disabled={option.disabled}>
                      <div>
                        <div>{option.label}</div>
                        {option.description && <div className='text-xs text-gray-500'>{option.description}</div>}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Multiselect */}
            {field.type === 'multiselect' && (
              <div className='space-y-2'>
                {getOptions(field, presetConfig, values).map((option) => (
                  <div key={String(option.value)} className='flex items-center space-x-2'>
                    <Checkbox
                      id={`field-${field.id}-${option.value}`}
                      checked={Array.isArray(values[field.id]) && values[field.id].includes(option.value)}
                      onCheckedChange={(checked: boolean | 'indeterminate') => {
                        const current = Array.isArray(values[field.id]) ? values[field.id] : []
                        if (checked === true) {
                          updateValue(field.id, [...current, option.value])
                        } else {
                          updateValue(
                            field.id,
                            current.filter((v: any) => v !== option.value)
                          )
                        }
                      }}
                      disabled={isSubmitting || option.disabled}
                    />
                    <Label htmlFor={`field-${field.id}-${option.value}`} className='text-sm font-normal cursor-pointer'>
                      {option.label}
                      {option.description && <span className='text-gray-500 ml-2'>{option.description}</span>}
                    </Label>
                  </div>
                ))}
              </div>
            )}

            {/* Confirm */}
            {field.type === 'confirm' && (
              <div className='flex items-center space-x-2'>
                <Checkbox
                  id={`field-${field.id}`}
                  checked={values[field.id] || false}
                  onCheckedChange={(checked: boolean | 'indeterminate') => updateValue(field.id, checked)}
                  disabled={isSubmitting}
                />
                <Label htmlFor={`field-${field.id}`} className='text-sm font-normal cursor-pointer'>
                  {field.prompt || label}
                </Label>
              </div>
            )}

            {/* Editor */}
            {field.type === 'editor' && (
              <Textarea
                id={`field-${field.id}`}
                placeholder={field.placeholder}
                value={values[field.id] || ''}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => updateValue(field.id, e.target.value)}
                rows={field.rows || 5}
                disabled={isSubmitting}
              />
            )}

            {error && <p className='text-sm text-red-500'>{error}</p>}
          </div>
        )
      })}

      <div className='flex justify-end gap-2 pt-4'>
        <Button type='button' variant='outline' onClick={onCancel} disabled={isSubmitting}>
          {t('app.cancel')}
        </Button>
        <Button type='submit' disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              {t('presets.form.saving')}
            </>
          ) : (
            t('app.save')
          )}
        </Button>
      </div>
    </form>
  )
}
