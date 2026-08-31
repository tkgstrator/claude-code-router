/**
 * The system prompt as the upstream model will receive it.
 *
 * The persona block goes first and the client's own prompt is appended
 * unchanged — which is the whole reason a persona is safe to leave on:
 * Claude Code can still override it. Showing the order is the only way
 * that guarantee is visible from the UI.
 */
import { promptExcerpt } from '@/lib/rialto/settings-content/persona'

export function PersonaPreview({ name, prompt }: { name: string; prompt: string }) {
  const excerpt = promptExcerpt(prompt)
  return (
    <div className='px-6 pb-6'>
      <div className='rounded-md border border-border'>
        <div className='border-b border-border px-3 py-1.5'>
          <span className='font-mono text-[10px] uppercase tracking-wider text-muted-foreground'>system</span>
        </div>
        <div className='space-y-2 px-3 py-2.5 text-[11px] leading-relaxed'>
          <div className='rounded bg-muted/60 px-2 py-1.5'>
            <span className='font-mono text-[10px] text-muted-foreground'>persona: {name}</span>
            <p className='mt-1'>{excerpt === '' ? 'This persona is empty — nothing is prepended.' : `${excerpt}…`}</p>
          </div>
          <div className='rounded border border-dashed border-border px-2 py-1.5 text-muted-foreground'>
            <span className='font-mono text-[10px]'>client system prompt</span>
            <p className='mt-1'>…whatever Claude Code sends, appended unchanged.</p>
          </div>
        </div>
      </div>
      <p className='mt-3 text-[11px] leading-relaxed text-muted-foreground'>
        The persona goes first so the client's own prompt can still override it. Both blocks are marked cacheable, so
        the cost is paid once per session.
      </p>
    </div>
  )
}
