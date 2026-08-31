/**
 * "Who guards what" — the three credentials an operator confuses with
 * each other, and the direction each one points.
 *
 * Static reference copy, not state: the whole reason the panel exists is
 * that "API key" means an inbound gate on two of these and an outbound
 * secret on the third, and nothing else on the screen says so.
 */
import { Link } from 'react-router-dom'

interface Guard {
  title: string
  accent: string
  flow: string
  body: React.ReactNode
}

const GUARDS: Guard[] = [
  {
    title: 'Cloudflare Access',
    accent: 'border-l-emerald-500/60',
    flow: 'you → Access → Rialto',
    body: (
      <>
        Guards this UI and <span className='font-mono'>/api/*</span> at the edge. The browser logs in at Cloudflare;
        Rialto currently reads the forwarded identity headers for display only.
      </>
    )
  },
  {
    title: 'Bootstrap token',
    accent: 'border-l-foreground/40',
    flow: 'Claude Code → Rialto',
    body: (
      <>
        Guards <span className='font-mono'>/v1/*</span> and <span className='font-mono'>/api/*</span>. CLI clients
        cannot complete an interactive Access login, so this shared secret is that path's only gate.
      </>
    )
  },
  {
    title: 'Provider API key',
    accent: 'border-l-border',
    flow: 'Rialto → OpenAI',
    body: (
      <>
        <span className='font-medium text-foreground'>Outbound.</span> Rialto presents it to a vendor. Lives on the
        provider in{' '}
        <Link to='/providers' className='underline underline-offset-2'>
          Providers
        </Link>
        .
      </>
    )
  }
]

export function GuardsCard() {
  return (
    <div className='rounded-md border border-border px-4 py-3'>
      <div className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>Who guards what</div>
      <div className='mt-2 grid grid-cols-3 gap-4'>
        {GUARDS.map((g) => (
          <div key={g.title} className={`border-l-2 ${g.accent} pl-3`}>
            <div className='text-xs font-medium'>{g.title}</div>
            <div className='mt-1 text-[11px] leading-relaxed text-muted-foreground'>{g.body}</div>
            <div className='mt-1.5 font-mono text-[10px] text-muted-foreground'>{g.flow}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
