import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { UpdatePerformResponseSchema } from '../../../schemas'
import { performUpdate } from '../../../services/update'

export const updatePerformRoute = new OpenAPIHono()

const route = createRoute({
  method: 'post',
  path: '/api/update/perform',
  responses: {
    200: {
      description: 'Result of the npm update command',
      content: { 'application/json': { schema: UpdatePerformResponseSchema } }
    }
  }
})
updatePerformRoute.openapi(route, async (c) => {
  const result = await performUpdate()
  return c.json(result, 200)
})
