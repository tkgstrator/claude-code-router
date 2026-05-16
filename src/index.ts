import 'dotenv/config'
import { OpenAPIHono } from '@hono/zod-openapi'
import { configRoute } from './api/config/route'
import { modelTestRoute } from './api/models/test/route'
import { modelTestAllRoute } from './api/models/test-all/route'
import { providersTestRoute } from './api/providers/test/route'
import { refreshModelsRoute } from './api/refresh-models/route'
import { scrapePricesRoute } from './api/scrape-prices/[vendor]/route'
import { subscriptionsRoute } from './api/subscriptions/route'
import { transformersRoute } from './api/transformers/route'
import { updateCheckRoute } from './api/update/check/route'
import { updatePerformRoute } from './api/update/perform/route'
import { v1Route } from './api/v1/route'
import { APP_VERSION } from './lib/version'
import { bootstrapServer } from './services/bootstrap'

// Hono root. Backend routes live under src/api/<path>/route.ts (one
// Hono sub-app per file, Next.js-style) and are mounted here. The
// /v1/* LLM proxy is served natively by v1Route, which drives the
// absorbed llms router + transformer pipeline directly (no Fastify).

// Mirror what the legacy Fastify server did at boot: lift any
// pre-existing config.json into Postgres, seed default Providers + the
// six RouterSlot rows, and copy the envelope scalars onto process.env.
// Idempotent — re-running it on a populated DB is a no-op.
await bootstrapServer()

const app = new OpenAPIHono()

// Each sub-app declares its own absolute /api/... paths, so mount them
// at root. OpenAPIHono.route() also merges their OpenAPI registries.
app.route('/', configRoute)
app.route('/', transformersRoute)
app.route('/', subscriptionsRoute)
app.route('/', updateCheckRoute)
app.route('/', updatePerformRoute)
app.route('/', refreshModelsRoute)
app.route('/', providersTestRoute)
app.route('/', modelTestRoute)
app.route('/', modelTestAllRoute)
app.route('/', scrapePricesRoute)

// Native /v1/* LLM proxy — drives the llms pipeline without Fastify.
app.route('/', v1Route)

// OpenAPI spec endpoint — useful for tooling and the generated docs.
app.doc('/api/openapi.json', {
  openapi: '3.1.0',
  info: { title: 'CCR API', version: APP_VERSION }
})

export default app
