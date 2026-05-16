import { composeUiConfig } from '@ccr/server/config'
import { Hono } from 'hono'

// Phase 1a Hono entry. Only the routes we've actually migrated land
// here; everything else under /api or /v1 falls through to the legacy
// Fastify server at FASTIFY_FALLBACK_URL so the UI keeps working.
const FASTIFY_FALLBACK_URL = (() => {
  const fromEnv = process.env.CCR_FASTIFY_URL
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  return 'http://localhost:3456'
})()

const app = new Hono()

app.get('/api/config', async (c) => {
  const config = await composeUiConfig()
  return c.json(config)
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
