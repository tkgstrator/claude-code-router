import { ChevronRight, Loader2, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { PageContainer, PageContent, PageHeader } from '@/components/PageLayout'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import type { Persona } from '@/types'
import type { ShellOutletContext } from './AppShell'
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

// Radio-group name shared by every row's `<input type="radio">` and the
// "None" option so single-select semantics kick in automatically —
// selecting one clears the others without extra JS.
const ACTIVE_RADIO_GROUP = 'personas-active'

export function Personas() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { config, reloadConfig } = useConfig()
  const { showToast } = useOutletContext<ShellOutletContext>()

  // Local draft of which persona is active. Radio picks update this
  // state only; Save persists the draft to Router.persona through
  // /api/config. Baseline mirrors the last-saved value so the Save
  // button can gate on "did anything actually change" and skip a
  // no-op /api/config round-trip.
  const persistedActive: string | null =
    typeof config?.Router.persona === 'string' && config.Router.persona !== '' ? config.Router.persona : null
  const [activeDraft, setActiveDraft] = useState<string | null>(persistedActive)
  const [activeBaseline, setActiveBaseline] = useState<string | null>(persistedActive)
  const [saving, setSaving] = useState<boolean>(false)

  // Re-sync the draft when config lands / reloads (fresh mount,
  // external config change). Guarded on config presence so the
  // initial `null` load doesn't clobber a mid-edit draft.
  useEffect(() => {
    if (config === null) return
    const next =
      typeof config.Router.persona === 'string' && config.Router.persona !== '' ? config.Router.persona : null
    setActiveDraft(next)
    setActiveBaseline(next)
  }, [config])

  const save = useCallback(async () => {
    if (config === null) return
    setSaving(true)
    try {
      await api.updateConfig({
        ...config,
        // Explicit null, never undefined: JSON.stringify drops undefined
        // keys, and the server distinguishes "clear the persona" from
        // "this save didn't touch the persona" by whether the key is
        // present at all (`'persona' in Router` in splitPayload). Sending
        // undefined made deselecting silently re-persist the old value.
        Router: { ...config.Router, persona: activeDraft }
      })
      await reloadConfig()
      showToast(t('personas.saved_success'), 'success')
    } catch (err) {
      showToast(`${t('personas.save_failed')}: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setSaving(false)
    }
  }, [config, activeDraft, reloadConfig, showToast, t])

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

  // Read-only view of the library, derived from config on every render so
  // the list catches up when ConfigProvider hydrates (or any external
  // config update arrives). Add/edit/delete all happen on the dedicated
  // /personas/new and /personas/edit/:id pages.
  const rows: PersonaRow[] = toRows(Array.isArray(config.Personas) ? config.Personas : [])
  const dirty = activeDraft !== activeBaseline

  return (
    <PageContainer>
      <PageHeader title={t('personas.title')}>
        <Button variant='outline' onClick={save} disabled={!dirty || saving}>
          {saving && <Loader2 className='h-3.5 w-3.5 animate-spin' aria-hidden='true' />}
          {t('app.save')}
        </Button>
        <Button onClick={() => navigate('/personas/new')}>
          <Plus className='h-4 w-4' />
          {t('personas.add')}
        </Button>
      </PageHeader>
      <PageContent>
        <div className='space-y-6'>
          <p className='text-sm text-muted-foreground'>{t('personas.description')}</p>

          {rows.length === 0 ? (
            <div className='flex items-center justify-center py-8 text-muted-foreground'>{t('personas.empty')}</div>
          ) : (
            <div className='space-y-1'>
              {/* "None" row — lets the operator clear the active
                  persona without navigating away. Rendered as a plain
                  label so clicking anywhere on the row picks the
                  radio; no navigation semantics here. */}
              <label
                className='flex cursor-pointer items-center gap-3 border-l-2 border-transparent px-3 py-2 text-sm transition-colors hover:border-primary'
                aria-label={t('personas.clearActiveAria')}
              >
                <input
                  type='radio'
                  name={ACTIVE_RADIO_GROUP}
                  className='h-4 w-4 shrink-0 accent-primary'
                  checked={activeDraft === null}
                  onChange={() => setActiveDraft(null)}
                />
                <span className='text-muted-foreground'>{t('personas.clearActive')}</span>
              </label>

              {/* Auto-fill grid: persona entries sit side-by-side at a
                  comfortable width on wide screens instead of full-width rows. */}
              <div className='grid grid-cols-[repeat(auto-fill,minmax(24rem,1fr))] items-start gap-x-6 gap-y-1'>
                {rows.map((row) => {
                  const isDraftActive = row.id === activeDraft
                  return (
                    <div
                      key={row.id}
                      // Row wraps the radio + the navigation button
                      // side-by-side. Nesting a button inside a button
                      // is invalid HTML, so the previous button-per-row
                      // structure had to split when the radio landed.
                      className='group flex items-start gap-3 border-l-2 border-transparent px-3 py-3 transition-colors hover:border-primary focus-within:border-primary'
                    >
                      <input
                        type='radio'
                        name={ACTIVE_RADIO_GROUP}
                        className='mt-1 h-4 w-4 shrink-0 accent-primary'
                        checked={isDraftActive}
                        aria-label={t('personas.activateAria', { name: row.name })}
                        onChange={() => setActiveDraft(row.id)}
                      />
                      <button
                        type='button'
                        className='flex min-w-0 flex-1 items-start gap-3 text-left focus-visible:outline-none'
                        onClick={() => navigate(`/personas/view/${encodeURIComponent(row.id)}`)}
                      >
                        <div className='min-w-0 flex-1 space-y-1'>
                          <p className='flex items-center gap-2 text-sm font-semibold text-foreground group-hover:underline'>
                            <span className='truncate'>{row.name}</span>
                            {isDraftActive && (
                              <span className='shrink-0 rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary'>
                                {t('personas.active')}
                              </span>
                            )}
                          </p>
                          {row.prompt.trim() === '' ? (
                            <p className='text-sm italic text-muted-foreground'>{t('personas.prompt_empty')}</p>
                          ) : (
                            <p className='line-clamp-2 text-sm text-muted-foreground'>{row.prompt}</p>
                          )}
                          <p className='text-xs text-muted-foreground'>
                            {t('personas.prompt_chars', { count: row.prompt.length })}
                          </p>
                        </div>
                        <ChevronRight className='mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground transition-colors group-hover:text-foreground' />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </PageContent>
    </PageContainer>
  )
}
