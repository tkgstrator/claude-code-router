/**
 * The full-page frame every system state renders into.
 *
 * These screens appear without the sidebar and header: either the shell
 * does not apply yet (the OAuth callback lands in its own tab) or it
 * cannot be trusted to render (the API is unreachable). One wrapper keeps
 * all of them centred identically — the mock puts them side by side
 * precisely so their tone can be compared.
 */
import type { ReactNode } from 'react'

export function SystemPage({ children }: { children: ReactNode }) {
  return <div className='flex min-h-screen items-center justify-center bg-background px-6 py-10'>{children}</div>
}
