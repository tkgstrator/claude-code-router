// @ts-nocheck
/**
 * Standalone @musistudio/llms service context — no Fastify.
 *
 * Mirrors what the llms Server constructor builds (ConfigService /
 * TransformerService / TokenizerService / ProviderService) so the Hono
 * /v1 adapter can drive the exact same router + transformer pipeline
 * (src/llms) directly, in-process, without booting Fastify (whose
 * listen()/avvio lifecycle hangs inside the Vite SSR runner).
 *
 * @ts-nocheck + tsconfig maps @/llms/* to an any-stub, so the strict
 * root typecheck never traverses the vendored llms graph. Vite
 * resolves @/llms/* to the real source at runtime via its own alias.
 */

import { handleTransformerEndpoint } from '@/llms/api/routes'
import { ConfigService } from '@/llms/services/config'
import { ProviderService } from '@/llms/services/provider'
import { TokenizerService } from '@/llms/services/tokenizer'
import { TransformerService } from '@/llms/services/transformer'
import { router } from '@/llms/utils/router'
import { loadFullConfig } from './services/configService'

// Re-export the pipeline entrypoints through this @ts-nocheck module so
// the strict Hono adapter can import them as `any` (the @/llms/* stub
// can't satisfy named imports directly).
export { handleTransformerEndpoint, router }

// Minimal pino-shaped logger the llms code expects on fastify.log.
const log: any = {
  info: () => {},
  debug: () => {},
  trace: () => {},
  warn: (...a: unknown[]) => console.warn('[llms]', ...a),
  error: (...a: unknown[]) => console.error('[llms]', ...a),
  fatal: (...a: unknown[]) => console.error('[llms]', ...a),
  child: () => log
}

export interface LlmsContext {
  configService: any
  transformerService: any
  tokenizerService: any
  providerService: any
  log: any
}

let ctxPromise: Promise<LlmsContext> | null = null

// Subscription providers store no api_key (the OAuth token lives in a
// credentials file). llms ProviderService skips any provider with a
// falsy api_key, and the real token is injected at request time by a
// credentials transformer. So for the /v1 pipeline view we give such
// providers a placeholder key (never sent — the transformer's auth()
// overrides the header) plus the matching credentials transformer.
const CREDENTIALS_TRANSFORMER: Record<string, string> = {
  'claude-code': 'claude-code-credentials'
  // codex needs a dedicated codex-credentials transformer in src/llms
  // before it can route via /v1 — tracked as a follow-up.
}
const withSubscriptionAuth = (providers: any[]): any[] =>
  providers.map((p) => {
    if (p?.auth_mode !== 'subscription') return p
    const cred = CREDENTIALS_TRANSFORMER[p.name]
    if (!cred) return p
    return { ...p, api_key: 'oauth', transformer: { ...(p.transformer ?? {}), use: [cred] } }
  })

async function build(): Promise<LlmsContext> {
  const cfg = await loadFullConfig()
  const providers = withSubscriptionAuth((cfg as any).Providers ?? [])
  // router.ts reads configService.get("providers") (lowercase) and
  // get("Router"); loadFullConfig returns capital Providers. Provide
  // both so explicit "provider,model" routing also works.
  const initialConfig = { ...cfg, Providers: providers, providers, Router: (cfg as any).Router }
  const configService = new ConfigService({ initialConfig })
  const transformerService = new TransformerService(configService, log)
  const tokenizerService = new TokenizerService(configService, log)
  await transformerService.initialize()
  await tokenizerService.initialize().catch((e: unknown) => log.error('tokenizer init failed', e))
  const providerService = new ProviderService(configService, transformerService, log)
  return { configService, transformerService, tokenizerService, providerService, log }
}

export function getLlmsContext(): Promise<LlmsContext> {
  if (!ctxPromise) ctxPromise = build()
  return ctxPromise
}

// Force a rebuild after the DB config changes (provider/model edits).
export function resetLlmsContext(): void {
  ctxPromise = null
}
