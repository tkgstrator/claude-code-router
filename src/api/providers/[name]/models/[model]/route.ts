import { OpenAPIHono } from '@hono/zod-openapi'
import { UpdateModelBodySchema } from '../../../../../schemas'
import { setModelEnabled } from '../../../../../services/config'
import { badRequestForZod } from '../../../../zod-response'

export const providerModelRoute = new OpenAPIHono()

providerModelRoute.patch('/api/providers/:name/models/:model', async (c) => {
  const providerName = c.req.param('name')
  const modelName = c.req.param('model')
  const raw = await c.req.json().catch(() => null)
  const parsed = UpdateModelBodySchema.safeParse(raw)
  if (!parsed.success) return badRequestForZod(c, parsed.error)
  try {
    await setModelEnabled(providerName, modelName, parsed.data.enabled)
    return c.json({ success: true as const })
  } catch (err) {
    return c.json({ success: false as const, error: (err as Error).message }, 404)
  }
})
