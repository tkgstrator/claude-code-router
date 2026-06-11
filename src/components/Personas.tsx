import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOutletContext } from 'react-router-dom'
import type { ShellOutletContext } from '@/components/AppShell'
import { PageContainer, PageContent, PageHeader } from '@/components/PageLayout'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import type { Persona } from '@/types'
import { useConfig } from './ConfigProvider'

// UI-only row shape: a stable `id` keys each list row so React keeps
// per-row identity across reorders/deletes. The id is stripped before the
// library is persisted as plain Persona objects.
interface PersonaRow extends Persona {
  id: string
}

const toRows = (personas: Persona[]): PersonaRow[] =>
  personas.map((persona) => ({ id: crypto.randomUUID(), name: persona.name, prompt: persona.prompt }))

// Edit/add dialog: editing a persona is a deliberate action that happens
// only here, never inline in the list. `persona` is null in create mode.
function PersonaEditDialog({
  open,
  persona,
  onSave,
  onCancel
}: {
  open: boolean
  persona: PersonaRow | null
  onSave: (values: { name: string; prompt: string }) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')

  // Seed the fields each time the dialog opens; create mode starts empty.
  useEffect(() => {
    if (!open) return
    setName(persona ? persona.name : '')
    setPrompt(persona ? persona.prompt : '')
  }, [open, persona])

  const isEdit = persona !== null

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent aria-describedby={undefined} className='flex max-h-[85vh] flex-col'>
        <DialogHeader>
          <DialogTitle>{isEdit ? t('personas.edit_title') : t('personas.add_title')}</DialogTitle>
        </DialogHeader>
        {/* Scroll the body so a long prompt can't push the footer (Save/Cancel) below the fold. */}
        <div className='min-h-0 flex-1 space-y-4 overflow-y-auto'>
          <div className='space-y-2'>
            <Label htmlFor='persona-name'>{t('personas.name_label')}</Label>
            <Input
              id='persona-name'
              value={name}
              placeholder={t('personas.name_placeholder')}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='persona-prompt'>{t('personas.prompt_label')}</Label>
            <Textarea
              id='persona-prompt'
              rows={10}
              value={prompt}
              placeholder={t('personas.prompt_placeholder')}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onCancel}>
            {t('app.cancel')}
          </Button>
          <Button onClick={() => onSave({ name, prompt })}>{t('app.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function Personas() {
  const { t } = useTranslation()
  const { showToast } = useOutletContext<ShellOutletContext>()
  const { config, setConfig } = useConfig()

  // Local copy of the library seeded from config; mutated only through the
  // edit dialog and the delete action, then persisted as a unit.
  const [rows, setRows] = useState<PersonaRow[]>(
    toRows(config && Array.isArray(config.Personas) ? config.Personas : [])
  )
  // null = dialog closed; a PersonaRow = edit that row; an empty-id sentinel
  // would be ambiguous, so create mode uses a dedicated boolean instead.
  const [editingRow, setEditingRow] = useState<PersonaRow | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [deletingRow, setDeletingRow] = useState<PersonaRow | null>(null)

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

  const persist = async (nextRows: PersonaRow[]) => {
    const normalizedPersonas: Persona[] = nextRows.map((row) => ({ name: row.name, prompt: row.prompt }))
    // Library-only save: spread the existing config so Router (including the
    // active Router.persona, owned by the Router page) is preserved.
    const nextConfig = {
      ...config,
      Personas: normalizedPersonas
    }
    await api.updateConfig(nextConfig)
    setConfig(nextConfig)
    setRows(nextRows)
  }

  const handleDialogSave = async (values: { name: string; prompt: string }) => {
    const trimmedName = values.name.trim()
    if (trimmedName === '') {
      showToast(t('personas.name_required'), 'error')
      return
    }
    // A rename must not collide with another persona; the row being edited
    // may keep its own name. Comparison is case-insensitive to match Providers.
    const editingId = editingRow ? editingRow.id : null
    const isDuplicate = rows.some(
      (row) => row.id !== editingId && row.name.trim().toLowerCase() === trimmedName.toLowerCase()
    )
    if (isDuplicate) {
      showToast(t('personas.name_duplicate'), 'error')
      return
    }

    const nextRows = editingRow
      ? rows.map((row) => (row.id === editingRow.id ? { ...row, name: trimmedName, prompt: values.prompt } : row))
      : [...rows, { id: crypto.randomUUID(), name: trimmedName, prompt: values.prompt }]

    try {
      await persist(nextRows)
      setEditingRow(null)
      setIsAdding(false)
      showToast(t('personas.saved_success'), 'success')
    } catch (err) {
      showToast(`${t('personas.save_failed')}: ${err instanceof Error ? err.message : 'request failed'}`, 'error')
    }
  }

  const handleDelete = async (row: PersonaRow) => {
    const nextRows = rows.filter((r) => r.id !== row.id)
    try {
      await persist(nextRows)
      setDeletingRow(null)
      showToast(t('personas.saved_success'), 'success')
    } catch (err) {
      showToast(`${t('personas.save_failed')}: ${err instanceof Error ? err.message : 'request failed'}`, 'error')
    }
  }

  const closeDialog = () => {
    setEditingRow(null)
    setIsAdding(false)
  }

  return (
    <PageContainer>
      <PageHeader title={`${t('personas.title')} (${rows.length})`}>
        <Button onClick={() => setIsAdding(true)}>
          <Plus className='h-4 w-4' />
          {t('personas.add')}
        </Button>
      </PageHeader>
      <PageContent>
        <div className='space-y-6'>
          <p className='text-sm text-muted-foreground'>{t('personas.description')}</p>

          {rows.length === 0 ? (
            <div className='flex items-center justify-center rounded-md border bg-background p-8 text-muted-foreground'>
              {t('personas.empty')}
            </div>
          ) : (
            <div className='divide-y rounded-md border bg-background'>
              {rows.map((row) => (
                <div key={row.id} className='flex items-start gap-3 px-4 py-3'>
                  <div className='min-w-0 flex-1 space-y-1'>
                    <p className='text-sm font-semibold text-foreground'>{row.name}</p>
                    {row.prompt.trim() === '' ? (
                      <p className='text-sm italic text-muted-foreground'>{t('personas.prompt_empty')}</p>
                    ) : (
                      <p className='line-clamp-2 text-sm text-muted-foreground'>{row.prompt}</p>
                    )}
                    <p className='text-xs text-muted-foreground'>
                      {t('personas.prompt_chars', { count: row.prompt.length })}
                    </p>
                  </div>
                  <div className='flex flex-shrink-0 items-center gap-2'>
                    <Button
                      variant='ghost'
                      size='icon'
                      aria-label={t('personas.edit')}
                      onClick={() => setEditingRow(row)}
                    >
                      <Pencil className='h-4 w-4' />
                    </Button>
                    <Button
                      variant='destructive'
                      size='icon'
                      aria-label={t('personas.delete')}
                      onClick={() => setDeletingRow(row)}
                    >
                      <Trash2 className='h-4 w-4' />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </PageContent>

      <PersonaEditDialog
        open={isAdding || editingRow !== null}
        persona={editingRow}
        onSave={handleDialogSave}
        onCancel={closeDialog}
      />

      <Dialog open={deletingRow !== null} onOpenChange={(open) => (open ? undefined : setDeletingRow(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('personas.delete')}</DialogTitle>
            <DialogDescription>{t('personas.delete_confirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeletingRow(null)}>
              {t('app.cancel')}
            </Button>
            <Button variant='destructive' onClick={() => deletingRow !== null && handleDelete(deletingRow)}>
              {t('app.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
