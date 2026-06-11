import { ChevronRight, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { PageContainer, PageContent, PageHeader } from '@/components/PageLayout'
import { Button } from '@/components/ui/button'
import type { Persona } from '@/types'
import { useConfig } from './ConfigProvider'

// UI-only row shape: `id` is the persona's persistent uuid key, used both
// as the React key and as the URL key when navigating to view/edit.
interface PersonaRow {
  id: string
  name: string
  prompt: string
}

const toRows = (personas: Persona[]): PersonaRow[] =>
  personas.map((persona) => ({
    id: persona.id ?? crypto.randomUUID(),
    name: persona.name,
    prompt: persona.prompt
  }))

export function Personas() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { config } = useConfig()

  // Read-only view of the library seeded from config. Add/edit/delete all
  // happen on the dedicated /personas/new and /personas/edit/:id pages.
  const [rows] = useState<PersonaRow[]>(toRows(config && Array.isArray(config.Personas) ? config.Personas : []))

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

  return (
    <PageContainer>
      <PageHeader title={`${t('personas.title')} (${rows.length})`}>
        <Button onClick={() => navigate('/personas/new')}>
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
                <button
                  key={row.id}
                  type='button'
                  className='flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none'
                  onClick={() => navigate(`/personas/view/${encodeURIComponent(row.id)}`)}
                >
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
                  <ChevronRight className='mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground' />
                </button>
              ))}
            </div>
          )}
        </div>
      </PageContent>
    </PageContainer>
  )
}
