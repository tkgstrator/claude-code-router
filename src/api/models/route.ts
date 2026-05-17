import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { EnabledModelsResponseSchema } from '../../schemas'
import { getEnabledModels } from '../../services/configService'

export const modelsRoute = new OpenAPIHono()

const getModelsRoute = createRoute({
  method: 'get',
  path: '/api/models',
  responses: {
    200: {
      description: 'Every enabled (routable) model. The Router selects render this verbatim.',
      content: { 'application/json': { schema: EnabledModelsResponseSchema } }
    }
  }
})

modelsRoute.openapi(getModelsRoute, async (c) => {
  const models = await getEnabledModels()
  return c.json({ models }, 200)
})
