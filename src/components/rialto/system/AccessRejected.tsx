/**
 * Cloudflare Access let the request reach the origin but the JWT did not
 * verify.
 *
 * This is an EXPLANATION, never a form. Authentication lives at the edge;
 * rendering a credential field here would stand up a second, weaker auth
 * system beside it, and the weaker one is the one an attacker uses. The
 * two failure shapes an operator actually hits are an `aud` that belongs
 * to a different Access application, and an origin reachable without
 * passing through Access at all — so the page names both.
 */
import { SystemPage } from './SystemPage'

export function AccessRejected({ detail }: { detail: string | null }) {
  return (
    <div className='w-full max-w-sm'>
      <div className='flex items-center gap-2'>
        <i className='ri-shield-cross-line text-base text-destructive' />
        <h3 className='text-sm font-semibold'>Access token not accepted</h3>
      </div>
      <p className='mt-2 text-[11px] leading-relaxed text-muted-foreground'>
        A <span className='font-mono'>Cf-Access-Jwt-Assertion</span> header arrived but failed verification. Rialto will
        not serve <span className='font-mono'>/api/*</span> until it does.
      </p>
      {detail === null ? null : (
        <div className='mt-3 rounded-md bg-muted/60 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap'>
          {detail}
        </div>
      )}
      <p className='mt-3 text-[11px] leading-relaxed text-muted-foreground'>
        Set <span className='font-mono'>ACCESS_AUD</span> to this application's AUD tag from Zero Trust, or reach the
        origin through the tunnel rather than directly.
      </p>
    </div>
  )
}

/**
 * Route entry. `detail` is the verifier's own reason string, rendered
 * verbatim when the server sends one — the page never invents an aud
 * comparison it has not been told about.
 */
export function AccessRejectedScreen({ detail = null }: { detail?: string | null }) {
  return (
    <SystemPage>
      <AccessRejected detail={detail} />
    </SystemPage>
  )
}
