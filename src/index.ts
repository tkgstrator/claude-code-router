import 'dotenv/config'
import { OpenAPIHono } from '@hono/zod-openapi'
import { configRoute } from './api/config/route'
import { logsRoute } from './api/logs/route'
import { modelsRoute } from './api/models/route'
import { modelTestRoute } from './api/models/test/route'
import { modelTestAllRoute } from './api/models/test-all/route'
import { providerModelRoute } from './api/providers/[name]/models/[model]/route'
import { providerByNameRoute } from './api/providers/[name]/route'
import { providersRoute } from './api/providers/route'
import { providersTestRoute } from './api/providers/test/route'
import { refreshModelsRoute } from './api/refresh-models/route'
import { requestLogsRoute } from './api/request-logs/route'
import { scrapePricesRoute } from './api/scrape-prices/[vendor]/route'
import { subscriptionsRoute } from './api/subscriptions/route'
import { transformersRoute } from './api/transformers/route'
import { updateCheckRoute } from './api/update/check/route'
import { updatePerformRoute } from './api/update/perform/route'
import { usageHistoryRoute } from './api/usage/history/route'
import { usageRoute } from './api/usage/route'
import { v1Route } from './api/v1/route'
import { apiKeyAuth } from './lib/apiKeyAuth'
import { APP_VERSION } from './lib/version'
import { bootstrapServer } from './services/bootstrap'

// Hono root. Backend routes live under src/api/<path>/route.ts (one
// Hono sub-app per file, Next.js-style) and are mounted here. The
// /v1/* LLM proxy is served natively by v1Route, which drives the
// absorbed llms router + transformer pipeline directly (no Fastify).

// Mirror what the legacy Fastify server did at boot: lift any
// pre-existing config.json into Postgres, seed default Providers + the
// six RouterSlot rows, and copy the envelope scalars onto process.env.
//
// Guard against Vite HMR re-evaluating this module on every file save:
// bootstrapServer() seeds the DB and may delete models/reset config, so
// it must run exactly once per process lifetime, not once per HMR cycle.
// globalThis survives module re-evaluation within the same Node process.
const _g = globalThis as Record<string, unknown>
if (!_g.__ccrBootstrapped) {
  _g.__ccrBootstrapped = true
  await bootstrapServer()
}

const app = new OpenAPIHono()

// Gate everything that hits the paid subscriptions or mutates config
// behind the envelope APIKEY (bootstrap mints one on first run). The
// static SPA at `/` stays open so the UI can load and prompt for the
// key; its own /api calls then carry it.
app.use('/api/*', apiKeyAuth)
app.use('/v1/*', apiKeyAuth)

// Each sub-app declares its own absolute /api/... paths, so mount them
// at root. OpenAPIHono.route() also merges their OpenAPI registries.
app.route('/', configRoute)
app.route('/', logsRoute)
app.route('/', transformersRoute)
app.route('/', subscriptionsRoute)
app.route('/', usageRoute)
app.route('/', usageHistoryRoute)
app.route('/', updateCheckRoute)
app.route('/', updatePerformRoute)
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

// Native /v1/* LLM proxy — drives the llms pipeline without Fastify.
app.route('/', v1Route)

// OpenAPI spec endpoint — useful for tooling and the generated docs.
app.doc('/api/openapi.json', {
  openapi: '3.1.0',
  info: { title: 'CCR API', version: APP_VERSION }
})

export default app
