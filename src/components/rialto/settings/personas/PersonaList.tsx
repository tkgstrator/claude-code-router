/**
 * The persona library column.
 *
 * A persona that is not the active one is not applied to anything, so it
 * renders dimmed with an `off` pill — the list answers "which of these is
 * actually costing me tokens" before it answers anything else.
 */
import { Pill, RButton } from '@/components/rialto/primitives'
import { countWords, type PersonaDraft } from '@/lib/rialto/settings-content/persona'
import { cn } from '@/lib/utils'

function PersonaRow({
  persona,
  selected,
  active,
  onSelect
}: {
  persona: PersonaDraft
  selected: boolean
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type='button'
      onClick={onSelect}
      className={cn(
        'block w-full border-l-2 px-4 py-3 text-left transition-colors',
        selected ? 'border-l-foreground bg-muted/60' : 'border-l-transparent hover:border-l-border hover:bg-muted/50',
        active ? '' : 'opacity-45'
      )}
    >
      <div className='flex items-center gap-2'>
        <span className='text-xs font-medium'>{persona.name}</span>
        {active ? null : <Pill tone='mute'>off</Pill>}
        <span className='ml-auto font-mono text-[11px] tabular-nums text-muted-foreground'>
          {countWords(persona.prompt)}w
        </span>
      </div>
      <div className='mt-0.5 text-[11px] text-muted-foreground'>{active ? 'all routed requests' : '—'}</div>
    </button>
  )
}

export function PersonaList({
  personas,
  selectedId,
  activeId,
  onSelect,
  onCreate
}: {
  personas: PersonaDraft[]
  selectedId: string | null
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
}) {
  return (
    <aside className='min-w-0 overflow-y-auto border-r border-border'>
      <div className='flex items-center gap-2 px-4 pt-5 pb-2'>
        <h2 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Personas</h2>
        <span className='ml-auto font-mono text-[10px] text-muted-foreground'>{personas.length}</span>
      </div>
      {personas.map((persona) => (
        <PersonaRow
          key={persona.id}
          persona={persona}
          selected={persona.id === selectedId}
          active={persona.id === activeId}
          onSelect={() => onSelect(persona.id)}
        />
      ))}
      <div className='p-4'>
        <RButton variant='outline' icon='ri-add-line' onClick={onCreate}>
          New persona
        </RButton>
      </div>
      <div className='border-t border-border px-4 py-4'>
        <p className='text-[11px] leading-relaxed text-muted-foreground'>
          A persona is prepended to the system prompt of every request on the surfaces it applies to. It costs input
          tokens on each turn — cached after the first, so keep it stable.
        </p>
      </div>
    </aside>
  )
}
