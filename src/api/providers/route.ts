import { OpenAPIHono } from '@hono/zod-openapi'
import { ProviderSchema } from '../../schemas'
import { getProviders, upsertProvider } from '../../services/config'
import { badRequestForZod } from '../zod-response'

export const providersRoute = new OpenAPIHono()

providersRoute.get('/api/providers', async (c) => {
  const providers = await getProviders()
  return c.json(providers)
})

providersRoute.post('/api/providers', async (c) => {
  const raw = await c.req.json().catch(() => null)
  const parsed = ProviderSchema.safeParse(raw)
  if (!parsed.success) return badRequestForZod(c, parsed.error)
  const { provider, warnings } = await upsertProvider(parsed.data)
  return c.json({ success: true as const, provider, ...(warnings.length > 0 ? { warnings } : {}) }, 201)
})
