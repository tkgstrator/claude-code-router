import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { UpdateCheckResponseSchema } from '../../../schemas/api/update'
import { checkForUpdates } from '../../../services/update'
import { APP_VERSION } from '../../../version'

export const updateCheckRoute = new OpenAPIHono()

const route = createRoute({
  method: 'get',
  path: '/api/update/check',
  responses: {
    200: {
      description: 'Compares the installed version against the npm registry',
      content: { 'application/json': { schema: UpdateCheckResponseSchema } }
    }
  }
})
updateCheckRoute.openapi(route, async (c) => {
  const result = await checkForUpdates(APP_VERSION)
  return c.json(result, 200)
})
