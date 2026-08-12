import 'dotenv/config'
import { OpenAPIHono } from '@hono/zod-openapi'
import { HTTPException } from 'hono/http-exception'
import { ZodError } from 'zod'
import { accessLog } from './api/access-log'
import { apiKeyAuth } from './api/api-key-auth'
import { catalogRoute } from './api/catalog/route'
import { configRoute } from './api/config/route'
import { logsRoute } from './api/logs/route'
import { modelsRoute } from './api/models/route'
import { modelTestRoute } from './api/models/test/route'
import { modelTestAllRoute } from './api/models/test-all/route'
import { oauthRoute } from './api/oauth/route'
import { providerModelRoute } from './api/providers/[name]/models/[model]/route'
import { providerByNameRoute } from './api/providers/[name]/route'
import { providersRoute } from './api/providers/route'
import { providersTestRoute } from './api/providers/test/route'
import { refreshModelsRoute } from './api/refresh-models/route'
import { requestLogsRoute } from './api/request-logs/route'
import { routerPreferencesRoute } from './api/router-preferences/route'
import { routingPresetsRoute } from './api/routing-presets/route'
import { scrapePricesRoute } from './api/scrape-prices/[vendor]/route'
import { subscriptionsRoute } from './api/subscriptions/route'
import { transformersRoute } from './api/transformers/route'
import { updateCheckRoute } from './api/update/check/route'
import { updatePerformRoute } from './api/update/perform/route'
import { usageCostHistoryRoute } from './api/usage/cost/history/route'
import { usageCostRoute } from './api/usage/cost/route'
import { usageHistoryRoute } from './api/usage/history/route'
import { usageRoute } from './api/usage/route'
import { v1Route } from './api/v1/route'
import { logger, syncLoggerFromEnv } from './logger'
import { startAuthHealthCheck } from './services/auth-health-job'
import { initConfig, initDir } from './services/config/envelope'
import { reconcileActiveSubAccounts } from './services/subscription-account-sync-service'
import { startUsageCapture } from './services/usage-job'
import { APP_VERSION } from './version'

// Hono root. Backend routes live under src/api/<path>/route.ts (one
// Hono sub-app per file, Next.js-style) and are mounted here. The
// /v1/* LLM proxy is served natively by v1Route, which drives the
// absorbed llms router + transformer pipeline directly (no Fastify).
//
// Single entry for both dev and prod: in dev, @hono/vite-dev-server
// imports this module and only forwards /api/* + /v1/* to app.fetch
// (everything else is Vite-served). In prod, Bun runs this file
// directly and consumes the default export's { port, fetch, idleTimeout }.
// The SPA + static-asset handlers below are registered only when
// ./dist/index.html exists, so dev (no build output) skips them safely.
//
// DB schema + first-run seed rows are NOT created here — that's the
// job of `prisma migrate deploy` + `prisma db seed`, which entrypoint.sh
// runs before exec'ing this process (or `bun db:migrate` locally).

await initDir()
const envelope = await initConfig()
// Re-apply LOG_LEVEL to the already-initialised logger: the pino
// instance is constructed at import time before initConfig() has
// mirrored config.json's LOG_LEVEL onto process.env.
syncLoggerFromEnv()
logger.info({ APIKEY: process.env.APIKEY }, 'ccr APIKEY ready')
// Self-heal subscription providers whose active account binding was
// orphaned by older toggle code that nulled instead of promoting.
// Idempotent: a no-op once every provider already has a valid active.
await reconcileActiveSubAccounts()
// Fire-and-forget: never block server boot on Redis. The job setup
// is resilient and registers the BullMQ schedule once Redis is reachable;
// it has its own per-process guard so HMR re-evaluation is a no-op.
void startUsageCapture()
// Same pattern: periodically re-probe each subscription account and
// persist its authStatus so the UI can flag accounts that need
// re-authentication.
void startAuthHealthCheck()

const app = new OpenAPIHono()

