import { Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { PageContainer, PageContent, PageHeader } from '@/components/PageLayout'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { Config, Persona } from '@/types'
import { useConfig } from './ConfigProvider'

// Read-only persona detail page (/personas/view/:id, keyed by the
// persona's uuid). Sits between the list and the editor: the list links
// here to inspect the full prompt, and this page links on to
// /personas/edit/:id to make changes.
export function PersonaView() {
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
  return <PersonaViewBody config={config} />
}

function PersonaViewBody({ config }: { config: Config }) {
  const { t } = useTranslation()
  const params = useParams()

  // Personas are keyed by their persistent uuid `id` (carried in the URL).
  const id = params.id ? decodeURIComponent(params.id) : null
  const persona: Persona | undefined = id !== null ? config.Personas.find((p) => p.id === id) : undefined

  // Name no longer in the library (deleted elsewhere, or a hand-typed URL).
  // Show a brief not-found state with a link back to the list instead of
  // crashing on an undefined persona.
  if (persona === undefined) {
    return (
      <PageContainer>
        <PageHeader title={t('personas.title')} />
        <PageContent className='flex flex-col items-center justify-center gap-4'>
          <p className='text-muted-foreground'>{t('personas.not_found')}</p>
          <Button asChild variant='outline'>
            <Link to='/personas'>{t('personas.back_to_list')}</Link>
          </Button>
        </PageContent>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader title={persona.name}>
        <Button asChild>
          <Link to={`/personas/edit/${encodeURIComponent(persona.id ?? '')}`}>
            <Pencil className='h-4 w-4' />
            {t('personas.edit')}
          </Link>
        </Button>
      </PageHeader>
      <PageContent>
        <div className='flex flex-1 flex-col gap-4'>
          <div className='flex min-h-0 flex-1 flex-col gap-2'>
            <div className='flex items-center justify-between'>
              <p className='text-sm font-medium text-foreground'>{t('personas.prompt_label')}</p>
              <p className='text-xs text-muted-foreground'>
                {t('personas.prompt_chars', { count: persona.prompt.length })}
              </p>
            </div>
            <Textarea
              readOnly
              value={persona.prompt}
              placeholder={t('personas.prompt_empty')}
              className='min-h-[50vh] flex-1 resize-none'
            />
          </div>
          <div className='flex shrink-0 justify-start'>
            <Button asChild variant='outline'>
              <Link to='/personas'>{t('personas.back_to_list')}</Link>
            </Button>
          </div>
        </div>
      </PageContent>
    </PageContainer>
  )
}
