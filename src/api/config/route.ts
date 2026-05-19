import { OpenAPIHono } from '@hono/zod-openapi'
import { resetLlmsContext } from '../../llmsContext'
import { ApplyConfigPayloadSchema } from '../../schemas'
import { applyUiConfig, composeUiConfig } from '../../services/configService'

export const configRoute = new OpenAPIHono()

// Neither /api/config route is registered through createRoute: the
// LegacyConfig the server returns (and the ApplyConfigPayload it
// accepts) carry a recursive JsonValue subtree (StatusLine /
// transformers / plugins). Feeding that to @hono/zod-openapi blows the
// stack during OpenAPI doc generation (zod-to-openapi recurses the
// self-referential schema). We still validate the POST body with the
// same zod schema by hand. The schemas stay exported for typing/docs.
configRoute.get('/api/config', async (c) => {
  const config = await composeUiConfig()
  return c.json(config)
})

configRoute.post('/api/config', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = ApplyConfigPayloadSchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ success: false as const, error: parsed.error }, 400)
  }
  const result = await applyUiConfig(parsed.data)
  // The /v1 proxy caches the llms services (incl. Router/providers)
  // built from this config — drop it so edits take effect without a
  // restart.
  resetLlmsContext()
  return c.json({
    success: true,
    message: 'Config saved successfully',
    ...(result.warnings.length > 0 ? { warnings: result.warnings } : {})
  })
})
