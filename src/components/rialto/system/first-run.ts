/**
 * First-run detection, shared by the gate that redirects to /setup and by
 * the setup screen it redirects to.
 *
 * There is no login screen any more — Cloudflare Access authenticates at
 * the edge — so nothing else stands between a fresh install and a shell
 * whose every panel is empty. This decides that the install has not been
 * set up at all, and it is deliberately narrow: a seeded catalog already
 * registers providers, so the only state that qualifies is a database
 * carrying no Provider row whatsoever. An install with a catalog but no
 * credentials is still usable — Overview and Providers both have
 * something to say — and hijacking it would be worse than saying nothing.
 */
import type { Config, Provider } from '@/types'

/**
 * Is this provider actually usable? A seeded catalog row is not: api_key
 * stays null until someone pastes one, and a subscription row is dead
 * until an account on it is enabled.
 */
export function isProviderConnected(provider: Provider): boolean {
  if (provider.auth_mode === 'subscription') {
    const accounts = provider.subscription_accounts
    return accounts === undefined ? false : accounts.some((account) => account.enabled)
  }
  return provider.api_key !== null && provider.api_key.length > 0
}

/** A database with nothing in it at all — not merely nothing authenticated. */
export function isFreshInstall(config: Config | null): boolean {
  return config !== null && config.Providers.length === 0
}

// Offering /setup is a one-time nudge, not a wall: the screen's own "Skip
// setup" link would bounce straight back into this gate without it.
// sessionStorage rather than a module-scoped flag so a reload does not
// re-hijack the tab, and both sides fail towards "already offered" when
// storage is unavailable, because a gate that cannot remember is a gate
// that traps.
const SETUP_OFFERED_KEY = 'rialto.setup-offered'

export function setupAlreadyOffered(): boolean {
  try {
    return sessionStorage.getItem(SETUP_OFFERED_KEY) !== null
  } catch {
    return true
  }
}

export function markSetupOffered(): void {
  try {
    sessionStorage.setItem(SETUP_OFFERED_KEY, '1')
  } catch {
    // Storage refused. The nudge is lost, which is the harmless direction.
  }
}