// Gate everything that hits the paid subscriptions or mutates config
// behind the envelope APIKEY (seed mints one on first run). The static
// SPA at `/` stays open so the UI can load and prompt for the key; its
// own /api calls then carry it.
//
// The OAuth callback lives at the root path `/callback` (not under
// /api/*) because Anthropic's OAuth client only whitelists the
// loopback `http://localhost:<port>/callback` pattern. It is therefore
// naturally outside this gate; CSRF protection lives on the single-use
// `state` issued at POST /api/oauth/initiate/* (still gated).
// Access log runs BEFORE apiKeyAuth so 401s from the auth gate are
// visible too — otherwise a wrong-key probe leaves no trace at all.
app.use('/api/*', accessLog)
app.use('/v1/*', accessLog)
app.use('/api/*', apiKeyAuth)
app.use('/v1/*', apiKeyAuth)

app.onError((err, c) => {
  if (err instanceof ZodError) {
    return c.json({ success: false as const, error: { type: 'validation_error' as const, issues: err.issues } }, 400)
  }
  if (err instanceof HTTPException) {
    return err.getResponse()
  }
  logger.error({ err }, 'unhandled route error')
  return c.json(
    {
      success: false as const,
      error: { type: 'internal_error', message: err.message }
    },
    500
  )
})

// Each sub-app declares its own absolute /api/... paths, so mount them
// at root. OpenAPIHono.route() also merges their OpenAPI registries.
app.route('/', configRoute)
app.route('/', logsRoute)
app.route('/', transformersRoute)
app.route('/', subscriptionsRoute)
app.route('/', usageRoute)
app.route('/', usageHistoryRoute)
app.route('/', usageCostRoute)
app.route('/', usageCostHistoryRoute)
app.route('/', updateCheckRoute)
app.route('/', updatePerformRoute)
app.route('/', catalogRoute)
app.route('/', refreshModelsRoute)
app.route('/', providersRoute)
app.route('/', providerByNameRoute)
app.route('/', providerModelRoute)
app.route('/', providersTestRoute)
app.route('/', modelsRoute)
app.route('/', modelTestRoute)
app.route('/', modelTestAllRoute)
app.route('/', scrapePricesRoute)
app.route('/', requestLogsRoute)
app.route('/', routingPresetsRoute)
app.route('/', routerPreferencesRoute)
app.route('/', oauthRoute)

// Native /v1/* LLM proxy — drives the llms pipeline without Fastify.
app.route('/', v1Route)

// OpenAPI spec endpoint — useful for tooling and the generated docs.
app.doc('/api/openapi.json', {
  openapi: '3.1.0',
  info: { title: 'CCR API', version: APP_VERSION }
})

// SPA + static fallback for production runs (Bun serving the built
// single-file index.html). Vite handles the SPA in dev, and dist/
// doesn't exist there, so we skip registration entirely when the build
// output is missing. Registration order matters: this is attached
// AFTER every API route, so it can never shadow them or strip auth.
//
// Gated on `typeof Bun !== 'undefined'` because @hono/vite-dev-server
// imports this module in Vite's Node-based SSR runtime, where the Bun
// global is missing and `hono/bun`'s SSG submodule throws at evaluation
// time. The dynamic import keeps that submodule out of the Node load path.
if (typeof Bun !== 'undefined') {
  const indexHtmlFile = Bun.file('./dist/index.html')
  if (await indexHtmlFile.exists()) {
    const { serveStatic } = await import('hono/bun')
    app.use('/*', serveStatic({ root: './dist' }))
    const indexHtml = await indexHtmlFile.text()
    app.get('/*', (c) => c.html(indexHtml))
  }
}

// Bun's per-request idle timeout defaults to 10s and kills any socket
// that goes quiet for that long. LLM calls routinely think for far
// longer than 10s before the first token, so the default makes Bun
// abort live requests with "request timed out after 10 seconds". 255
// is Bun's maximum; lower values just reintroduce the cutoff. The
// envelope key is in ms — convert to seconds and clamp to 1..255.
const idleTimeout = envelope.API_TIMEOUT_MS
  ? Math.min(Math.max(1, Math.round(envelope.API_TIMEOUT_MS / 1000)), 255)
  : 255

// Bun auto-serves a default export of `{ port, fetch }`. Vite's
// dev-server only looks at `.fetch`, so the extra fields are harmless
// in dev. PORT comes from the schema-parsed envelope (default 3456),
// so any in-app feature that builds a self URL from it matches the
// port Bun actually bound.
export default {
  port: envelope.PORT,
  idleTimeout,
  fetch: app.fetch
}
