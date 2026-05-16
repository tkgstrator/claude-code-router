import 'dotenv/config'
import { applyUiConfig, composeUiConfig } from '@ccr/server/config'
import { refreshModelsForAllProviders } from '@ccr/server/models'
import serverPackage from '@ccr/server/package'
import { testProvider } from '@ccr/server/providers'
import { getSubscriptionsInfo } from '@ccr/server/subscriptions'
import { checkForUpdates, performUpdate } from '@ccr/server/update'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { BUILTIN_TRANSFORMERS } from './lib/builtinTransformers'
import {
  ApplyConfigPayloadSchema,
  ApplyConfigResponseSchema,
  ProviderTestRequestSchema,
  ProviderTestResponseSchema,
  RefreshModelsResponseSchema,
  SubscriptionsResponseSchema,
  TransformersResponseSchema,
  UpdateCheckResponseSchema,
  UpdatePerformResponseSchema,
  ValidationErrorSchema
} from './schemas'

// Hono root for the CCR server. Routes are defined with @hono/zod-openapi
// so the request and response shapes are validated at the boundary and
// the generated OpenAPI spec stays in sync with the runtime behaviour.
// Any /api or /v1 path not handled below falls through to the legacy
// Fastify server at FASTIFY_FALLBACK_URL.
const FASTIFY_FALLBACK_URL = (() => {
  const fromEnv = process.env.CCR_FASTIFY_URL
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  return 'http://localhost:3456'
})()

const app = new OpenAPIHono()

// GET /api/config is not registered through createRoute because the
// LegacyConfig the server returns has a recursive JsonValue subtree
// (StatusLine / transformers / plugins) that breaks @hono/zod-openapi's
// inference (TS2589). The ConfigSchema is still exported for docs.
app.get('/api/config', async (c) => {
  const config = await composeUiConfig()
  return c.json(config)
})

const postConfigRoute = createRoute({
  method: 'post',
  path: '/api/config',
  request: {
    body: {
      content: { 'application/json': { schema: ApplyConfigPayloadSchema } },
      required: true
    }
  },
  responses: {
    200: {
      description: 'Diff applied; envelope written to disk',
      content: { 'application/json': { schema: ApplyConfigResponseSchema } }
    }
  }
})
app.openapi(postConfigRoute, async (c) => {
  const body = c.req.valid('json')
  const result = await applyUiConfig(body)
  return c.json(
    {
      success: true,
      message: 'Config saved successfully',
      ...(result.warnings.length > 0 ? { warnings: result.warnings } : {})
    },
    200
  )
})

const getTransformersRoute = createRoute({
  method: 'get',
  path: '/api/transformers',
  responses: {
    200: {
      description: 'Built-in transformers registered on the server',
      content: { 'application/json': { schema: TransformersResponseSchema } }
    }
  }
})
app.openapi(getTransformersRoute, (c) => {
  // Mirrors the list @musistudio/llms registers at boot. Once we
  // bootstrap TransformerService from Hono we can read it directly.
  return c.json({ transformers: BUILTIN_TRANSFORMERS }, 200)
})

const getSubscriptionsRoute = createRoute({
  method: 'get',
  path: '/api/subscriptions',
  responses: {
    200: {
      description: 'Subscription credentials info per provider',
      content: { 'application/json': { schema: SubscriptionsResponseSchema } }
    }
  }
})
app.openapi(getSubscriptionsRoute, async (c) => {
  const subscriptions = await getSubscriptionsInfo()
  return c.json({ subscriptions }, 200)
})

const getUpdateCheckRoute = createRoute({
  method: 'get',
  path: '/api/update/check',
  responses: {
    200: {
      description: 'Compares the installed version against the npm registry',
      content: { 'application/json': { schema: UpdateCheckResponseSchema } }
    }
  }
})
app.openapi(getUpdateCheckRoute, async (c) => {
  const result = await checkForUpdates(serverPackage.version)
  return c.json(result, 200)
})

const refreshModelsRoute = createRoute({
  method: 'post',
  path: '/api/refresh-models',
  responses: {
    200: {
      description: 'Outcome per provider after the upstream model sweep',
      content: { 'application/json': { schema: RefreshModelsResponseSchema } }
    }
  }
})
app.openapi(refreshModelsRoute, async (c) => {
  const outcomes = await refreshModelsForAllProviders()
  return c.json({ outcomes }, 200)
})

const providersTestRoute = createRoute({
  method: 'post',
  path: '/api/providers/test',
  request: {
    body: {
      content: { 'application/json': { schema: ProviderTestRequestSchema } },
      required: true
    }
  },
  responses: {
    200: {
      description: 'Provider connection probe result',
      content: { 'application/json': { schema: ProviderTestResponseSchema } }
    },
    400: {
      description: 'Provider name missing or invalid',
      content: { 'application/json': { schema: ValidationErrorSchema } }
    }
  }
})
app.openapi(providersTestRoute, async (c) => {
  const { name } = c.req.valid('json')
  const trimmed = name.trim()
  if (!trimmed) {
    return c.json({ success: false as const, error: 'name is required' }, 400)
  }
  const result = await testProvider(trimmed)
  return c.json(result, 200)
})

const updatePerformRoute = createRoute({
  method: 'post',
  path: '/api/update/perform',
  responses: {
    200: {
      description: 'Result of the npm update command',
      content: { 'application/json': { schema: UpdatePerformResponseSchema } }
    }
  }
})
app.openapi(updatePerformRoute, async (c) => {
  const result = await performUpdate()
  return c.json(result, 200)
})

// OpenAPI spec endpoint — useful for tooling and the generated docs.
app.doc('/api/openapi.json', {
  openapi: '3.1.0',
  info: { title: 'CCR API', version: serverPackage.version }
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
