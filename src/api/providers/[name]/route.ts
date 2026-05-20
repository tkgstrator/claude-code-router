import { OpenAPIHono } from '@hono/zod-openapi'
import { ProviderSchema } from '../../../schemas'
import { deleteProviderByName, upsertProvider } from '../../../services/config'
import { badRequestForZod } from '../../zod-response'

export const providerByNameRoute = new OpenAPIHono()

providerByNameRoute.patch('/api/providers/:name', async (c) => {
  const name = c.req.param('name')
  const raw = await c.req.json().catch(() => null)
  const parsed = ProviderSchema.safeParse({ ...(raw && typeof raw === 'object' ? raw : {}), name })
  if (!parsed.success) return badRequestForZod(c, parsed.error)
  const { provider, warnings } = await upsertProvider(parsed.data)
  return c.json({ success: true as const, provider, ...(warnings.length > 0 ? { warnings } : {}) })
})

providerByNameRoute.delete('/api/providers/:name', async (c) => {
  const name = c.req.param('name')
  try {
    await deleteProviderByName(name)
    return c.json({ success: true as const })
  } catch (err) {
    return c.json({ success: false as const, error: (err as Error).message }, 404)
  }
})
