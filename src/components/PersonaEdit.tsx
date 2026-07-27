import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
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
import type { Config, Persona } from '@/types'
import { useConfig } from './ConfigProvider'

// Dedicated full-page persona editor used for both create (/personas/new)
// and edit (/personas/edit/:id). Personas are long, so editing happens
// here with a tall textarea instead of the cramped in-list dialog.
export function PersonaEdit() {
  const { config } = useConfig()
  if (!config) {
    return (
      <PageContainer>
        <PageContent className='flex items-center justify-center'>
          <div className='text-muted-foreground'>Loading personas configuration...</div>
        </PageContent>
      </PageContainer>
    )
  }
  return <PersonaEditForm config={config} />
}

function PersonaEditForm({ config }: { config: Config }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { showToast } = useOutletContext<ShellOutletContext>()
  const { setConfig } = useConfig()
  const params = useParams()

  // Edit mode when :id is present in the route; create mode otherwise.
  // Personas are keyed by their persistent uuid `id` (carried in the URL).
  const id = params.id ? decodeURIComponent(params.id) : null
  const personas: Persona[] = config.Personas
  const existing = id !== null ? personas.find((p) => p.id === id) : undefined
  const isEdit = id !== null

  const [name, setName] = useState(existing ? existing.name : '')
  const [prompt, setPrompt] = useState(existing ? existing.prompt : '')
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)

  // Edit route pointed at a name no longer in the library (e.g. the page
  // was refreshed after a delete, or the URL was hand-typed). Don't crash:
  // show a brief not-found state with a link back to the list.
  if (isEdit && existing === undefined) {
    return (
      <PageContainer>
        <PageHeader title={t('personas.edit_title')} />
        <PageContent className='flex flex-col items-center justify-center gap-4'>
          <p className='text-muted-foreground'>{t('personas.not_found')}</p>
          <Button asChild variant='outline'>
            <Link to='/personas'>{t('personas.back_to_list')}</Link>
          </Button>
        </PageContent>
      </PageContainer>
    )
  }

  const handleSave = async () => {
    const trimmedName = name.trim()
    if (trimmedName === '') {
      showToast(t('personas.name_required'), 'error')
      return
    }
    // Names are free-form display labels — personas are keyed by their
    // uuid `id`, so duplicate names are allowed. Edit updates the row with
    // the matching id (preserving it); create mints a fresh uuid.
    const nextPersonas: Persona[] = isEdit
      ? personas.map((p) => (p.id === id ? { ...p, name: trimmedName, prompt } : p))
      : [...personas, { id: crypto.randomUUID(), name: trimmedName, prompt }]

    // Library-only save: spread the existing config so Router (including
    // the active Router.persona, owned by the Router page) is preserved.
    const nextConfig: Config = { ...config, Personas: nextPersonas }
    try {
      await api.updateConfig(nextConfig)
      setConfig(nextConfig)
      showToast(t('personas.saved_success'), 'success')
      navigate('/personas')
    } catch (err) {
      showToast(`${t('personas.save_failed')}: ${err instanceof Error ? err.message : 'request failed'}`, 'error')
    }
  }

  // Delete is only reachable in edit mode (id is non-null). Drop the edited
  // persona from the library and persist, preserving the rest of config.
  const handleDelete = async () => {
    const nextPersonas: Persona[] = personas.filter((p) => p.id !== id)
    const nextConfig: Config = { ...config, Personas: nextPersonas }
    try {
      await api.updateConfig(nextConfig)
      setConfig(nextConfig)
      setIsConfirmingDelete(false)
      showToast(t('personas.saved_success'), 'success')
      navigate('/personas')
    } catch (err) {
      showToast(`${t('personas.save_failed')}: ${err instanceof Error ? err.message : 'request failed'}`, 'error')
    }
  }

  return (
    <PageContainer>
      <PageHeader title={isEdit ? t('personas.edit_title') : t('personas.add_title')} />
      <PageContent>
        <div className='flex flex-1 flex-col gap-4'>
          <div className='space-y-2'>
            <Label htmlFor='persona-name'>{t('personas.name_label')}</Label>
            <Input
              id='persona-name'
              value={name}
              placeholder={t('personas.name_placeholder')}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className='flex min-h-0 flex-1 flex-col space-y-2'>
            <Label htmlFor='persona-prompt'>{t('personas.prompt_label')}</Label>
            <Textarea
              id='persona-prompt'
              value={prompt}
              placeholder={t('personas.prompt_placeholder')}
              onChange={(e) => setPrompt(e.target.value)}
              className='min-h-[50vh] flex-1 resize-none'
            />
          </div>
          <div className='flex shrink-0 items-center justify-between gap-2'>
            <div>
              {isEdit && (
                <Button variant='destructive' onClick={() => setIsConfirmingDelete(true)}>
                  <Trash2 className='h-4 w-4' />
                  {t('personas.delete')}
                </Button>
              )}
            </div>
            <div className='flex gap-2'>
              <Button variant='outline' onClick={() => navigate('/personas')}>
                {t('app.cancel')}
              </Button>
              <Button onClick={handleSave}>{t('app.save')}</Button>
            </div>
          </div>
        </div>
      </PageContent>

      <Dialog open={isConfirmingDelete} onOpenChange={(open) => (open ? undefined : setIsConfirmingDelete(false))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('personas.delete')}</DialogTitle>
            <DialogDescription>{t('personas.delete_confirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setIsConfirmingDelete(false)}>
              {t('app.cancel')}
            </Button>
            <Button variant='destructive' onClick={handleDelete}>
              {t('app.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
