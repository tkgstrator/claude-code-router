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
import { APP_VERSION } from './lib/version'
import { bootstrapServer } from './services/bootstrap'

// Hono root. Backend routes live under src/api/<path>/route.ts (one
// Hono sub-app per file, Next.js-style) and are mounted here. Anything
// under /api or /v1 that no route handles falls through to the legacy
// Fastify server at FASTIFY_FALLBACK_URL (dev-only; currently unused).
const FASTIFY_FALLBACK_URL = (() => {
  const fromEnv = process.env.CCR_FASTIFY_URL
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  return 'http://localhost:3456'
})()

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

// OpenAPI spec endpoint — useful for tooling and the generated docs.
app.doc('/api/openapi.json', {
  openapi: '3.1.0',
  info: { title: 'CCR API', version: APP_VERSION }
})

const proxyToFastify = async (c: { req: { raw: Request } }) => {
  const incoming = c.req.raw
  const incomingUrl = new URL(incoming.url)
  const target = new URL(FASTIFY_FALLBACK_URL)
  target.pathname = incomingUrl.pathname
  target.search = incomingUrl.search
  const body = incoming.method === 'GET' || incoming.method === 'HEAD' ? undefined : await incoming.arrayBuffer()
  const upstream = await fetch(target, {
    method: incoming.method,
    headers: incoming.headers,
    body
  })
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers
  })
}

app.all('/api/*', proxyToFastify)
app.all('/v1/*', proxyToFastify)

export default app
