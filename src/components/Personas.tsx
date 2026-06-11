import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOutletContext } from 'react-router-dom'
import type { ShellOutletContext } from '@/components/AppShell'
import { PageContainer, PageContent, PageHeader } from '@/components/PageLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import type { Persona } from '@/types'
import { useConfig } from './ConfigProvider'

// Sentinel used for the "no active persona" choice. Radix Select cannot
// carry an empty-string item value, so we map this back to '' (the wire
// contract for "off") on save.
const NONE_VALUE = '__none__'

// UI-only row shape: a stable `id` keys each editable row so React keeps
// per-row state across reorders/deletes. The id is stripped before the
// library is persisted as plain Persona objects.
interface PersonaRow extends Persona {
  id: string
}

const toRows = (personas: Persona[]): PersonaRow[] =>
  personas.map((persona) => ({ id: crypto.randomUUID(), name: persona.name, prompt: persona.prompt }))

export function Personas() {
  const { t } = useTranslation()
  const { showToast } = useOutletContext<ShellOutletContext>()
  const { config, setConfig } = useConfig()

  // Local editable copies seeded from config; persisted as a unit on Save.
  const [rows, setRows] = useState<PersonaRow[]>(
    toRows(config && Array.isArray(config.Personas) ? config.Personas : [])
  )
  const [activePersona, setActivePersona] = useState<string>(
    config && typeof config.ActivePersona === 'string' ? config.ActivePersona : ''
  )

  if (!config) {
    return (
      <PageContainer>
        <PageHeader title={t('personas.title')} />
        <PageContent className='flex items-center justify-center'>
          <div className='text-muted-foreground'>Loading personas configuration...</div>
        </PageContent>
      </PageContainer>
    )
  }

  const updateRow = (id: string, field: keyof Persona, value: string) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)))
  }

  const addRow = () => {
    setRows((prev) => [...prev, { id: crypto.randomUUID(), name: '', prompt: '' }])
  }

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((row) => row.id !== id))
  }

  const handleSave = async () => {
    // Names must be present and unique.
    const trimmedNames = rows.map((row) => row.name.trim())
    const hasEmptyName = trimmedNames.some((name) => name === '')
    if (hasEmptyName) {
      showToast(t('personas.name_required'), 'error')
      return
    }
    const hasDuplicate = trimmedNames.some((name, i) => trimmedNames.indexOf(name) !== i)
    if (hasDuplicate) {
      showToast(t('personas.name_duplicate'), 'error')
      return
    }
    // An active selection must point at a persona that exists.
    if (activePersona !== '' && !trimmedNames.includes(activePersona)) {
      showToast(t('personas.active_missing'), 'error')
      return
    }

    const normalizedPersonas: Persona[] = rows.map((row) => ({ name: row.name.trim(), prompt: row.prompt }))
    const nextConfig = { ...config, Personas: normalizedPersonas, ActivePersona: activePersona }
    try {
      await api.updateConfig(nextConfig)
      setConfig(nextConfig)
      setRows(toRows(normalizedPersonas))
      showToast(t('personas.saved_success'), 'success')
    } catch (err) {
      showToast(`${t('personas.save_failed')}: ${err instanceof Error ? err.message : 'request failed'}`, 'error')
    }
  }

  const activeSelectValue = activePersona === '' ? NONE_VALUE : activePersona

  return (
    <PageContainer>
      <PageHeader title={`${t('personas.title')} (${rows.length})`}>
        <Button variant='outline' onClick={addRow}>
          <Plus className='h-4 w-4' />
          {t('personas.add')}
        </Button>
        <Button onClick={handleSave}>{t('personas.save')}</Button>
      </PageHeader>
      <PageContent>
        <div className='space-y-6'>
          <p className='text-sm text-muted-foreground'>{t('personas.description')}</p>

          <div className='space-y-2'>
            <Label htmlFor='active-persona'>{t('personas.active_label')}</Label>
            <Select
              value={activeSelectValue}
              onValueChange={(value) => setActivePersona(value === NONE_VALUE ? '' : value)}
            >
              <SelectTrigger id='active-persona' className='w-72'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>{t('personas.active_none')}</SelectItem>
                {rows
                  .filter((row) => row.name.trim() !== '')
                  .map((row) => {
                    const name = row.name.trim()
                    return (
                      <SelectItem key={row.id} value={name}>
                        {name}
                      </SelectItem>
                    )
                  })}
              </SelectContent>
            </Select>
          </div>

          {rows.length === 0 ? (
            <div className='flex items-center justify-center rounded-md border bg-background p-8 text-muted-foreground'>
              {t('personas.empty')}
            </div>
          ) : (
            <div className='space-y-4'>
              {rows.map((row) => (
                <div key={row.id} className='space-y-3 rounded-md border bg-background p-4'>
                  <div className='flex items-end gap-2'>
                    <div className='flex-1 space-y-2'>
                      <Label htmlFor={`persona-name-${row.id}`}>{t('personas.name_label')}</Label>
                      <Input
                        id={`persona-name-${row.id}`}
                        value={row.name}
                        placeholder={t('personas.name_placeholder')}
                        onChange={(e) => updateRow(row.id, 'name', e.target.value)}
                      />
                    </div>
                    <Button
                      variant='destructive'
                      size='icon'
                      aria-label={t('personas.delete')}
                      onClick={() => removeRow(row.id)}
                    >
                      <Trash2 className='h-4 w-4' />
                    </Button>
                  </div>
                  <div className='space-y-2'>
                    <Label htmlFor={`persona-prompt-${row.id}`}>{t('personas.prompt_label')}</Label>
                    <Textarea
                      id={`persona-prompt-${row.id}`}
                      rows={6}
                      value={row.prompt}
                      placeholder={t('personas.prompt_placeholder')}
                      onChange={(e) => updateRow(row.id, 'prompt', e.target.value)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </PageContent>
    </PageContainer>
  )
}
