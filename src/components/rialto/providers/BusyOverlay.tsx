/**
 * Backdrop shown while a catalog-wide refresh is in flight.
 *
 * Only the long vendor round-trips get one. "Sync models" and "Refresh
 * prices" fan out to every provider — a live model list, a price scrape
 * and a context-window lookup each — and can run for tens of seconds,
 * during which the screen is indistinguishable from an idle one: the
 * buttons grey out, nothing else moves, and the operator reasonably
 * concludes the click was lost and clicks again. The per-row writes
 * (toggle a model, save a key, remove a provider) return fast enough
 * that dimming the screen for them would be noise, which is why the
 * label is passed per action rather than derived from `busy`.
 *
 * Covers the master-detail area rather than the whole shell, so the
 * header keeps the disabled control that started the work visible next
 * to what is running.
 */
export function BusyOverlay({ label }: { label: string }) {
  return (
    <div
      className='absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-[1px]'
      role='status'
      aria-live='polite'
    >
      <div className='flex items-center gap-2 rounded-md border border-border bg-background px-4 py-3 shadow-sm'>
        <i className='ri-loader-4-line animate-spin text-sm text-muted-foreground' />
        <span className='text-xs font-medium'>{label}</span>
      </div>
    </div>
  )
}
